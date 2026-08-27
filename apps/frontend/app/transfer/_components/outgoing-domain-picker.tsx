"use client";

import Link from "next/link";
import { ChevronRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeedbackBanner } from "@/components/feedback-banner";
import type { useMyDomains } from "../../dashboard/_hooks/use-my-domains.hook";
import { canUpdateSettings } from "../../dashboard/_lib/domain-status";
import { TRANSFER_OUT_ANCHOR } from "../../dashboard/[domain-id]/_components/transfer-out-card";

interface OutgoingDomainPickerProps {
  state: ReturnType<typeof useMyDomains>;
}

/**
 * 「自分のドメインを他社へ渡す」の入口。
 *
 * 渡す操作そのものは各ドメインの詳細ページにある（AuthCode の発行と移管ロックの解除）。
 * ただし、そこへ辿り着くには一覧からドメインを開く必要があり、
 * 「渡したい」と思った人が最初に来るこのページから繋がっていなかった。
 *
 * ここでは自分のドメインを並べて、選んだら詳細ページへ送る。
 */
export function OutgoingDomainPicker({ state }: OutgoingDomainPickerProps) {
  const { domains, loading, loadError, loadUnauthorized } = state;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-heading text-xl font-bold text-gray-900">
          自分のドメインを他社へ渡す
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          いまここで管理しているドメインを、他の事業者へ引っ越します。
          渡したいドメインを選ぶと、必要な手続き（認証コードの発行と移管ロックの解除）ができます。
        </p>
      </div>

      {loadError && (
        <FeedbackBanner
          tone="error"
          message={loadError}
          unauthorized={loadUnauthorized}
        />
      )}

      {loading && domains.length === 0 && (
        <p className="text-sm text-gray-600">ドメインを読み込んでいます...</p>
      )}

      {!loading && !loadError && domains.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">
          渡せるドメインがありません。まだドメインを取得していないか、すべて手続き中です。
        </p>
      )}

      {domains.map((domain) => {
        // 手続き中・廃止済みは、そもそもレジストリが変更を受け付けない
        const ready = canUpdateSettings(domain.status);
        return (
          <Card key={domain.id} className="ring-1 ring-gray-200">
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-heading text-base font-semibold text-gray-900">
                  {domain.name}
                </p>
                {!ready && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500">
                    <Lock className="size-3" aria-hidden="true" />
                    いまは手続き中のため渡せません
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant={ready ? "outline" : "ghost"}
                disabled={!ready}
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/${domain.id}#${TRANSFER_OUT_ANCHOR}`}
                  />
                }
              >
                渡す手続きへ
                <ChevronRight aria-hidden="true" />
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
