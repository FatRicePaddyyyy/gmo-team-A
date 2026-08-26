import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Domain = typeof domains.$inferSelect;
type NewDomain = typeof domains.$inferInsert;

export class DomainRepository {
  static async findById({
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
      console.error("DomainRepository.findById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async findByName({
    name,
    env,
  }: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<Domain | null>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select().from(domains).where(eq(domains.name, name));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("DomainRepository.findByName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async create({
    data,
    env,
  }: {
    data: NewDomain;
    env: CloudflareBindings;
  }): Promise<Result<Domain>> {
    try {
      const db = createDBClient(env);
      const [created] = await db.insert(domains).values(data).returning();
      // Drizzle の returning() 型上は必ず 1 行返る前提だが、D1 の異常系で 0 件のケースを保険で検知する
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!created) {
        return { success: false, data: null, error: "ドメインの作成に失敗しました" };
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
    env,
  }: {
    id: string;
    status: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
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
    env,
  }: {
    id: string;
    expiresAt: Date;
    status: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
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
    env,
  }: {
    id: string;
    expiresAt: Date;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
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
    env,
  }: {
    id: string;
    authInfo: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
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
    env,
  }: {
    id: string;
    autoRenew: boolean;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.update(domains).set({ autoRenew }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateAutoRenew error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateOwner({
    id,
    newOwnerUserId,
    env,
  }: {
    id: string;
    newOwnerUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.update(domains).set({ ownerUserId: newOwnerUserId }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateOwner error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async listByUserId({
    userId,
    env,
  }: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<Domain[]>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select().from(domains).where(eq(domains.ownerUserId, userId));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("DomainRepository.listByUserId error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
