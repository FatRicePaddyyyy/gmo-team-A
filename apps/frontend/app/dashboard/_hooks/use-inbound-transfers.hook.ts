"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  $approveTransfer,
  $listPendingInboundTransfers,
  $rejectTransfer,
  type ListPendingInboundTransfersResponse,
} from "@/clients";
import { usePoll } from "@/shared/hooks/use-poll.hook";
import { callApi } from "@/shared/lib/api-result";


type InboundSuccess = Extract<
  ListPendingInboundTransfersResponse,
  { success: true }
>;
export type InboundTransfer = InboundSuccess["data"][number];

/** 承認・却下の結果表示 */
export interface DomainFeedback {
  tone: "success" | "error";
  message: string;
  /** セッション切れ。帯にログイン導線を出すため */
  unauthorized?: boolean;
}

export interface RunningTransferAction {
  domainId: string;
  kind: "approve" | "reject";
}

/**
 * 自分のドメインに来ている移管申請（受信待ち移管）と、その承認・却下。
 *
 * 承認・却下の API はドメイン ID を取るため、対象は必ずこの一覧から選ばせる。
 * どちらの結果でもドメイン一覧の status が変わるので、`onDomainsChanged` で親に知らせる。
 */
export function useInboundTransfers(
  enabled: boolean,
  onDomainsChanged: () => void | Promise<void>,
) {
  const [transfers, setTransfers] = useState<InboundTransfer[]>([]);
  const [loading, setLoading] = useState(false);
  // 一度でも取得を終えたか。取得前に空状態が描画されるのを防ぐために見る
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadUnauthorized, setLoadUnauthorized] = useState(false);
  // セッション切れを掴んだか。自動更新を止める判断に使う
  const [sessionExpired, setSessionExpired] = useState(false);

  // refresh の依存に入れるとポーリングのたびに関数が作り直されるので、ref 経由で読む
  const onDomainsChangedRef = useRef(onDomainsChanged);
  useEffect(() => {
    onDomainsChangedRef.current = onDomainsChanged;
  }, [onDomainsChanged]);
  const [running, setRunning] = useState<RunningTransferAction | null>(null);
  const [feedback, setFeedback] = useState<DomainFeedback | null>(null);

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
    const result = await callApi<InboundTransfer[]>(
      $listPendingInboundTransfers(),
    );
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
      setTransfers((previous) => {
        // 申請が増減したら、ドメイン側の status も動いている。
        // ここで知らせないと「承認カードは消えたのに、一覧はまだ
        // 『承認するか却下するか決めてください』と出す」という食い違いが起きる。
        const changed =
          previous.length !== result.data.length ||
          previous.some(
            (transfer, index) =>
              transfer.transferId !== result.data[index]?.transferId,
          );
        if (changed) void onDomainsChangedRef.current();
        return result.data;
      });
    }
    setLoaded(true);
    if (!silent) setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  // 引き渡しの申請は自分が動かなくても届く。しかも放置すると自動承認されるので、
  // 画面を開いている間は取り直して、届いたことに気づけるようにする。
  //
  // ここは他方（申請中の一覧）と違い、0 件でも止めない。
  // 「まだ 1 件も無い」状態から届くのを待つのが、この一覧の役目だから。
  // セッションが切れたら止める。待っても回復せず、401 を送り続けるだけになる。
  // 承認・却下の実行中も止める。処理の途中で一覧が入れ替わると、
  // 押した対象が画面から消えたり、結果の表示と食い違ったりする。
  usePoll({
    enabled: enabled && !sessionExpired && running === null,
    onTick: () => refresh({ silent: true }),
  });

  const runAction = useCallback(
    async (
      transfer: InboundTransfer,
      kind: RunningTransferAction["kind"],
    ) => {
      if (running) return;
      setRunning({ domainId: transfer.domainId, kind });
      setFeedback(null);

      const param = { param: { "domain-id": transfer.domainId } };
      const result =
        kind === "approve"
          ? await callApi<null>($approveTransfer(param))
          : await callApi<null>($rejectTransfer(param));

      if (!result.success) {
        setFeedback({
          tone: "error",
          message: result.error,
          unauthorized: result.unauthorized,
        });
      } else {
        setFeedback({
          tone: "success",
          message:
            kind === "approve"
              ? `${transfer.domainName} の移管を承認しました。まもなく移管先へ引き渡されます。`
              : `${transfer.domainName} の移管を却下しました。ドメインは引き続きあなたのものです。`,
        });
        await refresh();
        await onDomainsChanged();
      }
      setRunning(null);
    },
    [onDomainsChanged, refresh, running],
  );

  return {
    transfers,
    // enabled が後から true になる（セッション解決後）ケースを含めて、
    // 初回取得が終わるまでは読み込み中として扱う。
    loading: loading || (enabled && !loaded),
    loadError,
    loadUnauthorized,
    running,
    feedback,
    refresh,
    approve: useCallback(
      (transfer: InboundTransfer) => runAction(transfer, "approve"),
      [runAction],
    ),
    reject: useCallback(
      (transfer: InboundTransfer) => runAction(transfer, "reject"),
      [runAction],
    ),
  };
}
