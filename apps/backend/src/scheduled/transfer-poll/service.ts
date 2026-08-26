import { TransferStatusRepository } from "../../domains/transfer/repository";
import { UserRepository } from "../../domains/user/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { PollMessage, Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { TransferPollRepository } from "./repository";

// process の結果分類。呼び出し側 (queue consumer) がこれを見て Cloudflare Queue の
// ack / retry を判断する。retry は wrangler.jsonc の max_retries と retry_delay に従う。
//
// 用語:
//   - Cloudflare Queue の ack/retry:  backend が管理するリトライ
//   - レジストリ側の ack:              レジストリのメッセージキューの消し込み
//                                     (未 ack だと次回 poll で同じメッセージが返る)
export type PollProcessOutcome =
  | { kind: "done" }           // 対象 transfer が確定した。Cloudflare Queue ack。
  | { kind: "still_pending" }; // まだ処理中 or 別 transfer 用メッセージ dispatch のみ。Cloudflare Queue retry。

export class TransferPollService {
  static async process({
    transferId,
    env,
  }: {
    transferId: string;
    env: CloudflareBindings;
  }): Promise<Result<PollProcessOutcome>> {
    const transferResult = await TransferPollRepository.findTransferById({ id: transferId, env });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      // transfer 自体が消えている (DB clean up 済み)。Cloudflare Queue は ack して終了。
      return { success: true, data: { kind: "done" }, error: null };
    }
    const transfer = transferResult.data;

    // 既に別経路 (approve/reject/cancel) で確定している。冪等に Cloudflare Queue ack。
    if (transfer.status !== "pendingTransfer") {
      console.info(`TransferPollService: transfer ${transferId} already processed (status=${transfer.status}), skipping`);
      return { success: true, data: { kind: "done" }, error: null };
    }

    const domainResult = await TransferPollRepository.findDomainById({ id: transfer.domainId, env });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      // Drop #6: ドメインが消えている = 整合が壊れている。
      // ack すると transfer が pendingTransfer のまま孤児化するので、
      // failure を返して Cloudflare Queue に retry させる。max_retries 超過で DLQ に届き、
      // DLQ consumer が transfer.status = "expired" にマークして最終処理する。
      console.error(`TransferPollService: domain missing for transferId=${transferId}. Retrying — will expire via DLQ.`);
      return { success: false, data: null, error: "domain_not_found_during_poll" };
    }
    const domain = domainResult.data;

    // Step 1: レジストリを poll
    const pollResult = await RegistryBridge.poll({
      registry: transfer.registry,
      env,
    });
    if (!pollResult.success) {return pollResult;}

    // メッセージなし: レジストリ側でまだ処理中。Cloudflare Queue に retry させて次回まで待つ。
    // (レジストリ側 ack 対象がそもそもいない)
    if (!pollResult.data) {
      return { success: true, data: { kind: "still_pending" }, error: null };
    }

    const pollMessage = pollResult.data;

    // Step 2: 自分の transfer 用メッセージか判定
    if (pollMessage.payload.domain === domain.name) {
      return await handleOwnMessage({ transferId, transfer, domain, pollMessage, env });
    }

    // Step 3: 別ドメインのメッセージ。
    // レジストリの poll はキュー先頭 1 件を返す方式なので、放置すると head-of-line blocking
    // が発生する (未 ack のまま先頭に居座り、他 transfer の poll も進まなくなる)。
    // 該当ドメインの pending transfer を DB から探して代行処理する。
    if (pollMessage.payload.domain) {
      const dispatchResult = await dispatchToOwner({ pollMessage, pollRegistry: transfer.registry, env });
      if (!dispatchResult.success) {return dispatchResult;}
      // dispatch でレジストリ側は ack 済み。自分自身はまだ pending なので Cloudflare Queue retry。
      return { success: true, data: { kind: "still_pending" }, error: null };
    }

    // 対象ドメインが判別できない (payload.domain が無い等)。
    // レジストリ ack はしない (別種 consumer の担当かもしれない)。
    // 自分の transfer はまだ pending なので Cloudflare Queue retry。
    //
    // Smell 4 対策: レジストリキュー先頭に不明メッセージが居座り続けると自 transfer の
    // retry_burn が発生して DLQ に早期到達する可能性がある。ただし DLQ consumer は
    // レジストリ info を叩いて真実 (serverApproved / pending 継続) を確認してから確定するため、
    // 誤 expired にはならない。連続で不明メッセージが返るのは registry 実装のバグ相当 = 手動介入対象。
    console.warn(
      `TransferPollService: unrecognized message payload for transferId=${transferId} — will retry, DLQ will reconcile via registry info if this persists`,
      pollMessage,
    );
    return { success: true, data: { kind: "still_pending" }, error: null };
  }
}

