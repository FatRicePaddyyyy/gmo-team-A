"use client";

import { ArrowLeft, ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Question, QuestionId } from "../_lib/recommend";

interface QuestionStepProps {
  question: Question;
  /** 1 始まりの現在位置 */
  stepNumber: number;
  totalSteps: number;
  onAnswer: (id: QuestionId, value: string) => void;
  /** 最初の質問では出さない */
  onBack?: () => void;
}

/**
 * 1問だけを大きく出す。
 *
 * 4問を一覧で並べると「フォーム」に見えて手が止まるので、1画面1問にする。
 * 選択肢はラベルだけでなく必ず1行の言い換えを添える（初学者は用語では選べない）。
 */
export function QuestionStep({
  question,
  stepNumber,
  totalSteps,
  onAnswer,
  onBack,
}: QuestionStepProps) {
  return (
    <section aria-labelledby="question-heading" className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-sm font-medium text-gray-600">
        質問 {stepNumber} / {totalSteps}
      </p>

      {/* 進み具合。パーセントは出さず、答えた数だけを示す */}
      <div
        className="mt-2 flex gap-1"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={totalSteps}
        aria-valuenow={stepNumber}
        aria-label="診断の進み具合"
      >
        {Array.from({ length: totalSteps }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full ${
              index < stepNumber ? "bg-[var(--brand)]" : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      <h1 id="question-heading" className="mt-5 text-xl font-bold text-gray-900 sm:text-2xl">
        {question.title}
      </h1>
      <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-gray-700">
        <Info className="mt-0.5 size-4 shrink-0 text-gray-500" aria-hidden="true" />
        {question.help}
      </p>

      <ul className="mt-5 space-y-2">
        {question.options.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              onClick={() => onAnswer(question.id, option.value)}
              className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-light)]"
            >
              <span className="min-w-0">
                <span className="block text-base font-bold text-gray-900">{option.label}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-gray-600">
                  {option.description}
                </span>
              </span>
              <ChevronRight
                className="size-5 shrink-0 text-[var(--brand)]"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>

      {onBack && (
        <Button variant="ghost" className="mt-4 h-11 px-3" onClick={onBack}>
          <ArrowLeft className="mr-1 size-4" aria-hidden="true" />
          1つ前の質問に戻る
        </Button>
      )}
    </section>
  );
}
