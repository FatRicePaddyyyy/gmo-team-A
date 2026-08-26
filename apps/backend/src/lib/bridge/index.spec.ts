/// <reference types="../../../worker-configuration" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RegistryBridge } from "./index";

// RegistryBridge そのもののテスト。
// 他のテストは RegistryBridge をまるごとモックしてハンドラ側を見ているため、
// 「レジストリの生レスポンスをどう解釈するか」はここでしか検証できない。
// openapi-fetch はグローバルの fetch を使うので、それを差し替えて生レスポンスを与える。

const mockEnv = {
  KITAQSIGN_BASE_URL: "https://epp.kitaqsign.example",
  KITAQNIC_BASE_URL: "https://epp.kitaqnic.example",
  KITAQSIGN_BASIC_USER: "u",
  KITAQSIGN_BASIC_PASS: "p",
  KITAQSIGN_REGISTRAR_ID: "REG-1",
  KITAQSIGN_API_KEY: "k",
  KITAQNIC_BASIC_USER: "u",
  KITAQNIC_BASIC_PASS: "p",
  KITAQNIC_REGISTRAR_ID: "REG-1",
  KITAQNIC_API_KEY: "k",
} as unknown as CloudflareBindings;

/** レジストリの生レスポンスを1回分だけ返す fetch を仕込む */
function stubRegistry(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

const okEnvelope = (resData: unknown) => ({
  result: { code: 1000, message: "Command completed successfully" },
  resData,
  extension: null,
  trID: { clTRID: null, svTRID: "TEST-0001" },
});

const errEnvelope = (code: number, message: string) => ({
  result: { code, message },
  trID: { clTRID: null, svTRID: "TEST-0001" },
});

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

// ─── hello ───────────────────────────────────────────────────────────────────

describe("RegistryBridge.hello: 対応TLDの入れ物がレジストリごとに違う", () => {
  test("kitaqsign 形（resData.tlds）を読める", async () => {
    stubRegistry(200, okEnvelope({ registryCode: "KQSGN", tlds: ["com", "net", "org", "info"] }));

    const res = await RegistryBridge.hello({ registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data?.tlds).toEqual(["com", "net", "org", "info"]);
  });

  // 実機の kitaqnic は resData.tlds を持たず、resData.info.supportedTlds に入れてくる。
  // ここが読めないと resolveRegistry が失敗し、.xyz など kitaqnic 管轄の TLD が全滅する。
  test("kitaqnic 形（resData.info.supportedTlds）を読める", async () => {
    stubRegistry(200, okEnvelope({
      svID: "KQNIC",
      info: { registryCode: "KQNIC", supportedTlds: ["xyz", "online", "site"] },
    }));

    const res = await RegistryBridge.hello({ registry: "kitaqnic", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data?.tlds).toEqual(["xyz", "online", "site"]);
  });

  test("どちらの形でもなければ失敗する", async () => {
    stubRegistry(200, okEnvelope({ registryCode: "UNKNOWN" }));

    const res = await RegistryBridge.hello({ registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_registry_response");
  });
});

// ─── restore ─────────────────────────────────────────────────────────────────

describe("RegistryBridge.restore: 実機は 409 + 2304 を返す", () => {
  test("[正常系] 200 + 1000 なら成功", async () => {
    stubRegistry(200, okEnvelope({}));

    const res = await RegistryBridge.restore({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(true);
  });

  // 仕様書も Swagger も「200 で 2304」と書いているが、実機は 409 で返す。
  // 非 2xx だと openapi-fetch は body を error 側に入れるため、
  // result.code を見る前に打ち切ると invalid_registry_response になり 500 になってしまう。
  test("[異常系] 409 + 2304 は operation_prohibited（500 にしない）", async () => {
    stubRegistry(409, errEnvelope(2304, "Object status prohibits operation"));

    const res = await RegistryBridge.restore({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("operation_prohibited");
  });

  test("[異常系] 仕様書どおり 200 + 2304 で来ても拾える", async () => {
    stubRegistry(200, errEnvelope(2304, "Object status prohibits operation"));

    const res = await RegistryBridge.restore({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("operation_prohibited");
  });

  // 409 の判定が効いていることの確認。
  // 上の 409 テストはボディに 2304 が入っているため、HTTP の判定を消しても
  // result.code 側で拾えてしまい「409 だから拾えた」ことを検証できない。
  // ボディが読めない 409（プロキシが返す HTML など）でも拾えることをここで担保する。
  test("[異常系] ボディが読めない 409 でも operation_prohibited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>Conflict</html>", { status: 409, headers: { "Content-Type": "text/html" } }),
    ));

    const res = await RegistryBridge.restore({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("operation_prohibited");
  });

  test("[異常系] 404 はドメイン不在", async () => {
    stubRegistry(404, errEnvelope(2303, "Object does not exist"));

    const res = await RegistryBridge.restore({ name: "nope.com", registry: "kitaqsign", env: mockEnv });

    expect(res.error).toBe("domain_not_found");
  });

  test("[異常系] 403 は権限なし", async () => {
    stubRegistry(403, errEnvelope(2201, "Authorization error"));

    const res = await RegistryBridge.restore({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.error).toBe("forbidden");
  });
});

// ─── delete ──────────────────────────────────────────────────────────────────

describe("RegistryBridge.delete: restore と同じく 409 + 2304", () => {
  test("[正常系] 200 + 1000 なら成功", async () => {
    stubRegistry(200, okEnvelope({}));

    const res = await RegistryBridge.delete({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(true);
  });

  // すでに pendingDelete のドメインを再削除すると実機は 409 + 2304
  // (`Domain xxx is pending delete`)。restore と同じ理由で 500 になっていた。
  test("[異常系] 409 + 2304 は operation_prohibited（500 にしない）", async () => {
    stubRegistry(409, errEnvelope(2304, "Object status prohibits operation"));

    const res = await RegistryBridge.delete({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("operation_prohibited");
  });

  test("[異常系] 仕様書どおり 200 + 2304 で来ても拾える", async () => {
    stubRegistry(200, errEnvelope(2304, "Object status prohibits operation"));

    const res = await RegistryBridge.delete({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("operation_prohibited");
  });

  test("[異常系] ボディが読めない 409 でも operation_prohibited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>Conflict</html>", { status: 409, headers: { "Content-Type": "text/html" } }),
    ));

    const res = await RegistryBridge.delete({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("operation_prohibited");
  });

  test("[異常系] 404 はドメイン不在", async () => {
    stubRegistry(404, errEnvelope(2303, "Object does not exist"));

    const res = await RegistryBridge.delete({ name: "nope.com", registry: "kitaqsign", env: mockEnv });

    expect(res.error).toBe("domain_not_found");
  });
});

// ─── renew ───────────────────────────────────────────────────────────────────

describe("RegistryBridge.renew", () => {
  test("[正常系] 200 + 1000 なら成功し、新しい exDate を返す", async () => {
    stubRegistry(200, okEnvelope({ domain: "example.com", exDate: "2028-08-26T00:00:00.000Z" }));

    const res = await RegistryBridge.renew({
      name: "example.com",
      curExpDate: "2027-08-26T00:00:00.000Z",
      period: { unit: "Y", value: 1 },
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.success).toBe(true);
    expect(res.data?.domain).toBe("example.com");
    expect(res.data?.exDate).toBe("2028-08-26T00:00:00.000Z");
  });

  // kitaqnic も同じ EppResponseDomainRenewResponse 形（exDate あり）を返す。
  // update と違って renew は両レジストリでレスポンス形が一致しているため、
  // 片方だけ通ればもう片方も通る前提だが、回帰確認として明示しておく。
  test("[正常系] kitaqnic でも同じ形で成功する", async () => {
    stubRegistry(200, okEnvelope({ domain: "example.xyz", exDate: "2028-08-26T00:00:00.000Z" }));

    const res = await RegistryBridge.renew({
      name: "example.xyz",
      curExpDate: "2027-08-26T00:00:00.000Z",
      period: { unit: "Y", value: 1 },
      registry: "kitaqnic",
      env: mockEnv,
    });

    expect(res.success).toBe(true);
    expect(res.data?.exDate).toBe("2028-08-26T00:00:00.000Z");
  });
});
