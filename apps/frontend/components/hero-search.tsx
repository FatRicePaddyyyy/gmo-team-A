"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { stripKnownTld } from "@/shared/lib/tld-catalog";

const popularTlds = [".com", ".net", ".jp", ".co.jp", ".org", ".xyz"];

interface HeroSearchProps {
  onSearch?: (query: string) => void;
  /** 外から入力欄にフォーカスしたいときに渡す（料金表からの導線など） */
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** 初期値。URL の ?q= から復元するときなどに使う */
  initialQuery?: string;
  /** 見出し。トップと検索ページで出し分けたいときに渡す */
  heading?: React.ReactNode;
  /** 見出しの下の説明文 */
  description?: React.ReactNode;
  /** 検索フォームの直下に置く要素（用途の選択など） */
  footer?: React.ReactNode;
}

const DEFAULT_HEADING = (
  <>
    あなたのドメインを、
    <br className="sm:hidden" />
    <span className="whitespace-nowrap">意味がわかった上で</span>取ろう。
  </>
);

const DEFAULT_DESCRIPTION =
  "ドメイン名を入れると、空き状況と一緒に「そのドメインが何なのか」も表示します。";

export function HeroSearch({
  onSearch,
  inputRef: externalInputRef,
  initialQuery,
  heading = DEFAULT_HEADING,
  description = DEFAULT_DESCRIPTION,
  footer,
}: HeroSearchProps) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const inputId = useId();
  const hintId = useId();
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;

  // URL から遅れて渡ってくる初期値にも追従する
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch?.(query.trim());
  };

  /**
   * TLDプルダウンの選択。入力欄を置き換えるのではなく、末尾のTLDだけを差し替える。
   * 空文字（「すべて」）を選んだときは、既存のTLDを外して選び直せるようにする。
   */
  const handleSelectTld = (tld: string) => {
    const base = stripKnownTld(query.trim());
    setQuery(tld ? `${base}${tld}` : base);
    inputRef.current?.focus();
  };

  /** 現在の入力値の末尾が候補TLDのどれかに一致していれば、プルダウンにも反映する */
  const currentTld = popularTlds.find((tld) => query.toLowerCase().endsWith(tld)) ?? "";

  return (
    <section
      className="relative overflow-hidden py-14 text-white"
      style={{ background: "linear-gradient(135deg, var(--brand) 0%, #a80015 100%)" }}
    >
      <div className="relative mx-auto max-w-3xl px-4 text-center">
        <h1 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">{heading}</h1>
        <p className="mb-8 text-red-100">{description}</p>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl bg-white p-4 text-left shadow-lg"
        >
          <label htmlFor={inputId} className="mb-1 block text-sm font-semibold text-gray-900">
            取得したいドメイン名
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={inputId}
              ref={inputRef}
              type="search"
              name="domain"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-describedby={hintId}
              placeholder="manabi-blog"
              className="h-11 text-gray-900 placeholder:text-gray-400"
            />
            <select
              aria-label="末尾（TLD）を選ぶ"
              value={currentTld}
              onChange={(e) => handleSelectTld(e.target.value)}
              className="h-11 w-full shrink-0 rounded-lg border border-input bg-white px-2.5 text-base text-gray-900 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-28 md:text-sm"
            >
              <option value="">すべて</option>
              {popularTlds.map((tld) => (
                <option key={tld} value={tld}>
                  {tld}
                </option>
              ))}
            </select>
            <Button
              type="submit"
              className="h-11 shrink-0 px-6 text-white"
              style={{ background: "var(--brand)" }}
            >
              <Search className="mr-1 size-4" aria-hidden="true" />
              空き状況を調べる
            </Button>
          </div>
          <p id={hintId} className="mt-2 text-xs leading-relaxed text-gray-600">
            半角英数字とハイフンで入力します。末尾（TLD）は横のプルダウンから選べます（例: manabi-blog）。
          </p>
        </form>

        {footer}
      </div>
    </section>
  );
}
