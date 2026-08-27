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
import { DomainService } from "./service";

const mockEnv = {} as CloudflareBindings;

const mockDomain = {
  id: "dom-001",
  name: "example.com",
  registry: "kitaqsign",
  status: "ok",
  expiresAt: "2027-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  ownerUserId: "user-001",
  autoRenew: false,
};

// info / update 用の詳細レスポンス
const mockDomainDetail = {
  ...mockDomain,
  registryAvailable: true,
  statuses: ["ok"],
  registrant: "C-0001",
  contacts: {},
  nameservers: ["ns1.example.com"],
  rgpStatus: [],
  upDate: null,
  trDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  // POST /api/v1/secure/domains は registry 省略時に hello (supportedTlds) から自動判定するため、
  // ハンドラー流しテストでも hello は成功前提で固定する。
  vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) => ({
    success: true,
    data: {
      registryCode: registry === "kitaqsign" ? "KITAQSIGN" : "KITAQNIC",
      tlds: registry === "kitaqsign" ? ["com", "net", "org", "info"] : ["xyz", "shop", "store", "app", "dev", "io"],
    },
    error: null,
  }));
});

// ─── check ───────────────────────────────────────────────────────────────────

describe("POST /api/v1/public/domains/check", () => {
  test("[正常系] 複数ドメインの空き確認結果をまとめて返す", async () => {
    vi.spyOn(DomainService, "checkBulk").mockResolvedValue({
      success: true,
      data: [
        { name: "example.com", avail: true, failed: false },
        { name: "taken.com", avail: false, failed: false },
      ],
      error: null,
    });

    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: ["example.com", "taken.com"] }),
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({
      success: true,
      data: {
        results: [
          { name: "example.com", avail: true, failed: false },
          { name: "taken.com", avail: false, failed: false },
        ],
      },
    });
  });

  test("[正常系] 確認できなかった項目は failed: true で返す", async () => {
    vi.spyOn(DomainService, "checkBulk").mockResolvedValue({
      success: true,
      data: [{ name: "example.com", avail: false, failed: true }],
      error: null,
    });

    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: ["example.com"] }),
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.results[0]).toMatchObject({ avail: false, failed: true });
  });

  test("[異常系] namesが空配列", async () => {
    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: [] }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });

  // Issue #76: 以前は日本語ドメインが素通りしてレジストリまで届き、422 が
  // failed: true に化けて「レジストリと通信に失敗しました」と表示されていた。
  test("[異常系] 日本語ドメインはレジストリへ送らず、理由付きの400で返す", async () => {
    const checkBulk = vi.spyOn(DomainService, "checkBulk");

    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: ["日本語.com"] }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toContain("日本語や記号は使えません");
    expect(checkBulk).not.toHaveBeenCalled();
  });

  test("[異常系] 1件でも形式が不正なら全体を弾く", async () => {
    const res = await checkDomainRouteHandler.request(
      "/api/v1/public/domains/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: ["example.com", "-bad.com"] }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });
});

// ─── checkBulk (service) ─────────────────────────────────────────────────────

describe("DomainService.checkBulk", () => {
  // Zod を通らない経路から呼ばれたときの二段構え。
  // 項目ごとの failed で返すと画面が「通信に失敗しました」(障害) と読み、
  // avail:false で返すと「すでに使われています」と読む。どちらも嘘になるので、
  // 名前の形式不正は処理全体の失敗として返す。
  test("[異常系] 形式が不正な名前は処理全体の失敗として返す", async () => {
    // 上の check ハンドラーのテストが checkBulk 自体を差し替えているので、
    // ここでは実装を戻してから呼ぶ (clearAllMocks は呼び出し履歴しか消さない)。
    vi.spyOn(DomainService, "checkBulk").mockRestore();
    const check = vi.spyOn(RegistryBridge, "check");

    const result = await DomainService.checkBulk({
      names: ["example.com", "日本語.com"],
      env: mockEnv,
    });

    expect(result).toEqual({ success: false, data: null, error: "invalid_domain_name" });
    expect(check).not.toHaveBeenCalled();
  });

  test("[正常系] すべて形式が正しければ結果を返す", async () => {
    vi.spyOn(DomainService, "checkBulk").mockRestore();
    vi.spyOn(RegistryBridge, "check").mockResolvedValue({
      success: true,
      data: { results: [{ name: "example.com", avail: true }] },
      error: null,
    });

    const result = await DomainService.checkBulk({
      names: ["example.com"],
      env: mockEnv,
    });

    expect(result).toEqual({
      success: true,
      data: [{ name: "example.com", avail: true, failed: false }],
      error: null,
    });
  });
});

// ─── create ───────────────────────────────────────────────────────────────────

describe("POST /api/v1/secure/domains", () => {
  // Issue #76: 以前は trim().min(1) しか無く、実レジストリの 422 を invalid_tld に
  // 写像していたため「対応していないドメインです」と TLD の問題に見えていた。
  test("[異常系] 日本語ドメインは登録処理に入る前に理由付きの400で返す", async () => {
    const create = vi.spyOn(DomainService, "create");

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "日本語.com",
          period: { unit: "Y", value: 1 },
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    const json = await res.json() as any;
    expect(json.error).toContain("日本語や記号は使えません");
    expect(create).not.toHaveBeenCalled();
  });

  test("[正常系] ドメイン登録成功", async () => {
    vi.spyOn(DomainService, "create").mockResolvedValue({
      success: true,
      data: mockDomain,
      error: null,
    });

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          registry: "kitaqsign",
          period: { unit: "Y", value: 1 },
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(201);
    const json = await res.json() as any;
    expect(json).toMatchObject({ success: true, data: { name: "example.com" } });
  });

  test("[異常系] ドメイン既存（domain_exists）", async () => {
    vi.spyOn(DomainService, "create").mockResolvedValue({
      success: false,
      data: null,
      error: "domain_exists",
    });

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "taken.com",
          registry: "kitaqsign",
          period: { unit: "Y", value: 1 },
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });

  test("[異常系] TLD違反（invalid_tld）", async () => {
    vi.spyOn(DomainService, "create").mockResolvedValue({
      success: false,
      data: null,
      error: "invalid_tld",
    });

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.invalid",
          registry: "kitaqsign",
          period: { unit: "Y", value: 1 },
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(422);
  });

  test("[異常系] period.unitが不正", async () => {
    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          registry: "kitaqsign",
          period: { unit: "D", value: 1 },
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });

  test("[正常系] registry 省略時は TLD から自動判定される（Issue #25）", async () => {
    vi.spyOn(DomainService, "create").mockResolvedValue({
      success: true,
      data: mockDomain,
      error: null,
    });

    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com", // .com → kitaqsign に自動判定
          period: { unit: "Y", value: 1 },
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(201);
  });

  test("[異常系] TLD が判定不能な名前 → 400", async () => {
    const res = await createDomainRouteHandler.request(
      "/api/v1/secure/domains",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "invalid-no-tld", // TLD なし → 判定不能
          period: { unit: "Y", value: 1 },
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });
});

// ─── list ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/secure/domains", () => {
  test("[正常系] 一覧取得", async () => {
    vi.spyOn(DomainService, "list").mockResolvedValue({
      success: true,
      data: [mockDomain],
      error: null,
    });

    const res = await listDomainsRouteHandler.request(
      "/api/v1/secure/domains",
      { method: "GET" },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data).toHaveLength(1);
  });

  test("[正常系] ゼロ件", async () => {
    vi.spyOn(DomainService, "list").mockResolvedValue({
      success: true,
      data: [],
      error: null,
    });

    const res = await listDomainsRouteHandler.request(
      "/api/v1/secure/domains",
      { method: "GET" },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data).toHaveLength(0);
  });
});

