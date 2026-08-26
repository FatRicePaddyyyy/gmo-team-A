"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  InboundTransfer,
  useInboundTransfers,
} from "../_hooks/use-inbound-transfers.hook";
import { ConfirmAction } from "@/components/confirm-action";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDate } from "@/shared/lib/format-date";

interface InboundTransferListProps {
  state: ReturnType<typeof useInboundTransfers>;
}

/**
 * 自分のドメインに来ている移管申請を承認 / 却下するセクション。
 * 申請が 1 件も無いときは何も出さない（普段は空のセクションが居座らないようにする）。
 */
export function InboundTransferList({ state }: InboundTransferListProps) {
  const { transfers, loadError, running, feedback } = state;
  const [rejecting, setRejecting] = useState<string | null>(null);

  // 読み込み中も出さない。移管申請は普段 0 件なので、読み込み表示を挟むと
  // 「あなたのドメインへの移管申請」が毎回一瞬現れて消えることになる。
  if (transfers.length === 0 && !loadError && !feedback) {
    return null;
  }

  const busy = running !== null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-bold text-gray-900">
          あなたのドメインへの移管申請
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          他社へドメインを渡す手続きです。心当たりがなければ却下してください。
        </p>
      </div>

      {feedback && (
        <FeedbackBanner tone={feedback.tone} message={feedback.message} />
      )}
      {loadError && <FeedbackBanner tone="error" message={loadError} />}

      {transfers.map((transfer: InboundTransfer) => (
        <Card key={transfer.transferId} className="ring-1 ring-amber-200">
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ArrowLeftRight
                className="size-4 shrink-0 text-amber-700"
                aria-hidden="true"
              />
              <span className="font-heading text-base font-semibold text-gray-900">
                {transfer.domainName}
              </span>
              <span className="text-xs text-gray-500">
                申請日 {formatDate(transfer.requestedAt)} / レジストリ{" "}
                {transfer.registry}
              </span>
            </div>

            {rejecting === transfer.transferId ? (
              <ConfirmAction
                question={`${transfer.domainName} の移管を却下しますか？`}
                detail="却下すると申請者へ引き渡されません。あなたが移管を依頼した相手からの申請だった場合は、もう一度申請してもらう必要があります。"
                confirmLabel="却下する"
                running={
                  running?.domainId === transfer.domainId &&
                  running.kind === "reject"
                }
                onConfirm={async () => {
                  // 閉じるのは完了後。先に閉じると「処理中...」が一度も出ない
                  await state.reject(transfer);
                  setRejecting(null);
                }}
                onCancel={() => setRejecting(null)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => void state.approve(transfer)}
                >
                  {running?.domainId === transfer.domainId &&
                  running.kind === "approve"
                    ? "承認中..."
                    : "承認する"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setRejecting(transfer.transferId)}
                >
                  却下する
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
