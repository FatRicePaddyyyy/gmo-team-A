"use client";

import { Check, X, ShoppingCart } from "lucide-react";
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
      <p className="mb-6 text-sm text-gray-500">{available.length}件のドメインが取得可能です</p>

      {/* Available */}
      <div className="mb-6 space-y-2">
        {available.map((result) => (
          <div
            key={result.tld}
            className="flex items-center justify-between rounded-lg border border-border bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <Check className="size-5 text-green-500" />
              <span className="font-semibold text-gray-900">
                {result.name}
                <span style={{ color: "var(--brand)" }}>{result.tld}</span>
              </span>
              <div className="flex gap-1">
                {result.popular && (
                  <Badge className="bg-orange-500 text-xs text-white">人気</Badge>
                )}
                {result.sale && (
                  <Badge className="bg-yellow-400 text-xs text-gray-900">SALE</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-lg font-bold" style={{ color: "var(--brand)" }}>
                  {result.price}
                  <span className="text-xs font-normal text-gray-500">/年</span>
                </p>
                {result.renewalPrice && (
                  <p className="text-xs text-gray-400">更新 {result.renewalPrice}/年</p>
                )}
              </div>
              <Button
                size="sm"
                className="text-white"
                style={{ background: "var(--brand)" }}
                onClick={() => onAddCart?.(result)}
              >
                <ShoppingCart className="mr-1 size-3" />
                カートへ
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Taken */}
      {taken.length > 0 && (
        <>
          <Separator className="mb-4" />
          <p className="mb-3 text-sm font-medium text-gray-500">取得済みのドメイン</p>
          <div className="space-y-2">
            {taken.map((result) => (
              <div
                key={result.tld}
                className="flex items-center gap-3 rounded-lg border border-border bg-gray-50 px-4 py-3"
              >
                <X className="size-5 text-gray-400" />
                <span className="font-medium text-gray-400">
                  {result.name}
                  {result.tld}
                </span>
                <Badge variant="outline" className="ml-auto text-xs text-gray-400">
                  取得済み
                </Badge>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
