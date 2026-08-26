"use client";

import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { PURPOSE_OPTIONS, purposeLabel, type Purpose } from "@/shared/lib/purpose";

interface PurposePickerProps {
  value: Purpose | null;
  onChange: (value: Purpose | null) => void;
  /** 見出し。検索の直下と検索結果の上で出し分ける */
  heading?: string;
  className?: string;
  /** 診断への導線を出すか。検索欄の直下など、迷いが起きる場所でだけ true にする */
  showQuizLink?: boolean;
}

/**
 * 「だれのドメイン？」を1回だけ聞く。
 *
 * 用途で答えがほぼ全部変わる（.co.jp の可否、Whois 代行の推奨、.jp の適性）ため、
 * ここで一度だけ聞いて以降の提示・警告を自分ごとに変える。強制はしない（スキップ可）。
 *
 * すでに答えが入っているとき（自分で選んだ場合も、`/plan-finder` の診断で決まった場合も）は
 * **質問の形では出さない**。同じことを何度も聞かれると「まだ決まっていない」と受け取られるため、
 * 決まった値を1行で見せて、変えたい人だけが選び直せる形にする。
 */
export function PurposePicker({
  value,
  onChange,
  heading = "だれのドメイン？",
  className = "",
  showQuizLink = false,
}: PurposePickerProps) {
  const selected = PURPOSE_OPTIONS.find((option) => option.value === value);

  // 決まっている場合は「聞く」のをやめて「確認して直せる」形にする
  if (selected) {
    return (
      <section
        aria-labelledby="purpose-heading"
        className={`rounded-xl border border-border bg-white px-4 py-3 text-left shadow-sm ${className}`}
      >
        <h2 id="purpose-heading" className="sr-only">
          {heading}
        </h2>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Check className="size-4 shrink-0 text-green-600" aria-hidden="true" />
          <p className="text-sm text-gray-800">
            用途: <span className="font-bold">{purposeLabel(value)}</span>
          </p>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-gray-600 underline underline-offset-2 hover:text-gray-900"
          >
            変更する
          </button>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{selected.description}</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="purpose-heading"
      className={`rounded-xl border border-border bg-white px-4 py-4 text-left shadow-sm ${className}`}
    >
      <h2 id="purpose-heading" className="text-sm font-bold text-gray-900">
        {heading}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-gray-600">
        1回だけ選ぶと、取れる末尾（TLD）や注意点をあなた向けに絞って表示します。あとから変更できます。
      </p>

      <div role="group" aria-label={heading} className="mt-3 flex flex-wrap gap-2">
        {PURPOSE_OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? null : option.value)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${
                active
                  ? "border-[var(--brand)] bg-[var(--brand-light)] text-[var(--brand-dark)]"
                  : "border-border bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {active && <Check className="size-4" aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-gray-700">
        選ばなくても検索できます。選ぶと「あなたは取得できません」も含めて理由付きで表示されます。
      </p>

      {showQuizLink && (
        <p className="mt-2">
          <Link
            href="/plan-finder"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--brand-dark)] underline underline-offset-2"
          >
            <Sparkles className="size-4 shrink-0" aria-hidden="true" />
            どれを選べばいいか分からない場合は、質問に答えておすすめを見る
          </Link>
        </p>
      )}
    </section>
  );
}
