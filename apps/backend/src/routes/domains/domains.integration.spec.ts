/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { RegistryBridge } from "../../lib/bridge";
import { deleteDomainRouteHandler } from "./[domain-id]/delete";
import { getDomainRouteHandler } from "./[domain-id]/get";
import { listInboundTransferHistoryRouteHandler } from "./inbound-transfer-history/get";
import { DomainTransferRepository } from "./transfer-repository";
import { updateDomainRouteHandler } from "./[domain-id]/put";
import { renewDomainRouteHandler } from "./[domain-id]/renew/post";
import { restoreDomainRouteHandler } from "./[domain-id]/restore/post";
import { checkDomainRouteHandler } from "./check/post";
import { listDomainsRouteHandler } from "./get";
import { createDomainRouteHandler } from "./post";
import { DomainRepository } from "./repository";
import { DomainUserRepository } from "./user-repository";

// ハンドラー→Service→Repository まで通す結合テスト。
// RegistryBridge と DomainRepository をモックして
// ハンドラーが正しい HTTP ステータスとユーザー向けメッセージを返すかを検証する。

const mockEnv = {} as CloudflareBindings;

// テスト時は authMiddleware が通らず ctx.get("userId") === undefined になる。
// ownerUserId を undefined に合わせることで所有者チェックを通過させる。
const mockDomainRow = {
  id: "dom-001",
  name: "example.com",
  registry: "kitaqsign" as const,
  status: "ok",
  expiresAt: new Date("2027-08-25T00:00:00.000Z"),
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
  authInfo: "test-auth-info",
  ownerUserId: undefined as unknown as string,
  autoRenew: false,
};

// レジストリの Swagger 制約に沿ったダミーユーザー (許可名 + @example.com)
const mockContactUser = {
  id: "user-001",
  name: "Taro Test",
  email: "taro.test@example.com",
  emailVerified: true,
  image: null,
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
  updatedAt: new Date("2026-08-25T00:00:00.000Z"),
  role: null,
  banned: false,
  banReason: null,
  banExpires: null,
};

beforeEach(() => vi.restoreAllMocks());

// ─── check ───────────────────────────────────────────────────────────────────

