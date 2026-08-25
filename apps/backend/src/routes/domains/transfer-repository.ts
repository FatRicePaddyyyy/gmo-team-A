import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;

// domains スライスが transfer 情報を参照・更新するための専用 repository
// transfers スライスの repository を直接 import しない
export class DomainTransferRepository {
  static async findByDomainId({
    domainId,
    env,
  }: {
    domainId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer | null>> {
    try {
      const db = createDBClient(env);
      const rows = await db
        .select()
        .from(transfers)
        .where(eq(transfers.domainId, domainId));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("DomainTransferRepository.findByDomainId error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }

  static async updateStatus({
    id,
    status,
    env,
  }: {
    id: string;
    status: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.update(transfers).set({ status }).where(eq(transfers.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainTransferRepository.updateStatus error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }
}
