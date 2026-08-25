"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSearch } from "@/components/hero-search";
import { CheckoutStepper } from "@/components/checkout-stepper";
import { PlanFinderLink } from "./_components/plan-finder-link";
import { SearchResultSection } from "./_components/search-result-section";
import { useDomainSearch } from "./_hooks/use-domain-search.hook";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { buildFlowSteps } from "@/shared/lib/progress-store";
import { stripKnownTld } from "@/shared/lib/tld-catalog";

export default function SearchPage() {
  const { query, results, loading, error, search } = useDomainSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState<string | undefined>(undefined);
  // 診断（/plan-finder）から渡ってくるおすすめの末尾。検索するたびに URL が
  // `?q=` だけに書き換わるので、URL ではなくここに持っておく
  const [recommendedTld, setRecommendedTld] = useState<string | null>(null);
  const { update } = useProgress();

  const handleSearch = useCallback(
    (value: string) => {
      // 進捗②「名前を決める」は、実際に検索したときだけ進める
      update({ searchedName: stripKnownTld(value.trim()) || value.trim() });
      void search(value);
    },
    [search, update],
  );

  // トップページからは `/search?q=...` で飛んでくる。
  // useSearchParams はサスペンス境界が要るため、マウント後に location から読む。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRecommendedTld(params.get("rec"));
    const initial = params.get("q")?.trim();
    if (!initial) return;
    setInputValue(initial);
    void search(initial);
  }, [search]);

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />
      <CheckoutStepper steps={buildFlowSteps("select")} />

      <HeroSearch
        onSearch={handleSearch}
        inputRef={searchInputRef}
        initialQuery={inputValue}
        heading="使いたい名前が空いているか、調べてみましょう。"
        description="空き状況と一緒に、その末尾（TLD）が何なのか・いくらかかり続けるのかも表示します。"
        footer={<PlanFinderLink className="mt-4" />}
      />

      <SearchResultSection
        query={query}
        results={results}
        loading={loading}
        error={error}
        recommendedTld={recommendedTld}
      />

      <SiteFooter />
    </div>
  );
}
