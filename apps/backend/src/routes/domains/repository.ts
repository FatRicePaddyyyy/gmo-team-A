import { eq } from "drizzle-orm";
import type { DBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Domain = typeof domains.$inferSelect;
type NewDomain = typeof domains.$inferInsert;

export class DomainRepository {
  static async findById({
    id,
    db,
  }: {
    id: string;
    db: DBClient;
  }): Promise<Result<Domain | null>> {
    try {
      const rows = await db.select().from(domains).where(eq(domains.id, id));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("DomainRepository.findById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async findByName({
    name,
    db,
  }: {
    name: string;
    db: DBClient;
  }): Promise<Result<Domain | null>> {
    try {
      const rows = await db.select().from(domains).where(eq(domains.name, name));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("DomainRepository.findByName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async create({
    data,
    db,
  }: {
    data: NewDomain;
    db: DBClient;
  }): Promise<Result<Domain>> {
    try {
      const [created] = await db.insert(domains).values(data).returning();
      // Drizzle の returning() 型上は必ず 1 行返る前提だが、D1 の異常系で 0 件のケースを保険で検知する
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!created) {
        return { success: false, data: null, error: "domain_create_failed" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("DomainRepository.create error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateStatus({
    id,
    status,
    db,
  }: {
    id: string;
    status: string;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      await db.update(domains).set({ status }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateStatus error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateExpiresAtAndStatus({
    id,
    expiresAt,
    status,
    db,
  }: {
    id: string;
    expiresAt: Date;
    status: string;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      await db.update(domains).set({ expiresAt, status }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateExpiresAtAndStatus error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateExpiresAt({
    id,
    expiresAt,
    db,
  }: {
    id: string;
    expiresAt: Date;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      await db.update(domains).set({ expiresAt }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateExpiresAt error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateAuthInfo({
    id,
    authInfo,
    db,
  }: {
    id: string;
    authInfo: string;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      await db.update(domains).set({ authInfo }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateAuthInfo error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateAutoRenew({
    id,
    autoRenew,
    db,
  }: {
    id: string;
    autoRenew: boolean;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      await db.update(domains).set({ autoRenew }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateAutoRenew error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }


  /**
   * 物理削除。
   * transfers.domain_id は ON DELETE restrict なので、pendingTransfer 行が残っている
   * ドメインを削除しようとすると FK エラーで失敗する。呼び出し側 (service) が
   * 「pending 移管があるドメインは削除対象外」の前提で使うこと。
   */
  static async deleteById({
    id,
    db,
  }: {
    id: string;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      await db.delete(domains).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.deleteById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async listByUserId({
    userId,
    db,
  }: {
    userId: string;
    db: DBClient;
  }): Promise<Result<Domain[]>> {
    try {
      const rows = await db.select().from(domains).where(eq(domains.ownerUserId, userId));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("DomainRepository.listByUserId error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
