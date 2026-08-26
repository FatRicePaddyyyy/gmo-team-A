"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $cancelTransfer,
  $listTransfers,
  $requestTransfer,
  type ListTransfersResponse,
  type RequestTransferResponse,
} from "@/clients";
import { callApi } from "@/shared/lib/api-result";

type ListSuccess = Extract<ListTransfersResponse, { success: true }>;
export type MyTransfer = ListSuccess["data"][number];

type RequestSuccess = Extract<RequestTransferResponse, { success: true }>;
type RequestedTransfer = RequestSuccess["data"];

export interface TransferFeedback {
  tone: "success" | "error";
  message: string;
  /** セッション切れ。帯にログイン導線を出すため */
  unauthorized?: boolean;
}

/**
 * 他社ドメインの移管申請と、自分が出した申請の取消。
 *
 * 申請はレジストリ側で非同期に進むため、送信直後は `pendingTransfer` のまま一覧に並ぶ。
 * 「送ったのに何も起きない」に見えないよう、送信後は必ず一覧を取り直す。
 */
export function useTransferRequests(enabled: boolean) {
  const [transfers, setTransfers] = useState<MyTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  // 一度でも取得を終えたか。取得前に空状態が描画されるのを防ぐために見る
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadUnauthorized, setLoadUnauthorized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TransferFeedback | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadUnauthorized(false);
    const result = await callApi<MyTransfer[]>($listTransfers());
    if (!result.success) {
      // 直前の一覧は消さない（成功メッセージと空状態が同時に出るのを避ける）
      setLoadError(result.error);
      setLoadUnauthorized(Boolean(result.unauthorized));
    } else {
      setTransfers(result.data);
    }
    setLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  /** 成功したら true を返す。フォームの入力を消してよいかの判断に使う */
  const request = useCallback(
    async (input: { name: string; authInfo: string }): Promise<boolean> => {
      if (submitting) return false;
      setSubmitting(true);
      setFeedback(null);

      // registry はバックエンドが TLD から自動判定するので送らない
      const result = await callApi<RequestedTransfer>(
        $requestTransfer({
          json: {
            name: input.name.trim().toLowerCase(),
            authInfo: input.authInfo.trim(),
          },
        }),
      );

      if (!result.success) {
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
        });
        setSubmitting(false);
        return false;
      }

      setFeedback({
        tone: "success",
        message: `${input.name.trim().toLowerCase()} の移管を申請しました。現在の管理者が承認すると移管が完了します。`,
      });
      await refresh();
      setSubmitting(false);
      return true;
    },
    [refresh, submitting],
  );

  const cancel = useCallback(
    async (transfer: MyTransfer) => {
      if (cancellingId) return;
      setCancellingId(transfer.id);
      setFeedback(null);
      const result = await callApi<null>(
        $cancelTransfer({ param: { "transfer-id": transfer.id } }),
      );
      if (!result.success) {
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
        });
      } else {
        setFeedback({ tone: "success", message: "移管申請を取り消しました。" });
        await refresh();
      }
      setCancellingId(null);
    },
    [cancellingId, refresh],
  );

  return {
    transfers,
    // enabled が後から true になる（セッション解決後）ケースを含めて、
    // 初回取得が終わるまでは読み込み中として扱う。
    loading: loading || (enabled && !loaded),
    loadError,
    loadUnauthorized,
    submitting,
    cancellingId,
    feedback,
    refresh,
    request,
    cancel,
  };
}
