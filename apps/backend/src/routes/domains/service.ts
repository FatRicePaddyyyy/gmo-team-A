import { TransferStatusRepository } from "../../domains/transfer/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { Registry } from "../../lib/bridge/types";
import type { Result } from "../../types/result";
import { DomainMapper   } from "./mapper";
import type {DomainDetailResponse, DomainResponse} from "./mapper";
import { DomainRepository } from "./repository";
import { DomainTransferRepository } from "./transfer-repository";
import { DomainUserRepository } from "./user-repository";

// 廃止したドメインが取りうる状態。
//
// レジストリの仕様（実機で確認済み）:
//   廃止直後   status = ["pendingDelete", "redemptionPeriod"]  → 復旧できる
//   45日経過後 status = ["pendingDelete"]                      → 復旧できない
// pendingDelete は復旧できなくなったあとも付いたままなので、それだけでは
// 復旧できるかを判断できない。復旧可否は redemptionPeriod の有無で決まる。
//
// なお復旧できるかどうかの判断はレジストリに任せている（DB の値は古い可能性があるため）。
// ここで使うのは「復旧した直後にまだ廃止中の値が返ってきたら ok に倒す」ためだけ。
const DELETED_STATUSES = ["redemptionPeriod", "pendingDelete"] as const;

function isDeletedStatus(status: string): boolean {
  return (DELETED_STATUSES as readonly string[]).includes(status);
}

// レジストリの status[] を DB カラム用の 1 つの status に集約する。
// B7: DB の status は「ドメインが今どの遷移状態にあるか」を表す業務ステータスなので、
// 復旧できる猶予状態 (redemptionPeriod) が最優先、次に pending*、続いて server* の運用ロック、
// それ以外は "ok" に丸める。
// clientTransferProhibited など client 系フラグは DB.status に載せない
// (載せると "ok" 判定が壊れて transfer/renew ができなくなる)。
function pickPrimaryStatus(statuses: string[], fallback: string): string {
  // 廃止直後は pendingDelete と redemptionPeriod が両方付く。復旧できるのは
  // redemptionPeriod があるときだけなので、そちらを優先して記録する
  // （45日経過後は pendingDelete だけが残り、復旧できない状態と区別できる）。
  if (statuses.includes("redemptionPeriod")) {return "redemptionPeriod";}
  if (statuses.includes("pendingDelete")) {return "pendingDelete";}
  if (statuses.includes("pendingTransfer")) {return "pendingTransfer";}
  if (statuses.includes("pendingRenew")) {return "pendingRenew";}
  if (statuses.includes("pendingUpdate")) {return "pendingUpdate";}
  if (statuses.includes("pendingCreate")) {return "pendingCreate";}
  if (statuses.includes("serverHold")) {return "serverHold";}
  if (statuses.includes("inactive")) {return "inactive";}
  if (statuses.includes("ok")) {return "ok";}
  if (statuses.length === 0) {return fallback;}
  // 未知のステータス集合。fallback を返し、client 系フラグに引きずられないようにする。
  return fallback;
}

