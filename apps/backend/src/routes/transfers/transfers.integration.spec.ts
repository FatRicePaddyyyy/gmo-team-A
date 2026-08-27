/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TransferStatusRepository } from "../../domains/transfer/repository";
import { RegistryBridge } from "../../lib/bridge";
import { approveTransferRouteHandler } from "../domains/[domain-id]/transfer/approve/post";
import { rejectTransferRouteHandler } from "../domains/[domain-id]/transfer/reject/post";
import { DomainRepository } from "../domains/repository";
import { DomainTransferRepository } from "../domains/transfer-repository";
import { cancelTransferRouteHandler } from "./[transfer-id]/cancel/post";
import { TransferDomainRepository } from "./domain-repository";
import { OutboundTransferRequestRepository } from "./outbound-repository";
import { requestTransferRouteHandler } from "./post";
import { TransferRepository } from "./repository";

// ハンドラー→Service→Repository まで通す結合テスト。
// RegistryBridge と各 Repository をモックして
// ハンドラーが正しい HTTP ステータスとユーザー向けメッセージを返すかを検証する。

const mockEnv = {} as unknown as CloudflareBindings;

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
  autoRenew: false,
};

// gainingUserId は undefined にしない。cancel 権限チェックで userId と比較するため、
// 成功系テストは ctx.get("userId") === undefined と一致させる必要がある。
// ここでは undefined のまま（＝authMiddleware 未通過時の userId）で揃える。
const mockTransferRow = {
  id: "tr-001",
  domainId: "dom-001",
  registry: "kitaqsign" as const,
  status: "pendingTransfer",
  gainingUserId: undefined as unknown as string,
  gainingRegistrar: null, // ctx.get("userId") === undefined に合わせる
  createdAt: new Date("2026-08-25T00:00:00.000Z"),
};

beforeEach(() => {
  vi.restoreAllMocks();
  // 全ケースで hello (supportedTlds) は成功前提。resolveRegistry / DomainService.check が
  // ここに依存する。個別テストで override したければ再度 spyOn し直す。
  vi.spyOn(RegistryBridge, "hello").mockImplementation(async ({ registry }) => ({
    success: true,
    data: {
      registryCode: registry === "kitaqsign" ? "KITAQSIGN" : "KITAQNIC",
      tlds: registry === "kitaqsign" ? ["com", "net"] : ["xyz", "shop", "store", "app", "dev", "io", "org", "info"],
    },
    error: null,
  }));
});

// ─── transfer request ─────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/transfers", () => {
  // request 正常系: userId=undefined (ctx.get 未通過) と owner を区別しないと self_transfer で弾かれる
  const otherOwnerDomain = { ...mockDomainRow, ownerUserId: "other-owner" };

  test("[正常系] 移管申請成功 → 202 + pendingTransfer", async () => {
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({ success: true, data: otherOwnerDomain, error: null });
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
    const json = await res.json() as any;
    expect(json.data.status).toBe("pendingTransfer");
  });

  test("[異常系] pendingDelete ドメインは移管不可 → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({
      success: true, data: { ...otherOwnerDomain, status: "pendingDelete" }, error: null,
    });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", authInfo: "auth", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("移管できません");
  });

  test("[異常系] authInfo 不一致 → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({ success: true, data: otherOwnerDomain, error: null });
    // NB-9 対応で bridge を叩く前に DB insert する順序に変わったので、create も mock する
    vi.spyOn(TransferRepository, "create").mockResolvedValue({ success: true, data: mockTransferRow, error: null });
    vi.spyOn(TransferRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "transferRequest").mockResolvedValue({ success: false, data: null, error: "authInfo_mismatch" });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "example.com", authInfo: "wrong", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("AuthCode");
  });

  test("[異常系] backend にも registry にもドメイン不在 → 404 + ユーザー向けメッセージ", async () => {
    // 新設計: backend DB に無くても outbound として registry に問い合わせる。
    // registry でも見つからなければ registry.transferRequest が domain_not_found を返し、
    // outbound 経路が失敗をそのまま伝搬して 404 になる。
    vi.spyOn(TransferDomainRepository, "findByName").mockResolvedValue({ success: true, data: null, error: null });
    // outbound の DB INSERT は成功、その後 registry で拒否 → rollback
    vi.spyOn(OutboundTransferRequestRepository, "create").mockResolvedValue({
      success: true,
      data: { id: "out-001", domainName: "notexist.com", registry: "kitaqsign", status: "pendingTransfer", gainingUserId: "user", authInfo: "auth", createdAt: new Date() },
      error: null,
    });
    vi.spyOn(OutboundTransferRequestRepository, "updateStatus").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "transferRequest").mockResolvedValue({ success: false, data: null, error: "domain_not_found" });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "notexist.com", authInfo: "auth", registry: "kitaqsign" }) },
      mockEnv,
    );
    expect(res.status).toBe(404);
    const json = await res.json() as any;
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
    vi.spyOn(DomainTransferRepository, "findPendingByDomainId").mockResolvedValue({
      success: true,
      data: { id: "tr-001", domainId: "dom-001", registry: "kitaqsign" as const, status: "pendingTransfer", gainingUserId: "user-002", gainingRegistrar: null, createdAt: new Date() },
      error: null,
    });
    vi.spyOn(RegistryBridge, "transferApprove").mockResolvedValue({ success: true, data: { domain: "example.com", status: "clientApproved", gainingRegistrar: "R2", losingRegistrar: "R1" }, error: null });
    // Bug 対策: approveTransfer が同期的に commitApproved を呼ぶようになったため mock。
    vi.spyOn(TransferStatusRepository, "commitApproved").mockResolvedValue({ success: true, data: undefined, error: null });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    expect(TransferStatusRepository.commitApproved).toHaveBeenCalledWith(
      expect.objectContaining({ transferStatus: "clientApproved", newOwnerUserId: "user-002" }),
    );
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
    const json = await res.json() as any;
    expect(json.error).toContain("権限");
  });

  test("[異常系] DB上に transfer レコードが存在しない → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    vi.spyOn(DomainTransferRepository, "findPendingByDomainId").mockResolvedValue({ success: true, data: null, error: null });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("見つかりません");
  });
});

