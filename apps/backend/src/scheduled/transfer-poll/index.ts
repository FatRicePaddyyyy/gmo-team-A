import type { TransferPollMessage } from "../../types/queue";
import { TransferPollRepository } from "./repository";
import { POLL_RETRY_DELAY_SECONDS, TransferPollService } from "./service";

export async function handleTransferPollQueue(
  batch: MessageBatch<TransferPollMessage>,
  env: CloudflareBindings,
): Promise<void> {
  for (const message of batch.messages) {
    const attempt = message.body.attempt;
    const transferId = message.body.transferId;

    const result = await TransferPollService.process({
      transferId,
      attempt,
      env,
    });

    if (!result.success) {
      // Bridge / DB エラー。Queue のリトライに任せる。
      console.error(`TransferPollQueue: process error for transferId=${transferId}`, result.error);
      message.retry();
      continue;
    }

    switch (result.data.kind) {
      case "done":
      case "invalid":
        // 対象が確定 or もう存在しない。ack。
        message.ack();
        break;
      case "still_pending":
        // レジストリ側でまだ処理中。attempt++ して再エンキュー。
        try {
          if (env.TRANSFER_QUEUE) {
            await env.TRANSFER_QUEUE.send(
              { transferId, attempt: attempt + 1 },
              { delaySeconds: POLL_RETRY_DELAY_SECONDS },
            );
          }
          message.ack();
        } catch (e) {
          console.error(`TransferPollQueue: re-enqueue failed for transferId=${transferId}`, e);
          message.retry();
        }
        break;
      case "expired":
        // 上限超え。transfer を expired 状態にして諦める。
        {
          const exp = await TransferPollRepository.updateTransferStatus({
            id: transferId,
            status: "expired",
            env,
          });
          if (!exp.success) {
            console.error(`TransferPollQueue: failed to mark expired for transferId=${transferId}`, exp.error);
            message.retry();
            break;
          }
          // 対応するドメインの status を ok に戻す (レジストリ側 pendingTransfer は
          // タイムアウトで自動解除されるはず)。
          // domain.id は transfer から再取得する。
          const t = await TransferPollRepository.findTransferById({ id: transferId, env });
          if (t.success && t.data) {
            await TransferPollRepository.updateDomainStatus({ id: t.data.domainId, status: "ok", env });
          }
          message.ack();
        }
        break;
    }
  }
}
