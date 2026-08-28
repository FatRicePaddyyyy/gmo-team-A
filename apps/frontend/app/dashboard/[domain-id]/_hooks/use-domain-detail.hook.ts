"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $deleteDomain,
  $getDomain,
  $pollNowTransfer,
  $renewDomain,
  $restoreDomain,
  $updateDomain,
  type GetDomainResponse,
} from "@/clients";
import { callApi } from "@/shared/lib/api-result";

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
  | "locks"
  | null;

/**
 * `add.statuses` / `rem.statuses` に指定できる 5 種類 (Swagger DomainChangeSet.statuses)。
 * server* 系はレジストリのみ設定可、pending* / ok / inactive は自動導出なので、
 * ここではクライアント側で設定・解除できる値だけを扱う。
 */
export const CLIENT_LOCK_STATUSES = [
  "clientHold",
  "clientTransferProhibited",
  "clientUpdateProhibited",
  "clientDeleteProhibited",
  "clientRenewProhibited",
] as const;
export type ClientLockStatus = (typeof CLIENT_LOCK_STATUSES)[number];

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

    // 移管の cron は 1 分周期なので、詳細画面で「最新にする」を押した瞬間に取り直しても
    // レジストリ側の pending / approved 反映が届いていないことが多い。取り直す前に
    // poll-now を叩いて、cron 相当の処理を 1 回走らせてから GET する。
    // backend 側で 10 秒に 1 回に絞られているので、連打してもレジストリには 1 回しか届かない。
    // poll 側が失敗しても取り直しは進める (詳細取得の方が価値が高い)。
    try {
      await callApi($pollNowTransfer());
    } catch {
      // no-op: poll-now は best effort
    }

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
            "レジストリは変更を受け付けましたが、実際には反映されませんでした。このレジストリが未対応の設定である可能性が高く、待っても変わりません。設定が必要な場合はサポートへご連絡ください。",
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

  /**
   * ロック (client*Prohibited / clientHold) の一括更新。
   *
   * 会員 API は「宣言的な最終状態」= target 集合を受け取り、
   * ここで現状 (`domain.statuses`) との差分を addStatuses / remStatuses に分解する。
   * (backend の NS 差分と同じ流儀。宣言→差分の変換は client 側で完結させる)
   *
   * レジストリが受理してもフラグを反映しないケース (実測: 修正前の kitaqsign) を
   * 弾くため、verify で「取り直した statuses が target と一致する」ことを確認する。
   */
  const updateLocks = useCallback(
    async (target: readonly ClientLockStatus[]): Promise<boolean> => {
      if (!domain) return false;
      const targetSet = new Set<ClientLockStatus>(target);
      const currentLocks = new Set<ClientLockStatus>(
        (domain.statuses ?? []).filter((s): s is ClientLockStatus =>
          (CLIENT_LOCK_STATUSES as readonly string[]).includes(s),
        ),
      );
      const addStatuses = [...targetSet].filter((s) => !currentLocks.has(s));
      const remStatuses = [...currentLocks].filter((s) => !targetSet.has(s));
      if (addStatuses.length === 0 && remStatuses.length === 0) {
        // 何も変わらないなら何も送らない (backend が no-op に丸めるが、
        // 「変更しました」の帯を出さないためにここで止める)
        return true;
      }
      return update(
        "locks",
        {
          ...(addStatuses.length > 0 ? { addStatuses } : {}),
          ...(remStatuses.length > 0 ? { remStatuses } : {}),
        },
        "保護設定を更新しました。反映まで少し時間がかかることがあります。",
        (updated) => {
          const after = new Set(
            (updated.statuses ?? []).filter((s) =>
              (CLIENT_LOCK_STATUSES as readonly string[]).includes(s),
            ),
          );
          if (after.size !== targetSet.size) return false;
          for (const t of targetSet) {
            if (!after.has(t)) return false;
          }
          return true;
        },
      );
    },
    [domain, update],
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
    updateLocks,
  };
}
