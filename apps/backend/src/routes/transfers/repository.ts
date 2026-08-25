import { and, eq } from "drizzle-orm";
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
      const [created] = await db.insert(transfers).values(data).returning();
      // Drizzle の returning() 型上は必ず 1 行返る前提だが、D1 の異常系で 0 件のケースを保険で検知する
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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

  // status='pendingTransfer' のレコードを一意に取得する。
  // partial UNIQUE index で 0 or 1 行が保証されているので orderBy 不要。
  static async findPendingByDomainId({
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
        .where(and(eq(transfers.domainId, domainId), eq(transfers.status, "pendingTransfer")));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("TransferRepository.findPendingByDomainId error:", error);
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

  // B16: gaining ユーザーが自分で申請した移管一覧。
  static async findByGainingUserId({
    userId,
    env,
  }: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer[]>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select().from(transfers).where(eq(transfers.gainingUserId, userId));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("TransferRepository.findByGainingUserId error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }
}
