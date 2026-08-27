"use client";

import { useId, useState } from "react";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LearningNote } from "@/components/learning-note";
import { purposeLabel } from "@/shared/lib/purpose";
import {
  formatYen,
  renewalWarningOf,
  stripKnownTld,
  twoYearTotalOf,
} from "@/shared/lib/tld-catalog";
import type { Recommendation } from "../_lib/recommend";

interface RecommendationCardProps {
  result: Recommendation;
  /** 直前に検索した名前があれば初期値にする */
  defaultName?: string | null;
  /** 名前を確定して検索へ進む。空文字なら名前なしで検索画面を開く */
  onSearch: (name: string) => void;
  onRestart: () => void;
}

/**
 * 診断結果。
 *
 * 「おすすめはこれです」で終わらせず、**その場で名前を入れて検索に進める**ところまでを1枚に置く。
 * 学んだことが行動につながらないと、結局また末尾で迷うため。
 * 価格・説明・取得条件は自前で持たず、必ず TLD カタログの値を表示する。
 */
export function RecommendationCard({
  result,
  defaultName,
  onSearch,
  onRestart,
}: RecommendationCardProps) {
  const [name, setName] = useState(defaultName ?? "");
  const inputId = useId();
  const info = result.info;
  const renewalWarning = info ? renewalWarningOf(info) : undefined;

  return (
    <section aria-labelledby="result-heading" className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-sm font-medium text-gray-600">診断結果</p>
      <h1 id="result-heading" className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
        あなたには{" "}
        <span style={{ color: "var(--brand)" }}>{result.tld}</span> がおすすめです
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        用途は「{purposeLabel(result.purpose)}」として保存しました。この先の画面でも同じ前提で表示します。
      </p>

      {/* おすすめの末尾 */}
      <div className="mt-5 rounded-xl border-2 border-[var(--brand)] bg-white px-4 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold text-gray-900">{result.tld}</span>
          <Badge className="bg-[var(--brand)] text-xs text-white">あなたへのおすすめ</Badge>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-gray-700">{result.reason}</p>

        {info && (
          <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-gray-600">初年度</dt>
              <dd className="font-bold" style={{ color: "var(--brand)" }}>
                {formatYen(info.firstYearPrice)}
                <span className="text-xs font-normal text-gray-600">（税込）</span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-gray-600">2年目以降</dt>
              <dd className="font-bold text-gray-900">
                {formatYen(info.renewalPrice)}
                <span className="text-xs font-normal text-gray-600">/年（税込）</span>
              </dd>
            </div>
          </dl>
        )}

        {info && <p className="mt-1 text-xs text-gray-600">{twoYearTotalOf(info)}</p>}

        {renewalWarning && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            {renewalWarning}
          </p>
        )}

        {info?.eligibility && (
          <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
            <span className="font-semibold">取得できる人: </span>
            {info.eligibility}
          </p>
        )}
      </div>

      {/* おすすめのオプション */}
      <h2 className="mt-8 text-lg font-bold text-gray-900">つけておくとよいオプション</h2>
      <p className="mt-1 text-sm text-gray-600">
        参考としてご案内しています。今回のお申し込みでは設定できません。
      </p>
      <ul className="mt-3 space-y-2">
        {result.options.map((option) => (
          <li
            key={option.id}
            className="rounded-xl border border-border bg-white px-4 py-3 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Check className="size-4 shrink-0 text-green-600" aria-hidden="true" />
              <span className="font-bold text-gray-900">{option.name}</span>
              <Badge className="bg-gray-100 text-xs text-gray-700">{option.price}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-gray-700">{option.summary}</p>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              <span className="font-semibold">あなたに勧める理由: </span>
              {option.reason}
            </p>
          </li>
        ))}
      </ul>

      {/* 次の一手。おすすめの末尾を持ったまま検索へ渡す */}
      <form
        className="mt-8 rounded-xl border border-border bg-white px-4 py-4 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(stripKnownTld(name.trim()));
        }}
      >
        <label htmlFor={inputId} className="text-sm font-bold text-gray-900">
          使いたい名前が空いているか調べる
        </label>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">
          末尾は入力しなくて大丈夫です。検索結果で {result.tld} に印をつけて表示します。
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            id={inputId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例: manabi-domain"
            className="h-11"
            autoComplete="off"
          />
          <Button
            type="submit"
            className="h-11 shrink-0 px-5 text-white"
            style={{ background: "var(--brand)" }}
          >
            {result.tld} で検索する
            <ArrowRight className="ml-1 size-4" aria-hidden="true" />
          </Button>
        </div>
      </form>

      <LearningNote title="おすすめ＝これしか選べない、ではありません">
        <p>
          検索結果には他の末尾も並びます。取得条件を満たしていれば、どれを選んでも構いません。
          迷ったときの初期値として、この診断結果を使ってください。
        </p>
      </LearningNote>

      <Button variant="ghost" className="mt-4 h-11 px-3" onClick={onRestart}>
        <RotateCcw className="mr-1 size-4" aria-hidden="true" />
        もう一度診断する
      </Button>
    </section>
  );
}