// 自分の transfer 用メッセージの処理。
// - 確定ステータス (approved/rejected/cancelled) → DB 反映 + レジストリ ack → Cloudflare Queue ack
// - 中間ステータス (pending 系 / 未知)           → 何もしない (レジストリ ack しない) → Cloudflare Queue retry
async function handleOwnMessage({
  transferId,
  transfer,
  domain,
  pollMessage,
  env,
}: {
  transferId: string;
  transfer: { domainId: string; gainingUserId: string; registry: Registry };
  domain: { id: string; name: string };
  pollMessage: PollMessage;
  env: CloudflareBindings;
}): Promise<Result<PollProcessOutcome>> {
  const status = pollMessage.payload.status;
  const isApproved = status === "serverApproved" || status === "clientApproved";
  const isCancelled = status === "clientRejected" || status === "clientCancelled";

  if (!isApproved && !isCancelled) {
    // 中間 or 未知。**レジストリ側 ack はしない**。
    // 未 ack のまま残しておけば次回 poll で状態が進んだメッセージが返ってくる。
    // Cloudflare Queue は retry させて再度 poll する。
    console.warn(
      `TransferPollService: intermediate/unknown status="${status ?? "<none>"}" for transferId=${transferId} domain=${domain.name} — leaving message unacked`,
    );
    return { success: true, data: { kind: "still_pending" }, error: null };
  }

  // Drop #8: DB を先に更新 (レジストリ ack 前) することでメッセージ喪失を防ぐ。
  // db.batch で複数更新を 1 トランザクションにまとめ、部分的な中間状態を作らない。
  if (isApproved) {
    const approvedStatus: "serverApproved" | "clientApproved" =
      status === "serverApproved" ? "serverApproved" : "clientApproved";
    // R6: gaining user が消えている場合は FK 制約違反で commitApproval が永遠に失敗し、
    // Cloudflare Queue が無限 retry する。事前にチェックして terminal 扱い (expired) にする。
    const userExists = await UserRepository.exists({ id: transfer.gainingUserId, env });
    if (!userExists.success) {return userExists;}
    if (!userExists.data) {
      console.error(
        `TransferPollService: gaining user ${transfer.gainingUserId} no longer exists for transferId=${transferId}. Marking expired.`,
      );
      // B-2 対策: 2 更新を batch でアトミック化。以前は sequential update だったため、
      // 中間で失敗すると transfer=expired + domain=pendingTransfer で永久ロックになった。
      const expire = await TransferStatusRepository.expireAndReleaseDomain({
        transferId,
        domainId: transfer.domainId,
        env,
      });
      if (!expire.success) {return expire;}
      // レジストリ側 ack もして、キュー先頭を空ける。
      const ack = await RegistryBridge.ackMessage({
        messageId: pollMessage.id,
        registry: transfer.registry,
        env,
      });
      if (!ack.success) {
        console.error(`TransferPollService: registry ack failed after gaining-user-expired for transferId=${transferId}`);
      }
      return { success: true, data: { kind: "done" }, error: null };
    }
    // S-A: 共通の TransferStatusRepository に集約 (NB-8)。
    const commit = await TransferStatusRepository.commitApproved({
      transferId,
      domainId: transfer.domainId,
      transferStatus: approvedStatus,
      newOwnerUserId: transfer.gainingUserId,
      env,
    });
    if (!commit.success) {return commit;}
  } else {
    const cancelledStatus: "clientRejected" | "clientCancelled" =
      status === "clientRejected" ? "clientRejected" : "clientCancelled";
    // S-A: 共通の TransferStatusRepository に集約 (NB-8)。
    const commit = await TransferStatusRepository.settleAndReleaseDomain({
      transferId,
      domainId: transfer.domainId,
      transferStatus: cancelledStatus,
      env,
    });
    if (!commit.success) {return commit;}
  }

  // DB 反映後にレジストリ側 ack。
  const ackResult = await RegistryBridge.ackMessage({
    messageId: pollMessage.id,
    registry: transfer.registry,
    env,
  });
  if (!ackResult.success) {
    console.error(`TransferPollService: registry ack failed but DB updated. messageId=${pollMessage.id}`);
    // DB は正しいので Cloudflare Queue は ack する。次回 poll で同じメッセージが返ってきても
    // transfer.status !== pendingTransfer で冪等にスキップされる。
  }

  return { success: true, data: { kind: "done" }, error: null };
}

