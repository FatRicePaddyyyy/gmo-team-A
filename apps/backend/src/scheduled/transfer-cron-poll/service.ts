import { TransferStatusRepository } from "../../domains/transfer/repository";
import { UserRepository } from "../../domains/user/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { PollMessage, Registry } from "../../lib/bridge/types";
import type { DBClient } from "../../lib/db";
import { OutboundTransferRequestRepository } from "../../routes/transfers/outbound-repository";
import { TransferCronPollRepository } from "./repository";

// 対応レジストリ。Cron のたびに全レジストリを順に drain する。
const REGISTRIES: Registry[] = ["kitaqsign", "kitaqnic"];

// 1 回の cron 発火で drain するときの安全弁。
// レジストリキューが病理的に無限に補充されるバグを踏んでも cron 実行が終わるように、上限で打ち切る。
// 通常運用ではキュー深度は 1 桁で、この上限に触れる想定はない。
const MAX_POLL_ITERATIONS_PER_REGISTRY = 100;

// pendingTransfer をタイムアウト reconcile 対象とみなす経過時間。
// レジストリ仕様 (20 分後に自動承認) + poll イベント到達遅延 + 1 分粒度の cron を考慮して 22 分に設定。
// これより新しい pending は「Phase 1 の poll で受け取る未来」を待つ。
const TIMEOUT_MINUTES = 22;

export interface CronPollSummary {
  polled: Partial<Record<Registry, number>>;
  reconciled: number;
  expired: number;
  serverApproved: number;
}

export async function runTransferCronPoll({
  db,
  env,
  now,
}: {
  db: DBClient;
  env: CloudflareBindings;
  now: Date;
}): Promise<CronPollSummary> {
  const summary: CronPollSummary = { polled: {}, reconciled: 0, expired: 0, serverApproved: 0 };

  // Phase 1: レジストリ poll drain (両レジストリ順に)
  console.info(`[cron:phase1] poll drain start registries=${REGISTRIES.join(",")}`);
  for (const registry of REGISTRIES) {
    const drained = await drainRegistry({ registry, db, env });
    summary.polled[registry] = drained;
    console.info(`[cron:phase1] registry=${registry} processed=${drained} messages`);
  }

  // Phase 2: タイムアウトした pendingTransfer を info で reconcile
  const cutoff = new Date(now.getTime() - TIMEOUT_MINUTES * 60 * 1000);
  console.info(`[cron:phase2] reconcile timed-out pending (cutoff=${cutoff.toISOString()})`);
  const timedOut = await TransferCronPollRepository.findTimedOutPending({ olderThan: cutoff, db });
  if (!timedOut.success) {
    console.error("[cron:phase2] findTimedOutPending failed", timedOut.error);
    return summary;
  }
  console.info(`[cron:phase2] candidates=${timedOut.data.length}`);
  for (const row of timedOut.data) {
    const outcome = await reconcileTimedOut({ transfer: row.transfer, domain: row.domain, db, env });
    if (outcome === "serverApproved") {summary.serverApproved++;}
    if (outcome === "expired") {summary.expired++;}
    if (outcome !== "skipped") {summary.reconciled++;}
  }

  return summary;
}

// 1 レジストリぶんキュー先頭から drain し、処理件数を返す。
// 何らかの理由で「先頭が動かない」状態になったら安全に break する (無限ループ防止)。
async function drainRegistry({
  registry,
  db,
  env,
}: {
  registry: Registry;
  db: DBClient;
  env: CloudflareBindings;
}): Promise<number> {
  let processed = 0;
  let lastSeenId: number | null = null;

  for (let i = 0; i < MAX_POLL_ITERATIONS_PER_REGISTRY; i++) {
    const pollResult = await RegistryBridge.poll({ registry, env });
    if (!pollResult.success) {
      console.warn(`TransferCronPoll.drainRegistry: poll failed for registry=${registry}`, pollResult.error);
      break;
    }
    if (!pollResult.data) {
      // メッセージなし = キュー空。drain 終了。
      break;
    }
    const msg = pollResult.data;

    // 先頭が動かない (前回と同じ id が返る) = 誰も ack できないメッセージがキュー先頭に居座っている。
    // 無限ループを避けるため break。次回 cron に持ち越す。
    if (lastSeenId !== null && msg.id === lastSeenId) {
      console.warn(
        `TransferCronPoll.drainRegistry: head-of-line stuck on messageId=${msg.id} registry=${registry}. Deferring to next cron.`,
      );
      break;
    }
    lastSeenId = msg.id;

    await handleMessage({ registry, msg, db, env });
    processed++;
  }

  return processed;
}

