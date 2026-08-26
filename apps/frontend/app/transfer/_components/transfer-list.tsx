"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/confirm-action";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDate } from "@/shared/lib/format-date";
import type { useTransferRequests } from "../_hooks/use-transfer-requests.hook";
import {
  isCancellable,
  isPending,
  transferStatusLabelOf,
} from "../_lib/transfer-status";

interface TransferListProps {
  state: ReturnType<typeof useTransferRequests>;
}

/** 自分が出した移管申請の一覧。承認待ちのものは取り消せる */
export function TransferList({ state }: TransferListProps) {
  const { transfers, loading, loadError, loadUnauthorized, cancellingId, refresh } = state;
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-bold text-gray-900">
          申請中の移管
        </h2>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" />
          {loading ? "読み込み中..." : "最新にする"}
        </Button>
      </div>

      {loadError && (
        <FeedbackBanner
          tone="error"
          message={loadError}
          unauthorized={loadUnauthorized}
        />
      )}

      {loading && transfers.length === 0 && (
        <p className="text-sm text-gray-600">申請を読み込んでいます...</p>
      )}

      {!loading && !loadError && transfers.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">
          まだ移管を申請していません。
        </p>
      )}

      {transfers.map((transfer) => (
        <Card key={transfer.id} className="ring-1 ring-gray-200">
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                {/* バックエンドの一覧はドメイン名を返さない（移管が終わるまで自分のものではないため）。
                    どの申請かを見分けられるよう、対象のIDと申請日を出す。 */}
                <p className="truncate font-mono text-sm text-gray-900">
                  対象ドメインID: {transfer.domainId}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  申請日 {formatDate(transfer.createdAt)} / レジストリ{" "}
                  {transfer.registry}
                </p>
              </div>
              <Badge
                variant="secondary"
                className={
                  isPending(transfer.status)
                    ? "bg-amber-100 text-amber-900"
                    : "bg-gray-100 text-gray-700"
                }
              >
                {transferStatusLabelOf(transfer.status)}
              </Badge>
            </div>

            {isCancellable(transfer.status) &&
              (confirmingId === transfer.id ? (
                <ConfirmAction
                  question="この移管申請を取り消しますか？"
                  detail="取り消すと手続きは最初からやり直しになります。認証コードも取り直しが必要な場合があります。"
                  confirmLabel="取り消す"
                  running={cancellingId === transfer.id}
                  onConfirm={async () => {
                    // 閉じるのは完了後。先に閉じると「処理中...」が一度も出ない
                    await state.cancel(transfer);
                    setConfirmingId(null);
                  }}
                  onCancel={() => setConfirmingId(null)}
                />
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={cancellingId !== null}
                  onClick={() => setConfirmingId(transfer.id)}
                >
                  申請を取り消す
                </Button>
              ))}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
