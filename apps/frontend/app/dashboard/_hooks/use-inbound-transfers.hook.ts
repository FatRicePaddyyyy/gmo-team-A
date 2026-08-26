"use client";

import { useCallback, useEffect, useState } from "react";
import {
  $approveTransfer,
  $listPendingInboundTransfers,
  $rejectTransfer,
  type ListPendingInboundTransfersResponse,
} from "@/clients";
import { callApi } from "@/shared/lib/api-result";
import type { DomainFeedback } from "./use-my-domains.hook";

type InboundSuccess = Extract<
  ListPendingInboundTransfersResponse,
  { success: true }
>;
export type InboundTransfer = InboundSuccess["data"][number];

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
  const [running, setRunning] = useState<RunningTransferAction | null>(null);
  const [feedback, setFeedback] = useState<DomainFeedback | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadUnauthorized(false);
    const result = await callApi<InboundTransfer[]>(
      $listPendingInboundTransfers(),
    );
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
