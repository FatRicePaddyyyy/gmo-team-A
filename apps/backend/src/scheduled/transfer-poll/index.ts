import type { TransferPollMessage } from "../../types/queue";
import { TransferPollService } from "./service";

export async function handleTransferPollQueue(
  batch: MessageBatch<TransferPollMessage>,
  env: CloudflareBindings,
): Promise<void> {
  for (const message of batch.messages) {
    const result = await TransferPollService.process({
      transferId: message.body.transferId,
      env,
    });
    if (result.success) {
      message.ack();
    } else {
      console.error(`TransferPollQueue: failed to process transferId=${message.body.transferId}`, result.error);
      message.retry();
    }
  }
}
