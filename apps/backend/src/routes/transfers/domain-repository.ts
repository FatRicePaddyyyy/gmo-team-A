import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Domain = typeof domains.$inferSelect;

// transfers スライスが domain 情報を参照・更新するための専用 repository
// domains スライスの repository を直接 import しない
export class TransferDomainRepository {
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
      console.error("TransferDomainRepository.findById error:", error);
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
      console.error("TransferDomainRepository.findByName error:", error);
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
      console.error("TransferDomainRepository.updateStatus error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
