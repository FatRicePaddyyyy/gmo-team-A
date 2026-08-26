import type { TransferPollMessage } from "../../types/queue";
import { TransferPollService } from "./service";

// transfer-poll consumer。
// Cloudflare Queues の max_retries と retry_delay は wrangler.jsonc で管理する
// (max_retries=3, retry_delay=600 秒 → 初回 20 分 + 3×10 分 = 総 50 分の poll 予算)。
// 上限を超えたメッセージは transfer-poll-dlq に自動的に送られ、DLQ consumer が
// レジストリ info を叩いてから transfer を expired or serverApproved に確定させる。
export async function handleTransferPollQueue(
  batch: MessageBatch<TransferPollMessage>,
  env: CloudflareBindings,
): Promise<void> {
  for (const message of batch.messages) {
    // どんな例外が飛んでも ack/retry を必ず呼び、メッセージが暗黙 ack される事故を防ぐ。
    try {
      const transferId = message.body.transferId;
      const result = await TransferPollService.process({ transferId, env });

      if (!result.success) {
        // Bridge / DB エラー。Cloudflare Queues に retry させて再試行する。
        console.error(`TransferPollQueue: process error for transferId=${transferId}`, result.error);
        message.retry();
        continue;
      }

      switch (result.data.kind) {
        case "done":
          // 対象 transfer が確定した or もう存在しない。ack。
          message.ack();
          break;
        case "still_pending":
          // レジストリ側でまだ処理中 or 別 transfer 用メッセージを dispatch しただけ。
          // retry_delay 秒後に再配信させる。max_retries 超過で DLQ 送り。
          message.retry();
          break;
      }
    } catch (e) {
      console.error(`TransferPollQueue: unexpected exception while processing message`, e);
      try { message.retry(); } catch (_e) { /* retry 自体が失敗する場合は諦める */ }
    }
  }
}
