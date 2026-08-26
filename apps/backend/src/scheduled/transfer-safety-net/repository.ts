import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Transfer = typeof transfers.$inferSelect;

// Bug 1 対策で追加された返却行: transfer と紐づく domain 名 (registry ack に必要)。
export interface RecentSettledTransferRow {
  transferId: string;
  registry: "kitaqsign" | "kitaqnic";
  domainName: string;
}

// R1: 定期実行の safety-net repository。
// TRANSFER_QUEUE への投入が失敗して orphan 化した pendingTransfer を検出するために使う。
export class TransferSafetyNetRepository {
  // createdAt が threshold より古い pendingTransfer を全部返す。
  static async findStalePending({
    olderThan,
    env,
  }: {
    olderThan: Date;
    env: CloudflareBindings;
  }): Promise<Result<Transfer[]>> {
    try {
      const db = createDBClient(env);
      const rows = await db
        .select()
        .from(transfers)
        .where(and(eq(transfers.status, "pendingTransfer"), lt(transfers.createdAt, olderThan)));
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("TransferSafetyNetRepository.findStalePending error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // Bug 1 対策: 最近同期 approve で settle した transfer で、registry 側に ack 未消化な poll メッセージが
  // 残っている可能性のあるものを拾う。since 以降に created された client/serverApproved を対象にする。
  // (createdAt を updatedAt の代替として使う。approve から数分〜数時間以内が対象範囲)
  //
  // S4: `limit` で 1 回の cron あたりの走査上限をかける。approve が高頻度でも registry poll の
  // 呼び出しが線形爆発しないようにする。既に ack 済みの settled は poll が 204 を返すだけで害はないが、
  // ネットワーク往復のコストは抑えたい。
  static async findRecentSettledForAck({
    since,
    limit,
    env,
  }: {
    since: Date;
    limit: number;
    env: CloudflareBindings;
  }): Promise<Result<RecentSettledTransferRow[]>> {
    try {
      const db = createDBClient(env);
      const rows = await db
        .select({
          transferId: transfers.id,
          registry: transfers.registry,
          domainName: domains.name,
        })
        .from(transfers)
        .innerJoin(domains, eq(transfers.domainId, domains.id))
        .where(
          and(
            inArray(transfers.status, ["clientApproved", "serverApproved"]),
            gt(transfers.createdAt, since),
          ),
        )
        .limit(limit);
      return { success: true, data: rows, error: null };
    } catch (error) {
      console.error("TransferSafetyNetRepository.findRecentSettledForAck error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
