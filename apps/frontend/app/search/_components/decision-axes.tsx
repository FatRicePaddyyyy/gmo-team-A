"use client";

import Link from "next/link";
import { ArrowRight, Coins, ShieldCheck, Type } from "lucide-react";
import type { ReactNode } from "react";
import type { DomainResult } from "@/components/domain-search-result";
import {
  checkEligibility,
  findTld,
  formatYen,
  tldAnchorId,
} from "@/shared/lib/tld-catalog";
import type { Purpose } from "@/shared/lib/purpose";
import { searchHref, withReturnTo } from "@/shared/lib/return-to";

interface DecisionAxesProps {
  query: string;
  results: DomainResult[];
  purpose: Purpose | null;
  /**
   * 診断（/plan-finder）が勧めた末尾。
   * 診断を済ませた人にもう一度「診断しよう」と言わないための目印に使う。
   */
  recommendedTld?: string | null;
}

/** 名前の長さから、その場で言えることだけを返す。事実で終わらせず、必ず良し悪しの判断を添える */
function nameAdvice(name: string): string {
  const length = name.length;
  if (length <= 8) {
    return `「${name}」は${length}文字。この長さなら問題ありません。口頭で伝えやすく、打ち間違えも起きにくいです。`;
  }
  if (length <= 12) {
    return `「${name}」は${length}文字。使ううえで困らない長さです。名刺やチラシに載せても読みやすく収まります。`;
  }
  return `「${name}」は${length}文字。長すぎて不利になる側です。口頭で伝えると省略されやすく、入力ミスも増えるので、短い候補も試してみてください。`;
}

/**
 * 検索結果の直下に置く唯一の解説枠。
 *
 * 静的な解説の再放送ではなく、**いま出ている結果の実データ**で3つの判断軸を示す。
 * 長い解説は `/learn` にあるので、ここからは1行リンクだけを出す。
 * そのリンクには `?from=` を付け、解説から**この検索結果にそのまま帰れる**ようにする。
 */
export function DecisionAxes({
  query,
  results,
  purpose,
  recommendedTld = null,
}: DecisionAxesProps) {
  const available = results.filter((result) => result.available);
  if (available.length === 0) return null;

  const allowed = available.filter((result) => {
    const info = findTld(result.tld);
    return info ? checkEligibility(info, purpose).allowed : true;
  });
  const blocked = available.filter((result) => !allowed.includes(result));

  const cheapest = available.reduce<{ tld: string; renewal: number } | null>((best, result) => {
    const info = findTld(result.tld);
    if (!info) return best;
    if (!best || info.renewalPrice < best.renewal) {
      return { tld: info.tld, renewal: info.renewalPrice };
    }
    return best;
  }, null);

  /** 「取得できない末尾がある」で終わらせず、どれのことなのかカードまで飛ばす */
  const eligibilityBody: ReactNode =
    purpose === null ? (
      // この画面に用途を選ぶ操作は無い（選ぶのは診断）。
      // 無い操作を指すと、探して見つからず止まる。診断へ送る。
      <>
        {available.length} 件が空いていますが、全部をあなたが取れるとは限りません。{" "}
        <Link
          href="/plan-finder"
          className="font-bold text-[var(--brand)] underline underline-offset-2"
        >
          4問の診断
        </Link>
        に答えると、取れない末尾とその理由が分かります。
      </>
    ) : blocked.length === 0 ? (
      // 条件で弾かれないなら、次に迷うのは「どれにするか」。
      // 診断を済ませた人には勧めない（同じことを二度やらせない）。
      <>
        いま出ている {available.length} 件は、すべてあなたが取得できます。
        {!recommendedTld && (
          <>
            {" "}
            どれが自分に合うか迷ったら、
            <Link
              href="/plan-finder"
              className="font-bold text-[var(--brand)] underline underline-offset-2"
            >
              4問の診断
            </Link>
            へ。
          </>
        )}
      </>
    ) : (
      <>
        いま出ている {available.length} 件のうち、あなたが取得できるのは {allowed.length} 件です。
        取得条件を満たしていないのは{" "}
        {blocked.map((result, index) => (
          <span key={result.tld}>
            {index > 0 && "・"}
            <Link
              href={`#${tldAnchorId(result.tld)}`}
              className="font-bold text-[var(--brand)] underline underline-offset-2"
            >
              {result.tld}
            </Link>
          </span>
        ))}
        {" "}です（押すと、その行の理由が見られます）。
      </>
    );

  const axes = [
    { icon: ShieldCheck, title: "① 取れる人の条件", body: eligibilityBody },
    {
      icon: Coins,
      title: "② 2年目以降の金額",
      body: cheapest
        ? `2年目に一番安いのは ${cheapest.tld}（${formatYen(cheapest.renewal)}/年・税込）です。初年度0円でも、翌年からは毎年かかります。`
        : "初年度だけでなく、2年目以降の金額まで見て決めてください。",
    },
    { icon: Type, title: "③ 名前の打ちやすさ", body: nameAdvice(query) },
  ];

  return (
    <section
      aria-labelledby="decision-axes-heading"
      className="mx-auto max-w-4xl px-4 pb-8"
    >
      <div className="rounded-xl border border-border bg-white px-4 py-4 shadow-sm">
        <h2 id="decision-axes-heading" className="text-base font-bold text-gray-900">
          この検索結果から選ぶときの3つの判断軸
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {axes.map((axis) => {
            const Icon = axis.icon;
            return (
              <li key={axis.title} className="rounded-lg bg-gray-50 px-3 py-3">
                <p className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                  <Icon className="size-4 shrink-0" style={{ color: "var(--brand)" }} aria-hidden="true" />
                  {axis.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-gray-700">{axis.body}</p>
              </li>
            );
          })}
        </ul>

        {/* 寄り道しても、この検索結果にそのまま帰ってこられるようにする */}
        <Link
          href={withReturnTo("/learn", searchHref(query))}
          className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--brand)] underline underline-offset-2"
        >
          末尾の違いと料金をもっと詳しく
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