async function handleMessage({
  registry,
  msg,
  db,
  env,
}: {
  registry: Registry;
  msg: PollMessage;
  db: DBClient;
  env: CloudflareBindings;
}): Promise<void> {
  const domainName = msg.payload.domain;

  console.info(
    `[event:${registry}] handle messageId=${msg.id} msgType="${msg.msgType}" domain="${domainName ?? "-"}" status="${msg.payload.status ?? "-"}" op="${msg.payload.op ?? "-"}"`,
  );

  if (!domainName) {
    // payload.domain が無い = 対象ドメインが判別できない。
    // 触らずに放置すると HoL block になるが、実装未知の msgType の可能性もある。
    // 現状は console.warn のみで ack しない (次回 cron の safety break で保護される)。
    console.warn(
      `TransferCronPoll.handleMessage: unrecognized payload (no domain) registry=${registry}`,
      msg,
    );
    return;
  }

  const found = await TransferCronPollRepository.findPendingTransferByDomainName({
    name: domainName,
    db,
  });
  if (!found.success) {
    console.error(
      `TransferCronPoll.handleMessage: DB lookup failed for domain=${domainName}`,
      found.error,
    );
    return;
  }

  if (!found.data) {
    // pending 無し。ここで 4 分岐:
    //   (a) outbound_transfer_requests に pending あり (自 backend の user が別レジストラのドメインを取りに行き中)
    //        → op に応じて確定処理 (approve なら domain 行 INSERT + outbound を clientApproved)
    //   (b) op='request' + 自 backend が知っているドメイン (inbound: 別レジストラが取りに来た)
    //        → transfers に pending 行を INSERT
    //   (c) 過去 settled あり → ack せず持ち越し
    //   (d) 完全に知らないドメイン → ack して先頭を空ける
    const outbound = await OutboundTransferRequestRepository.findPending({
      domainName,
      registry,
      db,
    });
    if (!outbound.success) {
      console.error(
        `TransferCronPoll.handleMessage: outbound findPending failed for domain=${domainName}`,
        outbound.error,
      );
      return;
    }
    if (outbound.data) {
      await handleOutboundMessage({ outbound: outbound.data, msg, registry, db, env });
      return;
    }

    const op = msg.payload.op;
    const counterparty = msg.payload.counterpartyRegistrar;
    if (op === "request" && counterparty) {
      const dom = await TransferCronPollRepository.findDomainByName({ name: domainName, db });
      if (!dom.success) {
        console.error(
          `TransferCronPoll.handleMessage: findDomainByName failed for domain=${domainName}`,
          dom.error,
        );
        return;
      }
      if (dom.data) {
        // 自 backend の管轄ドメイン。cron 検知の外部 pending として DB に INSERT する。
        const inserted = await TransferCronPollRepository.createExternalPending({
          domainId: dom.data.id,
          registry: dom.data.registry,
          gainingRegistrar: counterparty,
          db,
        });
        if (!inserted.success) {
          console.error(
            `TransferCronPoll.handleMessage: createExternalPending failed for domain=${domainName}`,
            inserted.error,
          );
          return;
        }
        // domain.status も pendingTransfer に揃える (owner 側 UI で「移管申請中」を出せるように)
        await TransferCronPollRepository.setDomainPendingTransfer({
          domainId: dom.data.id,
          db,
        });
        console.info(
          `TransferCronPoll.handleMessage: created external pending transfer for domain=${domainName} gainingRegistrar=${counterparty}`,
        );
        // DB に保存できたら request メッセージは ack して先に進める。
        // 次回以降 approve/reject/cancel/serverApproved の別メッセージが別 id で届くので、
        // request メッセージを残す必要はない (むしろ残すとキューが詰まる)。
        await tryAck({ messageId: msg.id, registry, env });
        return;
      }
    }

    const hasAny = await TransferCronPollRepository.hasAnyTransferForDomainName({
      name: domainName,
      db,
    });
    if (!hasAny.success) {
      console.error(
        `TransferCronPoll.handleMessage: hasAnyTransferForDomainName failed for domain=${domainName}`,
        hasAny.error,
      );
      return;
    }
    if (hasAny.data) {
      console.warn(
        `TransferCronPoll.handleMessage: settled transfer exists but no pending for domain=${domainName}. Deferring ack.`,
      );
      return;
    }
    // backend が全く知らないドメイン。ack して先頭を空ける。
    console.warn(
      `TransferCronPoll.handleMessage: orphan message for domain=${domainName} registry=${registry}. Acking.`,
    );
    await tryAck({ messageId: msg.id, registry, env });
    return;
  }

  // 該当 pending あり。ステータス種別で確定処理。
  const { transfer, domain } = found.data;

  // レジストリ mismatch 検知: DB 側の transfer.registry と poll 元のレジストリが違う。
  // レジストリ実装バグ or DB 汚染。HoL block を避けるため ack はする。DB 修復は手動介入。
  if (transfer.registry !== registry) {
    console.error(
      `TransferCronPoll.handleMessage: registry mismatch — DB says ${transfer.registry}, poll came from ${registry}. domain=${domainName}. Acking on ${registry} to avoid HoL block.`,
    );
    await tryAck({ messageId: msg.id, registry, env });
    return;
  }

  const status = msg.payload.status;
  const op = msg.payload.op;

  // レジストリによっては approve/reject/cancel の反映メッセージが payload.status ではなく
  // payload.op のみで通知される (例: kitaqsign の cancel は {op:"cancel"} のみ)。両方を見る。
  const isApproved = status === "serverApproved" || status === "clientApproved" || op === "approve";
  const isCancelled =
    status === "clientRejected" || status === "clientCancelled" || op === "reject" || op === "cancel";

  if (!isApproved && !isCancelled) {
    // 中間ステータス (pendingTransfer 等) or 未知。ack せず次回 cron で状態が進んだメッセージを待つ。
    console.warn(
      `TransferCronPoll.handleMessage: intermediate status="${status ?? "<none>"}" op="${op ?? "<none>"}" for domain=${domainName}. Not acking.`,
    );
    return;
  }

  if (isApproved) {
    const approvedStatus: "serverApproved" | "clientApproved" =
      status === "serverApproved" ? "serverApproved" : "clientApproved";
    console.info(
      `[event:${registry}] settle approved transferId=${transfer.id} domain=${domainName} decidedStatus=${approvedStatus} gainingUserId=${transfer.gainingUserId ?? "<external>"}`,
    );

    if (transfer.gainingUserId === null) {
      // 外部 pending (別レジストラが gaining) の承認確定。
      // 自 backend の user に該当者は居ないので、所有権移転先を書き換える代わりに domain 行を削除する。
      const commit = await TransferStatusRepository.commitApprovedAndDropDomain({
        transferId: transfer.id,
        domainId: transfer.domainId,
        transferStatus: approvedStatus,
        db,
      });
      if (!commit.success) {
        console.error(
          `TransferCronPoll.handleMessage: commitApprovedAndDropDomain failed for transferId=${transfer.id}`,
          commit.error,
        );
        return;
      }
    } else {
      // 自 backend 発 pending (gaining が自 user)。従来通り owner を書き換えて確定。
      // gaining user が消えていたら FK 制約違反で commitApproval が無限失敗するので expired にする。
      const userExists = await UserRepository.exists({ id: transfer.gainingUserId, db });
      if (!userExists.success) {
        console.error(
          `TransferCronPoll.handleMessage: UserRepository.exists failed for transferId=${transfer.id}`,
          userExists.error,
        );
        return;
      }
      if (!userExists.data) {
        console.error(
          `TransferCronPoll.handleMessage: gaining user ${transfer.gainingUserId} no longer exists for transferId=${transfer.id}. Marking expired.`,
        );
        const expire = await TransferStatusRepository.expireAndReleaseDomain({
          transferId: transfer.id,
          domainId: transfer.domainId,
          db,
        });
        if (!expire.success) {
          console.error(
            `TransferCronPoll.handleMessage: expireAndReleaseDomain failed for transferId=${transfer.id}`,
            expire.error,
          );
          return;
        }
        await tryAck({ messageId: msg.id, registry, env });
        return;
      }
      const commit = await TransferStatusRepository.commitApproved({
        transferId: transfer.id,
        domainId: transfer.domainId,
        transferStatus: approvedStatus,
        newOwnerUserId: transfer.gainingUserId,
        db,
      });
      if (!commit.success) {
        console.error(
          `TransferCronPoll.handleMessage: commitApproved failed for transferId=${transfer.id}`,
          commit.error,
        );
        return;
      }
    }
  } else {
    const cancelledStatus: "clientRejected" | "clientCancelled" =
      status === "clientRejected" || op === "reject" ? "clientRejected" : "clientCancelled";
    console.info(
      `[event:${registry}] settle cancelled transferId=${transfer.id} domain=${domainName} decidedStatus=${cancelledStatus}`,
    );
    const commit = await TransferStatusRepository.settleAndReleaseDomain({
      transferId: transfer.id,
      domainId: transfer.domainId,
      transferStatus: cancelledStatus,
      db,
    });
    if (!commit.success) {
      console.error(
        `TransferCronPoll.handleMessage: settleAndReleaseDomain failed for transferId=${transfer.id}`,
        commit.error,
      );
      return;
    }
  }

  await tryAck({ messageId: msg.id, registry, env });
  console.info(
    `[event:${registry}] settled messageId=${msg.id} domain=${domain.name} status="${status ?? "-"}" op="${op ?? "-"}"`,
  );
}

