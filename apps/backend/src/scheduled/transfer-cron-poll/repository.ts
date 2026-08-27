import { and, eq, lt } from "drizzle-orm";
import type { DBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;
type Domain = typeof domains.$inferSelect;

export interface PendingTransferWithDomain {
  transfer: Transfer;
  domain: Domain;
}

// 単一 cron で「poll drain + 22 分タイムアウト reconcile」を回すための repository。
// 旧 transfer-poll / transfer-poll-dlq / transfer-safety-net で分散していたクエリを集約する。
export class TransferCronPollRepository {
  // poll で受け取った payload.domain から pending transfer を引く。
  // レジストリが losing / gaining どちらのケースでも同じルートで確定処理させる。
  static async findPendingTransferByDomainName({
    name,
    db,
  }: {
    name: string;
    db: DBClient;
  }): Promise<Result<PendingTransferWithDomain | null>> {
    try {
      const domainRows = await db.select().from(domains).where(eq(domains.name, name));
      const domain = domainRows[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!domain) {return { success: true, data: null, error: null };}
      const transferRows = await db
        .select()
        .from(transfers)
        .where(and(eq(transfers.domainId, domain.id), eq(transfers.status, "pendingTransfer")));
      const transfer = transferRows[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!transfer) {return { success: true, data: null, error: null };}
      return { success: true, data: { transfer, domain }, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.findPendingTransferByDomainName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // orphan 判定を安全にするための補助: そのドメインに何らかの transfer 履歴があるかを確認する。
  // 過去 settled が存在する = backend の管轄 → ack を保留して retry (次回 cron)。
  static async hasAnyTransferForDomainName({
    name,
    db,
  }: {
    name: string;
    db: DBClient;
  }): Promise<Result<boolean>> {
    try {
      const domainRows = await db.select().from(domains).where(eq(domains.name, name));
      const domain = domainRows[0];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!domain) {return { success: true, data: false, error: null };}
      const rows = await db.select().from(transfers).where(eq(transfers.domainId, domain.id));
      return { success: true, data: rows.length > 0, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.hasAnyTransferForDomainName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // 22 分以上経過した pendingTransfer を全件返す (info reconcile 対象)。
  // レジストリ側の自動承認 (T+20 分) を過ぎても poll イベントで確定できなかったケースが該当する。
  static async findTimedOutPending({
    olderThan,
    db,
  }: {
    olderThan: Date;
    db: DBClient;
  }): Promise<Result<PendingTransferWithDomain[]>> {
    try {
      const rows = await db
        .select({ transfer: transfers, domain: domains })
        .from(transfers)
        .innerJoin(domains, eq(transfers.domainId, domains.id))
        .where(and(eq(transfers.status, "pendingTransfer"), lt(transfers.createdAt, olderThan)));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.findTimedOutPending error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // domain 名で domain 行を取得。cron が外部発の pending を検知したときに
  // 「そもそも自 backend で管理しているドメインか」を判定するために使う。
  static async findDomainByName({
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
      console.error("TransferCronPollRepository.findDomainByName error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // 別レジストラ発の pending を DB に INSERT する。
  // gainingUserId は null (自 backend に相手のユーザーは居ない)、
  // gainingRegistrar には payload.counterpartyRegistrar (例: "teama-2") を入れる。
  // partial UNIQUE index により、同 domain の pending が既にあれば constraint 違反で失敗する
  // (呼び出し側が事前に findPendingTransferByDomainName で確認する前提)。
  static async createExternalPending({
    domainId,
    registry,
    gainingRegistrar,
    db,
  }: {
    domainId: string;
    registry: "kitaqsign" | "kitaqnic";
    gainingRegistrar: string;
    db: DBClient;
  }): Promise<Result<Transfer>> {
    try {
      const rows = await db.insert(transfers).values({
        domainId,
        registry,
        status: "pendingTransfer",
        gainingUserId: null,
        gainingRegistrar,
      }).returning();
      const created = rows[0];
      // rows[0] は Drizzle 型上 non-null と扱われるが、D1 の異常応答で空配列が返るケースに備えて保険で検知する
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!created) {
        return { success: false, data: null, error: "transfer_create_failed" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.createExternalPending error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // 外部 pending 検知時に domain.status を pendingTransfer に揃える。
  // owner 側 UI で「移管申請中」を表示できるようにするためのミラーリング。
  static async setDomainPendingTransfer({
    domainId,
    db,
  }: {
    domainId: string;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      await db.update(domains).set({ status: "pendingTransfer" }).where(eq(domains.id, domainId));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("TransferCronPollRepository.setDomainPendingTransfer error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
