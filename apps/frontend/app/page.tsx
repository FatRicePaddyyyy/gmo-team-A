"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AcquisitionFlow } from "@/components/acquisition-flow";
import { DomainBenefits } from "@/components/domain-benefits";
import { FaqAccordion } from "@/components/faq-accordion";
import { HeroSearch } from "@/components/hero-search";
import { PurposePicker } from "@/components/purpose-picker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TldHighlights } from "@/components/tld-highlights";
import { useCart } from "@/shared/hooks/use-cart.hook";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { FAQS } from "@/shared/lib/learning-content";
import { withReturnTo } from "@/shared/lib/return-to";
import { stripKnownTld } from "@/shared/lib/tld-catalog";

/**
 * トップページ。未ログインでも見られる入口にする。
 *
 * 構成は「検索 → 取ると何ができる → 取得までの流れ → 末尾の違い → FAQ（短く）」。
 * 長い解説は `/learn` に集約し、ここには判断に必要なものだけを置く。
 *
 * 進捗表示は置かない。まだ何も始めていない人に「あと何%」を見せても意味が無く、
 * 保存値から出すと古い値が残って「何もしていないのに 60%」になる。
 * 代わりに、**いまカートに入っている／直前に検索した**という消えていない事実がある人にだけ、
 * 1行の再開リンクを出す。
 */
export default function Home() {
  const router = useRouter();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState<string | undefined>(undefined);
  const { state, setPurpose, update } = useProgress();
  const { count: cartCount } = useCart();

  // 「続きから」はライブな事実だけで出す（カートの中身 → 直前の検索）
  const resume =
    cartCount > 0
      ? { href: "/cart", label: `カートに${cartCount}件あります。内容の確認へ進む` }
      : state.searchedName
        ? {
            href: `/search?q=${encodeURIComponent(state.searchedName)}`,
            label: `「${state.searchedName}」の検索結果を見る`,
          }
        : null;

  const handleSearch = useCallback(
    (value: string) => {
      const name = stripKnownTld(value.trim()) || value.trim();
      update({ searchedName: name });
      router.push(`/search?q=${encodeURIComponent(value)}`);
    },
    [router, update],
  );

  /** 末尾のカードからは、押された末尾を検索欄に入れて入力欄へ戻す */
  const handleSelectTld = useCallback(
    (tld: string) => {
      const base = stripKnownTld((inputValue ?? "").trim()) || "example";
      setInputValue(`${base}${tld}`);

      const input = searchInputRef.current;
      if (!input) return;
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      input.focus();
    },
    [inputValue],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />

      {/* 途中まで進めた人にだけ出す1行。進捗バーもパーセントも出さない */}
      {resume && (
        <div className="border-b border-border bg-[var(--brand-light)]">
          <div className="mx-auto max-w-4xl px-4 py-2">
            <Link
              href={resume.href}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--brand-dark)] underline underline-offset-2"
            >
              続きから: {resume.label}
              <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      <HeroSearch
        onSearch={handleSearch}
        inputRef={searchInputRef}
        initialQuery={inputValue}
        footer={
          <PurposePicker
            value={state.purpose}
            onChange={setPurpose}
            className="mt-4"
            showQuizLink
          />
        }
      />

      <DomainBenefits />

      <AcquisitionFlow id="flow" />

      <TldHighlights id="learn" purpose={state.purpose} onSearchTld={handleSelectTld} />

      {/* FAQ は短く。全文は /learn に置く */}
      <div id="faq" className="scroll-mt-16">
        <FaqAccordion heading="よくある質問" items={FAQS.slice(0, 3)} />
      </div>

      <section className="bg-gray-50 pb-12">
        <div className="mx-auto flex max-w-3xl flex-col justify-center gap-2 px-4 sm:flex-row">
          <Button
            className="h-11 px-5 text-white"
            style={{ background: "var(--brand)" }}
            nativeButton={false}
            render={<Link href="/search" />}
          >
            ドメインを検索する
            <ArrowRight className="ml-1 size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            className="h-11 px-5"
            nativeButton={false}
            render={<Link href={withReturnTo("/learn", "/")} />}
          >
            料金表とくわしい解説を見る
          </Button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
