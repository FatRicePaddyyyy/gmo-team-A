import { eq } from "drizzle-orm";
import type { DBClient } from "../../lib/db";
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
    db,
  }: {
    id: string;
    status: TransferStatus;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
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
    db,
  }: {
    transferId: string;
    domainId: string;
    transferStatus: "clientRejected" | "clientCancelled";
    db: DBClient;
  }): Promise<Result<void>> {
    try {
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
    db,
  }: {
    transferId: string;
    domainId: string;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
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
    db,
  }: {
    transferId: string;
    domainId: string;
    transferStatus: "clientApproved" | "serverApproved";
    newOwnerUserId: string;
    db: DBClient;
  }): Promise<Result<void>> {
    try {
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

  // 別レジストラへの移管を確定するバッチ (外部 pending 承認 = gainingUserId が null のケース)。
  // transfer.status を確定値にした後、自 backend の domains 行は削除する
  // (別レジストラに所有権が移ったので自 backend の管轄外になる)。
  // transfers 側の FK は onDelete: "restrict" なので、先に transfer を settled にしてから
  // 順に SQL を発行する必要がある。ただし D1 の batch は同一トランザクション + 順序保持なので、
  // transfers UPDATE → transfers DELETE (この domain 参照) → domains DELETE の順で書ける。
  // ここでは「同 domain の全 transfer 行を DELETE」してから「domain 行を DELETE」する。
  static async commitApprovedAndDropDomain({
    transferId,
    domainId,
    transferStatus,
    db,
  }: {
    transferId: string;
    domainId: string;
    transferStatus: "clientApproved" | "serverApproved";
    db: DBClient;
  }): Promise<Result<void>> {
    try {
      // まず対象 transfer を settled にして pending 部分 UNIQUE から外す。
      // その後、同 domain に紐づく全 transfer を消し (履歴は諦める)、最後に domain を消す。
      // 履歴を残したい場合は将来 archive テーブル追加を検討。
      await db.batch([
        db.update(transfers).set({ status: transferStatus }).where(eq(transfers.id, transferId)),
        db.delete(transfers).where(eq(transfers.domainId, domainId)),
        db.delete(domains).where(eq(domains.id, domainId)),
      ]);
      return { success: true, data: undefined, error: null };
    } catch (error) {
      console.error("TransferStatusRepository.commitApprovedAndDropDomain error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
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