// ─── info ────────────────────────────────────────────────────────────────────

describe("GET /api/v1/secure/domains/{domain-id}", () => {
  test("[正常系] 詳細取得", async () => {
    vi.spyOn(DomainService, "info").mockResolvedValue({
      success: true,
      data: mockDomainDetail,
      error: null,
    });

    const res = await getDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "GET" },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({ success: true, data: { id: "dom-001" } });
  });

  test("[異常系] 不在または非保有（not_found）", async () => {
    vi.spyOn(DomainService, "info").mockResolvedValue({
      success: false,
      data: null,
      error: "not_found",
    });

    const res = await getDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-999",
      { method: "GET" },
      mockEnv,
    );

    expect(res.status).toBe(404);
  });
});

// ─── renew ───────────────────────────────────────────────────────────────────

describe("POST /api/v1/secure/domains/{domain-id}/renew", () => {
  test("[正常系] 更新成功", async () => {
    vi.spyOn(DomainService, "renew").mockResolvedValue({
      success: true,
      data: { ...mockDomain, expiresAt: "2028-01-01T00:00:00.000Z" },
      error: null,
    });

    const res = await renewDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/renew",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: { unit: "Y", value: 1 } }),
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({ success: true });
  });

  test("[異常系] pendingTransfer中（domain_pending_transfer）", async () => {
    vi.spyOn(DomainService, "renew").mockResolvedValue({
      success: false,
      data: null,
      error: "domain_pending_transfer",
    });

    const res = await renewDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/renew",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: { unit: "Y", value: 1 } }),
      },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });

  test("[異常系] period.valueが範囲外", async () => {
    const res = await renewDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/renew",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: { unit: "Y", value: 11 } }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });
});

// ─── update ──────────────────────────────────────────────────────────────────

describe("PUT /api/v1/secure/domains/{domain-id}", () => {
  test("[正常系] NS更新成功", async () => {
    vi.spyOn(DomainService, "update").mockResolvedValue({
      success: true,
      data: mockDomainDetail,
      error: null,
    });

    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameServers: ["ns1.example.com", "ns2.example.com"] }),
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
  });

  test("[異常系] addStatusesとremStatusesに同じ値を指定", async () => {
    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addStatuses: ["clientTransferProhibited"],
          remStatuses: ["clientTransferProhibited"],
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });

  test("[異常系] operation_prohibited（2304）", async () => {
    vi.spyOn(DomainService, "update").mockResolvedValue({
      success: false,
      data: null,
      error: "operation_prohibited",
    });

    const res = await updateDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addStatuses: ["clientUpdateProhibited"] }),
      },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });
});

