"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * 絞り込みはドメイン名の検索だけ置く。状態での絞り込みと並び替えは外した
 * （issue #83 で入れたが、数件の一覧では「まず絞る」手順が増えるだけだった）。
 * 並びは有効期限が近い順で固定する。
 *
 * 検索は手元にある一覧に対して行う。バックエンドには問い合わせない。
 * 保有数が数件のうちは取り直す方が遅く、打つたびに通信するのも無駄。
 */
export function DomainList({ state }: DomainListProps) {
  const { domains, loading, loadError, loadUnauthorized, refresh } = state;
  const [nameFilter, setNameFilter] = useState("");

  // 期限が近いものほど手を打つ必要があるので、上に置く。
  const visibleDomains = useMemo(() => {
    const query = nameFilter.trim().toLowerCase();
    return domains
      .filter((domain) => !query || domain.name.toLowerCase().includes(query))
      .sort(
        (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
      );
  }, [domains, nameFilter]);

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
          <Input
            value={nameFilter}
            onChange={(event) => setNameFilter(event.target.value)}
            placeholder="ドメイン名で検索"
            className="h-11 max-w-xs"
            aria-label="ドメイン名で検索"
          />

          {visibleDomains.length === 0 ? (
            // domains.length > 0 の分岐内なので、ここに来るのは検索で0件になったときだけ
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
              「{nameFilter.trim()}」に一致するドメインはありません。
            </p>
          ) : (
            <div className="space-y-3">
              {visibleDomains.map((domain) => (
                <DomainRow key={domain.id} domain={domain} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
