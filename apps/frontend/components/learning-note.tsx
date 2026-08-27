"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Lightbulb } from "lucide-react";

interface LearningNoteProps {
  title: string;
  /** info = 知っておくと得する説明 / warn = 知らないと事故る注意 */
  tone?: "info" | "warn";
  /**
   * 見出しだけ出して、押したときに本文を開く。
   *
   * 検索結果のように「早く一覧を見たい」場面で長い説明が居座ると、
   * 肝心のドメインが下へ押し出される。読みたい人だけ開ける形にする。
   * 既定は開いたまま（説明を読ませたい場面が多いため）。
   */
  collapsible?: boolean;
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
export function LearningNote({
  title,
  tone = "info",
  collapsible = false,
  children,
}: LearningNoteProps) {
  const { box, icon, Icon } = TONE[tone];
  const [open, setOpen] = useState(false);

  if (!collapsible) {
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

  return (
    <div className={`rounded-lg border ${box}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        // 見出し全体を押せるようにする。三角だけだと的が小さく、
        // 押せること自体に気づかれない。
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold"
      >
        <Icon className={`size-4 shrink-0 ${icon}`} aria-hidden="true" />
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="px-4 pb-3 text-sm leading-relaxed">{children}</div>
      )}
    </div>
  );
}