// ─── delete ──────────────────────────────────────────────────────────────────

describe("DELETE /api/v1/secure/domains/{domain-id}", () => {
  test("[正常系] 廃止成功 → status=pendingDelete", async () => {
    vi.spyOn(DomainService, "delete").mockResolvedValue({
      success: true,
      data: { ...mockDomain, status: "pendingDelete" },
      error: null,
    });

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({ success: true, data: { status: "pendingDelete" } });
  });

  test("[異常系] clientDeleteProhibited（operation_prohibited）", async () => {
    vi.spyOn(DomainService, "delete").mockResolvedValue({
      success: false,
      data: null,
      error: "operation_prohibited",
    });

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });

  test("[異常系] pendingTransfer中", async () => {
    vi.spyOn(DomainService, "delete").mockResolvedValue({
      success: false,
      data: null,
      error: "domain_pending_transfer",
    });

    const res = await deleteDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001",
      { method: "DELETE" },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });
});

// ─── restore ─────────────────────────────────────────────────────────────────

describe("POST /api/v1/secure/domains/{domain-id}/restore", () => {
  test("[正常系] 復旧成功 → status=ok", async () => {
    vi.spyOn(DomainService, "restore").mockResolvedValue({
      success: true,
      data: { ...mockDomain, status: "ok" },
      error: null,
    });

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({ success: true, data: { status: "ok" } });
  });

  test("[異常系] Grace Period終了（operation_prohibited）", async () => {
    vi.spyOn(DomainService, "restore").mockResolvedValue({
      success: false,
      data: null,
      error: "operation_prohibited",
    });

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });

  test("[異常系] 権限なし（forbidden）", async () => {
    vi.spyOn(DomainService, "restore").mockResolvedValue({
      success: false,
      data: null,
      error: "forbidden",
    });

    const res = await restoreDomainRouteHandler.request(
      "/api/v1/secure/domains/dom-001/restore",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(403);
  });
});
