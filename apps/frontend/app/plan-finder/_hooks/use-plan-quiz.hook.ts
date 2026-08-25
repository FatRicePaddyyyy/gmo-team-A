"use client";

import { useCallback, useMemo, useState } from "react";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import {
  isComplete,
  purposeFromAnswers,
  recommend,
  visibleQuestions,
  type Question,
  type QuestionId,
  type QuizAnswers,
  type Recommendation,
} from "../_lib/recommend";

interface UsePlanQuiz {
  answers: QuizAnswers;
  /** いま出題している質問。すべて答え終わったら undefined */
  current: Question | undefined;
  /** 出題される質問（Q2 は会社を選んだときだけ増える） */
  questions: Question[];
  /** 1 始まり。「2 / 4問目」の表示に使う */
  stepNumber: number;
  finished: boolean;
  result: Recommendation | null;
  answer: (id: QuestionId, value: string) => void;
  back: () => void;
  restart: () => void;
}

/**
 * 診断クイズの進行。
 *
 * 答えの保存先は2つに分けている。クイズ固有の答え（登記の有無・心配ごと）はこの画面の
 * state に持ち、**用途（purpose）だけは `progress-store` に書き込む**。
 * 用途はサービス全体の共有値で、これを入れておくと `/search` で
 * 「だれのドメイン？」を再度聞かれず、.co.jp の取得可否判定にもそのまま効く。
 */
export function usePlanQuiz(): UsePlanQuiz {
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const { setPurpose } = useProgress();

  const questions = useMemo(() => visibleQuestions(answers), [answers]);
  const current = questions.find((question) => answers[question.id] === undefined);
  const finished = isComplete(answers);
  const result = useMemo(() => recommend(answers), [answers]);

  const stepNumber = current
    ? questions.findIndex((question) => question.id === current.id) + 1
    : questions.length;

  const answer = useCallback(
    (id: QuestionId, value: string) => {
      // Q1 を選び直したら、それに依存する Q2 の答えは捨てる（会社以外に変えた場合に残ると矛盾する）
      const next: QuizAnswers =
        id === "scene"
          ? { ...answers, scene: value as QuizAnswers["scene"], registered: undefined }
          : ({ ...answers, [id]: value } as QuizAnswers);

      setAnswers(next);

      // 用途が確定した時点で共有側へ書く。以降の画面で聞き直さないため。
      // 共有ストアの更新は他コンポーネントの再描画を起こすので、
      // setState の更新関数の中（＝レンダー中）ではなくここで呼ぶ。
      const purpose = purposeFromAnswers(next);
      if (purpose) setPurpose(purpose);
    },
    [answers, setPurpose],
  );

  const back = useCallback(() => {
    setAnswers((prev) => {
      const asked = visibleQuestions(prev).filter((question) => prev[question.id] !== undefined);
      const last = asked[asked.length - 1];
      if (!last) return prev;
      return { ...prev, [last.id]: undefined } as QuizAnswers;
    });
  }, []);

  const restart = useCallback(() => setAnswers({}), []);

  return { answers, current, questions, stepNumber, finished, result, answer, back, restart };
}
