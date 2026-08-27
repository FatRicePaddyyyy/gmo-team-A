"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/confirm-action";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDate } from "@/shared/lib/format-date";
import type { useTransferRequests } from "../_hooks/use-transfer-requests.hook";
import {
  isApproved,
  isCancellable,
  isFinishedNegative,
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

      {transfers.map((transfer) => {
        const approved = isApproved(transfer.status);
        const negative = isFinishedNegative(transfer.status);
        return (
          <Card
            key={transfer.id}
            className={
              approved
                ? "ring-1 ring-green-300"
                : negative
                  ? "ring-1 ring-gray-300"
                  : "ring-1 ring-gray-200"
            }
          >
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-heading text-base font-semibold text-gray-900">
                    {transfer.domainName}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    申請日 {formatDate(transfer.createdAt)} / レジストリ{" "}
                    {transfer.registry}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={
                    approved
                      ? "bg-green-100 text-green-900"
                      : isPending(transfer.status)
                        ? "bg-amber-100 text-amber-900"
                        : "bg-gray-100 text-gray-700"
                  }
                >
                  {transferStatusLabelOf(transfer.status)}
                </Badge>
              </div>

              {approved && (
                // 承認が確定した = マイドメインに載っているはず。行き先を案内する
                <div
                  className="flex items-start gap-2 rounded-md border border-green-300 bg-green-50 p-2 text-sm text-green-900"
                  role="status"
                >
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      移管が完了しました
                    </p>
                    <p className="mt-0.5 text-xs">
                      {transfer.domainName} は今このアカウントで管理できます。
                    </p>
                    <Link
                      href="/dashboard"
                      className="mt-1 inline-block text-xs font-semibold text-green-900 underline underline-offset-2"
                    >
                      マイドメインで確認する →
                    </Link>
                  </div>
                </div>
              )}

              {isCancellable(transfer.status) &&
                (confirmingId === transfer.id ? (
                  <ConfirmAction
                    question={`${transfer.domainName} の移管申請を取り消しますか？`}
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
        );
      })}
    </section>
  );
}
