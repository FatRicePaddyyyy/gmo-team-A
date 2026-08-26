import type { Result } from "../../types/result";
import { getClient, getKitaqnicClient } from "./client";
import type {
  DomainCheckResponse,
  DomainCreateResponse,
  DomainRenewResponse,
  DomainResponse,
  DomainTransferResponse,
  GreetingResponse,
  PollMessage,
  Registry,
} from "./types";

type EmptyResData = Record<string, never>;

// レジストリ側 EPP レスポンスの result コード判定と resData 取り出しの共通化。
// - HTTP 非 200 系は上流で早期リターンしているので、ここでは result.code のみ見る。
// - resData が undefined の場合は上位で個別に扱う（メソッドによって許容の可否が違うため）。
// - 失敗時は必ず内部エラーコード "registry_error" に normalize して返す。
//   result.message はレジストリ由来の生文字列 (英語 or 内部情報) なので、ユーザー応答に載せず
//   console.error でログに残すのみ (toUserMessage の map miss で情報がドロップされるのを避ける)。
function extractResData<T>(
  body: { result: { code: number; message: string }; resData?: T } | undefined,
  successCodes: readonly number[] = [1000],
): Result<T | undefined> {
  if (!body) {return { success: false, data: null, error: "invalid_registry_response" };}
  if (!successCodes.includes(body.result.code)) {
    console.error(
      `Registry returned non-success code=${body.result.code}, message="${body.result.message}"`,
    );
    return { success: false, data: null, error: "registry_error" };
  }
  return { success: true, data: body.resData, error: null };
}

