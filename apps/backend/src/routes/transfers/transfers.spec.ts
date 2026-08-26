/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { approveTransferRouteHandler } from "../domains/[domain-id]/transfer/approve/post";
import { rejectTransferRouteHandler } from "../domains/[domain-id]/transfer/reject/post";
import { DomainService } from "../domains/service";
import { cancelTransferRouteHandler } from "./[transfer-id]/cancel/post";
import { requestTransferRouteHandler } from "./post";
import { TransferService } from "./service";

const mockEnv = {} as CloudflareBindings;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── transfer request ────────────────────────────────────────────────────────

describe("POST /api/v1/secure/transfers（移管申請フロー）", () => {
  test("[正常系] 移管申請成功 → 202 + pendingTransfer", async () => {
    vi.spyOn(TransferService, "request").mockResolvedValue({
      success: true,
      data: {
        id: "tr-001",
        domainId: "dom-001",
        registry: "kitaqsign",
        status: "pendingTransfer",
        gainingUserId: "user-002",
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
      },
      error: null,
    });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          authInfo: "s3cr3t-pass",
          registry: "kitaqsign",
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(202);
    const json = await res.json() as any;
    expect(json).toMatchObject({
      success: true,
      data: { status: "pendingTransfer" },
    });
  });

  test("[異常系] authInfo不一致（authInfo_mismatch）→ 409", async () => {
    vi.spyOn(TransferService, "request").mockResolvedValue({
      success: false,
      data: null,
      error: "authInfo_mismatch",
    });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          authInfo: "wrong-pass",
          registry: "kitaqsign",
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });

  test("[異常系] ドメイン不在（domain_not_found）→ 404", async () => {
    vi.spyOn(TransferService, "request").mockResolvedValue({
      success: false,
      data: null,
      error: "domain_not_found",
    });

    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "notexist.com",
          authInfo: "s3cr3t",
          registry: "kitaqsign",
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(404);
  });

  test("[異常系] authInfoが空", async () => {
    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          authInfo: "",
          registry: "kitaqsign",
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });

  test("[異常系] registryが不正", async () => {
    const res = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          authInfo: "s3cr3t",
          registry: "invalid",
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });
});

// ─── transfer approve ────────────────────────────────────────────────────────

describe("POST /api/v1/secure/domains/{domain-id}/transfer/approve（移管承認フロー）", () => {
  test("[正常系] 移管承認成功 → 200（DB更新はQueue consumerが担当）", async () => {
    vi.spyOn(DomainService, "approveTransfer").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json).toMatchObject({ success: true });
  });

  test("[異常系] losing側でない（forbidden）→ 403", async () => {
    vi.spyOn(DomainService, "approveTransfer").mockResolvedValue({
      success: false,
      data: null,
      error: "forbidden",
    });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(403);
  });

  test("[異常系] 移管申請が存在しない（transfer_not_found）→ 409", async () => {
    vi.spyOn(DomainService, "approveTransfer").mockResolvedValue({
      success: false,
      data: null,
      error: "transfer_not_found",
    });

    const res = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });
});

// ─── transfer reject ─────────────────────────────────────────────────────────

describe("POST /api/v1/secure/domains/{domain-id}/transfer/reject（移管拒否フロー）", () => {
  test("[正常系] 移管拒否成功 → 200 + domains.status=ok に戻る", async () => {
    vi.spyOn(DomainService, "rejectTransfer").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const res = await rejectTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/reject",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(200);
    // rejectはservice内でdomains.status="ok"に同期的に戻す
    expect(DomainService.rejectTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ domainId: "dom-001" }),
    );
  });

  test("[異常系] losing側でない（forbidden）→ 403", async () => {
    vi.spyOn(DomainService, "rejectTransfer").mockResolvedValue({
      success: false,
      data: null,
      error: "forbidden",
    });

    const res = await rejectTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/reject",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(403);
  });
});

// ─── transfer cancel ─────────────────────────────────────────────────────────

describe("POST /api/v1/secure/transfers/{transfer-id}/cancel（移管取消フロー）", () => {
  test("[正常系] 移管取消成功 → 200 + clientCancelled", async () => {
    vi.spyOn(TransferService, "cancel").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(200);
  });

  test("[異常系] gaining側でない（forbidden）→ 403", async () => {
    vi.spyOn(TransferService, "cancel").mockResolvedValue({
      success: false,
      data: null,
      error: "forbidden",
    });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(403);
  });

  test("[異常系] pendingTransfer以外は取消不可（transfer_not_cancellable）→ 409", async () => {
    vi.spyOn(TransferService, "cancel").mockResolvedValue({
      success: false,
      data: null,
      error: "transfer_not_cancellable",
    });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-001/cancel",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(409);
  });

  test("[異常系] 移管申請が不在（transfer_not_found）→ 404", async () => {
    vi.spyOn(TransferService, "cancel").mockResolvedValue({
      success: false,
      data: null,
      error: "transfer_not_found",
    });

    const res = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-999/cancel",
      { method: "POST" },
      mockEnv,
    );

    expect(res.status).toBe(404);
  });
});

// ─── フロー統合: check → create → transfer request → approve ──────────────

describe("移管フロー統合テスト（check → create → transfer request → approve）", () => {
  test("gaining側が申請し、losing側が承認する一連のフロー", async () => {
    // 1. gaining: ドメイン移管申請
    vi.spyOn(TransferService, "request").mockResolvedValue({
      success: true,
      data: {
        id: "tr-001",
        domainId: "dom-001",
        registry: "kitaqsign",
        status: "pendingTransfer",
        gainingUserId: "user-002",
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
      },
      error: null,
    });

    const requestRes = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          authInfo: "s3cr3t-pass",
          registry: "kitaqsign",
        }),
      },
      mockEnv,
    );
    expect(requestRes.status).toBe(202);
    const requestJson = await requestRes.json() as any;
    expect(requestJson.data.status).toBe("pendingTransfer");

    // 2. losing: 移管承認（DB更新はQueue consumerが担当）
    vi.spyOn(DomainService, "approveTransfer").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const approveRes = await approveTransferRouteHandler.request(
      "/api/v1/secure/domains/dom-001/transfer/approve",
      { method: "POST" },
      mockEnv,
    );
    expect(approveRes.status).toBe(200);
  });

  test("gaining側が申請し、自分でキャンセルする一連のフロー", async () => {
    // 1. 移管申請
    vi.spyOn(TransferService, "request").mockResolvedValue({
      success: true,
      data: {
        id: "tr-002",
        domainId: "dom-001",
        registry: "kitaqsign",
        status: "pendingTransfer",
        gainingUserId: "user-002",
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
      },
      error: null,
    });

    const requestRes = await requestTransferRouteHandler.request(
      "/api/v1/secure/transfers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "example.com",
          authInfo: "s3cr3t-pass",
          registry: "kitaqsign",
        }),
      },
      mockEnv,
    );
    expect(requestRes.status).toBe(202);

    // 2. gaining: 取消
    vi.spyOn(TransferService, "cancel").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const cancelRes = await cancelTransferRouteHandler.request(
      "/api/v1/secure/transfers/tr-002/cancel",
      { method: "POST" },
      mockEnv,
    );
    expect(cancelRes.status).toBe(200);
  });
});
