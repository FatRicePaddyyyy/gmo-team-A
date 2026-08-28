"use client";

import Link from "next/link";
import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/info-hint";
import { GlossaryTerm } from "@/components/glossary-term";
import { GLOSSARY } from "@/shared/lib/glossary";
import type { useMyDomains } from "../_hooks/use-my-domains.hook";
import { FeedbackBanner } from "@/components/feedback-banner";
import { DomainRow } from "../_parts/domain-row";

interface DomainListProps {
  state: ReturnType<typeof useMyDomains>;
}

/**
 * 取得済みドメインの一覧セクション。取得も操作も `useMyDomains` が持つ。
 *
 * 並び替え・絞り込みは置いていない（issue #83 で入れたが外した）。
 * デモで持つドメインは数件で、全部が一画面に収まる。数件しか無い一覧に
 * 絞り込みを付けると、操作の前に「まず絞る」という手順が増えるだけになる。
 * 有効期限が近い順に並べる既定だけ残す。
 */
export function DomainList({ state }: DomainListProps) {
  const { domains, loading, loadError, loadUnauthorized, refresh } = state;

  // 期限が近いものほど手を打つ必要があるので、上に置く。
  const visibleDomains = useMemo(
    () =>
      [...domains].sort(
        (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
      ),
    [domains],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-xl font-bold text-gray-900">
            取得済みのドメイン
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            それぞれのドメインを開くと、期限の延長・
            <GlossaryTerm description={GLOSSARY.nameServer.description}>
              {GLOSSARY.nameServer.term}
            </GlossaryTerm>
            の変更・他の
            <GlossaryTerm
              description={GLOSSARY.registrar.description}
            >
              {GLOSSARY.registrar.term}
            </GlossaryTerm>
            への引き渡し・廃止ができます。
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" />
            {loading ? "読み込み中..." : "最新にする"}
          </Button>
          <InfoHint
            label="「最新にする」で何が更新されるか"
            description="有効期限や状態、他のレジストラからの引き渡し申請の有無を、レジストリに問い合わせて取り直します。放置していると自動で承認されてしまう申請にも、押した時点で気づけます。"
          />
        </div>
      </div>

      {loadError && (
        <FeedbackBanner
              context="detail"
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
              render={<Link href="/" />}
            >
              ドメインを探す
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/transfer" />}
            >
              他のレジストラのドメインをここへ移す
            </Button>
          </div>
        </div>
      )}

      {domains.length > 0 && (
        <>
          <div className="space-y-3">
            {visibleDomains.map((domain) => (
              <DomainRow key={domain.id} domain={domain} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