describe("結合: POST /api/v1/public/domains/check", () => {
  test("[正常系] 複数ドメインをまとめて確認できる（同じregistryは1回のcheckにまとまる）", async () => {
    vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) =>
      registry === "kitaqsign"
        ? { success: true, data: { registryCode: "KQSGN", tlds: ["com", "net"] }, error: null }
        : { success: true, data: { registryCode: "KQNIC", tlds: ["xyz"] }, error: null },
    );
    const checkSpy = vi.spyOn(RegistryBridge, "check").mockResolvedValue({
      success: true,
      data: { results: [{ name: "example.com", avail: true }, { name: "taken.net", avail: false }] },
      error: null,
    });

    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: ["example.com", "taken.net"] }) },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.results).toMatchObject([
      { name: "example.com", avail: true, failed: false },
      { name: "taken.net", avail: false, failed: false },
    ]);
    // kitaqsign 宛の check は1回だけ（2件まとめて）呼ばれる
    expect(checkSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy).toHaveBeenCalledWith(expect.objectContaining({ names: ["example.com", "taken.net"], registry: "kitaqsign" }));
  });

  test("[異常系] 非対応TLD → failed:false・avail:falseで返す（500にはしない）", async () => {
    vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) =>
      registry === "kitaqsign"
        ? { success: true, data: { registryCode: "KQSGN", tlds: ["com"] }, error: null }
        : { success: true, data: { registryCode: "KQNIC", tlds: ["xyz"] }, error: null },
    );

    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: ["example.zzz"] }) },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.results).toMatchObject([{ name: "example.zzz", avail: false, failed: false }]);
  });

  test("[異常系] Bridge エラー → 該当項目だけ failed:true で返す（他の項目は道連れにしない）", async () => {
    vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) =>
      registry === "kitaqsign"
        ? { success: true, data: { registryCode: "KQSGN", tlds: ["com"] }, error: null }
        : { success: true, data: { registryCode: "KQNIC", tlds: ["xyz"] }, error: null },
    );
    vi.spyOn(RegistryBridge, "check").mockResolvedValue({ success: false, data: null, error: "network_error" });

    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: ["example.com"] }) },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.results).toMatchObject([{ name: "example.com", avail: false, failed: true }]);
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/domains", () => {
  test("[正常系] 登録成功 → 201 + Domain レスポンス", async () => {
    vi.spyOn(RegistryBridge, "hello").mockResolvedValue({ success: true, data: { registryCode: "kitaqsign", tlds: ["com"] }, error: null });
    vi.spyOn(DomainUserRepository, "findById").mockResolvedValue({ success: true, data: mockContactUser, error: null });
    vi.spyOn(RegistryBridge, "createContact").mockResolvedValue({ success: true, data: { contactId: "c-001" }, error: null });
    vi.spyOn(RegistryBridge, "create").mockResolvedValue({
      success: true, data: { domain: "example.com", crDate: "2026-08-25T00:00:00.000Z", exDate: "2027-08-25T00:00:00.000Z" }, error: null,
    });
    vi.spyOn(DomainRepository, "create").mockResolvedValue({ success: true, data: mockDomainRow, error: null });

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", registry: "kitaqsign", period: { unit: "Y", value: 1 } }) },
      mockEnv,
    );
    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.name).toBe("example.com");
  });

  test("[異常系] domain_exists → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(RegistryBridge, "hello").mockResolvedValue({ success: true, data: { registryCode: "kitaqsign", tlds: ["com"] }, error: null });
    vi.spyOn(DomainUserRepository, "findById").mockResolvedValue({ success: true, data: mockContactUser, error: null });
    vi.spyOn(RegistryBridge, "createContact").mockResolvedValue({ success: true, data: { contactId: "c-001" }, error: null });
    vi.spyOn(RegistryBridge, "create").mockResolvedValue({ success: false, data: null, error: "domain_exists" });

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "taken.com", registry: "kitaqsign", period: { unit: "Y", value: 1 } }) },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("すでに登録");
  });

  test("[異常系] invalid_tld → 422 + ユーザー向けメッセージ", async () => {
    // レジストリの hello は成功するが、hello.tlds に "xyz" を返さない → service 側で unsupported_tld として弾かれ 422 になる。
    vi.spyOn(RegistryBridge, "hello").mockResolvedValue({ success: true, data: { registryCode: "kitaqsign", tlds: ["com"] }, error: null });
    vi.spyOn(DomainUserRepository, "findById").mockResolvedValue({ success: true, data: mockContactUser, error: null });
    vi.spyOn(RegistryBridge, "createContact").mockResolvedValue({ success: true, data: { contactId: "c-001" }, error: null });
    vi.spyOn(RegistryBridge, "create").mockResolvedValue({ success: false, data: null, error: "invalid_tld" });

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "bad.xyz", registry: "kitaqsign", period: { unit: "Y", value: 1 } }) },
      mockEnv,
    );
    expect(res.status).toBe(422);
    const json = await res.json() as any;
    expect(json.error).toContain("対応していません");
  });

  test("[異常系] TLD 判定不能なドメイン → 400（Issue #25）", async () => {
    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "invalid-no-tld", period: { unit: "Y", value: 1 } }) },
      mockEnv,
    );
    expect(res.status).toBe(400);
  });

  test("[異常系] period.unit 不正 → 400", async () => {
    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", registry: "kitaqsign", period: { unit: "D", value: 1 } }) },
      mockEnv,
    );
    expect(res.status).toBe(400);
  });
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe("結合: GET /api/v1/secure/domains", () => {
  test("[正常系] ドメイン一覧を返す", async () => {
    vi.spyOn(DomainRepository, "listByUserId").mockResolvedValue({ success: true, data: [mockDomainRow], error: null });

    const res = await listDomainsRouteHandler.request("/api/v1/secure/domains", { method: "GET" }, mockEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data).toHaveLength(1);
    expect(json.data[0].name).toBe("example.com");
  });

  test("[正常系] ゼロ件", async () => {
    vi.spyOn(DomainRepository, "listByUserId").mockResolvedValue({ success: true, data: [], error: null });

    const res = await listDomainsRouteHandler.request("/api/v1/secure/domains", { method: "GET" }, mockEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data).toHaveLength(0);
  });
});

// ─── info ─────────────────────────────────────────────────────────────────────

