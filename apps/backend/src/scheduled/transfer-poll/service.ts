import { RegistryBridge } from "../../lib/bridge";
import type { PollMessage } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { TransferPollRepository } from "./repository";

// poll の再エンキュー上限。これを超えたら transfer を expired 扱いにして諦める。
// レジストリ側で最大 24 時間程度で自動承認される想定 (20 分 x 72 回)。
export const POLL_MAX_ATTEMPTS = 72;

// 空振り時の次回リトライ間隔 (秒)。20 分。
export const POLL_RETRY_DELAY_SECONDS = 1200;

// process の結果分類。呼び出し側 (queue consumer) がこれを見て ack / retry を判断する。
export type PollProcessOutcome =
  | { kind: "done" }           // 対象の transfer が確定した (approve/reject/cancelledいずれか)。ack 可
  | { kind: "still_pending" }   // レジストリ側でまだ処理中。再エンキューが必要
  | { kind: "expired" }         // 上限超えで諦め
  | { kind: "invalid" };        // 対象の transfer レコードが無い・既に処理済み。ack して終了

export class TransferPollService {
  static async process({
    transferId,
    attempt,
    env,
  }: {
    transferId: string;
    attempt: number;
    env: CloudflareBindings;
  }): Promise<Result<PollProcessOutcome>> {
    const transferResult = await TransferPollRepository.findTransferById({ id: transferId, env });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      // transfer 自体が消えている。ack して終了。
      return { success: true, data: { kind: "invalid" }, error: null };
    }
    const transfer = transferResult.data;

    // 既に別経路 (approve/reject/cancel) で確定している。冪等に ack。
    if (transfer.status !== "pendingTransfer") {
      console.info(`TransferPollService: transfer ${transferId} already processed (status=${transfer.status}), skipping`);
      return { success: true, data: { kind: "invalid" }, error: null };
    }

    const domainResult = await TransferPollRepository.findDomainById({ id: transfer.domainId, env });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      // 対象ドメインが消えている。整合が壊れているので transfer を invalid 化。
      return { success: true, data: { kind: "invalid" }, error: null };
    }
    const domain = domainResult.data;

    // Step 1: Poll
    const pollResult = await RegistryBridge.poll({
      registry: transfer.registry,
      env,
    });
    if (!pollResult.success) {return pollResult;}

    // メッセージなし: レジストリ側でまだ処理中。上限内なら再エンキュー。
    if (!pollResult.data) {
      return handlePendingOrExpired(attempt);
    }

    const pollMessage = pollResult.data;

    // Step 2: メッセージが自分の transfer 用か判定
    if (pollMessage.payload.domain === domain.name) {
      return await handleOwnMessage({ transferId, transfer, domain, pollMessage, env });
    }

    // Step 3: 別ドメインのメッセージだった場合。
    // B4: そのままにしておくと同じメッセージが永遠にキュー先頭に残り、
    // 他 transfer の poll も進まなくなる (head-of-line blocking)。
    // そのメッセージが指すドメインに対応する pending transfer があれば「代行処理」して消化する。
    if (pollMessage.payload.domain) {
      const dispatchResult = await dispatchToOwner({ pollMessage, env });
      if (!dispatchResult.success) {return dispatchResult;}
      // dispatch できたので、キュー先頭は捌けた。自分自身はまだ pending なので再エンキュー。
      return handlePendingOrExpired(attempt);
    }

    // 対象ドメインが判別できないメッセージ (msgType != transfer など)。
    // 消化はできない、ack もできない (別種の consumer が処理する想定)。
    // 自分の transfer はまだ pending なので再エンキュー。
    console.warn(
      `TransferPollService: unrecognized message payload for transferId=${transferId}`,
      pollMessage,
    );
    return handlePendingOrExpired(attempt);
  }
}

