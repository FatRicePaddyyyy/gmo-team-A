import { runTransferCronPoll } from "./service";

// Cron trigger のエントリ。wrangler.jsonc の triggers.crons で毎分発火する。
// - Phase 1: 全レジストリを空になるまで poll drain (losing / gaining どちらのメッセージも同一ルートで処理)
// - Phase 2: 22 分以上経過した pendingTransfer を info で reconcile (自動承認取りこぼしと真の失効を判別)
export async function handleTransferCronPoll(env: CloudflareBindings, now: Date): Promise<void> {
  try {
    const summary = await runTransferCronPoll({ env, now });
    console.info("TransferCronPoll: run complete", summary);
  } catch (e) {
    console.error("TransferCronPoll: unexpected exception during cron run", e);
  }
}
