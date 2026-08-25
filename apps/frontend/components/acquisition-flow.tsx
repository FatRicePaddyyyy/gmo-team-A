"use client";

import { ArrowRight, ChevronDown, Clock } from "lucide-react";
import { MISCONCEPTION } from "@/shared/lib/tld-catalog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface FlowStep {
  number: number;
  title: string;
  /** ここで何を決めるか */
  decide: string;
  /** どれくらいかかるか */
  duration: string;
  /** この判断の直前に出す「よくある勘違い」1つだけ */
  misconception: { title: string; body: string };
}

/**
 * 取得までの流れ。
 *
 * 「よくある勘違い」は1箇所にまとめず、**それが関係する意思決定のステップに1つだけ**置く。
 * まとめて読ませると読み飛ばされるため。
 */
const FLOW_STEPS: FlowStep[] = [
  {
    number: 1,
    title: "名前を決める",
    decide: "使いたい文字列（例: manabi-blog）",
    duration: "3分",
    misconception: MISCONCEPTION.refund,
  },
  {
    number: 2,
    title: "末尾（TLD）を選ぶ",
    decide: ".com / .jp など。取れる人の条件と2年目以降の金額",
    duration: "5分",
    misconception: MISCONCEPTION.tld,
  },
  {
    number: 3,
    title: "設定を確認する",
    decide: "Whois 情報公開代行を使うか・自動更新をオンにするか",
    duration: "3分",
    misconception: MISCONCEPTION.renewal,
  },
  {
    number: 4,
    title: "申し込む",
    decide: "金額とつづりの最終確認。ここではじめて課金されます",
    duration: "2分",
    misconception: MISCONCEPTION.publish,
  },
];

interface AcquisitionFlowProps {
  heading?: string;
  /** 進捗に合わせて「いまここ」を出す。1〜4。0 や未指定なら出さない */
  currentStep?: number;
  id?: string;
}

export function AcquisitionFlow({
  heading = "ドメイン取得までの流れ",
  currentStep,
  id,
}: AcquisitionFlowProps) {
  return (
    <section id={id} className="scroll-mt-16 bg-gray-50 py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">{heading}</h2>
        <p className="mx-auto mb-8 max-w-2xl text-center text-sm leading-relaxed text-gray-600">
          全部で4ステップ、合計15分ほどです。各ステップに「ここでよくある勘違い」を1つずつ置きました。
        </p>

        <ol className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-0">
          {FLOW_STEPS.map((step, index) => {
            const isCurrent = currentStep === step.number;
            const isDone = typeof currentStep === "number" && currentStep > step.number;

            return (
              <li key={step.number} className="flex flex-col md:flex-1 md:flex-row md:items-stretch">
                <div
                  className={`flex-1 rounded-xl border bg-white p-4 shadow-sm ${
                    isCurrent ? "border-[var(--brand)] ring-2 ring-[var(--brand-light)]" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        isDone || isCurrent ? "text-white" : "bg-gray-200 text-gray-700"
                      }`}
                      style={isDone || isCurrent ? { background: "var(--brand)" } : undefined}
                      aria-hidden="true"
                    >
                      {step.number}
                    </span>
                    <h3 className="font-bold text-gray-900">{step.title}</h3>
                    {isCurrent && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
                        style={{ background: "var(--brand)" }}
                      >
                        いまここ
                      </span>
                    )}
                  </div>

                  <p className="mt-2 text-sm leading-relaxed text-gray-700">
                    <span className="font-semibold">決めること: </span>
                    {step.decide}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-gray-600">
                    <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                    目安 {step.duration}
                  </p>

                  {/* 勘違いはここで1つだけ。折りたたんでページ全長を伸ばさない */}
                  <Accordion className="mt-3">
                    <AccordionItem
                      value={`misconception-${step.number}`}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3"
                    >
                      <AccordionTrigger className="py-2 text-left text-xs font-bold text-amber-950 hover:no-underline">
                        <span className="flex items-center gap-1.5 pr-2">
                          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                          ここでよくある勘違い
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-3 text-xs leading-relaxed text-amber-950">
                        <p className="font-semibold">{step.misconception.title}</p>
                        <p className="mt-1">{step.misconception.body}</p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>

                {/* 進行方向。デスクトップは横、モバイルは縦 */}
                {index < FLOW_STEPS.length - 1 && (
                  <div
                    className="flex items-center justify-center py-1 md:px-1 md:py-0"
                    aria-hidden="true"
                  >
                    <ArrowRight className="size-5 rotate-90 text-gray-400 md:rotate-0" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
