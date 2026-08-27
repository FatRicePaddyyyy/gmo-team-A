"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $listInboundTransferHistory,
  type ListInboundTransferHistoryResponse,
} from "@/clients";
import { callApi } from "@/shared/lib/api-result";

type HistorySuccess = Extract<
  ListInboundTransferHistoryResponse,
  { success: true }
>;
export type InboundTransferHistory = HistorySuccess["data"][number];

/**
 * 自分のドメインに来た移管申請のうち、処理が済んだもの。
 *
 * 承認・却下すると受信待ちの一覧からは消える。それだけだと
 * 「誰かが自分のドメインを取ろうとした」記録がどこにも残らず、
 * 身に覚えのない申請が繰り返されていても気づけない。
 *
 * 受信待ちと違って急いで見るものではないので、自動更新はしない。
 * 承認・却下した直後だけ、呼び出し側から取り直す。
 */
export function useInboundTransferHistory(enabled: boolean) {
  const [history, setHistory] = useState<InboundTransferHistory[]>([]);
  const [loading, setLoading] = useState(false);
  // 一度でも取得を終えたか。取得前に空状態が描画されるのを防ぐために見る
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadUnauthorized, setLoadUnauthorized] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadUnauthorized(false);
    const result = await callApi<InboundTransferHistory[]>(
      $listInboundTransferHistory(),
    );
    if (!result.success) {
      // 直前の一覧は消さない（成功メッセージと空状態が同時に出るのを避ける）
      setLoadError(result.error);
      setLoadUnauthorized(Boolean(result.unauthorized));
    } else {
      setHistory(result.data);
    }
    setLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return {
    history,
    // enabled が後から true になる（セッション解決後）ケースを含めて、
    // 初回取得が終わるまでは読み込み中として扱う。
    loading: loading || (enabled && !loaded),
    loadError,
    loadUnauthorized,
    refresh,
  };
}
