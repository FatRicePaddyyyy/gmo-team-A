import { AlertTriangle, Lightbulb } from "lucide-react";

interface LearningNoteProps {
  title: string;
  /** info = 知っておくと得する説明 / warn = 知らないと事故る注意 */
  tone?: "info" | "warn";
  children: React.ReactNode;
}

const TONE = {
  info: {
    box: "border-sky-200 bg-sky-50 text-sky-950",
    icon: "text-sky-600",
    Icon: Lightbulb,
  },
  warn: {
    box: "border-amber-300 bg-amber-50 text-amber-950",
    icon: "text-amber-600",
    Icon: AlertTriangle,
  },
} as const;

/**
 * 必要なタイミング（just-in-time）で出す学習用の補足ボックス。
 * 読ませる長文ではなく、その場で分かる短さに保つこと。
 */
export function LearningNote({ title, tone = "info", children }: LearningNoteProps) {
  const { box, icon, Icon } = TONE[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 ${box}`}>
      <p className="mb-1 flex items-center gap-2 text-sm font-bold">
        <Icon className={`size-4 shrink-0 ${icon}`} aria-hidden="true" />
        {title}
      </p>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}