// Phase 2: 22 分以上経過した pending を info で真実確認して確定させる。
// 戻り値は summary カウント用。
async function reconcileTimedOut({
  transfer,
  domain,
  db,
  env,
}: {
  transfer: { id: string; domainId: string; gainingUserId: string | null; registry: Registry };
  domain: { name: string };
  db: DBClient;
  env: CloudflareBindings;
}): Promise<"serverApproved" | "expired" | "skipped"> {
  const infoResult = await RegistryBridge.info({
    name: domain.name,
    registry: transfer.registry,
    env,
  });
  if (!infoResult.success) {
    console.warn(
      `TransferCronPoll.reconcileTimedOut: info failed for domain=${domain.name} — deferring to next cron`,
      infoResult.error,
    );
    return "skipped";
  }

  const stillPending = (infoResult.data.status ?? []).includes("pendingTransfer");
  if (stillPending) {
    // レジストリ側でもまだ pending → 自動承認さえ発火していない異常状態。expired 化して排他解除。
    console.warn(
      `TransferCronPoll.reconcileTimedOut: registry still pending after ${TIMEOUT_MINUTES}m for domain=${domain.name}. Marking expired.`,
    );
    const expire = await TransferStatusRepository.expireAndReleaseDomain({
      transferId: transfer.id,
      domainId: transfer.domainId,
      db,
    });
    if (!expire.success) {
      console.error(
        `TransferCronPoll.reconcileTimedOut: expireAndReleaseDomain failed for transferId=${transfer.id}`,
        expire.error,
      );
      return "skipped";
    }
    return "expired";
  }

  // レジストリでは pending 解除済み = serverApproved 相当 (poll イベントを取りこぼしたケース)。
  if (transfer.gainingUserId === null) {
    // 外部 pending (別レジストラ gaining) の承認確定。domain 行を削除。
    const commit = await TransferStatusRepository.commitApprovedAndDropDomain({
      transferId: transfer.id,
      domainId: transfer.domainId,
      transferStatus: "serverApproved",
      db,
    });
    if (!commit.success) {
      console.error(
        `TransferCronPoll.reconcileTimedOut: commitApprovedAndDropDomain failed for transferId=${transfer.id}`,
        commit.error,
      );
      return "skipped";
    }
    console.info(
      `TransferCronPoll.reconcileTimedOut: reconciled serverApproved (external) via info for domain=${domain.name}. domain row dropped.`,
    );
    return "serverApproved";
  }

  // 自 backend 発 pending の場合。gaining user が存在するなら所有権移転、消えていれば expired。
  const userExists = await UserRepository.exists({ id: transfer.gainingUserId, db });
  if (!userExists.success) {
    console.error(
      `TransferCronPoll.reconcileTimedOut: UserRepository.exists failed for transferId=${transfer.id}`,
      userExists.error,
    );
    return "skipped";
  }
  if (!userExists.data) {
    console.error(
      `TransferCronPoll.reconcileTimedOut: gaining user ${transfer.gainingUserId} no longer exists for transferId=${transfer.id}. Marking expired despite registry approval — MANUAL RECONCILIATION REQUIRED.`,
    );
    const expire = await TransferStatusRepository.expireAndReleaseDomain({
      transferId: transfer.id,
      domainId: transfer.domainId,
      db,
    });
    if (!expire.success) {
      console.error(
        `TransferCronPoll.reconcileTimedOut: expireAndReleaseDomain failed for transferId=${transfer.id}`,
        expire.error,
      );
      return "skipped";
    }
    return "expired";
  }

  const commit = await TransferStatusRepository.commitApproved({
    transferId: transfer.id,
    domainId: transfer.domainId,
    transferStatus: "serverApproved",
    newOwnerUserId: transfer.gainingUserId,
    db,
  });
  if (!commit.success) {
    console.error(
      `TransferCronPoll.reconcileTimedOut: commitApproved failed for transferId=${transfer.id}`,
      commit.error,
    );
    return "skipped";
  }
  console.info(
    `TransferCronPoll.reconcileTimedOut: reconciled serverApproved via info for domain=${domain.name}`,
  );
  return "serverApproved";
}

