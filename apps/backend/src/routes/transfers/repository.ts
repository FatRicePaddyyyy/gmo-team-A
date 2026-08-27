import { eq } from "drizzle-orm";
import { TransferStatusRepository } from "../../domains/transfer/repository";
import type { TransferStatus } from "../../domains/transfer/repository";
import type { DBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type NewTransfer = typeof transfers.$inferInsert;

export class TransferRepository {
  static async create({
    data,
    db,
  }: {
    data: NewTransfer;
    db: DBClient;
  }): Promise<Result<Transfer>> {
    try {
      const [created] = await db.insert(transfers).values(data).returning();
      // Drizzle の returning() 型上は必ず 1 行返る前提だが、D1 の異常系で 0 件のケースを保険で検知する
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!created) {
        return { success: false, data: null, error: "transfer_create_failed" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("TransferRepository.create error:", error);
      // UNIQUE violation は service 層で transfer_already_pending に再マップされる。
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async findById({
    id,
    db,
  }: {
    id: string;
    db: DBClient;
  }): Promise<Result<Transfer | null>> {
    try {
      const rows = await db.select().from(transfers).where(eq(transfers.id, id));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("TransferRepository.findById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateStatus({
    id,
    status,
    db,
  }: {
    id: string;
    status: TransferStatus;
    db: DBClient;
  }): Promise<Result<void>> {
    // NB-8: 共通の TransferStatusRepository に委譲。
    return TransferStatusRepository.update({ id, status, db });
  }

  // B16: gaining ユーザーが自分で申請した移管一覧。
  static async findByGainingUserId({
    userId,
    db,
  }: {
    userId: string;
    db: DBClient;
  }): Promise<Result<Transfer[]>> {
    try {
      const rows = await db.select().from(transfers).where(eq(transfers.gainingUserId, userId));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("TransferRepository.findByGainingUserId error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
