import type { Result } from "../../types/result";
import type {
  DomainCheckResponse,
  DomainCreateResponse,
  DomainResponse,
  DomainRenewResponse,
  DomainTransferResponse,
  EmptyResData,
  EppEnvelope,
  PollMessage,
  Registry,
} from "./types";

// レジストリからのレスポンス body を安全にパース
// JSON パース失敗や result フィールド欠落を検知するためのヘルパー
async function safeParseEpp<T>(res: Response): Promise<EppEnvelope<T> | null> {
  try {
    const json = await res.json() as unknown;
    if (!json || typeof json !== "object" || !("result" in json)) return null;
    return json as EppEnvelope<T>;
  } catch {
    return null;
  }
}

export class RegistryBridge {
  private static baseUrl(registry: Registry, env: CloudflareBindings): string {
    return registry === "kitaqsign" ? env.KITAQSIGN_BASE_URL : env.KITAQNIC_BASE_URL;
  }

  private static authHeaders(registry: Registry, env: CloudflareBindings): HeadersInit {
    const user = registry === "kitaqsign" ? env.KITAQSIGN_BASIC_USER : env.KITAQNIC_BASIC_USER;
    const pass = registry === "kitaqsign" ? env.KITAQSIGN_BASIC_PASS : env.KITAQNIC_BASIC_PASS;
    const registrarId = registry === "kitaqsign" ? env.KITAQSIGN_REGISTRAR_ID : env.KITAQNIC_REGISTRAR_ID;
    const apiKey = registry === "kitaqsign" ? env.KITAQSIGN_API_KEY : env.KITAQNIC_API_KEY;
    return {
      "Authorization": `Basic ${btoa(`${user}:${pass}`)}`,
      "X-Registrar-Id": registrarId,
      "X-Api-Key": apiKey,
      "X-Cl-TRID": `CLI-${crypto.randomUUID()}`,
      "Content-Type": "application/json",
    };
  }

