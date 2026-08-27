"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $cancelTransfer,
  $listTransfers,
  $requestTransfer,
  type ListTransfersResponse,
  type RequestTransferResponse,
} from "@/clients";
import { usePoll } from "@/shared/hooks/use-poll.hook";
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
  // セッション切れを掴んだか。自動更新を止める判断に使う
  const [sessionExpired, setSessionExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TransferFeedback | null>(null);

  /**
   * 一覧を取り直す。
   *
   * `silent` は背後の自動更新から呼ぶときに使う。利用者が何もしていないのに
   * 「読み込み中」がちらついたり、一時的な通信失敗で赤い帯が出たりすると、
   * 画面を眺めているだけの人を驚かせてしまう。
   * 表示中の一覧はそのまま残り、次に成功したときへ静かに差し替わる。
   */
  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
      setLoadError(null);
      setLoadUnauthorized(false);
    }
    const result = await callApi<MyTransfer[]>($listTransfers());
    if (!result.success) {
      // 直前の一覧は消さない（成功メッセージと空状態が同時に出るのを避ける）
      // 自動更新のときはエラーを出さない。次の回で回復することが多く、
      // 利用者が起こした操作でもないので伝える意味が薄い。
      //
      // ただしセッション切れだけは別。待っても回復せず、黙って叩き続けると
      // 401 を無限に送ることになる。自動更新かどうかにかかわらず記録して、
      // ポーリングを止める材料にする。
      if (result.unauthorized) {
        setLoadUnauthorized(true);
        setSessionExpired(true);
      }
      if (!silent) {
        setLoadError(result.error);
      }
    } else {
      setSessionExpired(false);
      setTransfers(result.data);
    }
    setLoaded(true);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  // 申請した移管はレジストリ側で非同期に進む。承認されたか却下されたかを
  // 手で「最新にする」を押さないと知れないのは不便なので、待っている間だけ取り直す。
  // 進行中の申請が無ければ変化しようがないので、そのときは止める。
  const hasPending = transfers.some(
    (transfer) => transfer.status === "pendingTransfer",
  );
  // セッションが切れたら止める。待っても回復せず、401 を送り続けるだけになる。
  // 申請・取消の実行中も止める。処理の途中で一覧が入れ替わると、
  // 押した対象が画面から消えたり、結果の表示と食い違ったりする。
  usePoll({
    enabled:
      enabled && hasPending && !sessionExpired && !submitting && !cancellingId,
    onTick: () => refresh({ silent: true }),
  });

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
        setFeedback({
          tone: "success",
          message: `${transfer.domainName} の移管申請を取り消しました。`,
        });
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
