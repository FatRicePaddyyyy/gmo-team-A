import { and, desc, eq, inArray } from "drizzle-orm";
import type { DBClient } from "../../lib/db";
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

// losing 目線の「渡さずに終わった移管」1 件。
// pending 一覧から消えても、誰かが取りに来た事実は残したい。
// status を添えて、どう決着したかまで見せる。
export interface InboundTransferHistoryRow extends InboundPendingTransferRow {
  status: string;
}

// domains スライスが transfer 情報を参照・更新するための専用 repository
// transfers スライスの repository を直接 import しない
export class DomainTransferRepository {
  // status='pendingTransfer' の transfer レコードを取得する。
  // partial UNIQUE index (transfers_pending_domain_unique_idx) により 0 or 1 行が保証される。
  static async findPendingByDomainId({
    domainId,
    db,
  }: {
    domainId: string;
    db: DBClient;
  }): Promise<Result<Transfer | null>> {
    try {
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
    db,
  }: {
    ownerUserId: string;
    db: DBClient;
  }): Promise<Result<InboundPendingTransferRow[]>> {
    try {
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

  // 自分のドメインに対して来た移管申請のうち、渡さずに終わったもの。
  //
  // 却下・取消・期限切れで終わった申請は pending 一覧から消えるが、
  // 「誰かが自分のドメインを取ろうとした」記録は残したい。
  // 身に覚えのない申請が繰り返されていても気づけないため。
  //
  // 承認済み（clientApproved / serverApproved）は意図的に除く。理由は 2 つ。
  //
  // 1. 他レジストラへ渡した場合、transfers も domains も削除される
  //    （TransferStatusRepository.commitApprovedAndDropDomain）。そもそも残らない。
  // 2. 自社ユーザー間の移管では domains.ownerUserId が新しい持ち主に変わる。
  //    この検索は ownerUserId で絞るので、渡した本人ではなく
  //    「受け取った人」の履歴として出てしまう。身に覚えのない記録を見せることになる。
  //
  // 承認済みも残すには transfers に losing 側の識別子が要る（今は持っていない）。
  // 履歴として正しく扱えるものだけを返す。
  static async findInboundHistoryByOwner({
    ownerUserId,
    db,
  }: {
    ownerUserId: string;
    db: DBClient;
  }): Promise<Result<InboundTransferHistoryRow[]>> {
    try {
      const rows = await db
        .select({
          transferId: transfers.id,
          domainId: domains.id,
          domainName: domains.name,
          registry: transfers.registry,
          requestedAt: transfers.createdAt,
          status: transfers.status,
        })
        .from(transfers)
        .innerJoin(domains, eq(transfers.domainId, domains.id))
        .where(
          and(
            // 手元に残った決着だけ。承認済みは上のコメントのとおり除く。
            inArray(transfers.status, [
              "clientRejected",
              "clientCancelled",
              "expired",
            ]),
            eq(domains.ownerUserId, ownerUserId),
          ),
        )
        .orderBy(desc(transfers.createdAt));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("DomainTransferRepository.findInboundHistoryByOwner error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
