import type { Result, SimpleResult } from "../../types/result";
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
    // レジストリの result.message をユーザー応答まで届ける (メンテ中や制約違反の理由を判別可能にする)。
    // 形式は "registry_error: <生メッセージ>"。toUserMessage で ':' 前のコードを見て
    // 定型文言 + ':' 後を「(理由: ...)」で末尾付加する。
    if (body.result.code === EPP_MAINTENANCE_CODE) {
      return { success: false, data: null, error: "registry_maintenance" };
    }
    const detail = attachDetail("registry_error", body.result.message);
    return { success: false, data: null, error: detail };
  }
  return { success: true, data: body.resData, error: null };
}

// エラーコードにレジストリ由来の詳細メッセージを付加する。空文字や undefined は無視。
// 内部にコロンやコードが再度含まれる場合の混乱を避けるため、既に detail 付きなら上書きしない。
export function attachDetail(code: string, detail: string | undefined | null): string {
  const trimmed = (detail ?? "").trim();
  if (!trimmed) {return code;}
  if (code.includes(":")) {return code;}
  return `${code}: ${trimmed}`;
}

// レジストリから返ってきた JSON レスポンスから result.message を安全に取り出す。
// openapi-fetch の error / data いずれにも result フィールドが乗る可能性があるので unknown で受ける。
export function extractResultMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("result" in body)) {return undefined;}
  const result = body.result;
  if (typeof result !== "object" || result === null) {return undefined;}
  // 実機は "message" と "msg" が混在する (メンテ中は msg で返ってくる、実測)
  if ("message" in result) {
    const v = result.message;
    if (typeof v === "string" && v.trim() !== "") {return v;}
  }
  if ("msg" in result) {
    const v = result.msg;
    if (typeof v === "string" && v.trim() !== "") {return v;}
  }
  return undefined;
}

// 「その状態ではその操作はできない」(EPP result.code 2304) を判定する。
//
// 実機は **HTTP 409 + result.code 2304** で返す（実測）。
//   restore … `Domain xxx is not pending delete`
//   delete  … `Domain xxx is pending delete`
// ところが仕様書(issue #7)も Swagger も「HTTP 200 で 2304」と書いており、資料が実機と食い違う。
//
// openapi-fetch は HTTP が非 2xx だと body を error 側に入れるため、
// `if (error)` で打ち切る前にここで拾わないと invalid_registry_response になり、
// ハンドラが 500 を返してしまう（実際 restore と delete がそうなっていた）。
// 資料どおり 200 + 2304 に戻っても拾えるよう、HTTP と result.code の両方を見る。
// body には成功時の data と失敗時の error のどちらが来てもよい（HTTP により入る側が変わるため）。
function isOperationProhibited(response: Response, body: unknown): boolean {
  if (response.status === 409) {return true;}
  if (typeof body !== "object" || body === null || !("result" in body)) {return false;}
  const result = body.result;
  if (typeof result !== "object" || result === null || !("code" in result)) {return false;}
  return result.code === 2304;
}

// hello の resData shape 差を吸収して共通形 GreetingResponse に normalize する。
// resData はレジストリごとに shape が違ううえ、Kitaqnic の Swagger は中身を定義していない
// ので、`unknown` として受け、実データを見てフィールドを取り出す。
// どちらのフィールドも欠落したら null を返し、呼び出し側で invalid_registry_response とする。
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// result.reason（EPP result.code 2303 "Object does not exist" のとき、何が存在しないかを
// 自由文字列で載せてくる未ドキュメント化フィールド）を安全に取り出す。
// Swagger の Result スキーマには reason が定義されていないため、生成型に無いフィールドを
// 盲目にキャストせず、`in` で存在を確かめながら読む。
// update で「不在なのはドメイン本体か、指定した NS/コンタクトか」を区別するために使う。
function readResultReason(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("reason" in result)) {return undefined;}
  const reason = result.reason;
  return typeof reason === "string" ? reason : undefined;
}

// レジストリの EPP result.code を安全に取り出す。
function readResultCode(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null || !("result" in body)) {return undefined;}
  const result = body.result;
  if (typeof result !== "object" || result === null || !("code" in result)) {return undefined;}
  const code = result.code;
  return typeof code === "number" ? code : undefined;
}

// EPP 2500 = Command failed; server closing connection。
// この擬似レジストリはメンテナンス中にこのコードと HTTP 503 を返す。
const EPP_MAINTENANCE_CODE = 2500;

