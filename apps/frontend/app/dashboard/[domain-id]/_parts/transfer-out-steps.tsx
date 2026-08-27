"use client";

import { Check } from "lucide-react";

/**
 * 他社へ渡す (outbound) 移管のステップインジケーター。
 *
 * 一連の流れは 4 段階:
 *   ① 認証コード (AuthCode) を発行する
 *   ② 認証コードを移管先の事業者に伝える
 *   ③ 移管先が申請を出す (別事業者の管理画面で)
 *   ④ 承認・完了 (放置しても 20 分で自動承認)
 *
 * このアプリでできるのは ① だけ。② 以降は自分たちのシステムの外側で起こる。
 * ここは「今どこにいるか」と「次に自分がやること」を示すためのガイド。
 */
export type TransferOutStepKey = "issue" | "hand-over" | "wait" | "done";

export interface TransferOutStepsProps {
  /** 現在アクティブなステップ */
  current: TransferOutStepKey;
}

interface StepDef {
  key: TransferOutStepKey;
  title: string;
  detail: string;
}

const STEPS: StepDef[] = [
  {
    key: "issue",
    title: "認証コードを発行",
    detail: "下の入力欄で新しいコードを設定します。",
  },
  {
    key: "hand-over",
    title: "移管先に伝える",
    detail: "設定したコードを移管先の事業者に安全に渡します。",
  },
  {
    key: "wait",
    title: "移管先が申請",
    detail: "移管先の管理画面で申請が行われるのを待ちます。",
  },
  {
    key: "done",
    title: "承認・完了",
    detail: "承認すると完了。放置しても 20 分ほどで自動承認されます。",
  },
];

export function TransferOutSteps({ current }: TransferOutStepsProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <nav aria-label="他社へ渡す手順" className="rounded-lg border border-gray-200 bg-white p-3">
      <ol className="flex flex-col gap-3 sm:flex-row sm:gap-2">
        {STEPS.map((step, index) => {
          const status: "done" | "current" | "upcoming" =
            index < currentIndex
              ? "done"
              : index === currentIndex
                ? "current"
                : "upcoming";
          return (
            <li
              key={step.key}
              className="flex flex-1 items-start gap-2"
              aria-current={status === "current" ? "step" : undefined}
            >
              <div
                className={
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                  (status === "done"
                    ? "bg-green-100 text-green-800"
                    : status === "current"
                      ? "bg-[var(--brand)] text-white"
                      : "bg-gray-100 text-gray-500")
                }
                aria-hidden="true"
              >
                {status === "done" ? <Check className="size-4" /> : index + 1}
              </div>
              <div className="min-w-0">
                <p
                  className={
                    "text-xs font-semibold " +
                    (status === "upcoming" ? "text-gray-500" : "text-gray-900")
                  }
                >
                  ステップ {index + 1} {status === "current" && "（いまここ）"}
                </p>
                <p
                  className={
                    "text-sm " +
                    (status === "upcoming" ? "text-gray-500" : "font-medium text-gray-900")
                  }
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
