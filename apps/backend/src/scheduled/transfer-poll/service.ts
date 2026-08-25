import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { TransferPollRepository } from "./repository";

export class TransferPollService {
  static async process({
    transferId,
    env,
  }: {
    transferId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const transferResult = await TransferPollRepository.findTransferById({ id: transferId, env });
    if (!transferResult.success) return transferResult;
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }
    const transfer = transferResult.data;

    // 既に処理済み（clientApproved/Rejected/Cancelled/serverApproved）ならスキップ
    // Queue retry や重複メッセージへの冪等性
    if (transfer.status !== "pendingTransfer") {
      console.info(`TransferPollService: transfer ${transferId} already processed (status=${transfer.status}), skipping`);
      return { success: true, data: undefined, error: null };
    }

    const domainResult = await TransferPollRepository.findDomainById({ id: transfer.domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    // Step 1: Poll のみ（ack はまだ）
    const pollResult = await RegistryBridge.poll({
      registry: transfer.registry as Registry,
      env,
    });
    if (!pollResult.success) return pollResult;

    if (!pollResult.data) {
      // メッセージなし（まだ pending か自動承認前）→ 正常終了。次回の scheduled で再度確認される
      return { success: true, data: undefined, error: null };
    }

    const pollMessage = pollResult.data;

    // Step 2: このtransferのメッセージか判定。違うなら ack せず終了
    // （別のtransferのメッセージを消費してしまうと、そのtransferの処理が失敗する）
    if (pollMessage.msgType && !pollMessage.msgType.toLowerCase().includes("transfer")) {
      console.warn(`TransferPollService: skipping non-transfer msgType="${pollMessage.msgType}"`);
      return { success: true, data: undefined, error: null };
    }
    if (pollMessage.payload.domain && pollMessage.payload.domain !== domain.name) {
      console.warn(
        `TransferPollService: domain mismatch. expected=${domain.name}, got=${pollMessage.payload.domain}`,
      );
      return { success: true, data: undefined, error: null };
    }

    const status = pollMessage.payload.status;

    // Step 3: DB を先に更新（失敗したら Queue retry で再実行される）
    if (status === "serverApproved" || status === "clientApproved") {
      const t = await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
      if (!t.success) return t;
      const o = await TransferPollRepository.updateDomainOwner({
        id: transfer.domainId,
        newOwnerUserId: transfer.gainingUserId,
        env,
      });
      if (!o.success) return o;
      const s = await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
      if (!s.success) return s;
    } else if (status === "clientRejected" || status === "clientCancelled") {
      const t = await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
      if (!t.success) return t;
      const s = await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
      if (!s.success) return s;
    } else {
      // 未知のステータス — ack せず失敗を返す。Queue で retry される
      console.error(`TransferPollService: unknown status="${status}" for transferId=${transferId}`);
      return { success: false, data: null, error: `unknown_transfer_status: ${status}` };
    }

    // Step 4: DB 更新が全て成功した後で ack
    // ack が失敗しても DB は正しい状態なので、次回 Queue retry で同じメッセージを取っても
    // 上の transfer.status !== "pendingTransfer" チェックで冪等にスキップされる
    const ackResult = await RegistryBridge.ackMessage({
      messageId: pollMessage.id,
      registry: transfer.registry as Registry,
      env,
    });
    if (!ackResult.success) {
      console.error(`TransferPollService: ack failed but DB updated. messageId=${pollMessage.id}`);
      // ack 失敗でも DB は正しいので success 扱いにする（次の Poll で同じメッセージが返るが、冪等に処理される）
      return { success: true, data: undefined, error: null };
    }

    return { success: true, data: undefined, error: null };
  }
}
