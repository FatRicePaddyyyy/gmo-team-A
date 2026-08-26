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

  // Kitaqnic の shape で info.registryCode が欠落しているとき、
  // トップレベルの svID にフォールバックする (normalizeGreeting 側の防御)。
  test("kitaqnic 形で info.registryCode が無ければ svID を使う", async () => {
    stubRegistry(200, okEnvelope({
      svID: "KQNIC",
      info: { supportedTlds: ["xyz"] },
    }));

    const res = await RegistryBridge.hello({ registry: "kitaqnic", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data?.registryCode).toBe("KQNIC");
    expect(res.data?.tlds).toEqual(["xyz"]);
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

  // sponsoring registrar 以外の呼び出し。restore と同じ扱いに揃える。
  test("[異常系] 403 は forbidden にマップされる", async () => {
    stubRegistry(403, errEnvelope(2201, "Authorization error"));

    const res = await RegistryBridge.delete({ name: "example.com", registry: "kitaqsign", env: mockEnv });

    expect(res.error).toBe("forbidden");
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe("RegistryBridge.update: 403/404 の権限系吸収", () => {
  // sponsoring registrar 以外の呼び出し。Swagger には 200/404 のみだが、
  // 実運用では 403 が返り得るので bridge で forbidden にマップして routes 側で 403 応答にする。
  test("[異常系] 403 は forbidden にマップされる", async () => {
    stubRegistry(403, errEnvelope(2201, "Authorization error"));

    const res = await RegistryBridge.update({
      name: "example.com",
      chg: { registrant: "C-0001" },
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("forbidden");
  });

  test("[異常系] 404 は domain_not_found にマップされる", async () => {
    stubRegistry(404, errEnvelope(2303, "Object does not exist"));

    const res = await RegistryBridge.update({
      name: "nope.com",
      chg: { registrant: "C-0001" },
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("domain_not_found");
  });

  // Kitaqnic の update 成功レスポンスは EppResponseUnit (resData が空 = Record<string, never>) を返す。
  // 呼び出し側はレスポンスの中身を参照せず info() で取り直す設計だが、bridge 段では
  // "resData 欠落" を invalid_registry_response に丸めず、空オブジェクトのまま成功で返すこと。
  test("[正常系] Kitaqnic の Unit (resData なし) 応答でも成功で返す", async () => {
    // openapi-fetch は 200 + result.code 1000 なら resData 不在でも success 扱い
    stubRegistry(200, {
      result: { code: 1000, message: "Command completed successfully" },
      trID: { clTRID: null, svTRID: "TEST-0001" },
    });

    const res = await RegistryBridge.update({
      name: "example.xyz",
      chg: { registrant: "C-0001" },
      registry: "kitaqnic",
      env: mockEnv,
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual({});
  });

  // update の 2303 は「ドメイン本体不在」と「add/rem で指定した NS/コンタクトが未登録」の
  // 2 通りが同じコードで返る。reason に対象ドメイン名が含まれるかで区別する。
  test("[異常系] 2303 + reason に対象ドメイン名を含む → domain_not_found", async () => {
    stubRegistry(200, {
      result: { code: 2303, message: "Object does not exist", reason: "Domain example.com not found" },
      trID: { clTRID: null, svTRID: "TEST-0001" },
    });

    const res = await RegistryBridge.update({
      name: "example.com",
      add: { nameservers: ["ns1.other.com"] },
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("domain_not_found");
  });

  test("[異常系] 2303 + reason に対象ドメイン名を含まない → referenced_object_not_found", async () => {
    stubRegistry(200, {
      result: { code: 2303, message: "Object does not exist", reason: "Host ns1.other.com not found" },
      trID: { clTRID: null, svTRID: "TEST-0001" },
    });

    const res = await RegistryBridge.update({
      name: "example.com",
      add: { nameservers: ["ns1.other.com"] },
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("referenced_object_not_found");
  });
});

// ─── resolveRegistry ─────────────────────────────────────────────────────────

describe("RegistryBridge.resolveRegistry: 片側 hello 失敗時の判定", () => {
  test("[異常系] kitaqsign 疎通 OK・kitaqnic 疎通 NG で kitaqnic 管轄 TLD → network_error", async () => {
    // hello を直接 spy で差し替える (fetch stub 二重管理を避けるため)。
    vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) => {
      if (registry === "kitaqsign") {
        return { success: true, data: { registryCode: "KQSGN", tlds: ["com", "net"] }, error: null };
      }
      return { success: false, data: null, error: "network_error" };
    });

    const res = await RegistryBridge.resolveRegistry({ name: "example.xyz", env: mockEnv });

    // 修正前は unsupported_tld を返していた (kitaqnic が実は対応してるかもしれないのに誤情報)
    expect(res.success).toBe(false);
    expect(res.error).toBe("network_error");
  });

  test("[異常系] 両方 hello が失敗 → network_error", async () => {
    vi.spyOn(RegistryBridge, "hello").mockResolvedValue({ success: false, data: null, error: "network_error" });

    const res = await RegistryBridge.resolveRegistry({ name: "example.com", env: mockEnv });

    expect(res.error).toBe("network_error");
  });

  test("[正常系] 両方 hello 成功・kitaqsign 管轄 TLD → kitaqsign", async () => {
    vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) => {
      if (registry === "kitaqsign") {
        return { success: true, data: { registryCode: "KQSGN", tlds: ["com"] }, error: null };
      }
      return { success: true, data: { registryCode: "KQNIC", tlds: ["xyz"] }, error: null };
    });

    const res = await RegistryBridge.resolveRegistry({ name: "example.com", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data).toBe("kitaqsign");
  });

  test("[異常系] 両方 hello 成功・どちらの tld にも該当しない → unsupported_tld", async () => {
    vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) => {
      if (registry === "kitaqsign") {
        return { success: true, data: { registryCode: "KQSGN", tlds: ["com"] }, error: null };
      }
      return { success: true, data: { registryCode: "KQNIC", tlds: ["xyz"] }, error: null };
    });

    const res = await RegistryBridge.resolveRegistry({ name: "example.foo", env: mockEnv });

    expect(res.error).toBe("unsupported_tld");
  });
});

// ─── createContact ───────────────────────────────────────────────────────────

describe("RegistryBridge.createContact: postalInfo 制約違反の吸収", () => {
  // 実測: 許可名以外の氏名 / @example 以外のメール / cc: JP US 以外は
  // HTTP 400 + result.code 2003 で返る。routes 側で 400 (入力不備) として扱えるように
  // invalid_contact_payload コードにマップする。
  test("[異常系] 400 + 2003 は invalid_contact_payload にマップされる", async () => {
    stubRegistry(400, errEnvelope(2003, "Required parameter missing"));

    const res = await RegistryBridge.createContact({
      name: "Real Person",
      email: "user@real.com",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_contact_payload");
  });

  test("[異常系] 409 はコンタクトID既存 (contact_id_conflict) のまま", async () => {
    stubRegistry(409, errEnvelope(2302, "Object exists"));

    const res = await RegistryBridge.createContact({
      name: "Taro Test",
      email: "taro.test@example.com",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("contact_id_conflict");
  });
});

// ─── transferAction (approve/reject/cancel) ──────────────────────────────────

describe("RegistryBridge.transferApprove: 401/403/404/409 の意味分け", () => {
  // 実測: API キー無効 → 401 + result.code 2200 "Authentication error"。
  // これは backend 設定不備 = 運用エラー。ユーザーに "権限なし" と誤って伝えないよう
  // invalid_registry_response に落とす (500 化して運用チームに気付かせる)。
  test("[異常系] 401 は invalid_registry_response にマップされる (backend 設定不備扱い)", async () => {
    stubRegistry(401, errEnvelope(2200, "Authentication error"));

    const res = await RegistryBridge.transferApprove({
      name: "example.com",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.success).toBe(false);
    // detail 付き ("invalid_registry_response: <レジストリ由来メッセージ>") で返る場合もあるため
    // プレフィックスで判定する。ユーザー向け toUserMessage は同じ定型文言 + 理由付加で処理される。
    expect(res.error).toMatch(/^invalid_registry_response(?::|$)/);
  });

  // 実測: ドメイン不在 → 404 + 2303 "Object does not exist"。
  // ドメインは存在するが transfer 中でない → 409 + 2301 "Object not pending transfer"。
  // ユーザー視点はどちらも「その移管申請は無い」なので transfer_not_found に集約する。
  test("[異常系] 404 (ドメイン不在) → transfer_not_found", async () => {
    stubRegistry(404, errEnvelope(2303, "Object does not exist"));

    const res = await RegistryBridge.transferApprove({
      name: "nope.com",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("transfer_not_found");
  });

  test("[異常系] 409 (pending でない) → transfer_not_found", async () => {
    stubRegistry(409, errEnvelope(2301, "Object not pending transfer"));

    const res = await RegistryBridge.transferApprove({
      name: "example.com",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("transfer_not_found");
  });

  test("[異常系] 403 (sponsoring registrar 以外) → forbidden", async () => {
    stubRegistry(403, errEnvelope(2201, "Authorization error"));

    const res = await RegistryBridge.transferApprove({
      name: "example.com",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("forbidden");
  });
});

// ─── transferRequest ─────────────────────────────────────────────────────────

describe("RegistryBridge.transferRequest: authInfo 不一致の吸収", () => {
  // e2e 実測 (teama-2 が違う authInfo で request): Kitaqsign は HTTP 403 + result.code 2202 を返す。
  // Swagger 定義には無いが、bridge で authInfo_mismatch に集約して routes 側で 409 応答にする。
  test("[異常系] 403 + result.code 2202 → authInfo_mismatch", async () => {
    stubRegistry(403, errEnvelope(2202, "Invalid authorization information"));

    const res = await RegistryBridge.transferRequest({
      name: "example.com",
      authInfo: "WRONG-authInfo",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe("authInfo_mismatch");
  });

  // Kitaqnic 側 (Swagger 定義通り HTTP 401)
  test("[異常系] 401 → authInfo_mismatch (Kitaqnic 相当)", async () => {
    stubRegistry(401, errEnvelope(2202, "Invalid authorization information"));

    const res = await RegistryBridge.transferRequest({
      name: "example.xyz",
      authInfo: "WRONG-authInfo",
      registry: "kitaqnic",
      env: mockEnv,
    });

    expect(res.error).toBe("authInfo_mismatch");
  });

  // 202 + result.code 2202 (Kitaqsign が仕様通り返した場合)
  test("[異常系] 202 + result.code 2202 → authInfo_mismatch", async () => {
    stubRegistry(202, errEnvelope(2202, "Invalid authorization information"));

    const res = await RegistryBridge.transferRequest({
      name: "example.com",
      authInfo: "WRONG-authInfo",
      registry: "kitaqsign",
      env: mockEnv,
    });

    expect(res.error).toBe("authInfo_mismatch");
  });

  test("[異常系] 404 → domain_not_found", async () => {
    stubRegistry(404, errEnvelope(2303, "Object does not exist"));

    const res = await RegistryBridge.transferRequest({
      name: "nope.com",
      authInfo: "any",
      registry: "kitaqsign",
      env: mockEnv,
    });

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

// ─── poll ────────────────────────────────────────────────────────────────────

describe("RegistryBridge.poll: レジストリごとに endpoint が違うが shape は共通", () => {
  test("[正常系] Kitaqsign から message を取得できる (payload の各種フィールドを保持)", async () => {
    stubRegistry(200, okEnvelope({
      count: 1,
      message: {
        id: 42,
        msgType: "transfer",
        qdate: "2026-08-26T10:00:00Z",
        payload: {
          domain: "example.com",
          status: "serverApproved",
          op: "approve",
          counterpartyRegistrar: "teama-2",
        },
      },
    }));

    const res = await RegistryBridge.poll({ registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data?.id).toBe(42);
    expect(res.data?.payload.domain).toBe("example.com");
    expect(res.data?.payload.status).toBe("serverApproved");
    expect(res.data?.payload.counterpartyRegistrar).toBe("teama-2");
  });

  test("[正常系] Kitaqnic (GET /messages) も同じ shape で返るので同様に読める", async () => {
    stubRegistry(200, okEnvelope({
      count: 1,
      message: {
        id: 100,
        msgType: "transfer",
        qdate: "2026-08-26T10:00:00Z",
        payload: { domain: "example.xyz", op: "request", counterpartyRegistrar: "teama-2" },
      },
    }));

    const res = await RegistryBridge.poll({ registry: "kitaqnic", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data?.id).toBe(100);
    expect(res.data?.payload.op).toBe("request");
  });

  test("[正常系] 204 は queue empty (data=null) で返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    const res = await RegistryBridge.poll({ registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
  });

  // 以前は 5xx を !data ブランチで queue empty として扱っており、cron が空キューと誤認して
  // drain break していた。5xx は poll_failed で返し、cron 側でリトライ判断させる。
  test("[異常系] HTTP 500 は poll_failed で返す (空キューと誤認しない)", async () => {
    stubRegistry(500, { result: { code: 2400, message: "Command failed" } });

    const res = await RegistryBridge.poll({ registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("poll_failed");
  });

  test("[異常系] 200 + result.code≠1000 は poll_failed で返す", async () => {
    stubRegistry(200, errEnvelope(2400, "Command failed"));

    const res = await RegistryBridge.poll({ registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(false);
    expect(res.error).toBe("poll_failed");
  });

  // EPP RFC 5730: 1300 は "no messages in queue"。1000 と同じく空扱いで受け入れる。
  // Kitaqsign/Kitaqnic の Swagger にはないが、EPP 準拠実装が送っても壊れないようにする。
  test("[正常系] result.code=1300 (EPP no-messages) は queue empty で返す", async () => {
    stubRegistry(200, {
      result: { code: 1300, message: "Command completed successfully; no messages" },
      trID: { clTRID: null, svTRID: "TEST-0001" },
    });

    const res = await RegistryBridge.poll({ registry: "kitaqsign", env: mockEnv });

    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
  });
});