export class RegistryBridge {
  // レジストリの疎通確認と対応TLD取得（認証不要のヘルスチェック）
  static async hello({
    registry,
    env,
  }: {
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<GreetingResponse>> {
    try {
      const { data, response } = await getClient(registry, env).GET("/api/v1/epp/sessions/hello");
      if (!response.ok || !data) {return { success: false, data: null, error: "invalid_registry_response" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      if (!extracted.data || !Array.isArray(extracted.data.tlds)) {
        return { success: false, data: null, error: "invalid_registry_response" };
      }
      return { success: true, data: extracted.data, error: null };
    } catch (e) {
      console.error("RegistryBridge.hello error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  // ドメイン名の TLD から対応レジストリを解決する。
  // 両レジストリの hello を並列で叩き、supportedTlds に含まれる方を返す。
  static async resolveRegistry({
    name,
    env,
  }: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<Registry>> {
    const lastDot = name.trim().toLowerCase().lastIndexOf(".");
    if (lastDot < 0 || lastDot === name.length - 1) {
      return { success: false, data: null, error: "invalid_domain_name" };
    }
    const tld = name.trim().toLowerCase().slice(lastDot + 1);

    const [ks, kn] = await Promise.all([
      RegistryBridge.hello({ registry: "kitaqsign", env }),
      RegistryBridge.hello({ registry: "kitaqnic", env }),
    ]);

    // レジストリの tlds は先頭ドット付き（".com"）かドットなし（"com"）か仕様上不明。両方に対応
    const normalize = (t: string) => t.toLowerCase().replace(/^\./, "");
    if (ks.success && ks.data.tlds.some(t => normalize(t) === tld)) {
      return { success: true, data: "kitaqsign", error: null };
    }
    if (kn.success && kn.data.tlds.some(t => normalize(t) === tld)) {
      return { success: true, data: "kitaqnic", error: null };
    }
    // 両方失敗した場合は疎通エラー、そうでなければ非対応TLD
    if (!ks.success && !kn.success) {
      return { success: false, data: null, error: "network_error" };
    }
    return { success: false, data: null, error: "unsupported_tld" };
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
      const { data, error, response } = await getClient(registry, env).POST("/api/v1/epp/domains/check", {
        body: { names: [name] },
      });
      if (response.status === 422) {return { success: false, data: null, error: "invalid_tld" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      if (!extracted.data) {return { success: false, data: null, error: "invalid_registry_response" };}
      return { success: true, data: extracted.data, error: null };
    } catch (e) {
      console.error("RegistryBridge.check error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  static async createContact({
    name,
    email,
    registry,
    env,
  }: {
    // レジストリの postalInfo.name / email に流し込む。
    // 呼び出し側で「許可された架空ダミー氏名 (例: Taro Test)」「@example.(com|net|org) メール」に
    // なっていることを担保しておくこと (レジストリが Swagger 制約で弾く)。
    name: string;
    email: string;
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
      const { data, error, response } = await getClient(registry, env).POST("/api/v1/epp/contacts", {
        body: {
          id: contactId,
          postalInfo: {
            name,
            addr: { street: "N/A", city: "N/A", cc: "JP" },
          },
          email,
          authInfo: crypto.randomUUID().slice(0, 16),
        },
      });
      // 409 = コンタクトID既存（UUID衝突。極めて稀）
      if (response.status === 409) {return { success: false, data: null, error: "contact_id_conflict" };}
      if (error) {return { success: false, data: null, error: "contact_create_failed" };}
      if (data.result.code !== 1000) {return { success: false, data: null, error: "contact_create_failed" };}
      const returnedId = data.resData?.id ?? contactId;
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
    contacts,
    authInfo,
    nameservers,
    registry,
    env,
  }: {
    domain: string;
    period: { unit: string; value: number };
    registrant: string;
    // ロール別コンタクト ID (admin/tech/billing)。Swagger 上 optional だが、
    // Kitaqsign/Kitaqnic の推奨手順では ADMIN/TECH を指定する。
    contacts?: Record<string, string>;
    authInfo: string;
    nameservers?: string[];
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainCreateResponse>> {
    try {
      const { data, error, response } = await getClient(registry, env).POST("/api/v1/epp/domains", {
        body: {
          domain,
          period,
          registrant,
          authInfo,
          ...(contacts ? { contacts } : {}),
          ...(nameservers ? { nameservers } : {}),
        },
      });
      if (response.status === 409) {return { success: false, data: null, error: "domain_exists" };}
      if (response.status === 422) {return { success: false, data: null, error: "invalid_tld" };}
      if (response.status === 404) {return { success: false, data: null, error: "contact_not_found" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      if (!extracted.data?.exDate) {return { success: false, data: null, error: "invalid_registry_response" };}
      return { success: true, data: extracted.data, error: null };
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
      const { data, error, response } = await getClient(registry, env).GET("/api/v1/epp/domains/{name}", {
        params: { path: { name } },
      });
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      if (!extracted.data?.exDate) {return { success: false, data: null, error: "invalid_registry_response" };}
      return { success: true, data: { ...extracted.data, exDate: extracted.data.exDate }, error: null };
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
      const { data, error, response } = await getClient(registry, env).POST("/api/v1/epp/domains/{name}/renew", {
        params: { path: { name } },
        body: { curExpDate, period },
      });
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (response.status === 400) {return { success: false, data: null, error: "invalid_period" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      if (!extracted.data?.exDate) {return { success: false, data: null, error: "invalid_registry_response" };}
      return { success: true, data: extracted.data, error: null };
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
  }): Promise<Result<DomainResponse>> {
    try {
      // 生成型の DomainChangeSet.statuses は @enum {array} 指定なのに単一 union として出力される
      // openapi-typescript のバグ相当のため、動的な string[] を通せるように body の型付けだけ緩める。
      // JSON 化する実行時挙動には影響しない。
      const body = {
        ...(add ? { add } : {}),
        ...(rem ? { rem } : {}),
        ...(chg ? { chg } : {}),
      };
      const { data, error, response } = await getClient(registry, env).PUT("/api/v1/epp/domains/{name}", {
        params: { path: { name } },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        body: body as never,
      });
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      if (!extracted.data?.exDate) {
        // レジストリが DomainResponse を返さなかった場合（一部レジストリで発生しうる）
        return { success: false, data: null, error: "invalid_registry_response" };
      }
      return { success: true, data: { ...extracted.data, exDate: extracted.data.exDate }, error: null };
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
      const { data, error, response } = await getClient(registry, env).DELETE("/api/v1/epp/domains/{name}", {
        params: { path: { name } },
      });
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      if (data.result.code === 2304) {return { success: false, data: null, error: "operation_prohibited" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      return { success: true, data: {}, error: null };
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
      const { data, error, response } = await getClient(registry, env).POST("/api/v1/epp/domains/{name}/restore", {
        params: { path: { name } },
      });
      if (response.status === 403) {return { success: false, data: null, error: "forbidden" };}
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}

      // pendingDelete でないドメインの復旧は 2304。
      // Swagger の Responses は 200/403/404 しか載っていないが、実機は **HTTP 409 + 2304** で返す
      // (実測: `Domain xxx is not pending delete`)。HTTP が非 2xx だと openapi-fetch は body を
      // error 側に入れるので、下の `if (error)` より前に拾わないと invalid_registry_response になり
      // ハンドラが 500 を返してしまう。仕様変更で 200 に戻っても拾えるよう、両方を見る。
      const conflictCode = (error as { result?: { code?: number } } | undefined)?.result?.code;
      if (response.status === 409 || conflictCode === 2304) {
        return { success: false, data: null, error: "operation_prohibited" };
      }

      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      if (data.result.code === 2304) {return { success: false, data: null, error: "operation_prohibited" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      return { success: true, data: {}, error: null };
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
  }): Promise<Result<DomainTransferResponse | undefined>> {
    try {
      const { data, error, response } = await getClient(registry, env).POST(
        "/api/v1/epp/domains/{name}/transfer/request",
        { params: { path: { name } }, body: { op: "request", authInfo } },
      );
      // Kitaqnic: authInfo不一致は HTTP 401
      if (response.status === 401) {return { success: false, data: null, error: "authInfo_mismatch" };}
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      // Kitaqsign: authInfo不一致は result.code 2202
      if (data.result.code === 2202) {return { success: false, data: null, error: "authInfo_mismatch" };}
      // 成功: 1000（同期完了）または 1001（非同期受付）
      // B5: Swagger 上 resData? は optional。空の resData でも result.code が成功値なら受付として扱う。
      const extracted = extractResData(data, [1000, 1001]);
      if (!extracted.success) {return extracted;}
      return { success: true, data: extracted.data, error: null };
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
  }): Promise<Result<DomainTransferResponse | undefined>> {
    try {
      const client = getClient(registry, env);
      // 3 種類のエンドポイントは path 以外シグネチャが同じ。openapi-fetch は path をリテラル型で管理するので分岐する。
      const { data, error, response } =
        action === "approve"
          ? await client.POST("/api/v1/epp/domains/{name}/transfer/approve", { params: { path: { name } } })
          : action === "reject"
          ? await client.POST("/api/v1/epp/domains/{name}/transfer/reject", { params: { path: { name } } })
          : await client.POST("/api/v1/epp/domains/{name}/transfer/cancel", { params: { path: { name } } });
      // R5: approve/reject/cancel は authInfo を送らないので、401 は authInfo 不一致ではなく
      // 「レジストリ認証失敗 = 権限不備」として forbidden にマップする。
      if (response.status === 401) {return { success: false, data: null, error: "forbidden" };}
      if (response.status === 403) {return { success: false, data: null, error: "forbidden" };}
      if (response.status === 404) {return { success: false, data: null, error: "transfer_not_found" };}
      if (response.status === 409) {return { success: false, data: null, error: "transfer_not_found" };}
      if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
      // B8: レジストリ実装によっては HTTP 200 でも result.code に失敗コード (例: 2303 "object does not exist")
      // を返すことがある。extractResData で 1000 のみを success とする既存契約を維持し、
      // 2303 のような "存在しない対象" は transfer_not_found にマッピングする。
      if (data.result.code === 2303) {return { success: false, data: null, error: "transfer_not_found" };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      // Swagger 上 DomainTransferResponse を返すが、レジストリ実装によっては空の可能性もある。
      // 呼び出し側は data を参照しないので、resData が無ければ undefined のまま返す。
      return { success: true, data: extracted.data, error: null };
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
  // Kitaqsign と Kitaqnic でエンドポイントが異なる（Kitaqsign: GET /messages/poll, Kitaqnic: GET /messages）。
  static async poll({
    registry,
    env,
  }: {
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<PollMessage | null>> {
    try {
      const { data, response } =
        registry === "kitaqsign"
          ? await getClient("kitaqsign", env).GET("/api/v1/epp/messages/poll")
          : await getKitaqnicClient(env).GET("/api/v1/epp/messages");

      if (response.status === 204 || !data) {return { success: true, data: null, error: null };}

      if (data.result.code !== 1000) {
        // S-6: レジストリ生 message はユーザー応答に載せず、normalized code に固定。
        // 詳細は console.error でログに残す。
        console.error(
          `RegistryBridge.poll: non-success code=${data.result.code}, message="${data.result.message}"`,
        );
        return { success: false, data: null, error: "poll_failed" };
      }

      const message = data.resData?.message;
      if (!message || typeof message.id !== "number") {
        return { success: true, data: null, error: null };
      }

      // B9: id は int64 だが JS number は 2^53-1 までしか安全に扱えない。
      // 精度が落ちた場合は ack が失敗する可能性があるので、明示的にエラーで返して監視できるようにする。
      if (!Number.isSafeInteger(message.id)) {
        console.error(`RegistryBridge.poll: message id=${message.id} is outside safe integer range`);
        return { success: false, data: null, error: "invalid_registry_response" };
      }

      return { success: true, data: message, error: null };
    } catch (e) {
      console.error("RegistryBridge.poll error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  // メッセージを ack（消し込み）
  // Kitaqsign: POST /messages/{id}/ack, Kitaqnic: DELETE /messages/{id}
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
      const { data, error, response } =
        registry === "kitaqsign"
          ? await getClient("kitaqsign", env).POST("/api/v1/epp/messages/{id}/ack", {
              params: { path: { id: messageId } },
            })
          : await getKitaqnicClient(env).DELETE("/api/v1/epp/messages/{id}", {
              params: { path: { id: messageId } },
            });
      if (!response.ok || error) {return { success: false, data: null, error: "ack_failed" };}
      if (data.result.code !== 1000) {return { success: false, data: null, error: "ack_failed" };}
      return { success: true, data: undefined, error: null };
    } catch (e) {
      console.error("RegistryBridge.ackMessage error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }
}
