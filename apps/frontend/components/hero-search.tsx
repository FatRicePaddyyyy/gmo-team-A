"use client";

import { useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const popularTlds = [".com", ".net", ".jp", ".co.jp", ".org", ".xyz"];

/**
 * 入力値の末尾についている既知のTLDを取り除いて、ドメイン名の部分だけを返す。
 * 「.com」を押したときに `.com.com` のような値にならないようにするための前処理。
 */
function stripKnownTld(value: string): string {
  const lower = value.toLowerCase();
  // 「.co.jp」が「.jp」より先にマッチするよう、長いものから判定する
  const matched = [...popularTlds]
    .sort((a, b) => b.length - a.length)
    .find((tld) => lower.endsWith(tld));

  if (!matched) return value;
  return value.slice(0, value.length - matched.length);
}

interface HeroSearchProps {
  onSearch?: (query: string) => void;
  /** 外から入力欄にフォーカスしたいときに渡す（価格表からの導線など） */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function HeroSearch({ onSearch, inputRef: externalInputRef }: HeroSearchProps) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const hintId = useId();
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch?.(query.trim());
  };

  /** 人気TLDのチップ。入力欄を置き換えるのではなく、末尾のTLDだけを差し替える */
  const handleSelectTld = (tld: string) => {
    const base = stripKnownTld(query.trim());
    setQuery(base ? `${base}${tld}` : "");
    inputRef.current?.focus();
  };

  return (
    <section
      className="relative overflow-hidden py-16 text-white"
      style={{ background: "linear-gradient(135deg, var(--brand) 0%, #a80015 100%)" }}
    >
      <div className="relative mx-auto max-w-3xl px-4 text-center">
        <h1 className="mb-2 text-3xl font-bold tracking-tight md:text-4xl">
          ドメイン取得は最安値<span className="text-yellow-300">0円</span>〜
        </h1>
        <p className="mb-8 text-red-100">ドメイン取るならお名前.com</p>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 rounded-xl bg-white p-2 shadow-lg sm:flex-row"
        >
          <label htmlFor={inputId} className="sr-only">
            取得したいドメイン名
          </label>
          <Input
            id={inputId}
            ref={inputRef}
            type="search"
            name="domain"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-describedby={hintId}
            placeholder="ドメイン名を検索！（例：onamae）"
            className="h-11 border-0 bg-transparent text-gray-900 placeholder:text-gray-400 focus-visible:ring-0"
          />
          <Button
            type="submit"
            className="h-11 shrink-0 px-6 text-white"
            style={{ background: "var(--brand)" }}
          >
            <Search className="mr-1 size-4" aria-hidden="true" />
            検索
          </Button>
        </form>

        <p id={hintId} className="sr-only">
          ドメイン名を入力して検索してください。下のボタンで人気のTLDを入力欄に反映できます。
        </p>

        <div
          role="group"
          aria-label="人気のTLDを入力欄に反映する"
          className="mt-4 flex flex-wrap justify-center gap-2"
        >
          {popularTlds.map((tld) => (
            <button
              key={tld}
              type="button"
              onClick={() => handleSelectTld(tld)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/40 bg-white/20 px-4 text-xs font-medium text-white transition-colors hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {tld}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