// 自分の transfer 用のメッセージだった場合の処理。
async function handleOwnMessage({
  transferId,
  transfer,
  domain,
  pollMessage,
  env,
}: {
  transferId: string;
  transfer: { domainId: string; gainingUserId: string; registry: "kitaqsign" | "kitaqnic" };
  domain: { id: string; name: string };
  pollMessage: PollMessage;
  env: CloudflareBindings;
}): Promise<Result<PollProcessOutcome>> {
  const status = pollMessage.payload.status;

  // DB を先に更新 (ack 前) することでメッセージ喪失を防ぐ。
  if (status === "serverApproved" || status === "clientApproved") {
    const t = await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
    if (!t.success) {return t;}
    const o = await TransferPollRepository.updateDomainOwner({
      id: transfer.domainId,
      newOwnerUserId: transfer.gainingUserId,
      env,
    });
    if (!o.success) {return o;}
    const s = await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
    if (!s.success) {return s;}
  } else if (status === "clientRejected" || status === "clientCancelled") {
    const t = await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
    if (!t.success) {return t;}
    const s = await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
    if (!s.success) {return s;}
  } else {
    console.error(`TransferPollService: unknown status="${status}" for transferId=${transferId} domain=${domain.name}`);
    return { success: false, data: null, error: `unknown_transfer_status: ${status}` };
  }

  // DB 更新後に ack。ack 失敗しても DB が正しいので、次回 poll で同じメッセージを取っても
  // "既に処理済み" として無害にスキップされる。
  const ackResult = await RegistryBridge.ackMessage({
    messageId: pollMessage.id,
    registry: transfer.registry,
    env,
  });
  if (!ackResult.success) {
    console.error(`TransferPollService: ack failed but DB updated. messageId=${pollMessage.id}`);
  }

  return { success: true, data: { kind: "done" }, error: null };
}

// 別ドメインのメッセージだった場合、そのメッセージを消化して先頭を空ける。
async function dispatchToOwner({
  pollMessage,
  env,
}: {
  pollMessage: PollMessage;
  env: CloudflareBindings;
}): Promise<Result<void>> {
  const domainName = pollMessage.payload.domain;
  if (!domainName) {return { success: true, data: undefined, error: null };}

  const found = await TransferPollRepository.findPendingTransferByDomainName({ name: domainName, env });
  if (!found.success) {return found;}
  if (!found.data) {
    // pending な transfer が DB に無い。ack だけしてキューを進める。
    // (別種の消化経路が過去に走った or レジストリと backend が乖離)
    console.warn(`TransferPollService: no pending transfer for domain=${domainName}, ack-ing message id=${pollMessage.id}`);
    const ack = await RegistryBridge.ackMessage({
      messageId: pollMessage.id,
      // レジストリはメッセージ発行側と同一なので、pollMessage が来た registry を再現するために
      // domain.registry から特定する必要はない (dispatch の呼び出し元 poll と同じ registry の consumer)。
      // ただしこのメソッドは pollMessage の出所レジストリを持たないので、found が無い場合はスキップ。
      registry: "kitaqsign",
      env,
    });
    if (!ack.success) {
      console.warn(`TransferPollService: ack failed for orphan message id=${pollMessage.id}`);
    }
    return { success: true, data: undefined, error: null };
  }

  const { transfer, domain } = found.data;
  // 代行処理: 同じ handleOwnMessage を通す。
  const result = await handleOwnMessage({
    transferId: transfer.id,
    transfer: { domainId: transfer.domainId, gainingUserId: transfer.gainingUserId, registry: transfer.registry },
    domain: { id: domain.id, name: domain.name },
    pollMessage,
    env,
  });
  if (!result.success) {return result;}
  return { success: true, data: undefined, error: null };
}

function handlePendingOrExpired(attempt: number): Result<PollProcessOutcome> {
  if (attempt >= POLL_MAX_ATTEMPTS) {
    return { success: true, data: { kind: "expired" }, error: null };
  }
  return { success: true, data: { kind: "still_pending" }, error: null };
}
