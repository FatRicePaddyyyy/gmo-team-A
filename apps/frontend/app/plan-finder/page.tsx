"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { readFromParam, resolveReturnTo } from "@/shared/lib/return-to";
import { QuestionStep } from "./_components/question-step";
import { RecommendationCard } from "./_components/recommendation-card";
import { usePlanQuiz } from "./_hooks/use-plan-quiz.hook";

/**
 * 末尾（TLD）とオプションの診断。
 *
 * 初学者が最初に詰まるのは「.com と .jp と .co.jp のどれ？」で、
 * 一覧と解説を並べても選べるようにはならない。答えられる質問（自分の状況）だけを聞いて、
 * 1つの初期値に変換する。
 *
 * ここで確定した用途は `progress-store` に保存するので、`/search` では
 * 「だれのドメイン？」を聞き直さず、そのまま取得可否の判定に使われる。
 */
export default function PlanFinderPage() {
  const router = useRouter();
  const { state, update } = useProgress();
  const { current, questions, stepNumber, result, answer, back, restart } = usePlanQuiz();
  const [from, setFrom] = useState<string | null>(null);

  // useSearchParams はサスペンス境界が要るため、マウント後に location から読む
  useEffect(() => {
    setFrom(readFromParam());
  }, []);

  const returnTo = resolveReturnTo(from, state.searchedName);

  /** 診断結果を持ったまま検索へ。おすすめの末尾は `rec` で渡して結果画面で強調する */
  const goSearch = useCallback(
    (name: string) => {
      const tld = result?.tld;
      const params = new URLSearchParams();
      if (name) {
        update({ searchedName: name });
        params.set("q", name);
      }
      if (tld) params.set("rec", tld);
      router.push(`/search?${params.toString()}`);
    },
    [result?.tld, router, update],
  );

  const answeredCount = questions.filter((question) => question.id !== current?.id).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 pt-6">
        <BackLink href={returnTo.href} label={returnTo.label} />
      </div>

      {current ? (
        <QuestionStep
          question={current}
          stepNumber={stepNumber}
          // 会社を選ぶと質問が1つ増える。まだ分からないうちは最大数で見せない
          totalSteps={Math.max(questions.length, answeredCount + 1)}
          onAnswer={answer}
          onBack={stepNumber > 1 ? back : undefined}
        />
      ) : result ? (
        <RecommendationCard
          result={result}
          defaultName={state.searchedName}
          onSearch={goSearch}
          onRestart={restart}
        />
      ) : null}

      <SiteFooter />
    </div>
  );
}