describe("結合: GET /api/v1/secure/domains/{id}", () => {
  test("[正常系] DB + Bridge の情報を合わせて返す", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainRepository, "updateExpiresAtAndStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: true,
      data: { domain: "example.com", status: ["ok"], registrant: "c-001", contacts: {}, nameservers: [], crDate: "2026-08-25T00:00:00.000Z", exDate: "2028-08-25T00:00:00.000Z", rgpStatus: [] },
      error: null,
    });

    const res = await getDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "GET" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.expiresAt).toBe("2028-08-25T00:00:00.000Z"); // Bridge の最新値
  });

  test("[異常系] 他ユーザーのドメイン → 404 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({
      success: true,
      data: { ...mockDomainRow, ownerUserId: "other-user" },
      error: null,
    });

    const res = await getDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "GET" },
      mockEnv,
    );
    expect(res.status).toBe(404);
    const json = await res.json() as any;
    expect(json.error).toContain("見つかりません");
  });
});

// ─── renew ────────────────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/domains/{id}/renew", () => {
  test("[正常系] 更新成功 → 200 + 新 expiresAt", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainRepository, "updateExpiresAt").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "renew").mockResolvedValue({ success: true, data: { domain: "example.com", exDate: "2028-08-25T00:00:00.000Z" }, error: null });

    const res = await renewDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/renew",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: { unit: "Y", value: 1 } }) },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.expiresAt).toBe("2028-08-25T00:00:00.000Z");
  });

  test("[異常系] pendingTransfer 中 → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockDomainRow, status: "pendingTransfer" }, error: null,
    });

    const res = await renewDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/renew",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: { unit: "Y", value: 1 } }) },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("移管手続き中");
  });

  test("[異常系] period.value 範囲外 → 400", async () => {
    const res = await renewDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/renew",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: { unit: "Y", value: 11 } }) },
      mockEnv,
    );
    expect(res.status).toBe(400);
  });
});

// ─── update ───────────────────────────────────────────────────────────────────

describe("結合: PUT /api/v1/secure/domains/{id}", () => {
  test("[正常系] 更新成功 → 200（Kitaqsign形: update が DomainResponse を返す）", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainRepository, "updateAuthInfo").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(DomainRepository, "updateExpiresAtAndStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "update").mockResolvedValue({
      success: true,
      data: {
        domain: "example.com", status: ["ok"], registrant: "C-0001",
        contacts: {}, nameservers: ["ns1.example.com"],
        crDate: "2026-08-25T00:00:00.000Z", exDate: "2027-08-25T00:00:00.000Z",
        rgpStatus: [],
      },
      error: null,
    });
    // update 成功後、最新状態の同期に info を呼ぶ（Kitaqsign / Kitaqnic 共通の後続処理）
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: true,
      data: {
        domain: "example.com", status: ["ok"], registrant: "C-0001",
        contacts: {}, nameservers: ["ns1.example.com"],
        crDate: "2026-08-25T00:00:00.000Z", exDate: "2027-08-25T00:00:00.000Z",
        rgpStatus: [],
      },
      error: null,
    });

    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chg: { authInfo: "new-pass" } }) },
      mockEnv,
    );
    expect(res.status).toBe(200);
  });

  test("[正常系] 更新成功 → 200（Kitaqnic形: update が空の resData しか返さなくても成功扱いになる）", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainRepository, "updateAuthInfo").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(DomainRepository, "updateExpiresAtAndStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    // Kitaqnic の domain:update は EppResponseUnit（resData が空）を返す
    vi.spyOn(RegistryBridge, "update").mockResolvedValue({ success: true, data: {}, error: null });
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: true,
      data: {
        domain: "example.com", status: ["ok"], registrant: "C-0001",
        contacts: {}, nameservers: ["ns1.example.com"],
        crDate: "2026-08-25T00:00:00.000Z", exDate: "2027-08-25T00:00:00.000Z",
        rgpStatus: [],
      },
      error: null,
    });

    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chg: { authInfo: "new-pass" } }) },
      mockEnv,
    );
    expect(res.status).toBe(200);
  });

  test("[異常系] add で指定したネームサーバーが未登録 → 400 + referenced_object_not_found", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    // 差分計算のため service 内で info を叩く。現状 NS が空なので送られた 2 本すべてが add 対象になる。
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: true,
      data: {
        domain: "example.com", status: ["ok"], registrant: "C-0001",
        contacts: {}, nameservers: [],
        crDate: "2026-08-25T00:00:00.000Z", exDate: "2027-08-25T00:00:00.000Z",
        rgpStatus: [],
      },
      error: null,
    });
    // 差分計算で add 対象になった NS は事前に host:create される。ここでは成功前提で通す。
    vi.spyOn(RegistryBridge, "createHost").mockResolvedValue({ success: true, error: null });
    vi.spyOn(RegistryBridge, "update").mockResolvedValue({ success: false, data: null, error: "referenced_object_not_found" });

    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nameServers: ["ns1.example.com", "ns2.example.com"] }) },
      mockEnv,
    );
    expect(res.status).toBe(400);
  });

  test("[異常系] addStatuses と remStatuses が重複 → 400", async () => {
    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addStatuses: ["clientTransferProhibited"], remStatuses: ["clientTransferProhibited"] }) },
      mockEnv,
    );
    expect(res.status).toBe(400);
  });

  test("[異常系] operation_prohibited → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(RegistryBridge, "update").mockResolvedValue({ success: false, data: null, error: "operation_prohibited" });

    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addStatuses: ["clientUpdateProhibited"] }) },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("できません");
  });
});

