"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $deleteDomain,
  $getDomain,
  $renewDomain,
  $restoreDomain,
  $updateDomain,
  type GetDomainResponse,
} from "@/clients";
import { callApi } from "@/shared/lib/api-result";
import { TRANSFER_LOCK_STATUS } from "../../_lib/domain-status";

type GetDomainSuccess = Extract<GetDomainResponse, { success: true }>;
export type DomainDetail = GetDomainSuccess["data"];

export interface DetailFeedback {
  tone: "success" | "error";
  message: string;
  unauthorized?: boolean;
  /** どの操作の結果か。押したカードの中に帯を出すために使う */
  source: NonNullable<RunningDetailAction>;
}

/** 実行中の操作。ボタンの「保存中...」表示と二重送信防止に使う */
export type RunningDetailAction =
  | "renew"
  | "delete"
  | "restore"
  | "nameServers"
  | "authInfo"
  | "transferLock"
  | null;

/**
 * ドメイン1件の詳細と、その設定変更（ネームサーバー・AuthCode・移管ロック）。
 *
 * 変更はすべて PUT /secure/domains/:id の部分更新。送るのは変えたい項目だけで、
 * 省いた項目はレジストリ側でも変わらない。
 * 成功したら詳細を取り直す（レジストリ側で statuses や upDate が変わるため）。
 */
