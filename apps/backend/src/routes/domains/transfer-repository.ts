import { and, eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;

// losing (現オーナー) 目線で「自分のドメインに対する pendingTransfer 一覧」を返すための行型。
// gaining 情報は情報漏洩防止のため含めない (gainingUserId はレスポンススキーマからも除外)。
export interface InboundPendingTransferRow {
  transferId: string;
  domainId: string;
  domainName: string;
  registry: "kitaqsign" | "kitaqnic";
  requestedAt: Date;
}

// domains スライスが transfer 情報を参照・更新するための専用 repository
// transfers スライスの repository を直接 import しない
export class DomainTransferRepository {
  // status='pendingTransfer' の transfer レコードを取得する。
  // partial UNIQUE index (transfers_pending_domain_unique_idx) により 0 or 1 行が保証される。
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
      console.error("DomainTransferRepository.findPendingByDomainId error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // losing (現オーナー) 目線で pendingTransfer な transfer 一覧を返す。
  // ドメインの現オーナーが渡された userId であり、かつ transfer が pending であるものだけ拾う。
  // gaining 側の情報 (gainingUserId) は返り値に含めない (情報漏洩防止)。
  static async findInboundPendingByOwner({
    ownerUserId,
    env,
  }: {
    ownerUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<InboundPendingTransferRow[]>> {
    try {
      const db = createDBClient(env);
      const rows = await db
        .select({
          transferId: transfers.id,
          domainId: domains.id,
          domainName: domains.name,
          registry: transfers.registry,
          requestedAt: transfers.createdAt,
        })
        .from(transfers)
        .innerJoin(domains, eq(transfers.domainId, domains.id))
        .where(and(eq(transfers.status, "pendingTransfer"), eq(domains.ownerUserId, ownerUserId)));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("DomainTransferRepository.findInboundPendingByOwner error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
