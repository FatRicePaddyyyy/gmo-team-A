import createClient from "openapi-fetch";
import type { Client, Middleware } from "openapi-fetch";
import type { paths as KitaqnicPaths } from "./generated/kitaqnic";
import type { paths as KitaqsignPaths } from "./generated/kitaqsign";

// Kitaqsign と Kitaqnic は poll/ack を除いてスキーマが一致する。
// 共通エンドポイント（domains/contacts/hosts/sessions/messages 以外）は
// Kitaqsign の paths 型でまとめて扱い、poll/ack だけレジストリ別クライアントを使う。
export type RegistryPaths = KitaqsignPaths;
export type RegistryClient = Client<RegistryPaths>;
export type KitaqnicClient = Client<KitaqnicPaths>;

export type Registry = "kitaqsign" | "kitaqnic";

function baseUrl(registry: Registry, env: CloudflareBindings): string {
  return registry === "kitaqsign" ? env.KITAQSIGN_BASE_URL : env.KITAQNIC_BASE_URL;
}

function authMiddleware(registry: Registry, env: CloudflareBindings): Middleware {
  const user = registry === "kitaqsign" ? env.KITAQSIGN_BASIC_USER : env.KITAQNIC_BASIC_USER;
  const pass = registry === "kitaqsign" ? env.KITAQSIGN_BASIC_PASS : env.KITAQNIC_BASIC_PASS;
  const registrarId = registry === "kitaqsign" ? env.KITAQSIGN_REGISTRAR_ID : env.KITAQNIC_REGISTRAR_ID;
  const apiKey = registry === "kitaqsign" ? env.KITAQSIGN_API_KEY : env.KITAQNIC_API_KEY;
  const authorization = `Basic ${btoa(`${user}:${pass}`)}`;

  return {
    onRequest({ request }) {
      request.headers.set("Authorization", authorization);
      request.headers.set("X-Registrar-Id", registrarId);
      request.headers.set("X-Api-Key", apiKey);
      // クライアントトランザクションID: リクエストごとに一意
      if (!request.headers.has("X-Cl-TRID")) {
        request.headers.set("X-Cl-TRID", `CLI-${crypto.randomUUID()}`);
      }
      return request;
    },
  };
}

// レジストリ通信の観測用 middleware。
// - onRequest: メソッド + URL + clTRID を残す (障害調査時にレジストリ側ログと突合するキー)
// - onResponse: HTTP status + result.code / message を残す (成功/失敗どちらも 1 行で分かるように)
// レスポンスボディを 1 度読むために clone() する。読み残しは呼び出し側に影響しない。
function loggingMiddleware(registry: Registry): Middleware {
  return {
    onRequest({ request }) {
      const clTrid = request.headers.get("X-Cl-TRID") ?? "-";
      console.info(`[registry:${registry}] → ${request.method} ${request.url} clTRID=${clTrid}`);
      return request;
    },
    async onResponse({ request, response }) {
      const clTrid = request.headers.get("X-Cl-TRID") ?? "-";
      const contentType = response.headers.get("content-type") ?? "";
      let resultCode: number | string = "-";
      let resultMessage = "";
      if (contentType.includes("json")) {
        try {
          const body: { result?: { code?: number; message?: string; msg?: string } } = await response.clone().json();
          resultCode = body.result?.code ?? "-";
          resultMessage = (body.result?.message ?? body.result?.msg ?? "").slice(0, 200);
        } catch {
          // JSON でない (エラーページ等) 場合はスキップ
        }
      }
      const line = `[registry:${registry}] ← ${request.method} ${new URL(request.url).pathname} status=${response.status} resultCode=${resultCode}${resultMessage ? ` message="${resultMessage}"` : ""} clTRID=${clTrid}`;
      if (response.ok) {console.info(line);} else {console.warn(line);}
      return response;
    },
  };
}

export function getClient(registry: Registry, env: CloudflareBindings): RegistryClient {
  const client = createClient<RegistryPaths>({ baseUrl: baseUrl(registry, env) });
  client.use(authMiddleware(registry, env));
  client.use(loggingMiddleware(registry));
  return client;
}

// Kitaqnic は poll/ack のパスとメソッドが異なる（GET /messages / DELETE /messages/{id}）ため、
// kitaqnic 用に別クライアントを分ける。
export function getKitaqnicClient(env: CloudflareBindings): KitaqnicClient {
  const client = createClient<KitaqnicPaths>({ baseUrl: env.KITAQNIC_BASE_URL });
  client.use(authMiddleware("kitaqnic", env));
  client.use(loggingMiddleware("kitaqnic"));
  return client;
}
