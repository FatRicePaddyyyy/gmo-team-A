import type { TransferPollMessage } from "../../types/queue";
import { TransferPollDlqService } from "./service";

// transfer-poll の DLQ consumer。
// wrangler.jsonc で transfer-poll queue の max_retries (=3) を超えたメッセージが自動的にここへ送られる。
// backend が長時間 poll しても確定できなかった transfer なので、
// (1) レジストリの info を叩いて真実を確認 (TransferPollDlqService.expire 内で実施)
// (2) レジストリで pending 継続 → transfer.status = "expired" にマーク + domain.status = "ok" に戻す
// (3) レジストリで serverApproved → commitApproved で所有権反映
// (4) いずれの終端でも tryAckOwnMessage で registry キューの該当メッセージを ack
// (5) console.error でオペレーターが気付けるようにする
export async function handleTransferPollDlq(
  batch: MessageBatch<TransferPollMessage>,
  env: CloudflareBindings,
): Promise<void> {
  for (const message of batch.messages) {
    // Drop #5 対策: どんな例外が来ても ack/retry が必ず呼ばれるように try/catch でラップする。
    try {
      const transferId = message.body.transferId;
      console.error(`TransferPollDlq: giving up on transferId=${transferId} (max retries exceeded)`);
      const result = await TransferPollDlqService.expire({ transferId, env });
      if (!result.success) {
        console.error(`TransferPollDlq: failed to expire transferId=${transferId}`, result.error);
        message.retry();
        continue;
      }
      message.ack();
    } catch (e) {
      // 想定外の例外 (JSON パース失敗、undefined 参照など)。retry させて Cloudflare Queues に判断を委ねる。
      // DLQ の max_retries=10 を超えるとメッセージは消えるが、その旨は console.error で残す。
      console.error(`TransferPollDlq: unexpected exception while processing message`, e);
      try { message.retry(); } catch (_e) { /* retry 自体が失敗する場合は諦める */ }
    }
  }
}
