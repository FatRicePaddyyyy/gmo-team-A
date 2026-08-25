"use client";

import { Check, X, ShoppingCart, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export interface DomainResult {
  tld: string;
  name: string;
  available: boolean;
  price: string;
  renewalPrice?: string;
  popular?: boolean;
  sale?: boolean;
}

interface DomainSearchResultProps {
  query: string;
  results: DomainResult[];
  onAddCart?: (domain: DomainResult) => void;
}

export function DomainSearchResult({ query, results, onAddCart }: DomainSearchResultProps) {
  const available = results.filter((r) => r.available);
  const taken = results.filter((r) => !r.available);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h2 className="mb-1 text-xl font-bold text-gray-900">
        「<span style={{ color: "var(--brand)" }}>{query}</span>」の検索結果
      </h2>
      <p className="mb-6 text-sm text-gray-500">
        {results.length === 0
          ? "該当するドメインは見つかりませんでした"
          : `${available.length}件のドメインが取得可能です`}
      </p>

      {/* 空状態 */}
      {results.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-white px-4 py-10 text-center">
          <SearchX className="mx-auto mb-3 size-8 text-gray-400" aria-hidden="true" />
          <p className="mb-1 font-semibold text-gray-900">検索結果がありません</p>
          <p className="text-sm text-gray-500">
            別のドメイン名でお試しください。記号を含まない半角英数字での検索がおすすめです。
          </p>
        </div>
      )}

      {/* 取得可能 */}
      {available.length > 0 && (
        <ul className="mb-6 space-y-2">
          {available.map((result) => (
            <li
              key={result.tld}
              className="flex flex-col gap-3 rounded-lg border border-border bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                  <Check className="size-4" aria-hidden="true" />
                  取得可能
                </span>
                <span className="font-semibold break-all text-gray-900">
                  {result.name}
                  <span style={{ color: "var(--brand)" }}>{result.tld}</span>
                </span>
                <span className="flex gap-1">
                  {result.popular && (
                    <Badge className="bg-orange-500 text-xs text-white">人気</Badge>
                  )}
                  {result.sale && (
                    <Badge className="bg-yellow-400 text-xs text-gray-900">SALE</Badge>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="text-left sm:text-right">
                  <p className="text-lg font-bold" style={{ color: "var(--brand)" }}>
                    {result.price}
                    <span className="text-xs font-normal text-gray-500">/年</span>
                  </p>
                  {result.renewalPrice && (
                    <p className="text-xs text-gray-500">更新 {result.renewalPrice}/年</p>
                  )}
                </div>
                <Button
                  className="h-11 min-w-11 px-4 text-white"
                  style={{ background: "var(--brand)" }}
                  onClick={() => onAddCart?.(result)}
                >
                  <ShoppingCart className="mr-1 size-4" aria-hidden="true" />
                  <span>
                    カートへ
                    <span className="sr-only">
                      （{result.name}
                      {result.tld}）
                    </span>
                  </span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 取得済み */}
      {taken.length > 0 && (
        <>
          <Separator className="mb-4" />
          <p className="mb-3 text-sm font-medium text-gray-600">取得済みのドメイン</p>
          <ul className="space-y-2">
            {taken.map((result) => (
              <li
                key={result.tld}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-gray-50 px-4 py-3"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">
                  <X className="size-4" aria-hidden="true" />
                  取得済み
                </span>
                <span className="font-medium break-all text-gray-600 line-through">
                  {result.name}
                  {result.tld}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
