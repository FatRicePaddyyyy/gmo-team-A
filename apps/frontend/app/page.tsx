"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { HeroSearch } from "@/components/hero-search";
import { CheckoutStepper } from "@/components/checkout-stepper";
import { PlanFinderLink } from "./search/_components/plan-finder-link";
import { SearchResultSection } from "./search/_components/search-result-section";
import { useDomainSearch } from "./search/_hooks/use-domain-search.hook";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { buildFlowSteps } from "@/shared/lib/progress-store";
import { stripKnownTld } from "@/shared/lib/tld-catalog";

const SCROLL_INTENT_KEY = "manabi-domain:search-scroll-intent";

/**
 * トップページ＝ドメイン検索画面。
 *
 * 以前は別に用意していたマーケティング用のランディングページを廃止し、
 * 「ドメインを探す」をそのままトップにした（3画面構成: 探す／学ぶ／マイドメイン）。
 */
export default function Home() {
  const { query, results, loading, error, unavailableReason, search } =
    useDomainSearch();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState<string | undefined>(undefined);
  // 診断（/plan-finder）から渡ってくるおすすめの末尾。検索するたびに URL が
  // `?q=` だけに書き換わるので、URL ではなくここに持っておく
  const [recommendedTld, setRecommendedTld] = useState<string | null>(null);
  const { update } = useProgress();

  // 検索完了時に結果まで自動でスクロールする。ただし「空き状況を調べる」を
  // このページで押したときだけ。他画面から ?q= 付きで飛んできた自動検索では
  // 検索欄の位置のままでよい。
  //
  // このスクロール意図はメモリ上のフラグでは持てない。`router.replace` が
  // このアプリの環境では実行コンテキストを作り直す（実質フルリロードに近い）
  // ため、押した直後の in-memory な ref は search 完了前に失われる。
  // そこで sessionStorage に意図を書いておき、リロード後の初期化 useEffect 側で
  // 読み出す（sessionStorage はリロードをまたいで残る）。
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !loading) {
      let shouldScroll = false;
      try {
        shouldScroll = sessionStorage.getItem(SCROLL_INTENT_KEY) === "1";
        sessionStorage.removeItem(SCROLL_INTENT_KEY);
      } catch {
        // プライベートブラウジング等で読めないことがある。その場合はスクロールしない
      }
      if (shouldScroll) {
        document.getElementById("search-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    wasLoadingRef.current = loading;
  }, [loading]);

  const handleSearch = useCallback(
    (value: string) => {
      // 進捗②「名前を決める」は、実際に検索したときだけ進める
      update({ searchedName: stripKnownTld(value.trim()) || value.trim() });
      try {
        sessionStorage.setItem(SCROLL_INTENT_KEY, "1");
      } catch {
        // 書けなくてもスクロールが起きないだけで、検索自体は続行する
      }
      void search(value);
    },
    [search, update],
  );

  // 他画面から `/?q=...` で飛んでくる（プラン診断のおすすめなど）。
  // useSearchParams はサスペンス境界が要るため、マウント後に location から読む。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRecommendedTld(params.get("rec"));
    const initial = params.get("q")?.trim();
    if (!initial) return;
    setInputValue(initial);
    void search(initial, { syncUrl: false });
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
        unavailableReason={unavailableReason}
        recommendedTld={recommendedTld}
      />

      <SiteFooter />
    </div>
  );
}
