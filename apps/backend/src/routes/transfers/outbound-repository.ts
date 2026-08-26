import { and, eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, outboundTransferRequests } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type OutboundTransferRequest = typeof outboundTransferRequests.$inferSelect;
type NewOutboundTransferRequest = typeof outboundTransferRequests.$inferInsert;
type Domain = typeof domains.$inferSelect;
type NewDomain = typeof domains.$inferInsert;

// 別レジストラのドメインを取りに行く申請 (backend DB に対応 domain 行を持たない移管申請)。
// 承認確定時に domains 行が INSERT され、本テーブル行は clientApproved 等に更新される。
export class OutboundTransferRequestRepository {
  static async create({
    data,
    env,
  }: {
    data: NewOutboundTransferRequest;
    env: CloudflareBindings;
  }): Promise<Result<OutboundTransferRequest>> {
    try {
      const db = createDBClient(env);
      const [created] = await db.insert(outboundTransferRequests).values(data).returning();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!created) {
        return { success: false, data: null, error: "outbound_create_failed" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("OutboundTransferRequestRepository.create error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async findById({
    id,
    env,
  }: {
    id: string;
    env: CloudflareBindings;
  }): Promise<Result<OutboundTransferRequest | null>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select().from(outboundTransferRequests).where(eq(outboundTransferRequests.id, id));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("OutboundTransferRequestRepository.findById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // domainName + registry で pending 行を検索。cron が承認通知を受けたときに使う。
  static async findPending({
    domainName,
    registry,
    env,
  }: {
    domainName: string;
    registry: "kitaqsign" | "kitaqnic";
    env: CloudflareBindings;
  }): Promise<Result<OutboundTransferRequest | null>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select().from(outboundTransferRequests).where(
        and(
          eq(outboundTransferRequests.domainName, domainName),
          eq(outboundTransferRequests.registry, registry),
          eq(outboundTransferRequests.status, "pendingTransfer"),
        ),
      );
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("OutboundTransferRequestRepository.findPending error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  static async updateStatus({
    id,
    status,
    env,
  }: {
    id: string;
    status: "clientApproved" | "serverApproved" | "clientRejected" | "clientCancelled" | "expired";
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.update(outboundTransferRequests).set({ status }).where(eq(outboundTransferRequests.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("OutboundTransferRequestRepository.updateStatus error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // 承認確定: outbound.status を確定値に + domains 行を owner=gainingUserId で新規 INSERT を batch で行う。
  // cron が別レジストラからの op=approve/serverApproved 通知を受けたときに呼ばれる。
  static async commitApprovedWithDomain({
    outboundId,
    outboundStatus,
    newDomain,
    env,
  }: {
    outboundId: string;
    outboundStatus: "clientApproved" | "serverApproved";
    newDomain: NewDomain;
    env: CloudflareBindings;
  }): Promise<Result<Domain>> {
    try {
      const db = createDBClient(env);
      const results = await db.batch([
        db.update(outboundTransferRequests).set({ status: outboundStatus }).where(eq(outboundTransferRequests.id, outboundId)),
        db.insert(domains).values(newDomain).returning(),
      ]);
      // batch の 2 番目 (insert...returning) の結果
      const insertResult = results[1] as Domain[];
      const created = insertResult[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!created) {
        return { success: false, data: null, error: "domain_create_failed" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("OutboundTransferRequestRepository.commitApprovedWithDomain error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
