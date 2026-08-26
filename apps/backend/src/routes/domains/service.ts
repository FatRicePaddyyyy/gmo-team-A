import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { DomainMapper, type DomainDetailResponse, type DomainResponse } from "./mapper";
import { DomainRepository } from "./repository";
import { DomainTransferRepository } from "./transfer-repository";

// レジストリの status[] を DB カラム用の1つの status に集約する。
// pendingTransfer / pendingDelete があれば優先、なければ status[0]、最終的に "ok"。
function pickPrimaryStatus(statuses: string[], fallback: string): string {
  if (statuses.includes("pendingDelete")) return "pendingDelete";
  if (statuses.includes("pendingTransfer")) return "pendingTransfer";
  if (statuses.length > 0 && statuses[0]) return statuses[0];
  return fallback;
}

export class DomainService {
  static async check({
    name,
    registry,
    env,
  }: {
    name: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<{ avail: boolean }>> {
    const result = await RegistryBridge.check({ name, registry, env });
    if (!result.success) return result;
    const avail = result.data.results[0]?.avail ?? false;
    return { success: true, data: { avail }, error: null };
  }

  static async create({
    name,
    registry,
    period,
    nameServers,
    userId,
    env,
  }: {
    name: string;
    registry: Registry;
    period: { unit: string; value: number };
    nameServers?: string[];
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    const contactResult = await RegistryBridge.createContact({ registry, env });
    if (!contactResult.success) return contactResult;

    const authInfo = crypto.randomUUID();

    const createResult = await RegistryBridge.create({
      domain: name,
      period,
      registrant: contactResult.data.contactId,
      authInfo,
      nameservers: nameServers,
      registry,
      env,
    });
    if (!createResult.success) return createResult;

    const expiresAt = new Date(createResult.data.exDate);
    const createdAt = new Date(createResult.data.crDate); // レジストリ登録日時
    const dbResult = await DomainRepository.create({
      data: {
        name,
        registry,
        status: "ok",
        expiresAt,
        createdAt,
        authInfo,
        ownerUserId: userId,
      },
      env,
    });
    if (!dbResult.success) return dbResult;

    return { success: true, data: DomainMapper.toResponse(dbResult.data), error: null };
  }

  static async list({
    userId,
    env,
  }: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse[]>> {
    const result = await DomainRepository.listByUserId({ userId, env });
    if (!result.success) return result;
    return { success: true, data: result.data.map(DomainMapper.toResponse), error: null };
  }

  static async info({
    domainId,
    userId,
    env,
  }: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainDetailResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data || domainResult.data.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry as Registry, env });
    if (!infoResult.success) return infoResult;

    const expiresAt = new Date(infoResult.data.exDate);
    const status = pickPrimaryStatus(infoResult.data.status, domain.status);

    // expiresAt と status を1クエリでアトミックに更新（2回に分けると並行読み取りで不整合が起きる）
    const updateResult = await DomainRepository.updateExpiresAtAndStatus({ id: domainId, expiresAt, status, env });
    if (!updateResult.success) return updateResult;

    const updatedRow = { ...domain, expiresAt, status };
    return { success: true, data: DomainMapper.toDetailResponse(updatedRow, infoResult.data), error: null };
  }

  static async renew({
    domainId,
    period,
    userId,
    env,
  }: {
    domainId: string;
    period: { unit: string; value: number };
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data || domainResult.data.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    const curExpDate = new Date(domain.expiresAt).toISOString().split("T")[0];
    if (!curExpDate) return { success: false, data: null, error: "invalid_expires_at" };

    const renewResult = await RegistryBridge.renew({
      name: domain.name,
      curExpDate,
      period,
      registry: domain.registry as Registry,
      env,
    });
    if (!renewResult.success) return renewResult;

    const expiresAt = new Date(renewResult.data.exDate);
    const updateResult = await DomainRepository.updateExpiresAt({ id: domainId, expiresAt, env });
    if (!updateResult.success) return updateResult;

    const updated = { ...domain, expiresAt };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }

  static async update({
    domainId,
    nameServers,
    addStatuses,
    remStatuses,
    chg,
    autoRenew,
    userId,
    env,
  }: {
    domainId: string;
    nameServers?: string[];
    addStatuses?: string[];
    remStatuses?: string[];
    chg?: { registrant?: string; authInfo?: string };
    autoRenew?: boolean; // Issue #24: 自動更新設定
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainDetailResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data || domainResult.data.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    // autoRenew のみ変更する場合は、Bridge を呼ばず DB だけ更新して early return
    const hasRegistryChanges = Boolean(nameServers || addStatuses || remStatuses || chg);
    if (!hasRegistryChanges && autoRenew !== undefined) {
      const arResult = await DomainRepository.updateAutoRenew({ id: domainId, autoRenew, env });
      if (!arResult.success) return arResult;
      const updatedRow = { ...domain, autoRenew };
      // レジストリからの最新情報はないので info を呼ぶ
      const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry as Registry, env });
      if (!infoResult.success) return infoResult;
      return { success: true, data: DomainMapper.toDetailResponse(updatedRow, infoResult.data), error: null };
    }

    const add = (nameServers || addStatuses)
      ? {
          ...(nameServers ? { nameservers: nameServers } : {}),
          ...(addStatuses ? { statuses: addStatuses } : {}),
        }
      : undefined;

    const rem = remStatuses ? { statuses: remStatuses } : undefined;

    const updateResult = await RegistryBridge.update({
      name: domain.name,
      add,
      rem,
      chg,
      registry: domain.registry as Registry,
      env,
    });
    if (!updateResult.success) return updateResult;

    // update のレスポンス形はレジストリによって異なる（Kitaqnic は空）ため、
    // 最新の DomainResponse は改めて info で取得して DB に同期する
    const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry as Registry, env });
    if (!infoResult.success) return infoResult;
    const registryData = infoResult.data;
    const expiresAt = new Date(registryData.exDate);
    const status = pickPrimaryStatus(registryData.status, domain.status);
    const syncResult = await DomainRepository.updateExpiresAtAndStatus({ id: domainId, expiresAt, status, env });
    if (!syncResult.success) return syncResult;

    if (chg?.authInfo) {
      const authInfoResult = await DomainRepository.updateAuthInfo({ id: domainId, authInfo: chg.authInfo, env });
      if (!authInfoResult.success) return authInfoResult;
    }

    if (autoRenew !== undefined) {
      const arResult = await DomainRepository.updateAutoRenew({ id: domainId, autoRenew, env });
      if (!arResult.success) return arResult;
    }

    const updatedRow = {
      ...domain,
      expiresAt,
      status,
      ...(chg?.authInfo ? { authInfo: chg.authInfo } : {}),
      ...(autoRenew !== undefined ? { autoRenew } : {}),
    };
    return { success: true, data: DomainMapper.toDetailResponse(updatedRow, registryData), error: null };
  }