/**
 * レジストリのエラー応答を内部エラーコードに落とす。
 *
 * メンテナンスは「予期しない応答」ではなく予期できる状態で、利用者が取れる行動
 * （時間をおく）も違う。汎用エラーに丸めると原因が伝わらないので分けて扱う。
 */
export function mapRegistryError(errorBody: unknown, status?: number): string {
  const isMaintenance =
    readResultCode(errorBody) === EPP_MAINTENANCE_CODE || status === 503;
  // メンテナンスはレジストリ側の文言も「メンテナンス中です。」なので、
  // 理由として付け足すと同じことを二度言うことになる。コードだけ返す。
  if (isMaintenance) {return "registry_maintenance";}
  return attachDetail("invalid_registry_response", extractResultMessage(errorBody));
}

function normalizeGreeting(
  registry: Registry,
  resData: unknown,
): GreetingResponse | null {
  if (!isObject(resData)) {return null;}

  if (registry === "kitaqsign") {
    // Kitaqsign shape: { registryCode, tlds, message }
    const registryCode = resData.registryCode;
    const tlds = resData.tlds;
    if (
      typeof registryCode !== "string" ||
      !Array.isArray(tlds) ||
      !tlds.every((t): t is string => typeof t === "string")
    ) {
      return null;
    }
    return { registryCode, tlds };
  }

  // Kitaqnic shape: resData.info.{registryCode, supportedTlds}
  // registryCode が info に無ければ svID (トップレベル) にフォールバックする。
  const info = isObject(resData.info) ? resData.info : undefined;
  const tlds = info?.supportedTlds;
  const rawCode = info?.registryCode ?? resData.svID;
  if (
    typeof rawCode !== "string" ||
    !Array.isArray(tlds) ||
    !tlds.every((t): t is string => typeof t === "string")
  ) {
    return null;
  }
  return { registryCode: rawCode, tlds };
}

// resolveRegistry の最後のフォールバック用。
// レジストリのメンテナンス等で hello が長時間落ちたときだけ使う静的テーブル。
// 値は wrangler.jsonc の vars.KITAQSIGN_FALLBACK_TLDS / KITAQNIC_FALLBACK_TLDS に定義する。
// カンマ区切りの単純な文字列。ここで前後空白と先頭ドットだけ剥がして Set 化する。
function parseFallbackTlds(raw: string | undefined): Set<string> {
  if (!raw) {return new Set();}
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/^\./, ""))
      .filter((s) => s.length > 0),
  );
}
function fallbackRegistryByTld(tld: string, env: CloudflareBindings): Registry | null {
  if (parseFallbackTlds(env.KITAQSIGN_FALLBACK_TLDS).has(tld)) {return "kitaqsign";}
  if (parseFallbackTlds(env.KITAQNIC_FALLBACK_TLDS).has(tld)) {return "kitaqnic";}
  return null;
}

// hello 応答を KV にキャッシュする TTL (秒)。
// レジストリ側で TLD が追加/削除されても最大 10 分で反映される。
const HELLO_CACHE_TTL_SECONDS = 600;

// レジストリへの HTTP 呼び出しをリトライする最大試行回数 (初回含む)。
// 5xx / ネットワークエラーはレジストリ側の一時障害の可能性が高いので即座に再試行する。
// 4xx / EPP result.code エラーは再試行しても直らないので retry しない。
const HTTP_MAX_ATTEMPTS = 3;

// レジストリへの HTTP 呼び出しを 5xx / throw に対して最大 HTTP_MAX_ATTEMPTS 回まで再試行する。
// - リトライ間の間隔は開けない (レジストリ側は即座に復旧している可能性が高い前提)。
// - 4xx / 2xx はそのまま返す (EPP result.code の失敗は呼び出し側で判定するため、ここでは HTTP 層のみ見る)。
// - 全 attempt が throw で終わった場合はその例外を最後に投げ直し、呼び出し側の catch で拾わせる。
//
// 呼び出し側 (openapi-fetch の GET/POST/...) は `{ data; error?: never } | { data?: never; error }` の
// 判別可能 union を返す。ジェネリック R でそのまま透過することで、既存の
// `if (error) return ...` → 後段は data 前提の narrow を型ごと維持する。
async function withRetry<R extends { response: Response }>(
  label: string,
  fn: () => Promise<R>,
): Promise<R> {
  let lastThrown: unknown = null;
  for (let attempt = 1; attempt <= HTTP_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      if (result.response.status >= 500 && attempt < HTTP_MAX_ATTEMPTS) {
        console.warn(
          `${label} ${result.response.status}, retry ${attempt}/${HTTP_MAX_ATTEMPTS - 1}`,
        );
        continue;
      }
      return result;
    } catch (e) {
      lastThrown = e;
      console.error(`${label} network error attempt=${attempt}:`, e);
      if (attempt < HTTP_MAX_ATTEMPTS) {continue;}
    }
  }
  // ここに来るのは全 attempt が throw で終わったパターンだけ (5xx 到達時は最終 attempt の result を返している)。
  throw lastThrown;
}

