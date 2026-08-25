import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { transfers } from "../../lib/schema/general-schema";
import { TransferDomainRepository } from "./domain-repository";
import { TransferRepository } from "./repository";

type Transfer = typeof transfers.$inferSelect;

export class TransferService {
  static async request({
    name,
    authInfo,
    registry,
    gainingUserId,
    env,
  }: {
    name: string;
    authInfo: string;
    registry: Registry;
    gainingUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer>> {
    const domainResult = await TransferDomainRepository.findByName({ name, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    if (domain.status !== "ok") {
      return { success: false, data: null, error: "domain_not_transferable" };
    }

    const bridgeResult = await RegistryBridge.transferRequest({ name, authInfo, registry, env });
    if (!bridgeResult.success) return bridgeResult;

    const transferResult = await TransferRepository.create({
      data: {
        domainId: domain.id,
        registry,
        status: "pendingTransfer",
        gainingUserId,
      },
      env,
    });
    if (!transferResult.success) return transferResult;

    const statusUpdateResult = await TransferDomainRepository.updateStatus({ id: domain.id, status: "pendingTransfer", env });
    if (!statusUpdateResult.success) return statusUpdateResult;

    if (env.TRANSFER_QUEUE) {
      try {
        await env.TRANSFER_QUEUE.send(
          { transferId: transferResult.data.id },
          { delaySeconds: 1200 },
        );
      } catch (e) {
        // Queue への積み込み失敗。DB には Transfer レコードが残るが Poll は発火しない。
        // レジストリ側は 20分で自動承認するため、致命的ではないがログを残す。
        console.error("TRANSFER_QUEUE.send failed for transferId:", transferResult.data.id, e);
      }
    }

    return { success: true, data: transferResult.data, error: null };
  }

  static async cancel({
    transferId,
    userId,
    env,
  }: {
    transferId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const transferResult = await TransferRepository.findById({ id: transferId, env });
    if (!transferResult.success) return transferResult;
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }
    const transfer = transferResult.data;

    if (transfer.gainingUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }
    if (transfer.status !== "pendingTransfer") {
      return { success: false, data: null, error: "transfer_not_cancellable" };
    }

    const domainResult = await TransferDomainRepository.findById({ id: transfer.domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    const bridgeResult = await RegistryBridge.transferCancel({
      name: domain.name,
      registry: domain.registry as Registry,
      env,
    });
    if (!bridgeResult.success) return bridgeResult;

    const cancelStatusResult = await TransferRepository.updateStatus({ id: transferId, status: "clientCancelled", env });
    if (!cancelStatusResult.success) return cancelStatusResult;

    const domainStatusResult = await TransferDomainRepository.updateStatus({ id: transfer.domainId, status: "ok", env });
    if (!domainStatusResult.success) return domainStatusResult;

    return { success: true, data: undefined, error: null };
  }
}
