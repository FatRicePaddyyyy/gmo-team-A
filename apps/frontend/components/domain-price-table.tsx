"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart } from "lucide-react";

export interface TldPrice {
  tld: string;
  newPrice: string;
  renewalPrice: string;
  popular?: boolean;
  sale?: boolean;
}

interface DomainPriceTableProps {
  prices: TldPrice[];
  onSelect?: (tld: string) => void;
}

export function DomainPriceTable({ prices, onSelect }: DomainPriceTableProps) {
  return (
    <section className="bg-gray-50 py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">おすすめドメイン</h2>
        <p className="mb-8 text-center text-sm text-gray-500">
          それぞれお1人様1個限り特別価格で登録できます
        </p>

        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">TLDごとの新規登録料金と更新料金</caption>
            <thead>
              <tr className="border-b border-border" style={{ background: "var(--brand)" }}>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-white">
                  ドメイン
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-white">
                  新規登録（1年）
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-white">
                  更新（1年）
                </th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {prices.map((row, i) => (
                <tr
                  key={row.tld}
                  className={`border-b border-border transition-colors last:border-0 hover:bg-red-50 ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                  }`}
                >
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold" style={{ color: "var(--brand)" }}>
                        {row.tld}
                      </span>
                      {row.popular && (
                        <Badge className="bg-orange-500 text-xs text-white">人気</Badge>
                      )}
                      {row.sale && (
                        <Badge className="bg-yellow-400 text-xs text-gray-900">SALE</Badge>
                      )}
                    </div>
                  </th>
                  <td className="px-4 py-3 text-right">
                    <span className="text-lg font-bold" style={{ color: "var(--brand)" }}>
                      {row.newPrice}
                    </span>
                    <span className="text-xs text-gray-600">円〜/年</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">
                    {row.renewalPrice}
                    <span className="text-xs text-gray-600">円/年</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      className="h-11 min-w-11 px-4 text-white"
                      style={{ background: "var(--brand)" }}
                      onClick={() => onSelect?.(row.tld)}
                    >
                      <ShoppingCart className="mr-1 size-4" aria-hidden="true" />
                      <span>
                        選択<span className="sr-only">（{row.tld}）</span>
                      </span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