function helloCacheKey(registry: Registry): string {
  return `hello:${registry}`;
}

async function readHelloFromCache(
  registry: Registry,
  env: CloudflareBindings,
): Promise<GreetingResponse | null> {
  try {
    const raw = await env.REGISTRY_HELLO_CACHE.get(helloCacheKey(registry), "json");
    if (!raw) {return null;}
    // KV の値は自分で書いた JSON なので shape は信頼してよいが、念のため normalize と同じ検証を通す。
    if (!isObject(raw)) {return null;}
    const registryCode = raw.registryCode;
    const tlds = raw.tlds;
    if (
      typeof registryCode !== "string" ||
      !Array.isArray(tlds) ||
      !tlds.every((t): t is string => typeof t === "string")
    ) {
      return null;
    }
    return { registryCode, tlds };
  } catch (e) {
    console.warn(`hello cache read failed for registry=${registry}:`, e);
    return null;
  }
}

async function writeHelloToCache(
  registry: Registry,
  env: CloudflareBindings,
  greeting: GreetingResponse,
): Promise<void> {
  try {
    await env.REGISTRY_HELLO_CACHE.put(
      helloCacheKey(registry),
      JSON.stringify(greeting),
      { expirationTtl: HELLO_CACHE_TTL_SECONDS },
    );
  } catch (e) {
    console.warn(`hello cache write failed for registry=${registry}:`, e);
  }
}