// ─── delete ───────────────────────────────────────────────────────────────────

// レジストリが返す status[] をそのまま与えるための共通モック。
// 廃止・復旧のあとは info で status を取り直すので、対でモックしないと
// 本物のレジストリを叩きにいって失敗し、フォールバック値でたまたま通ってしまう。
const mockRegistryInfo = (statuses: string[]) =>
  vi.spyOn(RegistryBridge, "info").mockResolvedValue({
    success: true,
    data: {
      domain: mockDomainRow.name,
      status: statuses,
      registrant: "C-0001",
      contacts: {},
      nameservers: [],
      crDate: "2026-08-25T00:00:00.000Z",
      exDate: "2027-08-25T00:00:00.000Z",
      rgpStatus: [],
    },
    error: null,
  });

describe("結合: DELETE /api/v1/secure/domains/{id}", () => {
  const mockDeleteDeps = () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(RegistryBridge, "delete").mockResolvedValue({ success: true, data: {}, error: null });
    return vi.spyOn(DomainRepository, "updateStatus")
      .mockResolvedValue({ success: true, data: undefined, error: null });
  };

  // 実機は廃止直後に pendingDelete と redemptionPeriod を両方付ける。
  // 復旧できるのは redemptionPeriod があるときだけなので、そちらを記録する。
  test("[正常系] 廃止成功 → 200 + status=redemptionPeriod（両方付く）", async () => {
    const updateSpy = mockDeleteDeps();
    mockRegistryInfo(["pendingDelete", "redemptionPeriod"]);

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("redemptionPeriod");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "redemptionPeriod" }));
  });

  // 廃止から45日を過ぎると redemptionPeriod が外れ、pendingDelete だけが残る。
  // この状態は復旧できないので、区別できるようにそのまま記録する。
  test("[正常系] 猶予期間を過ぎて pendingDelete だけなら pendingDelete を記録する", async () => {
    const updateSpy = mockDeleteDeps();
    mockRegistryInfo(["pendingDelete"]);

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("pendingDelete");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "pendingDelete" }));
  });

  test("[異常系] info が失敗しても廃止は成功扱い（status は pendingDelete に倒す）", async () => {
    const updateSpy = mockDeleteDeps();
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: false, data: null, error: "network_error",
    });

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("pendingDelete");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "pendingDelete" }));
  });

  test("[異常系] clientDeleteProhibited → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(RegistryBridge, "delete").mockResolvedValue({ success: false, data: null, error: "operation_prohibited" });

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("できません");
  });

  test("[異常系] 他ユーザーのドメイン → 404", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockDomainRow, ownerUserId: "other" }, error: null,
    });

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );
    expect(res.status).toBe(404);
  });
});

