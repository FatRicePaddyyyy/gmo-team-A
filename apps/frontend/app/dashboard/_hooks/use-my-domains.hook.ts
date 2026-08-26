"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $deleteDomain,
  $listDomains,
  $renewDomain,
  $restoreDomain,
  type ListDomainsResponse,
} from "@/clients";
import { callApi } from "@/shared/lib/api-result";

type ListDomainsSuccess = Extract<ListDomainsResponse, { success: true }>;
export type MyDomain = ListDomainsSuccess["data"][number];

export type RenewPeriodUnit = "Y" | "M";

export interface DomainFeedback {
  tone: "success" | "error";
  message: string;
}

/** 実行中の操作。`domainId` 単位で持つので、他の行のボタンは押せたままにできる */
export interface RunningDomainAction {
  domainId: string;
  kind: "renew" | "delete" | "restore";
}

/**
 * 取得済みドメインの一覧と、その行に対する操作（更新・廃止・復旧）をまとめて持つ。
 *
 * 二重送信は `running` で防ぐ。ボタン側は `running` が自分の行を指している間 disabled にする。
 * 操作が成功したら一覧を取り直す（レジストリ側で status / expiresAt が変わるため）。
 */
export function useMyDomains(enabled: boolean) {
  const [domains, setDomains] = useState<MyDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState<RunningDomainAction | null>(null);
  const [feedback, setFeedback] = useState<DomainFeedback | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await callApi<MyDomain[]>($listDomains());
    if (!result.success) {
      setLoadError(result.error);
      setDomains([]);
    } else {
      setDomains(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const renew = useCallback(
    async (domain: MyDomain, period: { unit: RenewPeriodUnit; value: number }) => {
      if (running) return;
      setRunning({ domainId: domain.id, kind: "renew" });
      setFeedback(null);
      const result = await callApi<MyDomain>(
        $renewDomain({ param: { "domain-id": domain.id }, json: { period } }),
      );
      if (!result.success) {
        setFeedback({ tone: "error", message: result.error });
      } else {
        setFeedback({
          tone: "success",
          message: `${domain.name} の有効期限を延長しました。`,
        });
        await refresh();
      }
      setRunning(null);
    },
    [refresh, running],
  );

  const remove = useCallback(
    async (domain: MyDomain) => {
      if (running) return;
      setRunning({ domainId: domain.id, kind: "delete" });
      setFeedback(null);
      const result = await callApi<MyDomain>(
        $deleteDomain({ param: { "domain-id": domain.id } }),
      );
      if (!result.success) {
        setFeedback({ tone: "error", message: result.error });
      } else {
        setFeedback({
          tone: "success",
          message: `${domain.name} を廃止しました。しばらくの間は復旧できます。`,
        });
        await refresh();
      }
      setRunning(null);
    },
    [refresh, running],
  );

  const restore = useCallback(
    async (domain: MyDomain) => {
      if (running) return;
      setRunning({ domainId: domain.id, kind: "restore" });
      setFeedback(null);
      const result = await callApi<MyDomain>(
        $restoreDomain({ param: { "domain-id": domain.id } }),
      );
      if (!result.success) {
        setFeedback({ tone: "error", message: result.error });
      } else {
        setFeedback({
          tone: "success",
          message: `${domain.name} を復旧しました。`,
        });
        await refresh();
      }
      setRunning(null);
    },
    [refresh, running],
  );

  return {
    domains,
    loading,
    loadError,
    running,
    feedback,
    clearFeedback: useCallback(() => setFeedback(null), []),
    refresh,
    renew,
    remove,
    restore,
  };
}
