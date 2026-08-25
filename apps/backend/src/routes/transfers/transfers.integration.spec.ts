/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { requestTransferRouteHandler } from "./post";
import { cancelTransferRouteHandler } from "./[transfer-id]/cancel/post";
import { approveTransferRouteHandler } from "../domains/[domain-id]/transfer/approve/post";
import { rejectTransferRouteHandler } from "../domains/[domain-id]/transfer/reject/post";
import { RegistryBridge } from "../../lib/bridge";
import { DomainRepository } from "../domains/repository";
import { DomainTransferRepository } from "../domains/transfer-repository";
import { TransferRepository } from "./repository";
import { TransferDomainRepository } from "./domain-repository";

// ハンドラー→Service→Repository まで通す結合テスト。
// RegistryBridge と各 Repository をモックして
// ハンドラーが正しい HTTP ステータスとユーザー向けメッセージを返すかを検証する。

const mockEnv = {} as CloudflareBindings;

// テスト時は authMiddleware が通らず ctx.get("userId") === undefined になる。
// ownerUserId / gainingUserId を undefined に合わせることで権限チェックを通過させる。
const mockDomainRow = {
  id: "dom-001",
  name: "example.com",
  registry: "kitaqsign" as const,
  status: "ok",
  expiresAt: new Date("2027-08-25T00:00:00.000Z"),
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
  authInfo: "test-auth",
  ownerUserId: undefined as unknown as string,
};

// gainingUserId は undefined にしない。cancel 権限チェックで userId と比較するため、
// 成功系テストは ctx.get("userId") === undefined と一致させる必要がある。
// ここでは undefined のまま（＝authMiddleware 未通過時の userId）で揃える。
const mockTransferRow = {
  id: "tr-001",
  domainId: "dom-001",
  registry: "kitaqsign" as const,
  status: "pendingTransfer",
  gainingUserId: undefined as unknown as string, // ctx.get("userId") === undefined に合わせる
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
};

beforeEach(() => vi.restoreAllMocks());

// ─── transfer request ─────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/transfers", () => {
  test("[正常系] 移管申請成功 → 202 + pendingTransfer", async () => {
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(TransferDomainRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(TransferRepository, "create").mockResolvedValue({ success: true, data: mockTransferRow, error: null });
    vi.spyOn(RegistryBridge, "transferRequest").mockResolvedValue({
      success: true,
      data: { domain: "example.com", status: "pendingTransfer", gainingRegistrar: "R2", losingRegistrar: "R1" },
      error: null,
    });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", authInfo: "test-auth", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(202);
    const json = await res.json() as { data: { status: string } };
    expect(json.data.status).toBe("pendingTransfer");
  });

  test("[異常系] pendingDelete ドメインは移管不可 → 500 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({
      success: true, data: { ...mockDomainRow, status: "pendingDelete" }, error: null,
    });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", authInfo: "auth", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(500);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("移管できません");
  });

  test("[異常系] authInfo 不一致 → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(RegistryBridge, "transferRequest").mockResolvedValue({ success: false, data: null, error: "authInfo_mismatch" });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", authInfo: "wrong", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("AuthCode");
  });

  test("[異常系] ドメイン不在 → 404 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({ success: true, data: null, error: null });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "notexist.com", authInfo: "auth", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(404);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("見つかりません");
  });

  test("[異常系] authInfo が空 → 400", async () => {
    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", authInfo: "", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(400);
  });
});

// ─── transfer approve ─────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/domains/{id}/transfer/approve", () => {
  test("[正常系] losing 側が承認 → 200", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainTransferRepository, "findByDomainId").mockResolvedValue({
      success: true,
      data: { id: "tr-001", domainId: "dom-001", registry: "kitaqsign" as const, status: "pendingTransfer", gainingUserId: "user-002", createdAt: new Date() },
      error: null,
    });
    vi.spyOn(RegistryBridge, "transferApprove").mockResolvedValue({ success: true, data: {}, error: null });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
  });

  test("[異常系] 非 losing ユーザー → 403 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockDomainRow, ownerUserId: "other-user" }, error: null,
    });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("権限");
  });

  test("[異常系] DB上に transfer レコードが存在しない → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainTransferRepository, "findByDomainId").mockResolvedValue({ success: true, data: null, error: null });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("見つかりません");
  });
});

// ─── transfer reject ──────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/domains/{id}/transfer/reject", () => {
  test("[正常系] reject 成功 → 200（DB 更新を含む）", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: { ...mockDomainRow, status: "pendingTransfer" }, error: null });
    vi.spyOn(DomainTransferRepository, "findByDomainId").mockResolvedValue({ success: true, data: { id: "tr-001", domainId: "dom-001", registry: "kitaqsign" as const, status: "pendingTransfer", gainingUserId: "user-002", createdAt: new Date() }, error: null });
    vi.spyOn(DomainTransferRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(DomainRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "transferReject").mockResolvedValue({ success: true, data: {}, error: null });

    const res = await rejectTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/reject",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    // DomainRepository.updateStatus が "ok" で呼ばれているか確認
    expect(DomainRepository.updateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
  });

  test("[異常系] 非 losing ユーザー → 403 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockDomainRow, ownerUserId: "other-user" }, error: null,
    });

    const res = await rejectTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/reject",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("権限");
  });
});

// ─── transfer cancel ──────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/transfers/{id}/cancel", () => {
  test("[正常系] gaining がキャンセル → 200（DB 更新を含む）", async () => {
    // ctx.get("userId") === undefined に合わせて gainingUserId も undefined にする
    vi.spyOn(TransferRepository, "findById").mockResolvedValue({ success: true, data: mockTransferRow, error: null });
    vi.spyOn(TransferDomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(TransferRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(TransferDomainRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "transferCancel").mockResolvedValue({ success: true, data: {}, error: null });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      mockEnv, // ctx.get("userId") === undefined === mockTransferRow.gainingUserId
    );
    expect(res.status).toBe(200);
    expect(TransferDomainRepository.updateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "ok" }));
    expect(TransferRepository.updateStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "clientCancelled" }));
  });

  test("[異常系] gaining でないユーザー → 403 + ユーザー向けメッセージ", async () => {
    // gainingUserId を明示して、ctx.get("userId")=undefined と不一致にする
    vi.spyOn(TransferRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockTransferRow, gainingUserId: "user-002" }, error: null,
    });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      mockEnv, // userId = undefined ≠ "user-002"
    );
    expect(res.status).toBe(403);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("権限");
  });

  test("[異常系] pendingTransfer 以外はキャンセル不可 → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockTransferRow, status: "clientApproved" }, error: null,
    });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      { ...mockEnv, __userId: "user-002" } as unknown as CloudflareBindings,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("取り消しできません");
  });

  test("[異常系] 移管申請不在 → 404 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferRepository, "findById").mockResolvedValue({ success: true, data: null, error: null });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/notexist/cancel",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(404);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("見つかりません");
  });
});
