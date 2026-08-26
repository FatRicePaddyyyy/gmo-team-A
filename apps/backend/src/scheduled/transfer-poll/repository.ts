import { and, eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type Domain = typeof domains.$inferSelect;

export class TransferPollRepository {
  static async findTransferById({
    id,
    env,
  }: {
    id: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer | null>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select().from(transfers).where(eq(transfers.id, id));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("TransferPollRepository.findTransferById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async findDomainById({
    id,
    env,
  }: {
    id: string;
    env: CloudflareBindings;
  }): Promise<Result<Domain | null>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select().from(domains).where(eq(domains.id, id));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("TransferPollRepository.findDomainById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // S-H: userExists は src/domains/user/repository.ts (UserRepository.exists) に集約。
  // S-A: 承認/拒否/キャンセル確定の batch commit は TransferStatusRepository に集約 (NB-8)。
  // poll consumer 側は直接 TransferStatusRepository.commitApproved / settleAndReleaseDomain を呼ぶ。

  // B4: poll で拾った message.payload.domain から pendingTransfer な transfer を引く。
  // 別ドメインのメッセージを消化するために使う。
  static async findPendingTransferByDomainName({
    name,
    env,
  }: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<{ transfer: Transfer; domain: Domain } | null>> {
    try {
      const db = createDBClient(env);
      const domainRows = await db.select().from(domains).where(eq(domains.name, name));
      const domain = domainRows[0];
      // rows[0] は Drizzle 型上 non-null と扱われるが、SELECT が空の場合を保険で検知する
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
      console.error("TransferPollRepository.findPendingTransferByDomainName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // Drop #7: そのドメイン名について backend が過去に何らかの transfer レコードを持っているかを確認する。
  // pending が無くても settled (approved/rejected/cancelled/expired) が存在するなら backend の管轄。
  // 全く無ければ「backend の関知しないドメイン」と判定して orphan として ack して差し支えない。
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
      console.error("TransferPollRepository.hasAnyTransferForDomainName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
