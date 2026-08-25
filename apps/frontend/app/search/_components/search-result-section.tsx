"use client";

import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DomainSearchResult, type DomainResult } from "@/components/domain-search-result";

interface SearchResultSectionProps {
  query: string | null;
  results: DomainResult[];
  loading: boolean;
  error: string | null;
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
export function SearchResultSection({ query, results, loading, error }: SearchResultSectionProps) {
  const hasSearched = query !== null;

  return (
    <>
      {error && (
        <div className="mx-auto max-w-4xl px-4 pt-6">
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>検索できませんでした</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <section aria-label="検索結果" aria-live="polite" aria-busy={loading}>
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
          <DomainSearchResult query={query} results={results} />
        )}
      </section>
    </>
  );
}
