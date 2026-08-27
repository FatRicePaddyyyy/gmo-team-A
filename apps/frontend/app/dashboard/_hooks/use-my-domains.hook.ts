"use client";

import { useCallback, useEffect, useState } from "react";
import { $listDomains, type ListDomainsResponse } from "@/clients";
import { callApi } from "@/shared/lib/api-result";

type ListDomainsSuccess = Extract<ListDomainsResponse, { success: true }>;
export type MyDomain = ListDomainsSuccess["data"][number];

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




  return {
    domains,
    // enabled が後から true になる（セッション解決後）ケースを含めて、
    // 初回取得が終わるまでは読み込み中として扱う。
    // useState の初期値では R2 の描画に間に合わず、空状態が1フレーム出てしまう。
    loading: loading || (enabled && !loaded),
    loadError,
    loadUnauthorized,
    refresh,
  };
}
