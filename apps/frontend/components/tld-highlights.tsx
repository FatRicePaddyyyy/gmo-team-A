"use client";

import { Search, Users, TrendingUp, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LearningNote } from "@/components/learning-note";
import {
  TLD_CATALOG,
  checkEligibility,
  formatYen,
  MISCONCEPTION,
  recommendedTldFor,
} from "@/shared/lib/tld-catalog";
import type { Purpose } from "@/shared/lib/purpose";

interface TldHighlightsProps {
  heading?: string;
  /** 選ばれた用途。おすすめと「取得できません」の出し分けに使う */
  purpose?: Purpose | null;
  /** 押された末尾でそのまま検索する */
  onSearchTld?: (tld: string) => void;
  id?: string;
}

/**
 * 末尾（TLD）の説明をトップページにも置く。
 *
 * 初学者が直感で掴める切り口は「どんな人向けか」と「どれくらい使われているか」。
 * 価格は補足に落とし、ここから直接検索できるようにする。
 */
export function TldHighlights({
  heading = "末尾（.com など）は何が違う？",
  purpose = null,
  onSearchTld,
  id,
}: TldHighlightsProps) {
  const recommended = recommendedTldFor(purpose);

  return (
    <section id={id} className="scroll-mt-16 bg-white py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">{heading}</h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
          ドメインの末尾を <span className="font-semibold">TLD</span>（トップレベルドメイン）と呼びます。
          値段より先に「どんな人向けか」で選ぶと迷いません。
        </p>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TLD_CATALOG.map((info) => {
            const verdict = checkEligibility(info, purpose);
            const isRecommended = purpose !== null && info.tld === recommended;

            return (
              <li key={info.tld}>
                <Card
                  className={`h-full ${
                    isRecommended ? "border-[var(--brand)] ring-2 ring-[var(--brand-light)]" : "border-border"
                  }`}
                >
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xl font-bold" style={{ color: "var(--brand)" }}>
                        {info.tld}
                      </span>
                      {isRecommended && (
                        <Badge
                          className="text-xs text-white"
                          style={{ background: "var(--brand)" }}
                        >
                          あなたにおすすめ
                        </Badge>
                      )}
                      {info.restricted && (
                        <Badge className="bg-amber-500 text-xs text-white">法人のみ</Badge>
                      )}
                    </div>

                    <dl className="space-y-2 text-sm leading-relaxed">
                      <div>
                        <dt className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                          <Users className="size-3.5" aria-hidden="true" />
                          どんな人向け
                        </dt>
                        <dd className="mt-0.5 text-gray-800">{info.audience ?? info.summary}</dd>
                      </div>
                      <div>
                        <dt className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                          <TrendingUp className="size-3.5" aria-hidden="true" />
                          どれくらい使われている
                        </dt>
                        <dd className="mt-0.5 text-gray-800">{info.usage ?? "—"}</dd>
                      </div>
                    </dl>

                    <p className="text-xs text-gray-600">
                      初年度 {formatYen(info.firstYearPrice)} ／ 2年目以降{" "}
                      <span className="font-semibold text-gray-900">
                        {formatYen(info.renewalPrice)}/年
                      </span>
                      （税込）
                    </p>

                    {!verdict.allowed && verdict.reason && (
                      <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-950">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          <span className="font-bold">あなたは取得できません。</span>
                          {verdict.reason}
                        </span>
                      </p>
                    )}

                    <Button
                      variant={verdict.allowed ? "outline" : "ghost"}
                      className="mt-auto h-11 w-full"
                      disabled={!verdict.allowed}
                      onClick={() => onSearchTld?.(info.tld)}
                    >
                      <Search className="mr-1 size-4" aria-hidden="true" />
                      <span>
                        この末尾で検索する<span className="sr-only">（{info.tld}）</span>
                      </span>
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>

        {/* 末尾を選ぶ、まさにその場で出す勘違い1つだけ */}
        <div className="mt-6">
          <LearningNote title={MISCONCEPTION.tld.title} tone="warn">
            <p>{MISCONCEPTION.tld.body}</p>
          </LearningNote>
        </div>
      </div>
    </section>
  );
}
