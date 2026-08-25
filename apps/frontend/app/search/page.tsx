"use client";

import { useCallback, useRef } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSearch } from "@/components/hero-search";
import { LandingSections } from "./_components/landing-sections";
import { SearchResultSection } from "./_components/search-result-section";
import { useDomainSearch } from "./_hooks/use-domain-search.hook";

export default function SearchPage() {
  const { query, results, loading, error, search } = useDomainSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(
    (value: string) => {
      void search(value);
    },
    [search],
  );

  /** 価格表の「選択」は検索フォームへ戻す（勝手に検索を実行しない） */
  const focusSearchInput = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />

      <HeroSearch onSearch={handleSearch} inputRef={searchInputRef} />

      <SearchResultSection query={query} results={results} loading={loading} error={error} />

      <LandingSections onSelectTld={focusSearchInput} />

      <SiteFooter />
    </div>
  );
}
