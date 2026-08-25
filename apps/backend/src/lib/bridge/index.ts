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
      const json = await res.json() as EppEnvelope<DomainCheckResponse>;
      if (!res.ok || json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
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
      // 成功は HTTP 201（Kitaqsign / Kitaqnic 共通）
      if (res.status !== 200 && res.status !== 201) {
        return { success: false, data: null, error: "contact_create_failed" };
      }
      // レスポンスは EppResponseContactResponse: resData.id にコンタクトIDが入る
      const json = await res.json() as { result?: { code: number }; resData?: { id?: string } };
      if (json.result && json.result.code !== 1000) {
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
      if (res.status === 409) return { success: false, data: null, error: "domain_exists" };
      if (res.status === 422) return { success: false, data: null, error: "invalid_tld" };
      if (res.status === 404) return { success: false, data: null, error: "contact_not_found" };
      const json = await res.json() as EppEnvelope<DomainCreateResponse>;
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
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
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${name}`, {
        method: "GET",
        headers: RegistryBridge.authHeaders(registry, env),
      });
      if (res.status === 404) return { success: false, data: null, error: "domain_not_found" };
      const json = await res.json() as EppEnvelope<DomainResponse>;
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
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
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${name}/renew`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ curExpDate, period }),
      });
      if (res.status === 404) return { success: false, data: null, error: "domain_not_found" };
      if (res.status === 400) return { success: false, data: null, error: "invalid_period" };
      const json = await res.json() as EppEnvelope<DomainRenewResponse>;
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
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
  }): Promise<Result<EmptyResData>> {
    try {
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${name}`, {
        method: "PUT",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ ...(add ? { add } : {}), ...(rem ? { rem } : {}), ...(chg ? { chg } : {}) }),
      });
      if (res.status === 404) return { success: false, data: null, error: "domain_not_found" };
      const json = await res.json() as EppEnvelope<EmptyResData>;
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
      }
      return { success: true, data: json.resData, error: null };
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
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${name}`, {
        method: "DELETE",
        headers: RegistryBridge.authHeaders(registry, env),
      });
      if (res.status === 404) return { success: false, data: null, error: "domain_not_found" };
      const json = await res.json() as EppEnvelope<EmptyResData>;
      if (json.result.code === 2304) return { success: false, data: null, error: "operation_prohibited" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
      }
      return { success: true, data: json.resData, error: null };
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
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${name}/restore`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
      });
      if (res.status === 403) return { success: false, data: null, error: "forbidden" };
      if (res.status === 404) return { success: false, data: null, error: "domain_not_found" };
      const json = await res.json() as EppEnvelope<EmptyResData>;
      if (json.result.code === 2304) return { success: false, data: null, error: "operation_prohibited" };
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
      }
      return { success: true, data: json.resData, error: null };
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
      const res = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${name}/transfer/request`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
        body: JSON.stringify({ op: "request", authInfo }),
      });
      // Kitaqnic: authInfo不一致は HTTP 401
      if (res.status === 401) return { success: false, data: null, error: "authInfo_mismatch" };
      if (res.status === 404) return { success: false, data: null, error: "domain_not_found" };
      const json = await res.json() as EppEnvelope<DomainTransferResponse>;
      // Kitaqsign: authInfo不一致は result.code 2202
      if (json.result.code === 2202) return { success: false, data: null, error: "authInfo_mismatch" };
      // 成功: 1000（同期完了）または 1001（非同期受付）
      if (json.result.code !== 1000 && json.result.code !== 1001) {
        return { success: false, data: null, error: json.result.message };
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
  }): Promise<Result<EmptyResData>> {
    try {
      const res = await fetch(
        `${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/domains/${name}/transfer/${action}`,
        {
          method: "POST",
          headers: RegistryBridge.authHeaders(registry, env),
        },
      );
      if (res.status === 403) return { success: false, data: null, error: "forbidden" };
      if (res.status === 409) return { success: false, data: null, error: "transfer_not_found" };
      const json = await res.json() as EppEnvelope<EmptyResData>;
      if (json.result.code !== 1000) {
        return { success: false, data: null, error: json.result.message };
      }
      return { success: true, data: json.resData, error: null };
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

  static async pollAndAck({
    registry,
    env,
  }: {
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<PollMessage | null>> {
    try {
      // Swagger 実物では Kitaqsign / Kitaqnic 両方とも同じパス
      const pollRes = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/messages/poll`, {
        method: "GET",
        headers: RegistryBridge.authHeaders(registry, env),
      });

      // メッセージなし（204）
      if (pollRes.status === 204) return { success: true, data: null, error: null };

      // レスポンスは EppEnvelope<PollResponse> でラップされている
      const json = await pollRes.json() as EppEnvelope<{ count: number; message?: PollMessage }>;
      const message = json.resData?.message;
      if (!message || typeof message.id !== "number") {
        // count:0 または message フィールドがない → メッセージなし
        return { success: true, data: null, error: null };
      }

      // Ack（消し込み）— Kitaqsign / Kitaqnic 両方とも POST /messages/{id}/ack
      const ackRes = await fetch(`${RegistryBridge.baseUrl(registry, env)}/api/v1/epp/messages/${message.id}/ack`, {
        method: "POST",
        headers: RegistryBridge.authHeaders(registry, env),
      });

      if (!ackRes.ok) {
        return { success: false, data: null, error: "ack_failed" };
      }

      return { success: true, data: message, error: null };
    } catch (e) {
      console.error("RegistryBridge.pollAndAck error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }
}
