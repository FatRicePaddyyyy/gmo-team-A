import { TransferStatusRepository } from "../../domains/transfer/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { DBClient } from "../../lib/db";
import { detectRegistry, isValidFqdn } from "../../lib/registry-policy";
import type { outboundTransferRequests, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";
import { TransferDomainRepository } from "./domain-repository";
import { OutboundTransferRequestRepository } from "./outbound-repository";
import { TransferRepository } from "./repository";

type Transfer = typeof transfers.$inferSelect;
type OutboundRequest = typeof outboundTransferRequests.$inferSelect;

// TransferService.request の返り値。
// (a) inbound (自 backend の domain を別 user に移管) の場合 = 従来通り Transfer 行
// (b) outbound (別レジストラ domain を取りに行く) の場合 = OutboundRequest 行
export type TransferRequestResult =
  | { kind: "inbound"; transfer: Transfer }
  | { kind: "outbound"; request: OutboundRequest };

export class TransferService {
  static async request({
    name,
    authInfo,
    registry,
    gainingUserId,
    db,
    env,
  }: {
    name: string;
    authInfo: string;
    registry: Registry;
    gainingUserId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<TransferRequestResult>> {
    // B15/NB-4: FQDN 形式は Zod でも検証しているが、service 層でも念のためチェック。
    // 正規化 (trim + lowercase) してから RFC 1035 準拠の isValidFqdn を通す。
    const normalizedName = name.trim().toLowerCase();
    if (!isValidFqdn(normalizedName)) {
      return { success: false, data: null, error: "invalid_domain_name" };
    }

    // B17: 引数の registry と TLD から推定した registry が一致するかを検証する。
    // 不一致は Zod でも検知できないので service 層で弾く。
    const detected = detectRegistry(normalizedName);
    if (detected && detected !== registry) {
      return { success: false, data: null, error: "invalid_domain_registry" };
    }

    const domainResult = await TransferDomainRepository.findByName({ name: normalizedName, db });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      // backend DB に該当ドメイン無し = 外部レジストラのドメインを取りに行くケース (outbound)。
      // outbound_transfer_requests に pending を INSERT + registry に transferRequest を投げる。
      return await requestOutbound({ name: normalizedName, authInfo, registry, gainingUserId, db, env });
    }
    const domain = domainResult.data;

    // B1: gaining が losing と同じ = 自分のドメインを自分に移管申請しようとしている
    // 実質的な情報漏洩でもあるので拒否する。
    if (domain.ownerUserId === gainingUserId) {
      return { success: false, data: null, error: "self_transfer" };
    }

    // ドメインが移管可能な状態 (ok) にあるかを確認する。
    // B7: pickPrimaryStatus 修正で "ok" が優先されるようになったので、
    // clientTransferProhibited 等は別途拒否
    if (domain.status !== "ok") {
      // 既に pendingTransfer なら明示的な理由でエラーを返す。DB unique index があるので
      // race で 2 件目が来ても insert 時に落ちるが、ここで早期に拒否する。
      if (domain.status === "pendingTransfer") {
        return { success: false, data: null, error: "transfer_already_pending" };
      }
      return { success: false, data: null, error: "domain_not_transferable" };
    }

    // NB-9: 並列 request 対策として、bridge を叩く前に DB に排他確保する。
    // partial UNIQUE index (domainId WHERE status='pendingTransfer') により、
    // 同時実行の 2 件目は DB insert 時に落ちる。
    // 万が一 bridge が失敗したら DB レコードを clientCancelled にして排他解除。
    const transferResult = await TransferRepository.create({
      data: {
        domainId: domain.id,
        registry,
        status: "pendingTransfer",
        gainingUserId,
      },
      db,
    });
    if (!transferResult.success) {
      // Smell 対策: UNIQUE violation (別 request との race) と generic D1 error を区別する。
      // TransferRepository.create は classifyDbError() の結果 (unique_violation / fk_violation / db_error)
      // または transfer_create_failed を返す。unique_violation だけを既存 pending として意味付ける。
      if (transferResult.error === "unique_violation") {
        return { success: false, data: null, error: "transfer_already_pending" };
      }
      return transferResult;
    }

    // ここから先で失敗したら、DB の transfer レコードは "clientCancelled" にして排他解除する。
    const rollbackTransferRecord = async (reason: string): Promise<void> => {
      console.error(`TransferService.request: rolling back transfer record (${reason})`);
      const r = await TransferRepository.updateStatus({
        id: transferResult.data.id,
        status: "clientCancelled",
        db,
      });
      if (!r.success) {
        console.error("TransferService.request: rollback transfer status failed", r.error);
      }
    };

    const bridgeResult = await RegistryBridge.transferRequest({ name: normalizedName, authInfo, registry, env });
    if (!bridgeResult.success) {
      // レジストリ側は動いていないので、DB の排他だけ解除して終了。
      await rollbackTransferRecord(`bridge failed: ${bridgeResult.error}`);
      return bridgeResult;
    }

    // domain.status を pendingTransfer に更新。ここから先の失敗は
    // レジストリ側に既に反映されているので、"補償 cancel + reconciliation" が必要。
    const statusUpdateResult = await TransferDomainRepository.updateStatus({
      id: domain.id,
      status: "pendingTransfer",
      db,
    });
    if (!statusUpdateResult.success) {
      // NB-2: 補償 cancel を試み、失敗した場合はレジストリ info で reconciliation する。
      await compensateAndReconcile({
        transferId: transferResult.data.id,
        domain: { id: domain.id, name: normalizedName, currentOwnerUserId: domain.ownerUserId },
        gainingUserId,
        registry,
        db,
        env,
      });
      return statusUpdateResult;
    }

    // ここに到達した時点で DB は pendingTransfer、レジストリも request が通っている。
    // 以降の確定処理は 1 分ごとの cron (scheduled/transfer-cron-poll) が両レジストリを
    // drain して行う。加えて 22 分経過しても pending のままなら同 cron の Phase 2 が
    // info で真実確認して serverApproved / expired に確定させる。
    return {
      success: true,
      data: { kind: "inbound", transfer: transferResult.data },
      error: null,
    };
  }

  static async cancel({
    transferId,
    userId,
    db,
    env,
  }: {
    transferId: string;
    userId: string;
    db: DBClient;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const transferResult = await TransferRepository.findById({ id: transferId, db });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      // inbound 側 (自 backend の transfers) に無ければ outbound_transfer_requests を検索。
      // teama が別レジストラのドメインを取りに行った申請を取消するケース。
      return await cancelOutbound({ outboundId: transferId, userId, db, env });
    }
    const transfer = transferResult.data;

    if (transfer.gainingUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }
    if (transfer.status !== "pendingTransfer") {
      return { success: false, data: null, error: "transfer_not_cancellable" };
    }

    const domainResult = await TransferDomainRepository.findById({ id: transfer.domainId, db });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    const bridgeResult = await RegistryBridge.transferCancel({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!bridgeResult.success) {return bridgeResult;}

    // R2: 2 更新を batch でアトミック化。中間で落ちて domain.status=pendingTransfer で
    // 永久ロックされるのを防ぐ。
    const settle = await TransferStatusRepository.settleAndReleaseDomain({
      transferId,
      domainId: transfer.domainId,
      transferStatus: "clientCancelled",
      db,
    });
    if (!settle.success) {return settle;}

    return { success: true, data: undefined, error: null };
  }

  // B16: ユーザー自身が gaining として申請した移管の一覧。
  // cancel 対象を見つけるための最小 API。
  static async listMine({
    userId,
    db,
  }: {
    userId: string;
    db: DBClient;
  }): Promise<Result<Transfer[]>> {
    return TransferRepository.findByGainingUserId({ userId, db });
  }
}

// NB-2 / Drop #3: 補償 cancel + reconciliation。
// レジストリに transferRequest が通ったが、その後のローカル DB 反映で失敗した場合に呼ばれる。
//
// 遷移保証: このメソッドを終える時点で、transfer は必ず以下のいずれかの状態:
//   (a) DB 上 clientCancelled (レジストリでも取り消し成功) → 終了
//   (b) DB 上 pendingTransfer → 次回 cron が poll / info で最終的に決着
//   (c) DB 上 serverApproved / clientApproved (レジストリ確定済み) → 終了
// (b) の状態を残すだけでよい理由: 1 分ごとの cron が両レジストリを drain するので、
// 20 分の自動承認 or losing の approve/reject/cancel いずれかで必ず決着する。
async function compensateAndReconcile({
  transferId,
  domain,
  gainingUserId,
  registry,
  db,
  env,
}: {
  transferId: string;
  domain: { id: string; name: string; currentOwnerUserId: string };
  gainingUserId: string;
  registry: Registry;
  db: DBClient;
  env: CloudflareBindings;
}): Promise<void> {
  const compensate = await RegistryBridge.transferCancel({ name: domain.name, registry, env });

  if (compensate.success) {
    // (a) レジストリ側は取り消せた。DB を戻して終了。
    // Smell 1: transfer.status + domain.status を 1 トランザクションで戻すことで、
    // 中間で落ちて domain.status=pendingTransfer で永久ロックされるのを防ぐ。
    console.warn(`TransferService: compensating cancel succeeded for transferId=${transferId}. Rolling back DB.`);
    const rollback = await TransferStatusRepository.settleAndReleaseDomain({
      transferId,
      domainId: domain.id,
      transferStatus: "clientCancelled",
      db,
    });
    if (!rollback.success) {
      console.error("compensateAndReconcile: batched rollback failed", rollback.error);
    }
    return;
  }

  // cancel が失敗した理由が「もう存在しない」= レジストリ側で既に確定 or 進行中。
  if (compensate.error === "transfer_not_found") {
    console.warn(
      `TransferService: compensating cancel returned transfer_not_found. Reconciling with registry info for domain=${domain.name}.`,
    );
    const info = await RegistryBridge.info({ name: domain.name, registry, env });
    if (info.success) {
      const isStillPending = (info.data.status ?? []).includes("pendingTransfer");
      if (isStillPending) {
        // (b) レジストリでもまだ pending。DB を pendingTransfer に合わせて cron に任せる。
        console.warn(`TransferService: registry still pending; deferring to cron.`);
        const rDom = await TransferDomainRepository.updateStatus({ id: domain.id, status: "pendingTransfer", db });
        if (!rDom.success) {console.error("compensateAndReconcile: sync domain pendingTransfer failed", rDom.error);}
      } else {
        // (c) レジストリでは確定済み。gaining ユーザーがオーナーになった前提で DB を反映する。
        // 従来は status だけ変えて owner は据え置いていたが、それだと DB とレジストリで
        // ownership が乖離するので commitApproved で 1 トランザクションで整合させる。
        console.warn(
          `TransferService: registry transfer already settled; committing serverApproved and reassigning ownership to gainingUserId=${gainingUserId}.`,
        );
        const commit = await TransferStatusRepository.commitApproved({
          transferId,
          domainId: domain.id,
          transferStatus: "serverApproved",
          newOwnerUserId: gainingUserId,
          db,
        });
        if (!commit.success) {
          console.error(
            `compensateAndReconcile: commitApproved (serverApproved) failed for transferId=${transferId}. Manual reconciliation required.`,
            commit.error,
          );
        }
      }
      return;
    }
    // info も失敗。レジストリの真実は次回 cron の Phase 2 (22 分経過 pending の info reconcile) に委ねる。
    console.error(
      "compensateAndReconcile: info call failed after transfer_not_found. Deferring to next cron.",
      info.error,
    );
    return;
  }

  // その他の cancel 失敗 (network_error など)。
  // レジストリ側の状態は不明。DB は pendingTransfer のまま残し、次回 cron に委ねる。
  console.error(
    `TransferService: compensating cancel failed with error=${compensate.error}. Deferring to next cron.`,
  );
}

// 別レジストラのドメインを取りに行く outbound リクエスト。
// backend DB に domain 行を作らずに outbound_transfer_requests に pending を INSERT する。
// registry.transferRequest で authInfo 不一致等は登録元 registry が拒否するので、
// backend 側での事前 authInfo バリデーションは不要 (bridge が authInfo_mismatch で返す)。
//
// 遷移保証:
//   (a) outbound INSERT 成功 + registry request 成功 → outbound.status = pendingTransfer
//   (b) INSERT 成功 + registry request 失敗       → outbound を clientCancelled にして即返す
//   (c) INSERT 失敗                                → その error を返す
async function requestOutbound({
  name,
  authInfo,
  registry,
  gainingUserId,
  db,
  env,
}: {
  name: string;
  authInfo: string;
  registry: Registry;
  gainingUserId: string;
  db: DBClient;
  env: CloudflareBindings;
}): Promise<Result<TransferRequestResult>> {
  const outboundResult = await OutboundTransferRequestRepository.create({
    data: {
      domainName: name,
      registry,
      status: "pendingTransfer",
      gainingUserId,
      authInfo,
    },
    db,
  });
  if (!outboundResult.success) {
    if (outboundResult.error === "unique_violation") {
      return { success: false, data: null, error: "transfer_already_pending" };
    }
    return outboundResult;
  }

  const bridgeResult = await RegistryBridge.transferRequest({ name, authInfo, registry, env });
  if (!bridgeResult.success) {
    // registry 側は動いていないので outbound を clientCancelled にして排他解除。
    const rollback = await OutboundTransferRequestRepository.updateStatus({
      id: outboundResult.data.id,
      status: "clientCancelled",
      db,
    });
    if (!rollback.success) {
      console.error(
        `requestOutbound: rollback (clientCancelled) failed for id=${outboundResult.data.id}`,
        rollback.error,
      );
    }
    return bridgeResult;
  }

  return {
    success: true,
    data: { kind: "outbound", request: outboundResult.data },
    error: null,
  };
}

// outbound_transfer_requests に対する取消 (gaining ユーザーが自分で申請を取り下げる)。
// registry に transferCancel を投げて成功したら outbound.status を clientCancelled に更新。
async function cancelOutbound({
  outboundId,
  userId,
  db,
  env,
}: {
  outboundId: string;
  userId: string;
  db: DBClient;
  env: CloudflareBindings;
}): Promise<Result<void>> {
  const found = await OutboundTransferRequestRepository.findById({ id: outboundId, db });
  if (!found.success) {return found;}
  if (!found.data) {
    return { success: false, data: null, error: "transfer_not_found" };
  }
  const outbound = found.data;

  if (outbound.gainingUserId !== userId) {
    return { success: false, data: null, error: "forbidden" };
  }
  if (outbound.status !== "pendingTransfer") {
    return { success: false, data: null, error: "transfer_not_cancellable" };
  }

  const bridgeResult = await RegistryBridge.transferCancel({
    name: outbound.domainName,
    registry: outbound.registry,
    env,
  });
  if (!bridgeResult.success) {return bridgeResult;}

  const update = await OutboundTransferRequestRepository.updateStatus({
    id: outbound.id,
    status: "clientCancelled",
    db,
  });
  if (!update.success) {return update;}

  return { success: true, data: undefined, error: null };
}