// ─── restore ─────────────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/domains/{id}/restore", () => {
  // 復旧後の status はレジストリの info から決めるので、restore と対で必ずモックする。
  // モックし忘れると本物のレジストリを叩きにいって失敗し、フォールバックの "ok" で
  // たまたま通ってしまい、status の決まり方を検証できなくなる。
  const mockInfo = (statuses: string[]) =>
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: true,
      data: {
        domain: mockDomainRow.name,
        status: statuses,
        registrant: "C-0001",
        contacts: {},
        nameservers: [],
        crDate: "2026-08-25T00:00:00.000Z",
        exDate: "2027-08-25T00:00:00.000Z",
        rgpStatus: [],
      },
      error: null,
    });

  // 復旧の前提（pendingDelete のドメインが自分のもので、レジストリ側の復旧は成功する）を揃える。
  // DB に何を書いたかを検証したいテストがあるので、updateStatus のスパイを返す。
  const mockRestoreDeps = () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockDomainRow, status: "pendingDelete" }, error: null,
    });
    vi.spyOn(RegistryBridge, "restore").mockResolvedValue({ success: true, data: {}, error: null });
    return vi.spyOn(DomainRepository, "updateStatus")
      .mockResolvedValue({ success: true, data: undefined, error: null });
  };

  test("[正常系] 復旧成功 → 200 + status=ok", async () => {
    const updateSpy = mockRestoreDeps();
    const infoSpy = mockInfo(["ok"]);

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("ok");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
    // 別のドメインやレジストリを問い合わせていないことも確かめる
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: mockDomainRow.name, registry: mockDomainRow.registry }),
    );
  });

  // "ok" 決め打ちにせず、レジストリが返した値をそのまま反映することの確認。
  // pendingDelete から抜けていれば復旧は成功しているので、ok 以外でも 200 を返す。
  test("[正常系] レジストリが inactive を返せばそのまま反映される", async () => {
    const updateSpy = mockRestoreDeps();
    mockInfo(["inactive"]);

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("inactive");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "inactive" }));
  });

  // 復旧そのものは成功しているので、status を確認できなくても 200 を返す。
  test("[異常系] info が失敗しても復旧は成功扱い（status は ok に倒す）", async () => {
    const updateSpy = mockRestoreDeps();
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: false, data: null, error: "network_error",
    });

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("ok");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
  });

  // レジストリ側の反映が一瞬遅れて pendingDelete が返ることがある。
  // ここで DB に書き戻すと「復旧したのに廃止中」になるので巻き戻さない。
  test("[異常系] info がまだ pendingDelete を返しても巻き戻さない", async () => {
    const updateSpy = mockRestoreDeps();
    mockInfo(["pendingDelete"]);

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("ok");
    // 「pendingDelete を書かない」だけだと updateStatus 自体が消えても通ってしまうので、
    // 「ok を書いた」ことを正面から確かめる。
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
  });

  // レジストリが復旧を断るケース。実機で確認できたのは「pendingDelete でない」場合で、
  // Grace Period 超過は猶予期間(kitaqnic は 45日)を待たないと再現できず未確認。
  // どちらもレジストリからは同じ 2304 で返るため、bridge から先の扱いは共通。
  // 復旧直後にレジストリの反映が遅れると、廃止中の値（実機では両方付く）が返ることがある。
  // 「復旧したのに廃止中」になってしまうので巻き戻さない。
  test("[異常系] info がまだ廃止中（両方付き）を返しても巻き戻さない", async () => {
    const updateSpy = mockRestoreDeps();
    mockInfo(["pendingDelete", "redemptionPeriod"]);

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("ok");
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
  });

  test("[異常系] レジストリが復旧を断る（2304）→ 409 + ユーザー向けメッセージ", async () => {
    mockRestoreDeps();
    vi.spyOn(RegistryBridge, "restore").mockResolvedValue({ success: false, data: null, error: "operation_prohibited" });

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("できません");
  });

  test("[異常系] 権限なし → 403 + ユーザー向けメッセージ", async () => {
    mockRestoreDeps();
    vi.spyOn(RegistryBridge, "restore").mockResolvedValue({ success: false, data: null, error: "forbidden" });

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(403);
    const json = await res.json() as any;
    expect(json.error).toContain("権限");
  });
});

