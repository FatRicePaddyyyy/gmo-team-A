import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type Domain = typeof domains.$inferSelect;

export class TransferPollRepository {
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
      console.error("TransferPollRepository.findTransferById error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }

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
      console.error("TransferPollRepository.findDomainById error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }

  static async updateTransferStatus({
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
      console.error("TransferPollRepository.updateTransferStatus error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }

  static async updateDomainOwner({
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
      console.error("TransferPollRepository.updateDomainOwner error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }

  static async updateDomainStatus({
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
      console.error("TransferPollRepository.updateDomainStatus error:", error);
      return { success: false, data: null, error: error instanceof Error ? error.message : "予期しないエラー" };
    }
  }
}