// ─── transfer reject ──────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/domains/{id}/transfer/reject", () => {
  test("[正常系] reject 成功 → 200（DB 更新を含む）", async () => {
    vi.spyOn(DomainRepository, "findById").mockResolvedValue({ success: true, data: { ...mockDomainRow, status: "pendingTransfer" }, error: null });
    vi.spyOn(DomainTransferRepository, "findPendingByDomainId").mockResolvedValue({ success: true, data: { id: "tr-001", domainId: "dom-001", registry: "kitaqsign" as const, status: "pendingTransfer", gainingUserId: "user-002", gainingRegistrar: null, createdAt: new Date() }, error: null });
    // R2: 2 更新が batch 化された。settleAndReleaseDomain を mock。
    vi.spyOn(TransferStatusRepository, "settleAndReleaseDomain").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "transferReject").mockResolvedValue({ success: true, data: { domain: "example.com", status: "clientApproved", gainingRegistrar: "R2", losingRegistrar: "R1" }, error: null });

    const res = await rejectTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/reject",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(200);
    expect(TransferStatusRepository.settleAndReleaseDomain).toHaveBeenCalledWith(
      expect.objectContaining({ transferStatus: "clientRejected" }),
    );
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
    const json = await res.json() as any;
    expect(json.error).toContain("権限");
  });
});

// ─── transfer cancel ──────────────────────────────────────────────────────────

describe("結合: POST /api/v1/secure/transfers/{id}/cancel", () => {
  test("[正常系] gaining がキャンセル → 200（DB 更新を含む）", async () => {
    // ctx.get("userId") === undefined に合わせて gainingUserId も undefined にする
    vi.spyOn(TransferRepository, "findById").mockResolvedValue({ success: true, data: mockTransferRow, error: null });
    vi.spyOn(TransferDomainRepository, "findById").mockResolvedValue({ success: true, data: mockDomainRow, error: null });
    // R2: 2 更新が batch 化された。settleAndReleaseDomain を mock。
    vi.spyOn(TransferStatusRepository, "settleAndReleaseDomain").mockResolvedValue({ success: true, data: undefined, error: null });
    vi.spyOn(RegistryBridge, "transferCancel").mockResolvedValue({ success: true, data: { domain: "example.com", status: "clientApproved", gainingRegistrar: "R2", losingRegistrar: "R1" }, error: null });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      mockEnv, // ctx.get("userId") === undefined === mockTransferRow.gainingUserId
    );
    expect(res.status).toBe(200);
    expect(TransferStatusRepository.settleAndReleaseDomain).toHaveBeenCalledWith(
      expect.objectContaining({ transferStatus: "clientCancelled" }),
    );
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
    const json = await res.json() as any;
    expect(json.error).toContain("権限");
  });

  test("[異常系] pendingTransfer 以外はキャンセル不可 → 409 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferRepository, "findById").mockResolvedValue({
      success: true, data: { ...mockTransferRow, status: "clientApproved" }, error: null,
    });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(409);
    const json = await res.json() as any;
    expect(json.error).toContain("取り消しできません");
  });

  test("[異常系] 移管申請不在 (inbound/outbound とも無し) → 404 + ユーザー向けメッセージ", async () => {
    vi.spyOn(TransferRepository, "findById").mockResolvedValue({ success: true, data: null, error: null });
    // 新設計: inbound で無ければ outbound を検索。outbound にも無い場合に 404 を返す。
    vi.spyOn(OutboundTransferRequestRepository, "findById").mockResolvedValue({ success: true, data: null, error: null });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/notexist/cancel",
      { method: "POST" },
      mockEnv,
    );
    expect(res.status).toBe(404);
    const json = await res.json() as any;
    expect(json.error).toContain("見つかりません");
  });
});