  static async check({
    name,
    registry,
    env,
  }: {
    name: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainCheckResponse>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/check`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ names: [name] }),
      });
      if (res.status === 422) return { success: false, data: null, error: "invalid_tld" };
      const json = await safeParseEpp<DomainCheckResponse>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (!res.ok || json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      return { success: true, data: json.resData, error: null };
    } catch (e) {
      console.error("RegistryBridge.check error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async createContact({
    registry,
    env,
  }: {
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<{ contactId: string }>> {
    try {
      // Swagger 制約:
      //   - id: 3〜16文字、英数字とハイフン。レジストラ内で一意
      //   - postalInfo.name: 特定の許可名のみ（例: "Taro Test"）
      //   - postalInfo.addr.cc: "JP" | "US" のみ
      //   - postalInfo.addr.street/city: "N/A" | "Redacted for Privacy" のみ
      //   - email: @example.(com|net|org) のみ
      //   - authInfo: 1〜64文字
      // ID はドメインごとにユニークにする必要があるため crypto.randomUUID を短縮して使う
      const contactId = `C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const body = {
        id: contactId,
        postalInfo: {
          name: "Taro Test",
          addr: { street: "N/A", city: "N/A", cc: "JP" },
        },
        email: `${contactId.toLowerCase()}@example.com`,
        authInfo: crypto.randomUUID().slice(0, 16),
      };
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/contacts`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify(body),
      });
      // 409 = コンタクトID既存（UUID衝突。極めて稀）
      if (res.status === 409) return { success: false, data: null, error: "contact_id_conflict" };
      // 成功は HTTP 201（Kitaqsign / Kitaqnic 共通）
      if (res.status !== 200 && res.status !== 201) {
        return { success: false, data: null, error: "contact_create_failed" };
      }
      // レスポンスは EppResponseContactResponse: resData.id にコンタクトIDが入る
      const json = await safeParseEpp<{ id?: string }>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: "contact_create_failed" };
      }
      const returnedId = json.resData?.id ?? contactId;
      return { success: true, data: { contactId: returnedId }, error: null };
    } catch (e) {
      console.error("RegistryBridge.createContact error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async create({
    domain,
    period,
    registrant,
    authInfo,
    nameservers,
    registry,
    env,
  }: {
    domain: string;
    period: { unit: string; value: number };
    registrant: string;
    authInfo: string;
    nameservers?: string[];
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainCreateResponse>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ domain, period, registrant, authInfo, ...(nameservers ? { nameservers } : {}) }),
      });
      if (res.status === 409) { await res.body?.cancel(); return { success: false, data: null, error: "domain_exists" }; }
      if (res.status === 422) { await res.body?.cancel(); return { success: false, data: null, error: "invalid_tld" }; }
      if (res.status === 404) { await res.body?.cancel(); return { success: false, data: null, error: "contact_not_found" }; }
      const json = await safeParseEpp<DomainCreateResponse>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      if (!json.resData || !json.resData.exDate) {
        return { success: false, data: null, error: "invalid_registry_response" };
      }
      return { success: true, data: json.resData, error: null };
    } catch (e) {
      console.error("RegistryBridge.create error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async info({
    name,
    registry,
    env,
  }: {
    name: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${encodeURIComponent(name)}`, {
        method: "GET",
        headers: RegistryBridge.authHeaders(registry, env),
      });
      if (res.status === 404) { await res.body?.cancel(); return { success: false, data: null, error: "domain_not_found" }; }
      const json = await safeParseEpp<DomainResponse>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      if (!json.resData) {
        return { success: false, data: null, error: "invalid_registry_response" };
      }
      return { success: true, data: json.resData, error: null };
    } catch (e) {
      console.error("RegistryBridge.info error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async renew({
    name,
    curExpDate,
    period,
    registry,
    env,
  }: {
    name: string;
    curExpDate: string;
    period: { unit: string; value: number };
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainRenewResponse>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${encodeURIComponent(name)}/renew`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ curExpDate, period }),
      });
      if (res.status === 404) { await res.body?.cancel(); return { success: false, data: null, error: "domain_not_found" }; }
      if (res.status === 400) { await res.body?.cancel(); return { success: false, data: null, error: "invalid_period" }; }
      const json = await safeParseEpp<DomainRenewResponse>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      if (!json.resData || !json.resData.exDate) {
        return { success: false, data: null, error: "invalid_registry_response" };
      }
      return { success: true, data: json.resData, error: null };
    } catch (e) {
      console.error("RegistryBridge.renew error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async update({
    name,
    add,
    rem,
    chg,
    registry,
    env,
  }: {
    name: string;
    add?: { nameservers?: string[]; contacts?: Record<string, string>; statuses?: string[] };
    rem?: { nameservers?: string[]; contacts?: Record<string, string>; statuses?: string[] };
    chg?: { registrant?: string; authInfo?: string };
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<Partial<DomainResponse>>> {
    try {
      // レジストリ実装は Swagger 上 registrant/authInfo とも任意にもかかわらず、
      // chg を送る際は registrant を必須で要求してくる（authInfo だけの変更が 2003 で拒否される）。
      // authInfo だけの変更を通すため、指定が無ければ現在の registrant を info で補って送る。
      let effectiveChg = chg;
      if (chg?.authInfo && !chg.registrant) {
        const infoResult = await RegistryBridge.info({ name, registry, env });
        if (!infoResult.success) return infoResult;
        effectiveChg = { ...chg, registrant: infoResult.data.registrant };
      }

      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${encodeURIComponent(name)}`, {
        method: "PUT",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ ...(add ? { add } : {}), ...(rem ? { rem } : {}), ...(effectiveChg ? { chg: effectiveChg } : {}) }),
      });
      // update レスポンスは EppResponseDomainResponse（Kitaqsign）または EppResponseUnit（Kitaqnic）。
      // どちらも result.code で成否を判定できるため、HTTP ステータスだけで判定しない。
      const json = await safeParseEpp<Partial<DomainResponse>>(res);
      if (!json) {
        if (res.status === 404) return { success: false, data: null, error: "domain_not_found" };
        return { success: false, data: null, error: "invalid_registry_response" };
      }
      if (json.result.code === 2303) {
        // "Object does not exist" はドメイン自体だけでなく、add/rem で指定した
        // ネームサーバーやコンタクトが未登録の場合にも同じコードで返ってくる。
        // reason にドメイン名が含まれるかで区別する（含まれなければ参照先オブジェクトの不在）。
        const reason = json.result.reason ?? "";
        const isDomainItself = !reason || reason.includes(name);
        return {
          success: false,
          data: null,
          error: isDomainItself ? "domain_not_found" : "referenced_object_not_found",
        };
      }
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      // Kitaqnic は resData を返さない（Unit）。ドメインの最新状態は呼び出し側が info で取得する。
      return { success: true, data: json.resData ?? {}, error: null };
    } catch (e) {
      console.error("RegistryBridge.update error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async delete({
    name,
    registry,
    env,
  }: {
    name: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<EmptyResData>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: RegistryBridge.authHeaders(registry, env),
      });
      if (res.status === 404) { await res.body?.cancel(); return { success: false, data: null, error: "domain_not_found" }; }
      const json = await safeParseEpp<EmptyResData>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (json.result.code === 2304) return { success: false, data: null, error: "operation_prohibited" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      return { success: true, data: json.resData ?? {} as EmptyResData, error: null };
    } catch (e) {
      console.error("RegistryBridge.delete error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async restore({
    name,
    registry,
    env,
  }: {
    name: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<EmptyResData>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${encodeURIComponent(name)}/restore`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
      });
      if (res.status === 403) { await res.body?.cancel(); return { success: false, data: null, error: "forbidden" }; }
      if (res.status === 404) { await res.body?.cancel(); return { success: false, data: null, error: "domain_not_found" }; }
      const json = await safeParseEpp<EmptyResData>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (json.result.code === 2304) return { success: false, data: null, error: "operation_prohibited" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      return { success: true, data: json.resData ?? {} as EmptyResData, error: null };
    } catch (e) {
      console.error("RegistryBridge.restore error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async transferRequest({
    name,
    authInfo,
    registry,
    env,
  }: {
    name: string;
    authInfo: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainTransferResponse>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${encodeURIComponent(name)}/transfer/request`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ op: "request", authInfo }),
      });
      // Kitaqnic: authInfo不一致は HTTP 401
      if (res.status === 401) { await res.body?.cancel(); return { success: false, data: null, error: "authInfo_mismatch" }; }
      if (res.status === 404) { await res.body?.cancel(); return { success: false, data: null, error: "domain_not_found" }; }
      const json = await safeParseEpp<DomainTransferResponse>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      // Kitaqsign: authInfo不一致は result.code 2202
      if (json.result.code === 2202) return { success: false, data: null, error: "authInfo_mismatch" };
      // 成功: 1000（同期完了）または 1001（非同期受付）
      if (json.result.code !== 1000 && json.result.code !== 1001) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      if (!json.resData) {
        return { success: false, data: null, error: "invalid_registry_response" };
      }
      return { success: true, data: json.resData, error: null };
    } catch (e) {
      console.error("RegistryBridge.transferRequest error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  private static async transferAction({
    name,
    action,
    registry,
    env,
  }: {
    name: string;
    action: "approve" | "reject" | "cancel";
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainTransferResponse>> {
    try {
      const res = await fetch(
        `${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${encodeURIComponent(name)}/transfer/${action}`,
        {
          method: "POST",
          headers: RegistryBridge.authHeaders(registry, env),
        },
      );
      if (res.status === 403) { await res.body?.cancel(); return { success: false, data: null, error: "forbidden" }; }
      if (res.status === 409) { await res.body?.cancel(); return { success: false, data: null, error: "transfer_not_found" }; }
      const json = await safeParseEpp<DomainTransferResponse>(res);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "registry_error" };
      }
      // Swagger 上 DomainTransferResponse を返すが、レジストリ実装によっては空の可能性もある
      // resData が無くても操作自体は成功なので、空オブジェクトで代替
      return { success: true, data: json.resData ?? ({} as DomainTransferResponse), error: null };
    } catch (e) {
      console.error(`RegistryBridge.transfer${action} error:`, e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async transferApprove(params: { name: string; registry: Registry; env: CloudflareBindings }) {
    return RegistryBridge.transferAction({ ...params, action: "approve" });
  }

  static async transferReject(params: { name: string; registry: Registry; env: CloudflareBindings }) {
    return RegistryBridge.transferAction({ ...params, action: "reject" });
  }

  static async transferCancel(params: { name: string; registry: Registry; env: CloudflareBindings }) {
    return RegistryBridge.transferAction({ ...params, action: "cancel" });
  }

  // Poll のみ（ack は呼ばない）。DB 更新に成功してから ack することで、
  // DB 更新失敗時にレジストリ側メッセージが失われるのを防ぐ。
  static async poll({
    registry,
    env,
  }: {
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<PollMessage | null>> {
    try {
      const pollRes = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/messages/poll`, {
        method: "GET",
        headers: RegistryBridge.authHeaders(registry, env),
      });

      if (pollRes.status === 204) return { success: true, data: null, error: null };

      const json = await safeParseEpp<{ count: number; message?: PollMessage }>(pollRes);
      if (!json) return { success: false, data: null, error: "invalid_registry_response" };

      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message || "poll_failed" };
      }

      const message = json.resData?.message;
      if (!message || typeof message.id !== "number") {
        return { success: true, data: null, error: null };
      }

      return { success: true, data: message, error: null };
    } catch (e) {
      console.error("RegistryBridge.poll error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  // メッセージを ack（消し込み）
  static async ackMessage({
    messageId,
    registry,
    env,
  }: {
    messageId: number;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    try {
      const ackRes = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/messages/${messageId}/ack`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
      });
      if (!ackRes.ok) {
        return { success: false, data: null, error: "ack_failed" };
      }
      const ackJson = await safeParseEpp<EmptyResData>(ackRes);
      if (!ackJson || ackJson.result.code !== 1000) {
        return { success: false, data: null, error: "ack_failed" };
      }
      return { success: true, data: undefined, error: null };
    } catch (e) {
      console.error("RegistryBridge.ackMessage error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }
}
