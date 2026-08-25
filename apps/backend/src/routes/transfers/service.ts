import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import { detectRegistry } from "../../lib/registry-policy";
import type { transfers } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";
import { TransferDomainRepository } from "./domain-repository";
import { TransferRepository } from "./repository";

type Transfer = typeof transfers.$inferSelect;

// 移管の poll 用 Queue の初回投入待ち時間 (秒)。
// レジストリが自動承認するまでの下限を待つ (Kitaqsign / Kitaqnic はハッカソン用に 20 分)。
const POLL_INITIAL_DELAY_SECONDS = 1200;

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
    // B15: FQDN 形式は Zod でもバリデーションしているが、service 層でも念のためチェック。
    // name.trim().toLowerCase() で正規化して以降を扱う。
    const normalizedName = name.trim().toLowerCase();
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(normalizedName)) {
      return { success: false, data: null, error: "invalid_domain_name" };
    }

    // B17: 引数の registry と TLD から推定した registry が一致するかを検証する。
    // 不一致は Zod でも検知できないので service 層で弾く。
    const detected = detectRegistry(normalizedName);
    if (detected && detected !== registry) {
      return { success: false, data: null, error: "invalid_domain_registry" };
    }

    const domainResult = await TransferDomainRepository.findByName({ name: normalizedName, env });
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    // B1: gaining が losing と同じ = 自分のドメインを自分に移管申請しようとしている
    // 実質的な情報漏洩でもあるので拒否する。
    if (domain.ownerUserId === gainingUserId) {
      return { success: false, data: null, error: "self_transfer" };
    }

    // ドメインが移管可能な状態 (ok) にあるかを確認する。
    // B7: pickPrimaryStatus 修正で "ok" が優先されるようになったので、
    // clientTransferProhibited 等は別途拒否
    if (domain.status !== "ok") {
      // 既に pendingTransfer なら明示的な理由でエラーを返す。DB unique index があるので
      // race で 2 件目が来ても insert 時に落ちるが、ここで早期に拒否する。
      if (domain.status === "pendingTransfer") {
        return { success: false, data: null, error: "transfer_already_pending" };
      }
      return { success: false, data: null, error: "domain_not_transferable" };
    }

    const bridgeResult = await RegistryBridge.transferRequest({ name: normalizedName, authInfo, registry, env });
    if (!bridgeResult.success) {return bridgeResult;}

    // B6: bridge 成功後 DB 書き込みが失敗したらレジストリと DB が乖離する。
    // 補償として transferCancel を叩いてロールバックを試みる。
    const transferResult = await TransferRepository.create({
      data: {
        domainId: domain.id,
        registry,
        status: "pendingTransfer",
        gainingUserId,
      },
      env,
    });
    if (!transferResult.success) {
      console.error(
        "TransferService.request: DB create failed after registry accepted. Attempting compensating cancel.",
        transferResult.error,
      );
      const compensate = await RegistryBridge.transferCancel({ name: normalizedName, registry, env });
      if (!compensate.success) {
        console.error(
          "TransferService.request: compensating cancel also failed. Manual intervention required.",
          compensate.error,
        );
      }
      return transferResult;
    }

    const statusUpdateResult = await TransferDomainRepository.updateStatus({ id: domain.id, status: "pendingTransfer", env });
    if (!statusUpdateResult.success) {
      console.error(
        "TransferService.request: domain status update failed after transfer created. Attempting compensating cancel.",
        statusUpdateResult.error,
      );
      const compensate = await RegistryBridge.transferCancel({ name: normalizedName, registry, env });
      if (!compensate.success) {
        console.error(
          "TransferService.request: compensating cancel also failed. Manual intervention required.",
          compensate.error,
        );
      }
      // DB 上の transfer レコードは無効化しておく
      await TransferRepository.updateStatus({ id: transferResult.data.id, status: "clientCancelled", env });
      return statusUpdateResult;
    }

    if (env.TRANSFER_QUEUE) {
      try {
        await env.TRANSFER_QUEUE.send(
          { transferId: transferResult.data.id, attempt: 1 },
          { delaySeconds: POLL_INITIAL_DELAY_SECONDS },
        );
      } catch (e) {
        // Queue への積み込み失敗。DB には Transfer レコードが残るが Poll は発火しない。
        // レジストリ側は自動承認するため、致命的ではないがログを残す。
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
    if (!transferResult.success) {return transferResult;}
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
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    const bridgeResult = await RegistryBridge.transferCancel({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!bridgeResult.success) {return bridgeResult;}

    const cancelStatusResult = await TransferRepository.updateStatus({ id: transferId, status: "clientCancelled", env });
    if (!cancelStatusResult.success) {return cancelStatusResult;}

    const domainStatusResult = await TransferDomainRepository.updateStatus({ id: transfer.domainId, status: "ok", env });
    if (!domainStatusResult.success) {return domainStatusResult;}

    return { success: true, data: undefined, error: null };
  }

  // B16: ユーザー自身が gaining として申請した移管の一覧。
  // cancel 対象を見つけるための最小 API。
  static async listMine({
    userId,
    env,
  }: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer[]>> {
    return TransferRepository.findByGainingUserId({ userId, env });
  }
}
