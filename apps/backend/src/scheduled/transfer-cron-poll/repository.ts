import { and, eq, lt } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type Domain = typeof domains.$inferSelect;

export interface PendingTransferWithDomain {
  transfer: Transfer;
  domain: Domain;
}

// 単一 cron で「poll drain + 22 分タイムアウト reconcile」を回すための repository。
// 旧 transfer-poll / transfer-poll-dlq / transfer-safety-net で分散していたクエリを集約する。
export class TransferCronPollRepository {
  // poll で受け取った payload.domain から pending transfer を引く。
  // レジストリが losing / gaining どちらのケースでも同じルートで確定処理させる。
  static async findPendingTransferByDomainName({
    name,
    env,
  }: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<PendingTransferWithDomain | null>> {
    try {
      const db = createDBClient(env);
      const domainRows = await db.select().from(domains).where(eq(domains.name, name));
      const domain = domainRows[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!domain) {return { success: true, data: null, error: null };}
      const transferRows = await db
        .select()
        .from(transfers)
        .where(and(eq(transfers.domainId, domain.id), eq(transfers.status, "pendingTransfer")));
      const transfer = transferRows[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!transfer) {return { success: true, data: null, error: null };}
      return { success: true, data: { transfer, domain }, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.findPendingTransferByDomainName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // orphan 判定を安全にするための補助: そのドメインに何らかの transfer 履歴があるかを確認する。
  // 過去 settled が存在する = backend の管轄 → ack を保留して retry (次回 cron)。
  static async hasAnyTransferForDomainName({
    name,
    env,
  }: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<boolean>> {
    try {
      const db = createDBClient(env);
      const domainRows = await db.select().from(domains).where(eq(domains.name, name));
      const domain = domainRows[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!domain) {return { success: true, data: false, error: null };}
      const rows = await db.select().from(transfers).where(eq(transfers.domainId, domain.id));
      return { success: true, data: rows.length > 0, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.hasAnyTransferForDomainName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // 22 分以上経過した pendingTransfer を全件返す (info reconcile 対象)。
  // レジストリ側の自動承認 (T+20 分) を過ぎても poll イベントで確定できなかったケースが該当する。
  static async findTimedOutPending({
    olderThan,
    env,
  }: {
    olderThan: Date;
    env: CloudflareBindings;
  }): Promise<Result<PendingTransferWithDomain[]>> {
    try {
      const db = createDBClient(env);
      const rows = await db
        .select({ transfer: transfers, domain: domains })
        .from(transfers)
        .innerJoin(domains, eq(transfers.domainId, domains.id))
        .where(and(eq(transfers.status, "pendingTransfer"), lt(transfers.createdAt, olderThan)));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.findTimedOutPending error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
