"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Search } from "lucide-react";

export interface TldPrice {
  tld: string;
  /** 初年度の価格（数字だけ。例: "0", "1,408"） */
  newPrice: string;
  /** 2年目以降の年額（数字だけ） */
  renewalPrice: string;
  popular?: boolean;
  sale?: boolean;
  /** 任意: そのTLDが何なのかの1行説明 */
  summary?: string;
  /** 任意: 取得条件（法人限定など） */
  eligibility?: string;
  /** 任意: 2年目以降の値上がりが大きいときの警告 */
  renewalWarning?: string;
}

interface DomainPriceTableProps {
  prices: TldPrice[];
  /** 押された TLD を検索フォームへ反映する */
  onSelect?: (tld: string) => void;
}

export function DomainPriceTable({ prices, onSelect }: DomainPriceTableProps) {
  return (
    <section className="bg-gray-50 py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">末尾（TLD）別の料金</h2>
        <p className="mb-8 text-center text-sm text-gray-600">
          初年度だけ安い末尾があります。2年目以降の金額まで見てから決めてください。
          <br />
          初年度の特別価格は、お1人様1個限りです（表示はすべて税込）。
        </p>

        {/* モバイルは横スクロールなしで比べられるようカードに切り替える */}
        <ul className="space-y-3 md:hidden">
          {prices.map((row) => (
            <li
              key={row.tld}
              className="rounded-xl border border-border bg-white px-4 py-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold" style={{ color: "var(--brand)" }}>
                  {row.tld}
                </span>
                {row.popular && <Badge className="bg-orange-500 text-xs text-white">人気</Badge>}
                {row.eligibility && (
                  <Badge className="bg-amber-500 text-xs text-white">条件あり</Badge>
                )}
              </div>

              {row.summary && (
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{row.summary}</p>
              )}

              <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <dt className="text-gray-600">初年度（税込）</dt>
                <dd className="text-right font-bold" style={{ color: "var(--brand)" }}>
                  {row.newPrice}
                  <span className="text-xs font-normal text-gray-600">円/年</span>
                </dd>
                <dt className="text-gray-600">2年目以降（税込）</dt>
                <dd className="text-right font-bold text-gray-900">
                  {row.renewalPrice}
                  <span className="text-xs font-normal text-gray-600">円/年</span>
                </dd>
              </dl>

              {row.renewalWarning && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  {row.renewalWarning}
                </p>
              )}

              {row.eligibility && (
                <p className="mt-2 flex items-start gap-1 text-xs leading-relaxed text-amber-900">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  取得できる人: {row.eligibility}
                </p>
              )}

              <Button
                variant="outline"
                className="mt-3 h-11 w-full"
                onClick={() => onSelect?.(row.tld)}
              >
                <Search className="mr-1 size-4" aria-hidden="true" />
                <span>
                  この末尾で検索する<span className="sr-only">（{row.tld}）</span>
                </span>
              </Button>
            </li>
          ))}
        </ul>

        <div className="hidden overflow-x-auto rounded-xl border border-border bg-white shadow-sm md:block">
          <table className="w-full text-sm">
            <caption className="sr-only">
              TLDごとの初年度価格と2年目以降の年額（税込）
            </caption>
            <thead>
              <tr className="border-b border-border" style={{ background: "var(--brand)" }}>
                <th scope="col" className="px-4 py-3 text-left font-semibold text-white">
                  ドメインの末尾
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-white">
                  初年度（税込）
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold text-white">
                  2年目以降（税込）
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold" style={{ color: "var(--brand)" }}>
                        {row.tld}
                      </span>
                      {row.popular && (
                        <Badge className="bg-orange-500 text-xs text-white">人気</Badge>
                      )}
                      {row.eligibility && (
                        <Badge className="bg-amber-500 text-xs text-white">条件あり</Badge>
                      )}
                    </div>
                    {row.summary && (
                      <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-600">
                        {row.summary}
                      </p>
                    )}
                    {row.eligibility && (
                      <p className="mt-1 flex max-w-xs items-start gap-1 text-xs leading-relaxed text-amber-900">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        取得できる人: {row.eligibility}
                      </p>
                    )}
                  </th>
                  {/* 初年度と2年目以降を同じ大きさ・太さで並べる */}
                  <td className="px-4 py-3 text-right align-top">
                    <span className="text-base font-bold" style={{ color: "var(--brand)" }}>
                      {row.newPrice}
                    </span>
                    <span className="text-xs text-gray-600">円/年</span>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <span className="text-base font-bold text-gray-900">{row.renewalPrice}</span>
                    <span className="text-xs text-gray-600">円/年</span>
                    {row.renewalWarning && (
                      <p className="mt-1 text-xs font-medium text-amber-900">
                        {row.renewalWarning}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    <Button
                      variant="outline"
                      className="h-11 min-w-11 px-4"
                      onClick={() => onSelect?.(row.tld)}
                    >
                      <Search className="mr-1 size-4" aria-hidden="true" />
                      <span>
                        この末尾で検索する<span className="sr-only">（{row.tld}）</span>
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
