import { runTransferCronPoll } from "./service";

// Cron trigger のエントリ。wrangler.jsonc の triggers.crons で毎分発火する。
// - Phase 1: 全レジストリを空になるまで poll drain (losing / gaining どちらのメッセージも同一ルートで処理)
// - Phase 2: 22 分以上経過した pendingTransfer を info で reconcile (自動承認取りこぼしと真の失効を判別)
export async function handleTransferCronPoll(env: CloudflareBindings, now: Date): Promise<void> {
  console.info(`[cron] transfer-poll start now=${now.toISOString()}`);
  try {
    const summary = await runTransferCronPoll({ env, now });
    console.info(
      `[cron] transfer-poll done polled=${JSON.stringify(summary.polled)} reconciled=${summary.reconciled} serverApproved=${summary.serverApproved} expired=${summary.expired}`,
    );
  } catch (e) {
    console.error("[cron] transfer-poll unexpected exception", e);
  }
}