export class RegistryBridge {
  // レジストリの疎通確認と対応TLD取得（認証不要のヘルスチェック）
  //
  // Kitaqsign と Kitaqnic で hello の resData shape が違うため、registry ごとに
  // 内部の narrow 型を切り替えたうえで、外向きは共通形 GreetingResponse に normalize する。
  //   - Kitaqsign: resData.tlds: string[]
  //   - Kitaqnic : resData.info.supportedTlds: string[]
  // どちらも取れなければ invalid_registry_response とする (shape 不一致 = レジストリ側の
  // 契約破棄なので、呼び出し側にプロトコル差分を漏らさず一律の内部コードに落とす)。
  static async hello({
    registry,
    env,
  }: {
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<GreetingResponse>> {
    // 1) KV キャッシュを先に見る。ホットパス (registerDomain / requestTransfer / check)
    //    で hello を毎回叩くとレイテンシとエラー面が増えるので、TTL 10 分でキャッシュする。
    const cached = await readHelloFromCache(registry, env);
    if (cached) {return { success: true, data: cached, error: null };}

    try {
      const { data, error, response } = await withRetry(
        `hello ${registry}`,
        () => getClient(registry, env).GET("/api/v1/epp/sessions/hello"),
      );
      if (!response.ok || !data) {
        return { success: false, data: null, error: mapRegistryError(error, response.status) };
      }
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      const resData = extracted.data;
      if (!resData) {return { success: false, data: null, error: "invalid_registry_response" };}

      const normalized = normalizeGreeting(registry, resData);
      if (!normalized) {return { success: false, data: null, error: "invalid_registry_response" };}

      // 成功したら KV に書き戻す。write 失敗はキャッシュしないだけで結果は返す。
      await writeHelloToCache(registry, env, normalized);
      return { success: true, data: normalized, error: null };
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
    // trim + lowercase 後の同じ文字列に対して index/length を取る。
    // 前は元の `name.length` と trim 後の lastIndexOf を混ぜていて、
    // 末尾スペースなどのケースで判定が微妙にズレていた。
    const normalizedName = name.trim().toLowerCase();
    const lastDot = normalizedName.lastIndexOf(".");
    if (lastDot < 0 || lastDot === normalizedName.length - 1) {
      return { success: false, data: null, error: "invalid_domain_name" };
    }
    const tld = normalizedName.slice(lastDot + 1);

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

    // どちらかの hello が失敗している場合のフォールバック:
    //   withRetry で 5xx リトライしても復旧しない = レジストリ側メンテなどで長時間落ちている状況。
    //   このとき成功した hello だけを見て「該当なし」と断定すると本来対応している TLD を
    //   unsupported_tld に誤判定してしまうので、ハードコードした FALLBACK_TLDS を最後の判定源とする。
    //   （メンテ中でも「.com は kitaqsign」といった業務仕様は変わらないため）
    if (!ks.success || !kn.success) {
      const fallback = fallbackRegistryByTld(tld, env);
      if (fallback) {
        console.warn(
          `resolveRegistry: hello failure (kitaqsign=${ks.success ? "ok" : ks.error}, kitaqnic=${kn.success ? "ok" : kn.error}) — falling back to static table for tld=${tld} → ${fallback}`,
        );
        return { success: true, data: fallback, error: null };
      }
      // ここに来た = 生きている hello の supportedTlds に無く、かつ静的テーブルにも無い TLD。
      // 生存側 hello + 静的テーブルの両方に無いなら、落ちている側にだけ存在する可能性より
      // 「そもそも登録できない TLD」の可能性がはるかに高い (静的テーブルは全 gTLD をカバーする前提)。
      // network_error で 500 に落とすとユーザーに「サーバ側の一時障害だから再試行して」と誤誘導するので、
      // unsupported_tld を返して 4xx で「その TLD は扱えません」と伝える。
      console.warn(
        `resolveRegistry: hello failure (kitaqsign=${ks.success ? "ok" : ks.error}, kitaqnic=${kn.success ? "ok" : kn.error}) — tld=${tld} not in surviving supportedTlds and not in static fallback either; treating as unsupported_tld`,
      );
      return { success: false, data: null, error: "unsupported_tld" };
    }
    return { success: false, data: null, error: "unsupported_tld" };
  }

  // names は複数まとめて渡せる（レジストリの Swagger 上 body.names は配列）。
  // 同じ registry 宛のチェックをまとめて1リクエストにするために使う（Issue #45 B-3）。
  static async check({
    names,
    registry,
    env,
  }: {
    names: string[];
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<DomainCheckResponse>> {
    try {
      const { data, error, response } = await withRetry(
        `check ${registry}`,
        () => getClient(registry, env).POST("/api/v1/epp/domains/check", {
          body: { names },
        }),
      );
      if (response.status === 422) {return { success: false, data: null, error: "invalid_tld" };}
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
      // ID はドメインごとにユニークにする必要があるため crypto.randomUUID を短縮して使う。
      // 短縮 (先頭 8 文字 = 32bit 相当) で衝突する可能性があるため、409 (contact_id_conflict) を
      // 検出したら別 ID を作り直して最大 CONTACT_ID_MAX_ATTEMPTS 回まで retry する。
      // ユーザーには成功/失敗の 2 値だけ見せて、内部の衝突は透過的に吸収する。
      const CONTACT_ID_MAX_ATTEMPTS = 3;
      let lastResponse: Response | undefined;
      let lastError: unknown;
      let lastData: unknown;
      for (let attempt = 1; attempt <= CONTACT_ID_MAX_ATTEMPTS; attempt++) {
        const contactId = `C-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const { data, error, response } = await withRetry(
          `createContact ${registry}`,
          () => getClient(registry, env).POST("/api/v1/epp/contacts", {
            body: {
              id: contactId,
              postalInfo: {
                name,
                addr: { street: "N/A", city: "N/A", cc: "JP" },
              },
              email,
              authInfo: crypto.randomUUID().slice(0, 16),
            },
          }),
        );
        lastResponse = response;
        lastError = error;
        lastData = data;
        // 409 = コンタクト ID 既存 (UUID 先頭 8 文字の衝突)。別 ID で retry。
        if (response.status === 409 && attempt < CONTACT_ID_MAX_ATTEMPTS) {
          console.warn(`createContact ${registry}: contact_id_conflict on ${contactId}, retry ${attempt}/${CONTACT_ID_MAX_ATTEMPTS - 1} with new id`);
          continue;
        }
        // 400 = postalInfo バリデーション違反 (実測: name/email/addr の許可値外)。
        // レジストリは HTTP 400 + result.code 2003 "Required parameter missing" を返す。
        // Swagger 定義には無いが、backend の user 情報が制約に合っていないケース (許可名以外の氏名や
        // @example 以外のメール等) はここに落ちる。routes 側で 400 に落として原因を伝えられるようにする。
        if (response.status === 400) {return { success: false, data: null, error: "invalid_contact_payload" };}
        // 全 retry を使い切って 409 のままのケース。極めて稀。
        if (response.status === 409) {return { success: false, data: null, error: "contact_id_conflict" };}
        // メンテナンス中はここで落ちる（ドメイン作成はコンタクト作成から始まるため）。
        // contact_create_failed に丸めると「接続中に問題が発生しました」としか出せず、
        // 待てば直るのか設定が悪いのか伝わらない。
        if (error) {
          const mapped = mapRegistryError(error, response.status);
          return {
            success: false,
            data: null,
            error: mapped.startsWith("registry_maintenance") ? mapped : "contact_create_failed",
          };
        }
        if (data.result.code === EPP_MAINTENANCE_CODE) {
          return { success: false, data: null, error: "registry_maintenance" };
        }
        if (data.result.code !== 1000) {return { success: false, data: null, error: "contact_create_failed" };}
        const returnedId = data.resData?.id ?? contactId;
        return { success: true, data: { contactId: returnedId }, error: null };
      }
      // 型上の unreachable ガード (ループを break せず抜けたら 409 で埋め尽くしたパターン)。
      void lastResponse; void lastError; void lastData;
      return { success: false, data: null, error: "contact_id_conflict" };
    } catch (e) {
      console.error("RegistryBridge.createContact error:", e);
      return { success: false, data: null, error: "network_error" };
    }
  }

  // host:create — ドメインの nameservers に紐付ける前にホストを登録する。
  // domain:update で add.nameservers に指定するホストは事前にレジストリに存在している必要があり、
  // 未登録だと 404 + result.code 2303 で弾かれる。
  // 既に存在 (409) は成功として扱う (idempotent 化)。
  static async createHost({
    name,
    registry,
    env,
  }: {
    name: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<SimpleResult> {
    try {
      const { response } = await withRetry(
        `createHost ${registry}`,
        () => getClient(registry, env).POST("/api/v1/epp/hosts", {
          body: { name },
        }),
      );
      // 201 = 新規作成成功、409 = 既存 (idempotent 化のため成功扱い)
      if (response.status === 201 || response.status === 409) {
        return { success: true, error: null };
      }
      // 400 は addrs 等の payload エラー。glue record 不要のこの呼び出しでは通常起きない。
      return { success: false, error: "host_create_failed" };
    } catch (e) {
      console.error("RegistryBridge.createHost error:", e);
      return { success: false, error: "network_error" };
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
      const { data, error, response } = await withRetry(
        `create ${registry}`,
        () => getClient(registry, env).POST("/api/v1/epp/domains", {
          body: {
            domain,
            period,
            registrant,
            authInfo,
            ...(contacts ? { contacts } : {}),
            ...(nameservers ? { nameservers } : {}),
          },
        }),
      );
      if (response.status === 409) {return { success: false, data: null, error: "domain_exists" };}
      if (response.status === 422) {return { success: false, data: null, error: "invalid_tld" };}
      // 404 は Swagger 定義には含まれないが、実測ではリクエストで指定した registrant / contacts の
      // contactId がレジストリに存在しないと 404 を返す実装がある。ユーザー起因の不整合を
      // "レジストリ疎通異常" に丸めず、contact_not_found として routes 側で意味付けできるようにする。
      if (response.status === 404) {return { success: false, data: null, error: "contact_not_found" };}
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
      const { data, error, response } = await withRetry(
        `info ${registry}`,
        () => getClient(registry, env).GET("/api/v1/epp/domains/{name}", {
          params: { path: { name } },
        }),
      );
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
      const { data, error, response } = await withRetry(
        `renew ${registry}`,
        () => getClient(registry, env).POST("/api/v1/epp/domains/{name}/renew", {
          params: { path: { name } },
          body: { curExpDate, period },
        }),
      );
      // 実測 (kitaqnic 2026-08-27): clientRenewProhibited のドメインを renew すると
      // HTTP 500 + result.code 2304 "Object status prohibits operation" が返る (Swagger 上は 200 想定)。
      // 5xx でも body に 2304 が入っていれば operation_prohibited と扱う。
      if (isOperationProhibited(response, error ?? data)) {
        return { success: false, data: null, error: "operation_prohibited" };
      }
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (response.status === 400) {return { success: false, data: null, error: "invalid_period" };}
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
  }): Promise<Result<Partial<DomainResponse>>> {
    try {
      // レジストリ実装は Swagger 上 registrant/authInfo とも任意にもかかわらず、
      // chg を送る際は registrant を必須で要求してくる（authInfo だけの変更が 2003 で拒否される）。
      // authInfo だけの変更を通すため、指定が無ければ現在の registrant を info で補って送る。
      let effectiveChg = chg;
      if (chg?.authInfo && !chg.registrant) {
        const infoResult = await RegistryBridge.info({ name, registry, env });
        if (!infoResult.success) {return infoResult;}
        if (!infoResult.data.registrant) {
          return { success: false, data: null, error: "invalid_registry_response" };
        }
        effectiveChg = { ...chg, registrant: infoResult.data.registrant };
      }

      // 生成型の DomainChangeSet.statuses は @enum {array} 指定なのに単一 union として出力される
      // openapi-typescript のバグ相当のため、動的な string[] を通せるように body の型付けだけ緩める。
      // JSON 化する実行時挙動には影響しない。
      const body = {
        ...(add ? { add } : {}),
        ...(rem ? { rem } : {}),
        ...(effectiveChg ? { chg: effectiveChg } : {}),
      };
      const { data, error, response } = await withRetry(
        `update ${registry}`,
        () => getClient(registry, env).PUT("/api/v1/epp/domains/{name}", {
          params: { path: { name } },
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          body: body as never,
        }),
      );
      // Swagger 上 update は 200/404 のみだが、実運用では sponsoring registrar 以外の呼び出しで
      // 403 が返り得る (restore / delete と同じ扱い)。routes 側で 403 に落とせるように forbidden にマップ。
      if (response.status === 403) {return { success: false, data: null, error: "forbidden" };}

      // 実測 (kitaqnic 2026-08-27): client*Prohibited のドメインを update すると
      // HTTP 500 + result.code 2304 "Object status prohibits operation" が返る (Swagger 上は 200 想定)。
      // 5xx でも body に 2304 が入っていれば operation_prohibited と扱う。
      if (isOperationProhibited(response, error ?? data)) {
        return { success: false, data: null, error: "operation_prohibited" };
      }

      // 404 と 200 のどちらでも result.code=2303 "Object does not exist" が返り得る。
      // 実測 (kitaqsign 2026-08-27): add/rem で指定した host が未登録のときに
      // HTTP 404 + result={"code":2303,"reason":"ns3.example.com not found"} で返る。
      // 「HTTP 404 なら常にドメイン不在」と決めつけると host 不在を domain_not_found に誤写像するので、
      // まず error/data の result.reason を読み、ドメイン名を含まないなら参照先オブジェクトの不在に倒す。
      const errorReason = readResultReason((error as { result?: unknown } | undefined)?.result);
      const dataReason = data ? readResultReason(data.result) : undefined;
      const reason2303 = errorReason ?? dataReason;
      const errorCode = (error as { result?: { code?: unknown } } | undefined)?.result?.code;
      const dataCode = data?.result.code;
      const is2303 = errorCode === 2303 || dataCode === 2303;
      if (is2303) {
        // reason が空 or ドメイン以外を指すなら参照先 (host/contact) 不在。
        // reason にドメイン名を「独立したトークンとして」含むときだけ domain_not_found に倒す。
        // 単純な substring 一致だと、例えば name="example.com" reason="ns3.example.com not found"
        // (host が example.com のサブドメイン) を domain_not_found と誤判定してしまう。
        // 前後が英数字・ハイフン・ドットでない場所で境界を取る (\W ではドット / ハイフンが境界扱いになるため自前判定)。
        const isDomainToken = (r: string, n: string): boolean => {
          const idx = r.indexOf(n);
          if (idx < 0) {return false;}
          const before = idx === 0 ? "" : r[idx - 1] ?? "";
          const after = r[idx + n.length] ?? "";
          const isBoundary = (c: string) => c === "" || /[^a-zA-Z0-9.\-]/.test(c);
          return isBoundary(before) && isBoundary(after);
        };
        const isDomainItself = reason2303 ? isDomainToken(reason2303, name) : false;
        return {
          success: false,
          data: null,
          error: isDomainItself ? "domain_not_found" : "referenced_object_not_found",
        };
      }

      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
      const extracted = extractResData(data);
      if (!extracted.success) {return extracted;}
      // Kitaqnic は update 成功時に resData を返さない（Unit）。呼び出し側は info で最新状態を取り直すこと。
      return { success: true, data: extracted.data ?? {}, error: null };
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
      const { data, error, response } = await withRetry(
        `delete ${registry}`,
        () => getClient(registry, env).DELETE("/api/v1/epp/domains/{name}", {
          params: { path: { name } },
        }),
      );
      // sponsoring registrar 以外の呼び出し等 (restore と同じ扱い)
      if (response.status === 403) {return { success: false, data: null, error: "forbidden" };}
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      // すでに pendingDelete のドメインを再度廃止しようとした場合など
      if (isOperationProhibited(response, error ?? data)) {
        return { success: false, data: null, error: "operation_prohibited" };
      }
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
      const { data, error, response } = await withRetry(
        `restore ${registry}`,
        () => getClient(registry, env).POST("/api/v1/epp/domains/{name}/restore", {
          params: { path: { name } },
        }),
      );
      if (response.status === 403) {return { success: false, data: null, error: "forbidden" };}
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      // pendingDelete でないドメインを復旧しようとした場合など
      if (isOperationProhibited(response, error ?? data)) {
        return { success: false, data: null, error: "operation_prohibited" };
      }
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
      const { data, error, response } = await withRetry(
        `transferRequest ${registry}`,
        () => getClient(registry, env).POST(
          "/api/v1/epp/domains/{name}/transfer/request",
          { params: { path: { name } }, body: { op: "request", authInfo } },
        ),
      );
      // Issue #107: clientTransferProhibited などのロック中は operation_prohibited に写像する。
      // 実測 (kitaqnic 2026-08-27): ロック付きドメインへの transferRequest は HTTP 500 + result.code 2304
      // "Object status prohibits operation" で返る (Swagger 上は 200/404 想定)。
      // renew / update / delete / restore と同じく、5xx でも body に 2304 が入っていれば
      // 「一時障害」ではなく「フラグが立っているので永久に受理されない」と伝える。
      if (isOperationProhibited(response, error ?? data)) {
        return { success: false, data: null, error: "operation_prohibited" };
      }
      // authInfo 不一致の伝え方がレジストリで違う (bridge で共通コードに集約する):
      //   Kitaqnic  … Swagger 定義通り HTTP 401
      //   Kitaqsign … 実測は HTTP 403 + result.code 2202 (Swagger は 202/404 のみ定義)、
      //               または HTTP 202/200 + result.code 2202 (下の分岐で処理)
      if (response.status === 401) {return { success: false, data: null, error: "authInfo_mismatch" };}
      if (response.status === 403) {return { success: false, data: null, error: "authInfo_mismatch" };}
      // ドメイン不在 (両レジストリ Swagger 定義)
      if (response.status === 404) {return { success: false, data: null, error: "domain_not_found" };}
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
      const { data, error, response } = await withRetry(
        `transfer${action} ${registry}`,
        () =>
          action === "approve"
            ? client.POST("/api/v1/epp/domains/{name}/transfer/approve", { params: { path: { name } } })
            : action === "reject"
            ? client.POST("/api/v1/epp/domains/{name}/transfer/reject", { params: { path: { name } } })
            : client.POST("/api/v1/epp/domains/{name}/transfer/cancel", { params: { path: { name } } }),
      );
      // approve/reject/cancel は authInfo を送らないので、実測でも 401 は
      // 「API キー / レジストラ ID が無効」= backend 設定不備 = 運用エラー。
      // ユーザーに "権限がない" と誤って伝えず、invalid_registry_response で 500 化して
      // 運用チームがログで気付けるようにする (実測 401 の body: result.code 2200 "Authentication error")。
      if (response.status === 401) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
      // 403 は sponsoring registrar 以外の呼び出し (Kitaqsign Swagger 定義)。
      if (response.status === 403) {return { success: false, data: null, error: "forbidden" };}
      // 404 は "対象ドメイン不在" (実測: result.code 2303 "Object does not exist")。
      // 409 は "ドメインは存在するが pendingTransfer でない" (実測: result.code 2301 "Object not pending transfer")。
      // どちらもユーザー視点では「その移管申請は無い」ので transfer_not_found に集約する。
      if (response.status === 404) {return { success: false, data: null, error: "transfer_not_found" };}
      if (response.status === 409) {return { success: false, data: null, error: "transfer_not_found" };}
      if (error) {return { success: false, data: null, error: mapRegistryError(error, response.status) };}
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
      const { data, error, response } = await withRetry(
        `poll ${registry}`,
        () =>
          registry === "kitaqsign"
            ? getClient("kitaqsign", env).GET("/api/v1/epp/messages/poll")
            : getKitaqnicClient(env).GET("/api/v1/epp/messages"),
      );

      // 204 No Content はレジストリの「メッセージなし」規約 (Swagger には無いが実測で来うる)
      if (response.status === 204) {
        console.info(`[poll:${registry}] queue empty (status=204)`);
        return { success: true, data: null, error: null };
      }
      // HTTP 5xx / 4xx はレジストリ側の異常。以前は !data で "queue empty" として無視していたが、
      // それだと cron が空キューと誤認して drain break してしまう。明示的に poll_failed で返す。
      if (!response.ok) {
        console.error(
          `[poll:${registry}] http error status=${response.status} message="${extractResultMessage(error) ?? "-"}"`,
        );
        return { success: false, data: null, error: "poll_failed" };
      }
      // 200 でも body が空 (仕様不明の実装差) の場合は "空キュー" として扱う。
      if (!data) {
        console.info(`[poll:${registry}] queue empty (empty body)`);
        return { success: true, data: null, error: null };
      }

      // EPP RFC 5730 準拠: 1300 = "no messages in queue"。1000 と同義で空キューを意味する。
      // Kitaqsign / Kitaqnic の Swagger には未定義だが、EPP 準拠実装なら送りうるので許容する
      // (誤って poll_failed にすると cron がリトライループに入る)。
      if (data.result.code !== 1000 && data.result.code !== 1300) {
        // S-6: レジストリ生 message はユーザー応答に載せず、normalized code に固定。
        // 詳細は console.error でログに残す。
        console.error(
          `[poll:${registry}] non-success code=${data.result.code}, message="${data.result.message}"`,
        );
        return { success: false, data: null, error: "poll_failed" };
      }

      const message = data.resData?.message;
      if (!message || typeof message.id !== "number") {
        console.info(`[poll:${registry}] queue empty (no message in resData, code=${data.result.code})`);
        return { success: true, data: null, error: null };
      }

      // B9: id は int64 だが JS number は 2^53-1 までしか安全に扱えない。
      // 精度が落ちた場合は ack が失敗する可能性があるので、明示的にエラーで返して監視できるようにする。
      if (!Number.isSafeInteger(message.id)) {
        console.error(`[poll:${registry}] message id=${message.id} is outside safe integer range`);
        return { success: false, data: null, error: "invalid_registry_response" };
      }

      // 生成型の payload は Record<string, never> と過剰に厳しいので、
      // ここで実データを持つ PollMessage に narrow して観測用ログ + 返却に使う。
      const narrowed: PollMessage = message;

      // どのようなメッセージが飛んできたか観測できるように 1 行で残す。
      // payload の全量は残さない (秘匿情報が入り得るため、既知の安全フィールドだけ抜粋)。
      console.info(
        `[poll:${registry}] message id=${narrowed.id} msgType="${narrowed.msgType}" domain="${narrowed.payload.domain ?? "-"}" status="${narrowed.payload.status ?? "-"}" op="${narrowed.payload.op ?? "-"}" counterparty="${narrowed.payload.counterpartyRegistrar ?? "-"}"`,
      );

      return { success: true, data: narrowed, error: null };
    } catch (e) {
      console.error(`[poll:${registry}] exception`, e);
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
      const { data, error, response } = await withRetry(
        `ack ${registry}`,
        () =>
          registry === "kitaqsign"
            ? getClient("kitaqsign", env).POST("/api/v1/epp/messages/{id}/ack", {
                params: { path: { id: messageId } },
              })
            : getKitaqnicClient(env).DELETE("/api/v1/epp/messages/{id}", {
                params: { path: { id: messageId } },
              }),
      );
      if (!response.ok || error) {
        console.warn(`[ack:${registry}] failed messageId=${messageId} status=${response.status}`);
        return { success: false, data: null, error: "ack_failed" };
      }
      if (data.result.code !== 1000) {
        console.warn(`[ack:${registry}] failed messageId=${messageId} code=${data.result.code} message="${data.result.message}"`);
        return { success: false, data: null, error: "ack_failed" };
      }
      console.info(`[ack:${registry}] ok messageId=${messageId}`);
      return { success: true, data: undefined, error: null };
    } catch (e) {
      console.error(`[ack:${registry}] exception messageId=${messageId}`, e);
      return { success: false, data: null, error: "network_error" };
    }
  }
}