describe("結合: メンテナンス中でも詳細は DB の分だけ返す", () => {
  // レジストリが落ちると詳細ページの中身が丸ごと消えていた。
  // ドメイン名・有効期限・状態は自社 DB にあるので、そこは返す。
  test("[正常系] registry_maintenance のとき 200 + registryAvailable: false", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainUserRepository, "findById").mockResolvedValue({ success: true, data: mockContactUser, error: null });
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({ success: false, data: null, error: "registry_maintenance" });

    const res = await getDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      {},
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { registryAvailable: boolean; registryUnavailableReason: string; name: string; nameservers: string[]; ownerName: string } };
    expect(json.data.registryAvailable).toBe(false);
    // 登録者は自社 DB 由来なので、レジストリが落ちていても出せる
    expect(json.data.ownerName).toBe(mockContactUser.name);
    // 理由まで返す。メンテナンスと通信不良で利用者への案内が変わるため
    expect(json.data.registryUnavailableReason).toContain("メンテナンス");
    // DB にある情報は出る
    expect(json.data.name).toBe(mockDomainRow.name);
    // レジストリ由来は「取得できていない」として空
    expect(json.data.nameservers).toEqual([]);
  });

  test("[正常系] network_error でも同じく DB の分を返す", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({ success: false, data: null, error: "network_error" });

    const res = await getDomainRouteHandler.request("/api/v1/secure/domains/dom-001", {}, mockEnv);
    expect(res.status).toBe(200);
    // 通信不良をメンテナンスと言わない
    const json = await res.json() as { data: { registryUnavailableReason: string } };
    expect(json.data.registryUnavailableReason).not.toContain("メンテナンス");
  });

  test("[異常系] ドメイン不在など相手都合でないエラーは従来どおり失敗させる", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({ success: false, data: null, error: "domain_not_found" });

    const res = await getDomainRouteHandler.request("/api/v1/secure/domains/dom-001", {}, mockEnv);
    expect(res.status).not.toBe(200);
  });
});

describe("結合: 詳細に登録者の氏名を載せる", () => {
  // レジストリの registrant は `C-01054F4E` のような内部 ID で利用者に読めない。
  // コンタクトは登録時に自社のユーザー情報から作っているので、氏名は DB 側から出す。
  test("[正常系] ownerName に DB のユーザー名が入る", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainUserRepository, "findById").mockResolvedValue({ success: true, data: mockContactUser, error: null });
    vi.spyOn(DomainRepository, "updateExpiresAtAndStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    mockRegistryInfo(["ok"]);

    const res = await getDomainRouteHandler.request("/api/v1/secure/domains/dom-001", {}, mockEnv);

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { ownerName: string } };
    expect(json.data.ownerName).toBe(mockContactUser.name);
  });

  test("[異常系] ユーザーを引けなくても詳細は返す（氏名だけ空）", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainUserRepository, "findById").mockResolvedValue({ success: false, data: null, error: "db_error" });
    vi.spyOn(DomainRepository, "updateExpiresAtAndStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    mockRegistryInfo(["ok"]);

    const res = await getDomainRouteHandler.request("/api/v1/secure/domains/dom-001", {}, mockEnv);

    // 氏名が引けないことは詳細を出せない理由にならない
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { ownerName: string; name: string } };
    expect(json.data.ownerName).toBe("");
    expect(json.data.name).toBe(mockDomainRow.name);
  });
});

describe("結合: 渡す側の移管履歴", () => {
  // 承認・却下すると pending 一覧から消えてどこにも出なくなっていた。
  // 「誰かが自分のドメインを取ろうとした」記録が追えないのはセキュリティ上まずい。
  test("[正常系] 処理が済んだ申請が status 付きで返る", async () => {
    vi.spyOn(DomainTransferRepository, "findInboundHistoryByOwner").mockResolvedValue({
      success: true,
      data: [
        {
          transferId: "tr-001",
          domainId: "dom-001",
          domainName: "example.com",
          registry: "kitaqsign" as const,
          requestedAt: new Date("2026-08-25T00:00:00.000Z"),
          status: "clientRejected",
        },
      ],
      error: null,
    });

    const res = await listInboundTransferHistoryRouteHandler.request(
      "/api/v1/secure/domains/inbound-transfer-history",
      {},
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { status: string; domainName: string }[] };
    expect(json.data).toHaveLength(1);
    // どう決着したかが分からないと履歴の意味がない
    expect(json.data[0]?.status).toBe("clientRejected");
    expect(json.data[0]?.domainName).toBe("example.com");
  });

  test("[正常系] 履歴が無いときは空配列", async () => {
    vi.spyOn(DomainTransferRepository, "findInboundHistoryByOwner").mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });

    const res = await listInboundTransferHistoryRouteHandler.request(
      "/api/v1/secure/domains/inbound-transfer-history",
      {},
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toEqual([]);
  });

  test("[異常系] DB エラーは 500", async () => {
    vi.spyOn(DomainTransferRepository, "findInboundHistoryByOwner").mockResolvedValue({
      success: false,
      data: null,
      error: "db_error",
    });

    const res = await listInboundTransferHistoryRouteHandler.request(
      "/api/v1/secure/domains/inbound-transfer-history",
      {},
      mockEnv,
    );

    expect(res.status).toBe(500);
  });
});
