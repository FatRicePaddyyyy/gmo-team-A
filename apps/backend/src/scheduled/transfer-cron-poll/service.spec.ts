/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TransferStatusRepository } from "../../domains/transfer/repository";
import { UserRepository } from "../../domains/user/repository";
import { RegistryBridge } from "../../lib/bridge";
import type { DBClient } from "../../lib/db";
import { TransferCronPollRepository } from "./repository";
import { runTransferCronPoll } from "./service";

const env = {} as CloudflareBindings;
// repository / bridge をすべてモックしているので実 DBClient は不要。
const db = {} as DBClient;
const now = new Date("2026-08-26T00:00:00.000Z");

beforeEach(() => {
  vi.restoreAllMocks();
  // 既定: 両レジストリともメッセージなし、timeout 対象なし
  vi.spyOn(RegistryBridge, "poll").mockResolvedValue({ success: true, data: null, error: null });
  vi.spyOn(TransferCronPollRepository, "findTimedOutPending").mockResolvedValue({
    success: true,
    data: [],
    error: null,
  });
});

describe("runTransferCronPoll", () => {
  test("[Phase 1] メッセージなしの場合は何も処理せず summary を 0 で返す", async () => {
    const summary = await runTransferCronPoll({ db, env, now });

    expect(summary.reconciled).toBe(0);
    expect(summary.serverApproved).toBe(0);
    expect(summary.expired).toBe(0);
    expect(summary.polled).toEqual({ kitaqsign: 0, kitaqnic: 0 });
  });

  test("[Phase 1] 自レジストラの pending に対する serverApproved メッセージを確定する", async () => {
    const transfer = {
      id: "tr-1",
      domainId: "dom-1",
      registry: "kitaqsign" as const,
      status: "pendingTransfer",
      gainingUserId: "user-gaining",
      gainingRegistrar: null,
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    };
    const domain = {
      id: "dom-1",
      name: "example.jp",
      registry: "kitaqsign" as const,
      status: "pendingTransfer",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      authInfo: "auth",
      ownerUserId: "user-losing",
      autoRenew: false,
    };

    // 1 回目 poll で自ドメインのメッセージ、2 回目以降は空にして drain 終了
    const pollSpy = vi.spyOn(RegistryBridge, "poll");
    pollSpy
      .mockResolvedValueOnce({
        success: true,
        data: {
          id: 100,
          msgType: "transfer",
          payload: { domain: "example.jp", status: "serverApproved" },
          qdate: "2026-08-26T00:00:00Z",
        },
        error: null,
      })
      .mockResolvedValue({ success: true, data: null, error: null });

    vi.spyOn(TransferCronPollRepository, "findPendingTransferByDomainName").mockResolvedValue({
      success: true,
      data: { transfer, domain },
      error: null,
    });
    vi.spyOn(UserRepository, "exists").mockResolvedValue({ success: true, data: true, error: null });
    const commitSpy = vi.spyOn(TransferStatusRepository, "commitApproved").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });
    const ackSpy = vi.spyOn(RegistryBridge, "ackMessage").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const summary = await runTransferCronPoll({ db, env, now });

    expect(commitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId: "tr-1",
        transferStatus: "serverApproved",
        newOwnerUserId: "user-gaining",
      }),
    );
    expect(ackSpy).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 100, registry: "kitaqsign" }),
    );
    expect(summary.polled.kitaqsign).toBe(1);
  });

  test("[Phase 1] 中間ステータスのメッセージは ack せず drain を止める", async () => {
    // レジストリごとに transfer.registry を対応させて mismatch 分岐を通さず、
    // 「中間ステータス → ack しない」だけを検証する。
    const pollSpy = vi.spyOn(RegistryBridge, "poll");
    pollSpy.mockImplementation(async ({ registry }) => ({
      success: true,
      data: {
        id: registry === "kitaqsign" ? 200 : 201,
        msgType: "transfer",
        payload: { domain: `${registry}.example.jp`, status: "pendingTransfer" },
        qdate: "2026-08-26T00:00:00Z",
      },
      error: null,
    }));

    vi.spyOn(TransferCronPollRepository, "findPendingTransferByDomainName").mockImplementation(
      async ({ name }) => ({
        success: true,
        data: {
          transfer: {
            id: `tr-${name}`,
            domainId: `dom-${name}`,
            registry: name.startsWith("kitaqsign") ? "kitaqsign" : "kitaqnic",
            status: "pendingTransfer",
            gainingUserId: "u",
            gainingRegistrar: null,
            createdAt: new Date(),
          },
          domain: {
            id: `dom-${name}`,
            name,
            registry: name.startsWith("kitaqsign") ? "kitaqsign" : "kitaqnic",
            status: "pendingTransfer",
            expiresAt: new Date(),
            createdAt: new Date(),
            authInfo: "a",
            ownerUserId: "o",
            autoRenew: false,
          },
        },
        error: null,
      }),
    );
    const ackSpy = vi.spyOn(RegistryBridge, "ackMessage");

    await runTransferCronPoll({ db, env, now });

    expect(ackSpy).not.toHaveBeenCalled();
  });

  test("[Phase 2] 22 分経過した pending をレジストリ info で serverApproved に確定させる", async () => {
    const stale = {
      transfer: {
        id: "tr-3",
        domainId: "dom-3",
        registry: "kitaqsign" as const,
        status: "pendingTransfer",
        gainingUserId: "user-gaining",
        gainingRegistrar: null,
        createdAt: new Date(now.getTime() - 30 * 60 * 1000),
      },
      domain: {
        id: "dom-3",
        name: "stale.example.jp",
        registry: "kitaqsign" as const,
        status: "pendingTransfer",
        expiresAt: new Date(),
        createdAt: new Date(),
        authInfo: "a",
        ownerUserId: "user-losing",
        autoRenew: false,
      },
    };
    vi.spyOn(TransferCronPollRepository, "findTimedOutPending").mockResolvedValue({
      success: true,
      data: [stale],
      error: null,
    });
    // レジストリ info: pendingTransfer が消えている → serverApproved 相当
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: true,
      data: {
        domain: "stale.example.jp",
        status: ["ok"],
        registrant: "reg",
        contacts: {},
        nameservers: [],
        crDate: "2026-01-01",
        exDate: "2027-01-01",
        rgpStatus: [],
      },
      error: null,
    });
    vi.spyOn(UserRepository, "exists").mockResolvedValue({ success: true, data: true, error: null });
    const commitSpy = vi.spyOn(TransferStatusRepository, "commitApproved").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const summary = await runTransferCronPoll({ db, env, now });

    expect(commitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        transferId: "tr-3",
        transferStatus: "serverApproved",
        newOwnerUserId: "user-gaining",
      }),
    );
    expect(summary.serverApproved).toBe(1);
    expect(summary.reconciled).toBe(1);
  });

  test("[Phase 2] レジストリ info でも pending が残っていれば expired に落とす", async () => {
    const stale = {
      transfer: {
        id: "tr-4",
        domainId: "dom-4",
        registry: "kitaqsign" as const,
        status: "pendingTransfer",
        gainingUserId: "u",
        gainingRegistrar: null,
        createdAt: new Date(now.getTime() - 30 * 60 * 1000),
      },
      domain: {
        id: "dom-4",
        name: "still-pending.example.jp",
        registry: "kitaqsign" as const,
        status: "pendingTransfer",
        expiresAt: new Date(),
        createdAt: new Date(),
        authInfo: "a",
        ownerUserId: "o",
        autoRenew: false,
      },
    };
    vi.spyOn(TransferCronPollRepository, "findTimedOutPending").mockResolvedValue({
      success: true,
      data: [stale],
      error: null,
    });
    vi.spyOn(RegistryBridge, "info").mockResolvedValue({
      success: true,
      data: {
        domain: "still-pending.example.jp",
        status: ["pendingTransfer"],
        registrant: "reg",
        contacts: {},
        nameservers: [],
        crDate: "2026-01-01",
        exDate: "2027-01-01",
        rgpStatus: [],
      },
      error: null,
    });
    const expireSpy = vi.spyOn(TransferStatusRepository, "expireAndReleaseDomain").mockResolvedValue({
      success: true,
      data: undefined,
      error: null,
    });

    const summary = await runTransferCronPoll({ db, env, now });

    expect(expireSpy).toHaveBeenCalledWith(
      expect.objectContaining({ transferId: "tr-4", domainId: "dom-4" }),
    );
    expect(summary.expired).toBe(1);
  });
});
