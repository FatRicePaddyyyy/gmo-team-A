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
  /** セッション切れ。帯にログイン導線を出すため */
  unauthorized?: boolean;
}

/**
 * 実行中の操作。どの行のどの操作かを表示に使う（「更新中...」を出す行の特定）。
 * 同時に走らせられるのは 1 件だけ。
 */
export interface RunningDomainAction {
  domainId: string;
  kind: "renew" | "delete" | "restore";
}

/**
 * 取得済みドメインの一覧と、その行に対する操作（更新・廃止・復旧）をまとめて持つ。
 *
 * 二重送信は `running` で防ぐ。走っている間は全行のボタンを止める
 * （成功のたびに一覧を取り直すので、並行させると取得順で表示が壊れる）。
 * 操作が成功したら一覧を取り直す（レジストリ側で status / expiresAt が変わるため）。
 */
export function useMyDomains(enabled: boolean) {
  const [domains, setDomains] = useState<MyDomain[]>([]);
  const [loading, setLoading] = useState(false);
  // 一度でも取得を終えたか。取得前に空状態が描画されるのを防ぐために見る
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadUnauthorized, setLoadUnauthorized] = useState(false);
  const [running, setRunning] = useState<RunningDomainAction | null>(null);
  const [feedback, setFeedback] = useState<DomainFeedback | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadUnauthorized(false);
    const result = await callApi<MyDomain[]>($listDomains());
    if (!result.success) {
      // 直前の一覧は消さない。消すと「廃止しました」と「まだ取得していません」が同時に出る
      setLoadError(result.error);
      setLoadUnauthorized(Boolean(result.unauthorized));
    } else {
      setDomains(result.data);
    }
    setLoaded(true);
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
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
        });
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
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
        });
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
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
        });
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
    // enabled が後から true になる（セッション解決後）ケースを含めて、
    // 初回取得が終わるまでは読み込み中として扱う。
    // useState の初期値では R2 の描画に間に合わず、空状態が1フレーム出てしまう。
    loading: loading || (enabled && !loaded),
    loadError,
    loadUnauthorized,
    running,
    feedback,
    refresh,
    renew,
    remove,
    restore,
  };
}
