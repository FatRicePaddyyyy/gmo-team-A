import { TransferStatusRepository } from "../../domains/transfer/repository";
import { UserRepository } from "../../domains/user/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { PollMessage, Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
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
  env,
  now,
}: {
  env: CloudflareBindings;
  now: Date;
}): Promise<CronPollSummary> {
  const summary: CronPollSummary = { polled: {}, reconciled: 0, expired: 0, serverApproved: 0 };

  // Phase 1: レジストリ poll drain (両レジストリ順に)
  for (const registry of REGISTRIES) {
    summary.polled[registry] = await drainRegistry({ registry, env });
  }

  // Phase 2: タイムアウトした pendingTransfer を info で reconcile
  const cutoff = new Date(now.getTime() - TIMEOUT_MINUTES * 60 * 1000);
  const timedOut = await TransferCronPollRepository.findTimedOutPending({ olderThan: cutoff, env });
  if (!timedOut.success) {
    console.error("TransferCronPoll: findTimedOutPending failed", timedOut.error);
    return summary;
  }
  for (const row of timedOut.data) {
    const outcome = await reconcileTimedOut({ transfer: row.transfer, domain: row.domain, env });
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
  env,
}: {
  registry: Registry;
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

    await handleMessage({ registry, msg, env });
    processed++;
  }

  return processed;
}

async function handleMessage({
  registry,
  msg,
  env,
}: {
  registry: Registry;
  msg: PollMessage;
  env: CloudflareBindings;
}): Promise<void> {
  const domainName = msg.payload.domain;

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
    env,
  });
  if (!found.success) {
    console.error(
      `TransferCronPoll.handleMessage: DB lookup failed for domain=${domainName}`,
      found.error,
    );
    return;
  }

  if (!found.data) {
    // pending 無し = 既に別経路で確定 or backend の管轄外。
    // 過去 settled があるなら念のため ack を保留 (DB replica lag 対策で次回 cron に持ち越す)。
    const hasAny = await TransferCronPollRepository.hasAnyTransferForDomainName({
      name: domainName,
      env,
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
  const isApproved = status === "serverApproved" || status === "clientApproved";
  const isCancelled = status === "clientRejected" || status === "clientCancelled";

  if (!isApproved && !isCancelled) {
    // 中間ステータス (pendingTransfer 等) or 未知。ack せず次回 cron で状態が進んだメッセージを待つ。
    console.warn(
      `TransferCronPoll.handleMessage: intermediate status="${status ?? "<none>"}" for domain=${domainName}. Not acking.`,
    );
    return;
  }

  if (isApproved) {
    const approvedStatus: "serverApproved" | "clientApproved" =
      status === "serverApproved" ? "serverApproved" : "clientApproved";
    // gaining user が消えていたら FK 制約違反で commitApproval が無限失敗するので expired にする。
    const userExists = await UserRepository.exists({ id: transfer.gainingUserId, env });
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
        env,
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
      env,
    });
    if (!commit.success) {
      console.error(
        `TransferCronPoll.handleMessage: commitApproved failed for transferId=${transfer.id}`,
        commit.error,
      );
      return;
    }
  } else {
    const cancelledStatus: "clientRejected" | "clientCancelled" =
      status === "clientRejected" ? "clientRejected" : "clientCancelled";
    const commit = await TransferStatusRepository.settleAndReleaseDomain({
      transferId: transfer.id,
      domainId: transfer.domainId,
      transferStatus: cancelledStatus,
      env,
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
    `TransferCronPoll.handleMessage: settled domain=${domain.name} status=${status ?? "unknown"} registry=${registry}`,
  );
}

// Phase 2: 22 分以上経過した pending を info で真実確認して確定させる。
// 戻り値は summary カウント用。
async function reconcileTimedOut({
  transfer,
  domain,
  env,
}: {
  transfer: { id: string; domainId: string; gainingUserId: string; registry: Registry };
  domain: { name: string };
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
      env,
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
  // gaining user が存在するなら所有権移転、消えていれば expired。
  const userExists = await UserRepository.exists({ id: transfer.gainingUserId, env });
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
      env,
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
    env,
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
