import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { domains, transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

// NB-8: transfers.status を書き換える箇所を 1 か所に集約する。
// 以前は TransferRepository / DomainTransferRepository / TransferPollRepository の 3 つの
// updateStatus が同じ SQL を書いていて、遷移可能値の追加時 (例: expired) にドリフトのリスクが高かった。
// スライス間で共有するロジックは domains/ 配下に置く CLAUDE.md ルールに沿ってここへ集約。
export class TransferStatusRepository {
  static async update({
    id,
    status,
    env,
  }: {
    id: string;
    status: TransferStatus;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.update(transfers).set({ status }).where(eq(transfers.id, id));
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("TransferStatusRepository.update error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // R2: cancel / reject 用に「transfer.status を確定値に + domain.status = ok」を
  // 1 トランザクションで実行する。中間で落ちて domain が pendingTransfer で永久ロックされるのを防ぐ。
  static async settleAndReleaseDomain({
    transferId,
    domainId,
    transferStatus,
    env,
  }: {
    transferId: string;
    domainId: string;
    transferStatus: "clientRejected" | "clientCancelled";
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.batch([
        db.update(transfers).set({ status: transferStatus }).where(eq(transfers.id, transferId)),
        db.update(domains).set({ status: "ok" }).where(eq(domains.id, domainId)),
      ]);
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("TransferStatusRepository.settleAndReleaseDomain error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // expired 用の batch。transfer.status=expired + domain.status=ok を 1 トランザクションで。
  // DLQ で「レジストリも pending のまま」と判定された場合に呼ばれる。
  static async expireAndReleaseDomain({
    transferId,
    domainId,
    env,
  }: {
    transferId: string;
    domainId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.batch([
        db.update(transfers).set({ status: "expired" }).where(eq(transfers.id, transferId)),
        db.update(domains).set({ status: "ok" }).where(eq(domains.id, domainId)),
      ]);
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("TransferStatusRepository.expireAndReleaseDomain error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // 承認確定用のバッチ。transfer.status + domain.ownerUserId + domain.status=ok を
  // 1 トランザクションで更新する。
  // - transferStatus="clientApproved": losing user が明示的に approve を叩いた場合 (DomainService.approveTransfer から)
  // - transferStatus="serverApproved": レジストリが 20 分ルールで自動承認した場合 (poll / DLQ 経由)
  static async commitApproved({
    transferId,
    domainId,
    transferStatus,
    newOwnerUserId,
    env,
  }: {
    transferId: string;
    domainId: string;
    transferStatus: "clientApproved" | "serverApproved";
    newOwnerUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const db = createDBClient(env);
      await db.batch([
        db.update(transfers).set({ status: transferStatus }).where(eq(transfers.id, transferId)),
        db.update(domains).set({ ownerUserId: newOwnerUserId, status: "ok" }).where(eq(domains.id, domainId)),
      ]);
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("TransferStatusRepository.commitApproved error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }

  // 後方互換ラッパ。旧名 commitServerApproved は "serverApproved" 決め打ちで呼ばれてきた。
  // 新規コードは commitApproved を直接呼ぶこと。
  static async commitServerApproved(params: {
    transferId: string;
    domainId: string;
    newOwnerUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    return TransferStatusRepository.commitApproved({ ...params, transferStatus: "serverApproved" });
  }
}

// transfers.status の取り得る値。schema コメントと同期させる。
export type TransferStatus =
  | "pendingTransfer"
  | "clientApproved"
  | "clientRejected"
  | "clientCancelled"
  | "serverApproved"
  | "expired";
