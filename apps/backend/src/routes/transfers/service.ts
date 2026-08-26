import { TransferStatusRepository } from "../../domains/transfer/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import { detectRegistry, isValidFqdn } from "../../lib/registry-policy";
import type { transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";
import { TransferDomainRepository } from "./domain-repository";
import { TransferRepository } from "./repository";

type Transfer = typeof transfers.$inferSelect;

// 移管の poll 用 Queue の初回投入待ち時間 (秒)。
// レジストリが自動承認するまでの下限を待つ (Kitaqsign / Kitaqnic はハッカソン用に 20 分)。
const POLL_INITIAL_DELAY_SECONDS = 1200;

export class TransferService {
  static async request({
    name,
    authInfo,
    registry,
    gainingUserId,
    env,
  }: {
    name: string;
    authInfo: string;
    registry: Registry;
    gainingUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer>> {
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

    const domainResult = await TransferDomainRepository.findByName({ name: normalizedName, env });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
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
      env,
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
        env,
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
      env,
    });
    if (!statusUpdateResult.success) {
      // NB-2: 補償 cancel を試み、失敗した場合はレジストリ info で reconciliation する。
      await compensateAndReconcile({
        transferId: transferResult.data.id,
        domain: { id: domain.id, name: normalizedName, currentOwnerUserId: domain.ownerUserId },
        gainingUserId,
        registry,
        env,
      });
      return statusUpdateResult;
    }

    // Drop #1/#2 対策: queue send は必須。失敗すると transfer が pending のまま
    // polling されずに永遠に stuck するため、失敗した場合は compensating cancel で
    // レジストリ・DB とも完全にロールバックし、ユーザーには失敗を返す。
    if (!env.TRANSFER_QUEUE) {
      console.error(
        "TransferService.request: TRANSFER_QUEUE binding is missing. Rolling back to avoid orphan pendingTransfer.",
      );
      await compensateAndReconcile({
        transferId: transferResult.data.id,
        domain: { id: domain.id, name: normalizedName, currentOwnerUserId: domain.ownerUserId },
        gainingUserId,
        registry,
        env,
      });
      return { success: false, data: null, error: "queue_unavailable" };
    }
    try {
      // Queue の retry_delay は wrangler.jsonc で 1200 秒に設定済み。
      // 初回投入時のみ明示的に delaySeconds を指定して初回 poll までの間隔を揃える。
      await env.TRANSFER_QUEUE.send(
        { transferId: transferResult.data.id },
        { delaySeconds: POLL_INITIAL_DELAY_SECONDS },
      );
    } catch (e) {
      console.error(
        "TransferService.request: TRANSFER_QUEUE.send failed for transferId:",
        transferResult.data.id,
        e,
      );
      await compensateAndReconcile({
        transferId: transferResult.data.id,
        domain: { id: domain.id, name: normalizedName, currentOwnerUserId: domain.ownerUserId },
        gainingUserId,
        registry,
        env,
      });
      return { success: false, data: null, error: "queue_unavailable" };
    }

    return { success: true, data: transferResult.data, error: null };
  }

  static async cancel({
    transferId,
    userId,
    env,
  }: {
    transferId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const transferResult = await TransferRepository.findById({ id: transferId, env });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }
    const transfer = transferResult.data;

    if (transfer.gainingUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }
    if (transfer.status !== "pendingTransfer") {
      return { success: false, data: null, error: "transfer_not_cancellable" };
    }

    const domainResult = await TransferDomainRepository.findById({ id: transfer.domainId, env });
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
      env,
    });
    if (!settle.success) {return settle;}

    return { success: true, data: undefined, error: null };
  }

  // B16: ユーザー自身が gaining として申請した移管の一覧。
  // cancel 対象を見つけるための最小 API。
  static async listMine({
    userId,
    env,
  }: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer[]>> {
    return TransferRepository.findByGainingUserId({ userId, env });
  }
}

// NB-2 / Drop #3: 補償 cancel + reconciliation。
// レジストリに transferRequest が通ったが、その後のローカル DB 反映で失敗した場合に呼ばれる。
//
// 遷移保証: このメソッドを終える時点で、transfer は必ず以下のいずれかの状態:
//   (a) DB 上 clientCancelled (レジストリでも取り消し成功) → 終了
//   (b) DB 上 pendingTransfer + queue に message あり → poll 経路で最終的に決着
//   (c) DB 上 serverApproved / clientApproved (レジストリ確定済み) → 終了
// つまり "pending なのに queue に何もない" 状態を絶対に作らない。
async function compensateAndReconcile({
  transferId,
  domain,
  gainingUserId,
  registry,
  env,
}: {
  transferId: string;
  domain: { id: string; name: string; currentOwnerUserId: string };
  gainingUserId: string;
  registry: Registry;
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
      env,
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
        // (b) レジストリでもまだ pending。DB を pendingTransfer に合わせて poll に任せる。
        // Drop #3: 必ず queue に投入し、poll で最終的な決着を保証する。
        console.warn(`TransferService: registry still pending; deferring to poll.`);
        const rDom = await TransferDomainRepository.updateStatus({ id: domain.id, status: "pendingTransfer", env });
        if (!rDom.success) {console.error("compensateAndReconcile: sync domain pendingTransfer failed", rDom.error);}
        await enqueuePollBestEffort({ transferId, env });
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
          env,
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
    // Drop #3: info も失敗。レジストリの真実が分からないので、
    // 最終的に poll で解決するよう queue に投入する。max_retries で最終的に DLQ 経由 expired に落ちる。
    console.error(
      "compensateAndReconcile: info call failed after transfer_not_found. Deferring to poll.",
      info.error,
    );
    await enqueuePollBestEffort({ transferId, env });
    return;
  }

  // その他の cancel 失敗 (network_error など)。
  // Drop #3: レジストリ側の状態が不明なので、poll で決着させる。
  console.error(
    `TransferService: compensating cancel failed with error=${compensate.error}. Deferring to poll.`,
  );
  await enqueuePollBestEffort({ transferId, env });
}

// enqueuePollBestEffort: reconciliation 経路から queue に投入する。
// この関数の失敗はログのみ。呼び出し元は既に "request 全体を失敗として返す" と決めているので、
// queue send が失敗しても DB は不整合状態のままロールバックできない (transferCancel も既に失敗している)。
// ユーザーには 503 で失敗を返して手動介入を促す設計。
async function enqueuePollBestEffort({
  transferId,
  env,
}: {
  transferId: string;
  env: CloudflareBindings;
}): Promise<void> {
  if (!env.TRANSFER_QUEUE) {
    console.error(
      `enqueuePollBestEffort: TRANSFER_QUEUE binding missing; cannot enqueue transferId=${transferId}.`,
    );
    return;
  }
  try {
    await env.TRANSFER_QUEUE.send(
      { transferId },
      { delaySeconds: POLL_INITIAL_DELAY_SECONDS },
    );
  } catch (e) {
    console.error(`enqueuePollBestEffort: queue send failed for transferId=${transferId}`, e);
  }
}