export class DomainService {
  static async check({
    name,
    env,
  }: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<{ avail: boolean; registry: Registry }>> {
    // レジストリを自動解決（両レジストリの hello を並列で叩いて TLD で判定）
    const registryResult = await RegistryBridge.resolveRegistry({ name, env });
    if (!registryResult.success) {return registryResult;}
    const registry = registryResult.data;

    const result = await RegistryBridge.check({ name, registry, env });
    if (!result.success) {return result;}
    const avail = result.data.results[0]?.avail ?? false;
    return { success: true, data: { avail, registry }, error: null };
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
    // 1. 疎通確認: レジストリの hello を叩き、認証ヘッダ・応答・TLD 対応を確認する。
    const helloResult = await RegistryBridge.hello({ registry, env });
    if (!helloResult.success) {return helloResult;}
    const lastDot = name.trim().toLowerCase().lastIndexOf(".");
    const tld = lastDot >= 0 ? name.trim().toLowerCase().slice(lastDot + 1) : "";
    const normalize = (t: string) => t.toLowerCase().replace(/^\./, "");
    const tldSupported = helloResult.data.tlds.some(t => normalize(t) === tld);
    if (!tldSupported) {
      return { success: false, data: null, error: "unsupported_tld" };
    }

    // 2. コンタクト作成: 実ユーザーの name / email を postalInfo.name / email に流し込む。
    //    レジストリの Swagger 制約に沿って、ユーザーは事前に許可ダミー氏名 (例: "Taro Test") と
    //    @example.(com|net|org) のメールで登録されている前提。
    const userResult = await DomainUserRepository.findById({ id: userId, env });
    if (!userResult.success) {return userResult;}
    if (!userResult.data) {
      return { success: false, data: null, error: "user_not_found" };
    }
    const contactResult = await RegistryBridge.createContact({
      name: userResult.data.name,
      email: userResult.data.email,
      registry,
      env,
    });
    if (!contactResult.success) {return contactResult;}
    const contactId = contactResult.data.contactId;

    const authInfo = crypto.randomUUID();

    // 3. ドメイン登録: registrant と contacts.ADMIN/TECH/BILLING に上で作った contactId を割り当てる。
    const createResult = await RegistryBridge.create({
      domain: name,
      period,
      registrant: contactId,
      contacts: { ADMIN: contactId, TECH: contactId, BILLING: contactId },
      authInfo,
      nameservers: nameServers,
      registry,
      env,
    });
    if (!createResult.success) {return createResult;}

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
    if (!dbResult.success) {return dbResult;}

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
    if (!result.success) {return result;}
    return { success: true, data: result.data.map(row => DomainMapper.toResponse(row)), error: null };
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
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
    if (!infoResult.success) {return infoResult;}

    // exDate は Swagger 上 ISO8601 文字列だが、レジストリ実装によっては非 ISO を返しうる。
    // Invalid Date のまま DB に流すと NaN epoch で保存されるので明示的に検証する。
    const expiresAt = new Date(infoResult.data.exDate);
    if (Number.isNaN(expiresAt.getTime())) {
      return { success: false, data: null, error: "invalid_expires_at" };
    }
    const status = pickPrimaryStatus(infoResult.data.status ?? [], domain.status);

    // 読み取りついでにレジストリの最新値で DB を同期する (best-effort)。
    // ここで DB 書き込みが失敗しても、呼び出し元にはレジストリの新鮮なデータを返したいので、
    // 失敗はログに残して処理は続行する (CQS 的にも read リクエストが write 失敗で 500 にならない)。
    const updateResult = await DomainRepository.updateExpiresAtAndStatus({ id: domainId, expiresAt, status, env });
    if (!updateResult.success) {
      console.error("DomainService.info: DB sync failed but continuing with registry data:", updateResult.error);
    }

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
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    const curExpDate = new Date(domain.expiresAt).toISOString().split("T")[0];
    if (!curExpDate) {return { success: false, data: null, error: "invalid_expires_at" };}

    const renewResult = await RegistryBridge.renew({
      name: domain.name,
      curExpDate,
      period,
      registry: domain.registry,
      env,
    });
    if (!renewResult.success) {return renewResult;}

    const expiresAt = new Date(renewResult.data.exDate);
    const updateResult = await DomainRepository.updateExpiresAt({ id: domainId, expiresAt, env });
    if (!updateResult.success) {return updateResult;}

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
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    // autoRenew のみ変更する場合は、Bridge を呼ばず DB だけ更新して early return
    const hasRegistryChanges = Boolean(nameServers ?? addStatuses ?? remStatuses ?? chg);
    if (!hasRegistryChanges && autoRenew !== undefined) {
      const arResult = await DomainRepository.updateAutoRenew({ id: domainId, autoRenew, env });
      if (!arResult.success) {return arResult;}
      const updatedRow = { ...domain, autoRenew };
      // レジストリからの最新情報はないので info を呼ぶ
      const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
      if (!infoResult.success) {return infoResult;}
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
      registry: domain.registry,
      env,
    });
    if (!updateResult.success) {return updateResult;}

    // update のレスポンス形はレジストリによって異なる（Kitaqnic は空）ため、
    // 最新の DomainResponse は改めて info で取得して DB に同期する
    const infoResult = await RegistryBridge.info({ name: domain.name, registry: domain.registry, env });
    if (!infoResult.success) {return infoResult;}
    const registryData = infoResult.data;
    const expiresAt = new Date(registryData.exDate);
    if (Number.isNaN(expiresAt.getTime())) {
      return { success: false, data: null, error: "invalid_expires_at" };
    }
    const status = pickPrimaryStatus(registryData.status ?? [], domain.status);
    const syncResult = await DomainRepository.updateExpiresAtAndStatus({ id: domainId, expiresAt, status, env });
    if (!syncResult.success) {return syncResult;}

    if (chg?.authInfo) {
      const authInfoResult = await DomainRepository.updateAuthInfo({ id: domainId, authInfo: chg.authInfo, env });
      if (!authInfoResult.success) {return authInfoResult;}
    }

    if (autoRenew !== undefined) {
      const arResult = await DomainRepository.updateAutoRenew({ id: domainId, autoRenew, env });
      if (!arResult.success) {return arResult;}
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
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    if (domain.status === "pendingTransfer") {
      return { success: false, data: null, error: "domain_pending_transfer" };
    }

    const deleteResult = await RegistryBridge.delete({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!deleteResult.success) {return deleteResult;}

    // 廃止後の status を "pendingDelete" 決め打ちにしない。
    // delete のレスポンスは resData が空で status を返さないため info で取り直す。
    // 猶予状態の呼び名はレジストリによって redemptionPeriod / pendingDelete と分かれ、
    // 意味も違う（前者は復旧できる、後者は削除待ち）ので、返ってきた値をそのまま記録する。
    // info が取れなければ、実機の挙動に合わせて pendingDelete に倒す。
    const infoResult = await RegistryBridge.info({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!infoResult.success) {
      console.error(
        `DomainService.delete: 廃止後の info を取得できなかったため status を "pendingDelete" として保存します: ${infoResult.error}`,
      );
    }
    const status = infoResult.success
      ? pickPrimaryStatus(infoResult.data.status ?? [], "pendingDelete")
      : "pendingDelete";

    const updateResult = await DomainRepository.updateStatus({ id: domainId, status, env });
    if (!updateResult.success) {return updateResult;}

    const updated = { ...domain, status };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }

  // losing (現オーナー) 目線で pending な inbound transfer の一覧を返す。
  // frontend はこの一覧を使って「あなたのドメイン xxx.com に移管申請が来ています」と表示し、
  // approve / reject を叩けるようにする。
  static async listInboundPendingTransfers({
    userId,
    env,
  }: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<{
    transferId: string;
    domainId: string;
    domainName: string;
    registry: "kitaqsign" | "kitaqnic";
    requestedAt: string;
  }[]>> {
    const result = await DomainTransferRepository.findInboundPendingByOwner({ ownerUserId: userId, env });
    if (!result.success) {return result;}
    return {
      success: true,
      data: result.data.map(row => ({
        transferId: row.transferId,
        domainId: row.domainId,
        domainName: row.domainName,
        registry: row.registry,
        requestedAt: new Date(row.requestedAt).toISOString(),
      })),
      error: null,
    };
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
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    if (domain.ownerUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }

    // B2: pendingTransfer な transfer レコードが存在するかチェック。
    // 既に処理済み (clientApproved/serverApproved/clientRejected/clientCancelled) なら弾く。
    // poll consumer が先に owner 変更を反映していると、ここで元 owner がヒットしても
    // 「pending が無い = 既に処理済み」と判断できる。
    const transferResult = await DomainTransferRepository.findPendingByDomainId({ domainId, env });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }

    const bridgeResult = await RegistryBridge.transferApprove({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!bridgeResult.success) {return bridgeResult;}

    // Bug 対策: bridge 成功後に同期的に DB へ確定を反映する。
    //   transfer.status = "clientApproved" (losing が明示的に approve を叩いたので client 側の approve)
    //   domains.ownerUserId = gaining
    //   domains.status = "ok"
    // これを 1 バッチで書くので、後続の cron poll で serverApproved 経由のメッセージが届いても
    // 既に pendingTransfer では無いので冪等スキップされる (transfer-cron-poll/service.ts handleMessage)。
    // レジストリキューに残った通知メッセージは次回 cron drain が自然に ack して処分する。
    const commit = await TransferStatusRepository.commitApproved({
      transferId: transferResult.data.id,
      domainId,
      transferStatus: "clientApproved",
      newOwnerUserId: transferResult.data.gainingUserId,
      env,
    });
    if (!commit.success) {return commit;}

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
    if (!domainResult.success) {return domainResult;}
    if (!domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    if (domain.ownerUserId !== userId) {
      return { success: false, data: null, error: "forbidden" };
    }

    // B2: pendingTransfer な transfer が無ければ既に処理済みとして弾く。
    // これを bridge の前に置くことで、確定済みの transfer に対して余分な reject リクエストを送らない。
    const transferResult = await DomainTransferRepository.findPendingByDomainId({ domainId, env });
    if (!transferResult.success) {return transferResult;}
    if (!transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }

    const bridgeResult = await RegistryBridge.transferReject({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!bridgeResult.success) {return bridgeResult;}

    // R2: transfer.status と domain.status の 2 更新を batch でアトミック化。
    const settle = await TransferStatusRepository.settleAndReleaseDomain({
      transferId: transferResult.data.id,
      domainId,
      transferStatus: "clientRejected",
      env,
    });
    if (!settle.success) {return settle;}

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
    if (!domainResult.success) {return domainResult;}
    if (domainResult.data?.ownerUserId !== userId) {
      return { success: false, data: null, error: "not_found" };
    }
    const domain = domainResult.data;

    const restoreResult = await RegistryBridge.restore({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!restoreResult.success) {return restoreResult;}

    // 復旧後の status を "ok" 決め打ちにしない。
    // restore のレスポンスは resData が空で status を返さないため、info で取り直す。
    // 決め打ちだと、レジストリが "ok" 以外（inactive / serverHold 等）を返したときに
    // DB とレジストリがズレたままになる（次に info を叩くまで直らない）。
    // info と同じくレジストリの返り値から決め、取れなければ "ok" に倒す。
    // 実測(kitaqsign): NS 未設定のドメインでも復旧後は ["ok"] / rgpStatus ["addPeriod"] だった。
    const infoResult = await RegistryBridge.info({
      name: domain.name,
      registry: domain.registry,
      env,
    });
    if (!infoResult.success) {
      // 復旧そのものは成功しているので処理は続ける。ただし status を確認できていないことは残す。
      console.error(
        `DomainService.restore: 復旧後の info を取得できなかったため status を "ok" として保存します: ${infoResult.error}`,
      );
    }
    const raw = infoResult.success
      ? pickPrimaryStatus(infoResult.data.status ?? [], "ok")
      : "ok";
    // レジストリ側の反映が一瞬遅れて、まだ廃止中（redemptionPeriod / pendingDelete）が
    // 返ることがある。ここで書き戻すと「復旧したのに廃止中」になってしまうので ok に倒す。
    // 「復旧できるか」の判定（isRestorable）とは別物なので、ここでは両方を見る。
    const status = isDeletedStatus(raw) ? "ok" : raw;

    const updateResult = await DomainRepository.updateStatus({ id: domainId, status, env });
    if (!updateResult.success) {return updateResult;}

    const updated = { ...domain, status };
    return { success: true, data: DomainMapper.toResponse(updated), error: null };
  }
}
