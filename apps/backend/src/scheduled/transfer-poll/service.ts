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

    const domainResult = await TransferPollRepository.findDomainById({ id: transfer.domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    const pollResult = await RegistryBridge.pollAndAck({
      registry: transfer.registry as Registry,
      env,
    });
    if (!pollResult.success) return pollResult;

    if (!pollResult.data) {
      // メッセージなし（まだ pending か自動承認前）→ 正常終了
      return { success: true, data: undefined, error: null };
    }

    const pollMessage = pollResult.data;

    // content.domain でこのtransferのメッセージか判定
    if (pollMessage.payload.domain && pollMessage.payload.domain !== domain.name) {
      console.warn(
        `TransferPollService: domain mismatch. expected=${domain.name}, got=${pollMessage.payload.domain}`,
      );
      return { success: true, data: undefined, error: null };
    }

    const status = pollMessage.payload.status;

    if (status === "serverApproved" || status === "clientApproved") {
      await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
      await TransferPollRepository.updateDomainOwner({
        id: transfer.domainId,
        newOwnerUserId: transfer.gainingUserId,
        env,
      });
      await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
    } else if (status === "clientRejected" || status === "clientCancelled") {
      await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
      await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
    } else {
      // 未知のステータス — DB を更新しないままにすると transfer が永遠に pendingTransfer のまま残る
      console.error(`TransferPollService: unknown status="${status}" for transferId=${transferId}`);
      return { success: false, data: null, error: `unknown_transfer_status: ${status}` };
    }

    return { success: true, data: undefined, error: null };
  }
}
