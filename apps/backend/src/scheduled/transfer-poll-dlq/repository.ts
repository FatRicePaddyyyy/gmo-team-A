import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type Domain = typeof domains.$inferSelect;

export class TransferPollDlqRepository {
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
      console.error("TransferPollDlqRepository.findTransferById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // DLQ 到達時にレジストリの真実を確認するため、ドメイン名を引くのに使う。
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
      console.error("TransferPollDlqRepository.findDomainById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // S-H: userExists は src/domains/user/repository.ts (UserRepository.exists) に集約。
}
