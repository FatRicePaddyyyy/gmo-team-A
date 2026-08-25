"use client";

import { Check } from "lucide-react";
import { buildFlowSteps } from "@/shared/lib/progress-store";

export interface CheckoutStep {
  label: string;
  status: "done" | "current" | "upcoming";
}

/**
 * 引数なしで置いたときの既定。ステップの並びは
 * `shared/lib/progress-store.ts` の `FLOW_STEPS` が唯一の定義。
 */
const DEFAULT_STEPS: CheckoutStep[] = buildFlowSteps("review");

interface CheckoutStepperProps {
  steps?: CheckoutStep[];
}

/**
 * 「1 - 2 - 3 - 4」の番号ステッパー。
 *
 * 完了率（％）は出さない。分母が動かない番号のほうが「あと何回操作するか」が読めるうえ、
 * 保存値からの推測が要らないので古い値でズレない。
 * 狭い画面ではラベルが横に溢れるため、丸だけを並べて「ステップ 2 / 4・内容を確認」を下に添える。
 */
export function CheckoutStepper({ steps = DEFAULT_STEPS }: CheckoutStepperProps) {
  const currentIndex = steps.findIndex((step) => step.status === "current");
  const current = currentIndex >= 0 ? steps[currentIndex] : undefined;

  return (
    <nav
      aria-label="申込みステップ"
      className="w-full text-white"
      style={{ background: "var(--brand)" }}
    >
      <div className="mx-auto max-w-4xl px-4 py-3">
        <ol className="flex items-center">
          {steps.map((step, i) => (
            <li
              key={step.label}
              className="flex flex-1 items-center"
              aria-current={step.status === "current" ? "step" : undefined}
            >
              {/* 丸もラベルも狭い画面では出し分けるので、読み上げは1行にまとめる */}
              <span className="sr-only">
                {`ステップ${i + 1} ${step.label}`}
                {step.status === "done"
                  ? "（完了）"
                  : step.status === "current"
                    ? "（いまここ）"
                    : "（この先）"}
              </span>
              <div className="flex items-center gap-2" aria-hidden="true">
                {/* circle */}
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    step.status === "done"
                      ? "border-white bg-white text-[var(--brand)]"
                      : step.status === "current"
                        ? "border-white bg-transparent text-white"
                        : "border-white/40 bg-transparent text-white/40"
                  }`}
                >
                  {step.status === "done" ? <Check className="size-3" /> : i + 1}
                </span>
                <span
                  className={`hidden text-sm font-medium sm:inline ${
                    step.status === "current"
                      ? "text-white"
                      : step.status === "done"
                        ? "text-white/80"
                        : "text-white/40"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {/* connector */}
              {i < steps.length - 1 && <div className="mx-2 h-px flex-1 bg-white/30" />}
            </li>
          ))}
        </ol>

        {/* 狭い画面ではラベルを出せないので、番号と現在地を1行で補う（％は使わない） */}
        {current && (
          <p className="mt-2 text-xs font-medium text-white sm:hidden" aria-hidden="true">
            ステップ {currentIndex + 1} / {steps.length}・{current.label}
          </p>
        )}
      </div>
    </nav>
  );
}
