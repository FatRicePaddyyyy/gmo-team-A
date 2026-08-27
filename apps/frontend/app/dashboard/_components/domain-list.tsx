"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useMyDomains } from "../_hooks/use-my-domains.hook";
import { FeedbackBanner } from "@/components/feedback-banner";
import { DomainRow } from "../_parts/domain-row";

interface DomainListProps {
  state: ReturnType<typeof useMyDomains>;
}

/** 取得済みドメインの一覧セクション。取得も操作も `useMyDomains` が持つ */
export function DomainList({ state }: DomainListProps) {
  const { domains, loading, loadError, loadUnauthorized, refresh } = state;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-xl font-bold text-gray-900">
            取得済みのドメイン
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            それぞれのドメインを開くと、期限の延長・ネームサーバーの変更・他社への引き渡し・廃止ができます。
          </p>
        </div>
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

      {loading && domains.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-600">
          ドメインを読み込んでいます...
        </p>
      )}

      {!loading && !loadError && domains.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-700">
            まだドメインを取得していません。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              variant="brand"
              nativeButton={false}
              render={<Link href="/search" />}
            >
              ドメインを探す
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/transfer" />}
            >
              他社のドメインをここへ移す
            </Button>
          </div>
        </div>
      )}

      {domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((domain) => (
            <DomainRow key={domain.id} domain={domain} />
          ))}
        </div>
      )}
    </section>
  );
}
