import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      const rows = await db.insert(domains).values(data).returning();
      const created = rows[0];
      if (!created) {
        return { success: false, data: null, error: "ドメインの作成に失敗しました" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("DomainRepository.create error:", error);
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
      await db.update(domains).set({ status }).where(eq(domains.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("DomainRepository.updateStatus error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
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
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }
}
