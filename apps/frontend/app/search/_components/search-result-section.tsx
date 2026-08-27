"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DomainSearchResult, type DomainResult } from "@/components/domain-search-result";
import { FeedbackBanner } from "@/components/feedback-banner";
import { useCart } from "@/shared/hooks/use-cart.hook";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { DecisionAxes } from "./decision-axes";

interface SearchResultSectionProps {
  query: string | null;
  results: DomainResult[];
  loading: boolean;
  error: string | null;
  /** 空き確認ができなかった理由。メンテナンス中かどうかを書き分けるために使う */
  unavailableReason?: string | null;
  /** 診断（/plan-finder）が勧めた末尾。結果の中で目印を付けるために使う */
  recommendedTld?: string | null;
}

function ResultSkeleton() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 h-6 w-56 animate-pulse rounded bg-gray-200" />
      <ul className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <li
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
            <div className="h-11 w-32 animate-pulse rounded bg-gray-200" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 検索結果まわりの表示。
 * 読み上げの取りこぼしを防ぐため、ライブリージョンは常に DOM に置いたままにする。
 */
export function SearchResultSection({
  query,
  results,
  loading,
  error,
  unavailableReason = null,
  recommendedTld = null,
}: SearchResultSectionProps) {
  const hasSearched = query !== null;
  const { add, has, count } = useCart();
  const { state, setPurpose, update } = useProgress();

  return (
    <>
      {error && (
        <div className="mx-auto max-w-4xl px-4 pt-6">
          <FeedbackBanner
              context="search" tone="error" message={error} />
        </div>
      )}

      <section id="search-results" aria-label="検索結果" aria-live="polite" aria-busy={loading}>
        {/* 状況を必ず1文で読み上げる（視覚的にはスケルトン／結果本体で伝える） */}
        <p className="sr-only">
          {loading
            ? "検索中です"
            : !hasSearched
              ? "まだ検索されていません"
              : error
                ? "検索に失敗しました"
                : `「${query}」の検索結果 ${results.filter((r) => r.available).length}件が取得可能です`}
        </p>

        {loading && <ResultSkeleton />}

        {!loading && !error && hasSearched && (
          <DomainSearchResult
            query={query}
            results={results}
            purpose={state.purpose}
            recommendedTld={recommendedTld}
            unavailableReason={unavailableReason}
            onDeclarePurpose={setPurpose}
            onAddCart={(domain) => {
              add({ name: domain.name, tld: domain.tld });
              // 覚えておくのは検索に戻るための名前だけ。進み具合はカートの中身が持つ
              update({ searchedName: domain.name });
            }}
            isAdded={(domain) => has({ name: domain.name, tld: domain.tld })}
          />
        )}
      </section>

      {!loading && !error && hasSearched && (
        <DecisionAxes query={query} results={results} purpose={state.purpose} />
      )}

      {/* カートに入れたら、次の一手を必ず画面上に出す */}
      {count > 0 && (
        <div className="mx-auto max-w-4xl px-4 pb-8">
          <div className="flex flex-col items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-4 shadow-sm sm:flex-row">
            <p className="text-sm text-gray-800">
              カートに<span className="font-bold">{count}件</span>のドメインが入っています。
              次の画面で内容を確認できます（まだ課金されません）。
            </p>
            <Button
              className="h-11 w-full shrink-0 px-5 text-white sm:w-auto"
              style={{ background: "var(--brand)" }}
              nativeButton={false}
              render={<Link href="/cart" />}
            >
              内容を確認する
              <ArrowRight className="ml-1 size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