  static async delete({
    domainId,
    userId,
    env,
  }: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data || domainResult.data.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    const deleteResult = await RegistryBridge.delete({
      name: domain.name,
      registry: domain.registry as Registry,
      env,
    });
    if (!deleteResult.success) return deleteResult;

    const updateResult = await DomainRepository.updateStatus({ id: domainId, status: "pendingDelete", env });
    if (!updateResult.success) return updateResult;

    const updated = { ...domain, status: "pendingDelete" };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }

  static async approveTransfer({
    domainId,
    userId,
    env,
  }: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const domainResult = await DomainRepository.findById({ id: domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    if (domain.ownerUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }

    // DB上に pendingTransfer の transfer レコードが存在するか確認
    const transferResult = await DomainTransferRepository.findByDomainId({ domainId, env });
    if (!transferResult.success) return transferResult;
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }

    const bridgeResult = await RegistryBridge.transferApprove({
      name: domain.name,
      registry: domain.registry as Registry,
      env,
    });
    if (!bridgeResult.success) return bridgeResult;

    // DB更新はQueue consumerが担当（approve後にpollAndAckで結果を受け取る）
    return { success: true, data: undefined, error: null };
  }

  static async rejectTransfer({
    domainId,
    userId,
    env,
  }: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    const domainResult = await DomainRepository.findById({ id: domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    if (domain.ownerUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }

    const bridgeResult = await RegistryBridge.transferReject({
      name: domain.name,
      registry: domain.registry as Registry,
      env,
    });
    if (!bridgeResult.success) return bridgeResult;

    // rejectは確定操作なのでDB同期的に更新する
    const transferResult = await DomainTransferRepository.findByDomainId({ domainId, env });
    if (!transferResult.success) return transferResult;
    if (!transferResult.data) {
      // transfer レコードが見つからない場合は domain の status 更新もスキップして不整合を防ぐ
      return { success: false, data: null, error: "transfer_not_found" };
    }

    const rejectStatusResult = await DomainTransferRepository.updateStatus({
      id: transferResult.data.id,
      status: "clientRejected",
      env,
    });
    if (!rejectStatusResult.success) return rejectStatusResult;

    const domainStatusResult = await DomainRepository.updateStatus({ id: domainId, status: "ok", env });
    if (!domainStatusResult.success) return domainStatusResult;

    return { success: true, data: undefined, error: null };
  }

  static async restore({
    domainId,
    userId,
    env,
  }: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    const domainResult = await DomainRepository.findById({ id: domainId, env });
    if (!domainResult.success) return domainResult;
    if (!domainResult.data || domainResult.data.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    const restoreResult = await RegistryBridge.restore({
      name: domain.name,
      registry: domain.registry as Registry,
      env,
    });
    if (!restoreResult.success) return restoreResult;

    const updateResult = await DomainRepository.updateStatus({ id: domainId, status: "ok", env });
    if (!updateResult.success) return updateResult;

    const updated = { ...domain, status: "ok" };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }
}
