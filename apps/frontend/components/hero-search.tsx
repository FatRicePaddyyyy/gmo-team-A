"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const popularTlds = [".com", ".net", ".jp", ".co.jp", ".org", ".xyz"];

interface HeroSearchProps {
  onSearch?: (query: string) => void;
}

export function HeroSearch({ onSearch }: HeroSearchProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onSearch?.(query.trim());
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

        <form onSubmit={handleSubmit} className="flex gap-2 rounded-xl bg-white p-2 shadow-lg">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ドメイン名を検索！（例：onamae）"
            className="border-0 bg-transparent text-gray-900 placeholder:text-gray-400 focus-visible:ring-0"
          />
          <Button
            type="submit"
            className="shrink-0 px-6 text-white"
            style={{ background: "var(--brand)" }}
          >
            <Search className="mr-1 size-4" />
            検索
          </Button>
        </form>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {popularTlds.map((tld) => (
            <Badge
              key={tld}
              variant="outline"
              className="cursor-pointer border-white/40 bg-white/20 text-white hover:bg-white/30"
              onClick={() => setQuery(tld)}
            >
              {tld}
            </Badge>
          ))}
        </div>
      </div>
    </section>
  );
}
