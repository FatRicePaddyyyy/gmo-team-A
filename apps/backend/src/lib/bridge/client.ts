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

export function getClient(registry: Registry, env: CloudflareBindings): RegistryClient {
  const client = createClient<RegistryPaths>({ baseUrl: baseUrl(registry, env) });
  client.use(authMiddleware(registry, env));
  return client;
}

// Kitaqnic は poll/ack のパスとメソッドが異なる（GET /messages / DELETE /messages/{id}）ため、
// kitaqnic 用に別クライアントを分ける。
export function getKitaqnicClient(env: CloudflareBindings): KitaqnicClient {
  const client = createClient<KitaqnicPaths>({ baseUrl: env.KITAQNIC_BASE_URL });
  client.use(authMiddleware("kitaqnic", env));
  return client;
}
