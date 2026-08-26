import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { TransferSafetyNetRepository } from "./repository";

// R1: pending が想定より長く残っている transfer を検出して queue に再投入する。
// Queue の poll 予算は 総 50分 (初回 20分 + retry 3回 × 10分) なので、
// 2 時間経っても pendingTransfer のままなら「queue send そのものが失敗して orphan 化した」
// と判断できる。
// これは Cloudflare Queues の DLQ 経由 expired ロジックとは独立した保険。
export const STALE_THRESHOLD_HOURS = 2;

// Bug 1 対策: 同期 approve は DB を即確定するが、その後の TRANSFER_QUEUE.send が失敗すると
// レジストリ側の poll メッセージが ack されず HoL block を起こしうる。
// 過去 SETTLED_ACK_LOOKBACK_HOURS 以内に settle した transfer を対象に「レジストリキュー先頭に
// 該当メッセージが残っていれば ack」する。
export const SETTLED_ACK_LOOKBACK_HOURS = 2;

// S4: 1 回の cron 実行で最大 20 件の settled を走査する。
// approve レート × 2h が 20 を超えるようなら SETTLED_ACK_LOOKBACK_HOURS を短くするか、
// registry_acked_at カラムを追加して deduplication を入れる。
const SETTLED_ACK_LIMIT_PER_RUN = 20;

export class TransferSafetyNetService {
  static async sweep({
    env,
    now,
  }: {
    env: CloudflareBindings;
    now: Date;
  }): Promise<Result<{ requeued: number; acked: number }>> {
    let requeued = 0;
    let acked = 0;

    // (1) stale pending の再投入
    const threshold = new Date(now.getTime() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
    const stale = await TransferSafetyNetRepository.findStalePending({ olderThan: threshold, env });
    if (!stale.success) {return stale;}

    if (!env.TRANSFER_QUEUE) {
      console.error(
        `TransferSafetyNetService: TRANSFER_QUEUE binding missing; ${stale.data.length} stale pending transfers cannot be requeued.`,
      );
    } else {
      for (const transfer of stale.data) {
        try {
          await env.TRANSFER_QUEUE.send({ transferId: transfer.id });
          requeued++;
          console.warn(`TransferSafetyNetService: requeued stale pending transferId=${transfer.id}`);
        } catch (e) {
          console.error(`TransferSafetyNetService: failed to requeue transferId=${transfer.id}`, e);
        }
      }
    }

    // (2) Bug 1 対策: 最近 settle した transfer の registry-side ack を試みる
    const settledSince = new Date(now.getTime() - SETTLED_ACK_LOOKBACK_HOURS * 60 * 60 * 1000);
    const settled = await TransferSafetyNetRepository.findRecentSettledForAck({
      since: settledSince,
      limit: SETTLED_ACK_LIMIT_PER_RUN,
      env,
    });
    if (!settled.success) {
      // stale sweep は成功しているので、ack side だけ諦めて success で返す
      console.error("TransferSafetyNetService: findRecentSettledForAck failed", settled.error);
      return { success: true, data: { requeued, acked }, error: null };
    }
    for (const row of settled.data) {
      const didAck = await tryAckOwnMessage({
        domainName: row.domainName,
        registry: row.registry,
        env,
      });
      if (didAck) {acked++;}
    }

    return { success: true, data: { requeued, acked }, error: null };
  }
}

// 対応する registry キューメッセージが残っていれば ack する。
// - poll で先頭 1 件を取得
// - payload.domain が一致 → ack
// - 一致しない or 無い → 何もしない
// 失敗はログのみ。次回 cron でまた試行される。
async function tryAckOwnMessage({
  domainName,
  registry,
  env,
}: {
  domainName: string;
  registry: Registry;
  env: CloudflareBindings;
}): Promise<boolean> {
  const pollResult = await RegistryBridge.poll({ registry, env });
  if (!pollResult.success) {
    console.warn(`TransferSafetyNetService.tryAckOwnMessage: poll failed for domain=${domainName}`, pollResult.error);
    return false;
  }
  if (!pollResult.data) {return false;}
  if (pollResult.data.payload.domain !== domainName) {return false;}
  const ackResult = await RegistryBridge.ackMessage({
    messageId: pollResult.data.id,
    registry,
    env,
  });
  if (!ackResult.success) {
    console.warn(
      `TransferSafetyNetService.tryAckOwnMessage: registry ack failed for domain=${domainName} messageId=${pollResult.data.id}`,
      ackResult.error,
    );
    return false;
  }
  console.info(
    `TransferSafetyNetService: acked orphan registry message for domain=${domainName} messageId=${pollResult.data.id}`,
  );
  return true;
}
