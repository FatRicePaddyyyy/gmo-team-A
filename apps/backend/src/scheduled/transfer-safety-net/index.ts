import { TransferSafetyNetService } from "./service";

// R1: Cron 経由の safety-net。1 時間ごとに実行し、以下 2 つの後始末をする。
//  (1) 2 時間以上 pendingTransfer のまま残った transfer を queue に再投入 (queue send 失敗の救済)
//  (2) Bug 1 対策: 直近 2 時間以内に settle した transfer で、レジストリ側 poll メッセージが
//      ack 未消化な可能性のあるものを ack する (approve 同期化後の queue send 失敗の救済)
// wrangler.jsonc の triggers.crons で登録済み。
export async function handleTransferSafetyNetCron(env: CloudflareBindings, now: Date): Promise<void> {
  const result = await TransferSafetyNetService.sweep({ env, now });
  if (!result.success) {
    console.error("TransferSafetyNetCron: sweep failed", result.error);
    return;
  }
  console.info(
    `TransferSafetyNetCron: requeued=${result.data.requeued} settled-acked=${result.data.acked}`,
  );
}
