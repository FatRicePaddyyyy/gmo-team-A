"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $getDomain,
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
}

/** 実行中の操作。ボタンの「保存中...」表示と二重送信防止に使う */
export type RunningDetailAction =
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

  /** PUT の共通処理。成功したら詳細を取り直してからフィードバックを出す */
  const update = useCallback(
    async (
      kind: NonNullable<RunningDetailAction>,
      body: Parameters<typeof $updateDomain>[0]["json"],
      successMessage: string,
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
        });
        setRunning(null);
        return false;
      }

      await refresh();
      setFeedback({ tone: "success", message: successMessage });
      setRunning(null);
      return true;
    },
    [domainId, refresh, running],
  );

  const updateNameServers = useCallback(
    (nameServers: string[]) =>
      update(
        "nameServers",
        { nameServers },
        "ネームサーバーを変更しました。反映まで最大で数時間かかることがあります。",
      ),
    [update],
  );

  const updateAuthInfo = useCallback(
    (authInfo: string) =>
      update(
        "authInfo",
        { chg: { authInfo } },
        "認証コード（AuthCode）を再発行しました。移管先の事業者にこのコードを伝えてください。",
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
    updateNameServers,
    updateAuthInfo,
    setTransferLock,
  };
}
