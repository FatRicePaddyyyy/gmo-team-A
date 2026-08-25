import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type NewTransfer = typeof transfers.$inferInsert;

export class TransferRepository {
  static async create({
    data,
    env,
  }: {
    data: NewTransfer;
    env: CloudflareBindings;
  }): Promise<Result<Transfer>> {
    try {
      const db = createDBClient(env);
      const rows = await db.insert(transfers).values(data).returning();
      const created = rows[0];
      if (!created) {
        return { success: false, data: null, error: "移管レコードの作成に失敗しました" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("TransferRepository.create error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }

  static async findById({
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
      console.error("TransferRepository.findById error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }

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
      console.error("TransferRepository.findByDomainId error:", error);
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
      console.error("TransferRepository.updateStatus error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }
}