// 別ドメインのメッセージを代行処理してレジストリキューの先頭を空ける。
// - 該当 pending transfer が見つかれば handleOwnMessage を通す (確定処理 → レジストリ ack)
// - 見つからなければ (orphan)、そのまま放置すると HoL blocking なので、
//   レジストリ側だけ ack してキューを進める。
async function dispatchToOwner({
  pollMessage,
  pollRegistry,
  env,
}: {
  pollMessage: PollMessage;
  pollRegistry: Registry;
  env: CloudflareBindings;
}): Promise<Result<void>> {
  const domainName = pollMessage.payload.domain;
  if (!domainName) {return { success: true, data: undefined, error: null };}

  const found = await TransferPollRepository.findPendingTransferByDomainName({ name: domainName, env });
  if (!found.success) {return found;}

  if (!found.data) {
    // Drop #7: pending が無いだけでは orphan と決めつけない。同ドメインに settled transfer があるかを追加確認する。
    // ある = backend の管轄下だが (a) DB replica lag で pending 未検出 or (b) 既に別経路で確定済み。
    //         → ack はしないで retry で再確認 (次回 poll でも同じメッセージが返る)
    // 無い = 完全に backend の関知しないドメイン (別テナントの残骸など)。
    //         → 安全に ack して先頭を空ける
    const hasAny = await TransferPollRepository.hasAnyTransferForDomainName({ name: domainName, env });
    if (!hasAny.success) {return hasAny;}
    if (hasAny.data) {
      console.warn(
        `TransferPollService: no pending transfer but settled records exist for domain=${domainName}. Leaving message unacked (will retry).`,
      );
      return { success: true, data: undefined, error: null };
    }
    // S3: race window narrow化 — hasAny=false 判定と ack の間に新規 request が
    // pending を作った場合、その pending 用メッセージを誤 ack する可能性がある。
    // 直前にもう 1 度 pending チェックしてから ack することで window を最小化する。
    const recheck = await TransferPollRepository.findPendingTransferByDomainName({ name: domainName, env });
    if (!recheck.success) {return recheck;}
    if (recheck.data) {
      // race で recheck 時点では pending ができていた。ack せず処理を切り替える。
      console.warn(
        `TransferPollService: race detected — pending transfer created between orphan check and ack for domain=${domainName}. Retrying.`,
      );
      return { success: true, data: undefined, error: null };
    }
    console.warn(
      `TransferPollService: no transfer at all for domain=${domainName}, ack-ing orphan message id=${pollMessage.id} on registry=${pollRegistry}`,
    );
    const ack = await RegistryBridge.ackMessage({
      messageId: pollMessage.id,
      registry: pollRegistry,
      env,
    });
    if (!ack.success) {
      console.warn(`TransferPollService: registry ack failed for orphan message id=${pollMessage.id} on registry=${pollRegistry}`);
    }
    return { success: true, data: undefined, error: null };
  }

  const { transfer, domain } = found.data;
  // R7 / S2: transfer.registry と pollRegistry が違うのは DB 汚染相当の異常。
  // 例: transfer.registry='kitaqnic' の DB レコードに対して、kitaqsign 側 poll に payload.domain
  // が一致するメッセージが来たケース。これはレジストリ実装のバグまたは backend の DB 汚染。
  //
  // 対処: DB 側は触らず (transfer.registry が壊れているだけなので confusing な状態を悪化させない)、
  // 一方で **レジストリ側の pollRegistry では ack を試みる**。ack しないと HoL block を起こして
  // 他 transfer の 50 分予算を消費してしまう。DB 側の修復は手動介入対象なので console.error で通知。
  if (transfer.registry !== pollRegistry) {
    console.error(
      `TransferPollService: registry mismatch — DB says transfer.registry=${transfer.registry}, poll came from ${pollRegistry}. domain=${domainName}. Acking the message to avoid HoL block; DB correction is a manual op.`,
    );
    const ack = await RegistryBridge.ackMessage({
      messageId: pollMessage.id,
      registry: pollRegistry,
      env,
    });
    if (!ack.success) {
      console.warn(
        `TransferPollService: registry ack failed for mismatch message id=${pollMessage.id} on registry=${pollRegistry}`,
        ack.error,
      );
    }
    return { success: true, data: undefined, error: null };
  }
  // 代行処理: 同じ handleOwnMessage を通す。レジストリ ack は pollRegistry を使う。
  const result = await handleOwnMessage({
    transferId: transfer.id,
    transfer: { domainId: transfer.domainId, gainingUserId: transfer.gainingUserId, registry: pollRegistry },
    domain: { id: domain.id, name: domain.name },
    pollMessage,
    env,
  });
  if (!result.success) {return result;}
  return { success: true, data: undefined, error: null };
}
