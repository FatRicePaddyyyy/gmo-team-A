"use client";

import { useRouter } from "next/navigation";
import { DomainSearchResult, type DomainResult } from "@/components/domain-search-result";
import { FeedbackBanner } from "@/components/feedback-banner";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { saveConfirmedOrder } from "@/shared/lib/order-store";
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
  const router = useRouter();
  const hasSearched = query !== null;
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
                ? error
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
            onProceed={(domain) => {
              // 選んだ1件を購入フローに引き渡す。
              // 「カート」概念は廃止し、選択即遷移。次画面（内容確認）は
              // ここに保存した ConfirmedOrder を読む。
              saveConfirmedOrder({
                items: [{ name: domain.name, tld: domain.tld }],
                purpose: state.purpose,
                confirmedAt: new Date().toISOString(),
              });
              update({ searchedName: domain.name });
              router.push("/cart/complete");
            }}
          />
        )}
      </section>

      {!loading && !error && hasSearched && (
        <DecisionAxes query={query} results={results} purpose={state.purpose} />
      )}
    </>
  );
}
