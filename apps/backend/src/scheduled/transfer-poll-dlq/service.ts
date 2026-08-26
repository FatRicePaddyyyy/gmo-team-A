import { TransferStatusRepository } from "../../domains/transfer/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { TransferPollDlqRepository } from "./repository";

// DLQ に届いた = poll consumer が max_retries を超えても確定できなかった transfer。
//
// 単純に expired にマークしてしまうと、レジストリ側で既に serverApproved になっている
// ケースを見逃す。DB が「expired = 移管なし」となってレジストリと乖離してしまう。
//
// 対策: レジストリの info を叩いて真実を確認する。
//   - レジストリでも pendingTransfer が残っている → expired にマーク
//   - レジストリでは既に完了 (pendingTransfer が status[] に無い) → serverApproved 扱いで所有権を反映
//   - info 呼び出し自体が失敗 → retry (Cloudflare Queues が DLQ 側 max_retries=10 で再試行)
//
// 加えて、いずれの終端処理でも「レジストリ側キュー先頭にこの transfer 用メッセージが残っていれば ack」する
// (Bug 3/4 対策)。ack しないとキュー先頭に居座って他の transfer の poll が HoL block される。
export class TransferPollDlqService {
  static async expire({
    transferId,
    env,
  }: {
    transferId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const transferResult = await TransferPollDlqRepository.findTransferById({ id: transferId, env });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      // 既に消えている。冪等に success で終了。
      return { success: true, data: undefined, error: null };
    }
    const transfer = transferResult.data;

    // 既に確定済み (approve/reject/cancel/expired) なら DB は触らないが、
    // レジストリ側にメッセージが残っている可能性もあるので ack だけ試みる。
    if (transfer.status !== "pendingTransfer") {
      console.info(
        `TransferPollDlqService: transferId=${transferId} already settled (status=${transfer.status}), attempting registry ack only`,
      );
      const domainResult = await TransferPollDlqRepository.findDomainById({ id: transfer.domainId, env });
      if (domainResult.success && domainResult.data) {
        await tryAckOwnMessage({ domainName: domainResult.data.name, registry: transfer.registry, env });
      }
      return { success: true, data: undefined, error: null };
    }

    // domain を引いて info を叩く。
    const domainResult = await TransferPollDlqRepository.findDomainById({ id: transfer.domainId, env });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      // ドメインが消えている。transfer だけ expired で終了。
      // レジストリ側 ack はドメイン名が判らないのでできない (レジストリ側でタイムアウト削除される想定)。
      console.error(`TransferPollDlqService: domain missing for transferId=${transferId}. Marking expired.`);
      return await markExpired({ transferId, domainId: transfer.domainId, env });
    }
    const domain = domainResult.data;

    const infoResult = await RegistryBridge.info({ name: domain.name, registry: transfer.registry, env });
    if (!infoResult.success) {
      // レジストリ照会失敗。Cloudflare Queues 側で retry させる (DLQ max_retries=10)。
      return infoResult;
    }

    const stillPending = (infoResult.data.status ?? []).includes("pendingTransfer");
    if (stillPending) {
      // レジストリ側でも pendingTransfer が残っている → 本当に諦める。expired へ。
      console.warn(
        `TransferPollDlqService: registry also still pending for transferId=${transferId}. Marking expired.`,
      );
      const expireResult = await markExpired({ transferId, domainId: transfer.domainId, env });
      if (!expireResult.success) {return expireResult;}
      // Bug 3 対策: 対応する registry キューメッセージがあれば ack して HoL 汚染を防ぐ。
      await tryAckOwnMessage({ domainName: domain.name, registry: transfer.registry, env });
      return { success: true, data: undefined, error: null };
    }

    // レジストリでは確定済み。gaining ユーザーに所有権を移す。
    // gaining user が消えていた場合は expired 扱い。
    const userExists = await TransferPollDlqRepository.userExists({ id: transfer.gainingUserId, env });
    if (!userExists.success) {return userExists;}
    if (!userExists.data) {
      console.error(
        `TransferPollDlqService: gaining user ${transfer.gainingUserId} no longer exists. Marking expired despite registry approval — MANUAL RECONCILIATION REQUIRED.`,
      );
      const expireResult = await markExpired({ transferId, domainId: transfer.domainId, env });
      if (!expireResult.success) {return expireResult;}
      // Bug 4 対策: 対応する registry キューメッセージがあれば ack。
      await tryAckOwnMessage({ domainName: domain.name, registry: transfer.registry, env });
      return { success: true, data: undefined, error: null };
    }

    console.warn(
      `TransferPollDlqService: registry transfer already settled for transferId=${transferId}. Committing serverApproved.`,
    );
    const commit = await TransferStatusRepository.commitServerApproved({
      transferId,
      domainId: transfer.domainId,
      newOwnerUserId: transfer.gainingUserId,
      env,
    });
    if (!commit.success) {return commit;}
    // 対応する registry キューメッセージがあれば ack。
    await tryAckOwnMessage({ domainName: domain.name, registry: transfer.registry, env });
    return { success: true, data: undefined, error: null };
  }
}

async function markExpired({
  transferId,
  domainId,
  env,
}: {
  transferId: string;
  domainId: string;
  env: CloudflareBindings;
}): Promise<Result<void>> {
  // Smell 2 対策: 2 更新を batch 化して、中間で落ちて domain が pendingTransfer で残るのを防ぐ。
  return TransferStatusRepository.expireAndReleaseDomain({ transferId, domainId, env });
}

// Bug 3/4 対策: DLQ で終端処理した後、対応する registry キューメッセージが残っていれば ack する。
// - poll で先頭を取得
// - payload.domain がこの transfer 用ドメインと一致 → ack
// - 一致しない or 無い → 何もしない (他 transfer のメッセージなので触らない)
// 失敗はログのみ (次回別 transfer の poll で拾われる)。
async function tryAckOwnMessage({
  domainName,
  registry,
  env,
}: {
  domainName: string;
  registry: Registry;
  env: CloudflareBindings;
}): Promise<void> {
  const pollResult = await RegistryBridge.poll({ registry, env });
  if (!pollResult.success) {
    console.warn(`TransferPollDlqService.tryAckOwnMessage: poll failed for domain=${domainName}`, pollResult.error);
    return;
  }
  if (!pollResult.data) {
    // メッセージなし = レジストリ側は既に他のメッセージで消化されているか、そもそも emit されなかった。
    return;
  }
  if (pollResult.data.payload.domain !== domainName) {
    // 別ドメイン用のメッセージ。ここでは触らない (通常の poll consumer が dispatchToOwner で処理する)。
    return;
  }
  const ackResult = await RegistryBridge.ackMessage({
    messageId: pollResult.data.id,
    registry,
    env,
  });
  if (!ackResult.success) {
    console.warn(
      `TransferPollDlqService.tryAckOwnMessage: registry ack failed for domain=${domainName} messageId=${pollResult.data.id}`,
      ackResult.error,
    );
  }
}
