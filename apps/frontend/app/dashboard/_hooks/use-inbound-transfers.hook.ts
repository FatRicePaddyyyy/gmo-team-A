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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [running, setRunning] = useState<RunningTransferAction | null>(null);
  const [feedback, setFeedback] = useState<DomainFeedback | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await callApi<InboundTransfer[]>(
      $listPendingInboundTransfers(),
    );
    if (!result.success) {
      setLoadError(result.error);
      setTransfers([]);
    } else {
      setTransfers(result.data);
    }
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
        setFeedback({ tone: "error", message: result.error });
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
    loading,
    loadError,
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
