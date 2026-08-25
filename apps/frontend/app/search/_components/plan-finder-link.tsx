"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

interface PlanFinderLinkProps {
  className?: string;
}

/**
 * 検索欄の直下に置く、診断（/plan-finder）への導線。
 *
 * 末尾で迷うのは「名前を入れる直前」なので、解説ページではなくここに置く。
 * 検索そのものを止めないよう、ボタンではなくリンクにして主導線を奪わない。
 */
export function PlanFinderLink({ className = "" }: PlanFinderLinkProps) {
  return (
    <div
      className={`rounded-xl border border-[var(--brand)] bg-[var(--brand-light)] px-4 py-3 text-left ${className}`}
    >
      <Link
        href="/plan-finder"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--brand-dark)]"
      >
        <Sparkles className="size-4 shrink-0" aria-hidden="true" />
        <span>
          どの拡張子（末尾）を選べばいいか迷ったら、質問に答えておすすめを見る
        </span>
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
      </Link>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-700">
        4問までの簡単な質問です。答えると、あなたに合う末尾と必要なオプションが分かります。
      </p>
    </div>
  );
}
