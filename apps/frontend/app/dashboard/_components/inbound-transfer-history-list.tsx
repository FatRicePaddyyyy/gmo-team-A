"use client";

import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { useInboundTransferHistory } from "../_hooks/use-inbound-transfer-history.hook";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDate } from "@/shared/lib/format-date";

/**
 * 移管申請がどう終わったか。
 *
 * レジストリが返す status をそのまま出しても、何が起きたのか伝わらない。
 * 「自分が決めたのか」「放っておいた結果そうなったのか」まで分かる言葉にする。
 */
const HISTORY_STATUS_LABELS: Record<string, string> = {
  clientApproved: "あなたが承認して引き渡しました",
  clientRejected: "あなたが却下しました",
  serverApproved: "承認されないまま期限が来たため、自動で引き渡されました",
  clientCancelled: "申請した側が取り消しました",
  expired: "期限切れで取り消されました",
};

function historyStatusLabel(status: string): string {
  return HISTORY_STATUS_LABELS[status] ?? status;
}

/** 手元に残ったか、渡ったか。色で一目で分かるようにする */
function isKeptByOwner(status: string): boolean {
  return status === "clientRejected" || status === "clientCancelled" || status === "expired";
}

interface InboundTransferHistoryListProps {
  state: ReturnType<typeof useInboundTransferHistory>;
}

/**
 * 自分のドメインに来た移管申請のうち、処理が済んだもの。
 *
 * 承認・却下すると受信待ちの一覧からは消える。それだけだと
 * 「誰かが自分のドメインを取ろうとした」記録がどこにも残らない。
 *
 * 1 件も無いときは何も出さない。ほとんどの人にとっては常に空なので、
 * 空のセクションが居座ると邪魔になる。
 */
export function InboundTransferHistoryList({
  state,
}: InboundTransferHistoryListProps) {
  const { history, loadError, loadUnauthorized } = state;

  if (history.length === 0 && !loadError) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 font-heading text-xl font-bold text-gray-900">
          <History className="size-5 text-gray-400" aria-hidden="true" />
          過去の移管申請
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          あなたのドメインに対して過去に届いた申請と、その結果です。
          心当たりのない申請が並んでいる場合は、認証コードを設定し直してください。
        </p>
      </div>

      {loadError && (
        <FeedbackBanner
          tone="error"
          message={loadError}
          unauthorized={loadUnauthorized}
        />
      )}

      {history.map((item) => {
        const kept = isKeptByOwner(item.status);
        return (
          <Card key={item.transferId} className="ring-1 ring-gray-200">
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-heading text-base font-semibold text-gray-900">
                  {item.domainName}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  申請日 {formatDate(item.requestedAt)}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  kept
                    ? "bg-gray-100 text-gray-700"
                    : "bg-amber-50 text-amber-900"
                }`}
              >
                {historyStatusLabel(item.status)}
              </span>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