export function useDomainDetail(domainId: string, enabled: boolean) {
  const [domain, setDomain] = useState<DomainDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadUnauthorized, setLoadUnauthorized] = useState(false);
  const [running, setRunning] = useState<RunningDetailAction>(null);
  const [feedback, setFeedback] = useState<DetailFeedback | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadUnauthorized(false);
    const result = await callApi<DomainDetail>(
      $getDomain({ param: { "domain-id": domainId } }),
    );
    if (!result.success) {
      // 直前の内容は消さない。再取得の失敗で画面が空になると、
      // 「消えた」のか「取れなかった」のか区別できなくなる。
      setLoadError(result.error);
      setLoadUnauthorized(Boolean(result.unauthorized));
    } else {
      setDomain(result.data);
    }
    setLoaded(true);
    setLoading(false);
  }, [domainId]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  /**
   * PUT の共通処理。
   *
   * レジストリはリクエストを 200 で受理しても、実際には反映しないことがある
   * （Kitaqsign サンドボックスは client 系ステータスを無視する）。
   * HTTP 成功だけで「変更しました」と出すと嘘になるので、取り直した内容が
   * 期待どおりかを `verify` で確かめ、違えば警告として伝える。
   */
  const update = useCallback(
    async (
      kind: NonNullable<RunningDetailAction>,
      body: Parameters<typeof $updateDomain>[0]["json"],
      successMessage: string,
      verify?: (updated: DomainDetail) => boolean,
    ): Promise<boolean> => {
      if (running) return false;
      setRunning(kind);
      setFeedback(null);

      const result = await callApi<DomainDetail>(
        $updateDomain({ param: { "domain-id": domainId }, json: body }),
      );

      if (!result.success) {
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
          source: kind,
        });
        setRunning(null);
        return false;
      }

      // PUT のレスポンスはレジストリから取り直した最新の内容
      const updated = result.data;
      setDomain(updated);
      setLoaded(true);

      if (verify && !verify(updated)) {
        setFeedback({
          tone: "error",
          source: kind,
          message:
            "レジストリが変更を受け付けましたが、まだ反映されていません。時間をおいて「最新にする」で確認してください。反映されない場合はレジストリ側の制限が考えられます。",
        });
        setRunning(null);
        return false;
      }

      setFeedback({ tone: "success", message: successMessage, source: kind });
      setRunning(null);
      return true;
    },
    [domainId, running],
  );

  /**
   * 有効期限の延長。
   *
   * PUT ではなく POST /renew なので update() は通さない。レスポンスは一覧形
   * （詳細フィールドを含まない）なので、詳細を取り直して画面に反映する。
   */
  const renew = useCallback(
    async (years: number): Promise<boolean> => {
      if (running) return false;
      setRunning("renew");
      setFeedback(null);

      const result = await callApi(
        $renewDomain({
          param: { "domain-id": domainId },
          json: { period: { unit: "Y", value: years } },
        }),
      );

      if (!result.success) {
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
          source: "renew",
        });
        setRunning(null);
        return false;
      }

      await refresh();
      setFeedback({
        tone: "success",
        message: `有効期限を ${years} 年延長しました。`,
        source: "renew",
      });
      setRunning(null);
      return true;
    },
    [domainId, refresh, running],
  );

  /**
   * 廃止と復旧。renew と同じく PUT ではないので update() は通さない。
   * どちらも status が変わるので、詳細を取り直してカードの出し分けを更新する。
   */
  const runLifecycle = useCallback(
    async (
      kind: "delete" | "restore",
      successMessage: string,
    ): Promise<boolean> => {
      if (running) return false;
      setRunning(kind);
      setFeedback(null);

      const param = { param: { "domain-id": domainId } };
      const result = await callApi(
        kind === "delete" ? $deleteDomain(param) : $restoreDomain(param),
      );

      if (!result.success) {
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
          source: kind,
        });
        setRunning(null);
        return false;
      }

      await refresh();
      setFeedback({ tone: "success", message: successMessage, source: kind });
      setRunning(null);
      return true;
    },
    [domainId, refresh, running],
  );

  const remove = useCallback(
    () =>
      runLifecycle(
        "delete",
        "このドメインを廃止しました。しばらくの間は復旧できます。",
      ),
    [runLifecycle],
  );

  const restore = useCallback(
    () => runLifecycle("restore", "このドメインを復旧しました。"),
    [runLifecycle],
  );

  const updateNameServers = useCallback(
    (nameServers: string[]) =>
      update(
        "nameServers",
        { nameServers },
        "ネームサーバーを変更しました。反映まで最大で数時間かかることがあります。",
        // 送った集合と一致するか。every だけだと台数を減らしたとき
        // （[ns1, ns2] → [ns1]）に削除が効いていなくても通ってしまう。
        // 並び順はレジストリ側で変わりうるので、集合として比べる。
        (updated) => {
          const after = new Set(updated.nameservers ?? []);
          return (
            after.size === nameServers.length &&
            nameServers.every((ns) => after.has(ns))
          );
        },
      ),
    [update],
  );

  const updateAuthInfo = useCallback(
    (authInfo: string) =>
      update(
        "authInfo",
        { chg: { authInfo } },
        "認証コード（AuthCode）を再発行しました。移管先の事業者にこのコードを伝えてください。",
        // authInfo は info で返ってこない（表示できない値）ので検証しようがない。
        // レジストリが 200 を返したことをもって成功とする。
      ),
    [update],
  );

  const setTransferLock = useCallback(
    (locked: boolean) =>
      update(
        "transferLock",
        locked
          ? { addStatuses: [TRANSFER_LOCK_STATUS] }
          : { remStatuses: [TRANSFER_LOCK_STATUS] },
        locked
          ? "移管ロックをかけました。他社への移管ができなくなります。"
          : "移管ロックを解除しました。他社への移管ができるようになります。",
        (updated) =>
          (updated.statuses ?? []).includes(TRANSFER_LOCK_STATUS) === locked,
      ),
    [update],
  );

  return {
    domain,
    // enabled が後から true になる（セッション解決後）ケースを含めて、
    // 初回取得が終わるまでは読み込み中として扱う。
    loading: loading || (enabled && !loaded),
    loadError,
    loadUnauthorized,
    running,
    feedback,
    refresh,
    renew,
    remove,
    restore,
    updateNameServers,
    updateAuthInfo,
    setTransferLock,
  };
}
