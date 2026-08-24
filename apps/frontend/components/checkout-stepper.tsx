import { Check } from "lucide-react";

export interface CheckoutStep {
  label: string;
  status: "done" | "current" | "upcoming";
}

const DEFAULT_STEPS: CheckoutStep[] = [
  { label: "ご希望の商品を選択", status: "done" },
  { label: "お申込み内容の確認", status: "current" },
  { label: "お支払い", status: "upcoming" },
  { label: "完了", status: "upcoming" },
];

interface CheckoutStepperProps {
  steps?: CheckoutStep[];
}

export function CheckoutStepper({ steps = DEFAULT_STEPS }: CheckoutStepperProps) {
  return (
    <nav
      aria-label="申込みステップ"
      className="w-full text-white"
      style={{ background: "var(--brand)" }}
    >
      <ol className="mx-auto flex max-w-4xl items-center px-4 py-3">
        {steps.map((step, i) => (
          <li key={step.label} className="flex flex-1 items-center">
            <div className="flex items-center gap-2">
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
                {step.status === "done" ? (
                  <Check className="size-3" />
                ) : (
                  i + 1
                )}
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
            {i < steps.length - 1 && (
              <div className="mx-2 h-px flex-1 bg-white/30" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
