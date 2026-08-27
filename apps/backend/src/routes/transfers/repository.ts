import { eq } from "drizzle-orm";
import { TransferStatusRepository } from "../../domains/transfer/repository";
import type { TransferStatus } from "../../domains/transfer/repository";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type NewTransfer = typeof transfers.$inferInsert;

/** 一覧表示用。ドメイン ID だけでは何の申請か分からないので名前を添える */
export type TransferWithDomainName = Transfer & { domainName: string };

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
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateStatus({
    id,
    status,
    env,
  }: {
    id: string;
    status: TransferStatus;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    // NB-8: 共通の TransferStatusRepository に委譲。
    return TransferStatusRepository.update({ id, status, env });
  }

  // B16: gaining ユーザーが自分で申請した移管一覧。
  static async findByGainingUserId({
    userId,
    env,
  }: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<TransferWithDomainName[]>> {
    try {
      const db = createDBClient(env);
      // ドメイン名を join で添える。移管が終わるまで domains.ownerUserId は
      // 申請者ではないが、申請者は「どのドメインを申請したか」を知っているので
      // 名前を見せてよい（ID だけでは一覧が読めない）。
      const rows = await db
        .select({ transfer: transfers, domainName: domains.name })
        .from(transfers)
        .innerJoin(domains, eq(transfers.domainId, domains.id))
        .where(eq(transfers.gainingUserId, userId));
      return {
        success: true,
        data: rows.map((row) => ({ ...row.transfer, domainName: row.domainName })),
        error: null,
      };
    } catch (error) {
      console.error("TransferRepository.findByGainingUserId error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