async function tryAck({
  messageId,
  registry,
  env,
}: {
  messageId: number;
  registry: Registry;
  env: CloudflareBindings;
}): Promise<void> {
  const ack = await RegistryBridge.ackMessage({ messageId, registry, env });
  if (!ack.success) {
    console.warn(
      `TransferCronPoll.tryAck: registry ack failed for messageId=${messageId} registry=${registry}`,
      ack.error,
    );
  }
}

// 自 backend の user が別レジストラのドメインを取りに行った outbound の pending がある状態で
// registry から poll メッセージを受け取った場合の処理。
// - status=approve/serverApproved → domain 行を owner=gainingUserId で INSERT + outbound を確定
// - status=reject/cancel/expire   → outbound を確定 (domain 行は作らない)
// - status=pendingTransfer 等の中間 → 何もしない (ack せず次回持ち越し)
async function handleOutboundMessage({
  outbound,
  msg,
  registry,
  db,
  env,
}: {
  outbound: { id: string; domainName: string; registry: "kitaqsign" | "kitaqnic"; gainingUserId: string; authInfo: string };
  msg: PollMessage;
  registry: Registry;
  db: DBClient;
  env: CloudflareBindings;
}): Promise<void> {
  const status = msg.payload.status;
  const op = msg.payload.op;

  console.info(
    `[event:${registry}] outbound message outboundId=${outbound.id} domain=${outbound.domainName} status="${status ?? "-"}" op="${op ?? "-"}"`,
  );

  const isApproved = status === "serverApproved" || status === "clientApproved" || op === "approve";
  const isCancelled = status === "clientRejected" || status === "clientCancelled" || op === "reject" || op === "cancel";

  if (!isApproved && !isCancelled) {
    // op=request 通知は自 backend が投げた request の反響なので無視 (ack しない、次で消化される想定)。
    // 中間 or 未知は次回 cron で状態が進んだメッセージを待つ。
    console.warn(
      `[event:${registry}] outbound intermediate status="${status ?? "<none>"}" op="${op ?? "<none>"}" domain=${outbound.domainName}. Not acking.`,
    );
    return;
  }

  if (isApproved) {
    // 承認された = 所有権が gaining (自 backend user) に来た。domains 行を新規 INSERT。
    // exDate は info 経由で正確に取得する。
    const infoResult = await RegistryBridge.info({ name: outbound.domainName, registry: outbound.registry, env });
    if (!infoResult.success) {
      console.error(
        `TransferCronPoll.handleOutboundMessage: info failed for domain=${outbound.domainName}`,
        infoResult.error,
      );
      return;
    }
    const expiresAt = new Date(infoResult.data.exDate);
    if (Number.isNaN(expiresAt.getTime())) {
      console.error(
        `TransferCronPoll.handleOutboundMessage: invalid exDate for domain=${outbound.domainName}: ${infoResult.data.exDate}`,
      );
      return;
    }
    const approvedStatus: "serverApproved" | "clientApproved" =
      status === "serverApproved" ? "serverApproved" : "clientApproved";
    const commit = await OutboundTransferRequestRepository.commitApprovedWithDomain({
      outboundId: outbound.id,
      outboundStatus: approvedStatus,
      newDomain: {
        name: outbound.domainName,
        registry: outbound.registry,
        status: "ok",
        expiresAt,
        authInfo: outbound.authInfo,
        ownerUserId: outbound.gainingUserId,
      },
      db,
    });
    if (!commit.success) {
      console.error(
        `TransferCronPoll.handleOutboundMessage: commitApprovedWithDomain failed for domain=${outbound.domainName}`,
        commit.error,
      );
      return;
    }
    console.info(
      `TransferCronPoll.handleOutboundMessage: outbound approved for domain=${outbound.domainName} owner=${outbound.gainingUserId}`,
    );
  } else {
    // 拒否 or 取消。outbound.status を落とすだけ (domain 行は作らない)。
    const cancelledStatus: "clientRejected" | "clientCancelled" =
      status === "clientRejected" || op === "reject" ? "clientRejected" : "clientCancelled";
    const update = await OutboundTransferRequestRepository.updateStatus({
      id: outbound.id,
      status: cancelledStatus,
      db,
    });
    if (!update.success) {
      console.error(
        `TransferCronPoll.handleOutboundMessage: updateStatus failed for outbound=${outbound.id}`,
        update.error,
      );
      return;
    }
    console.info(
      `TransferCronPoll.handleOutboundMessage: outbound ${cancelledStatus} for domain=${outbound.domainName}`,
    );
  }

  await tryAck({ messageId: msg.id, registry, env });
}
