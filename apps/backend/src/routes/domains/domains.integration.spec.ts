/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { RegistryBridge } from "../../lib/bridge";
import { deleteDomainRouteHandler } from "./[domain-id]/delete";
import { getDomainRouteHandler } from "./[domain-id]/get";
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
  test("[正常系] avail:true → 200", async () => {
    vi.spyOn(RegistryBridge, "resolveRegistry").mockResolvedValue({ success: true, data: "kitaqsign", error: null });
    vi.spyOn(RegistryBridge, "check").mockResolvedValue({
      success: true, data: { results: [{ name: "example.com", avail: true }] }, error: null,
    });
    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com" }) },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.avail).toBe(true);
  });

  test("[正常系] avail:false → 200", async () => {
    vi.spyOn(RegistryBridge, "resolveRegistry").mockResolvedValue({ success: true, data: "kitaqsign", error: null });
    vi.spyOn(RegistryBridge, "check").mockResolvedValue({
      success: true, data: { results: [{ name: "taken.com", avail: false }] }, error: null,
    });
    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "taken.com" }) },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.avail).toBe(false);
  });

  test("[異常系] 非対応TLD → 400", async () => {
    vi.spyOn(RegistryBridge, "resolveRegistry").mockResolvedValue({ success: false, data: null, error: "unsupported_tld" });
    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.zzz" }) },
      mockEnv,
    );
    expect(res.status).toBe(400);
  });

  test("[異常系] Bridge エラー → 500 + ユーザー向けメッセージ", async () => {
    vi.spyOn(RegistryBridge, "resolveRegistry").mockResolvedValue({ success: true, data: "kitaqsign", error: null });
    vi.spyOn(RegistryBridge, "check").mockResolvedValue({ success: false, data: null, error: "network_error" });
    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com" }) },
      mockEnv,
    );
    expect(res.status).toBe(500);
    const json = await res.json() as any;
    expect(json.error).not.toBe("network_error"); // エラーコードがそのまま出ていない
    expect(json.error).toContain("再試行");
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/domains", () => {
  test("[正常系] 登録成功 → 201 + Domain レスポンス", async () => {
    vi.spyOn(RegistryBridge, "hello").mockResolvedValue({ success: true, data: { registryCode: "kitaqsign", message: "hello", tlds: ["com"] }, error: null });
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
    vi.spyOn(RegistryBridge, "hello").mockResolvedValue({ success: true, data: { registryCode: "kitaqsign", message: "hello", tlds: ["com"] }, error: null });
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
    vi.spyOn(RegistryBridge, "hello").mockResolvedValue({ success: true, data: { registryCode: "kitaqsign", message: "hello", tlds: ["com"] }, error: null });
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
  test("[正常系] 更新成功 → 200", async () => {
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

    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chg: { authInfo: "new-pass" } }) },
      mockEnv,
    );
    expect(res.status).toBe(200);
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

describe("結合: DELETE /api/v1/secure/domains/{id}", () => {
  test("[正常系] 廃止成功 → 200 + status=pendingDelete", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "delete").mockResolvedValue({ success: true, data: {}, error: null });

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.status).toBe("pendingDelete");
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
