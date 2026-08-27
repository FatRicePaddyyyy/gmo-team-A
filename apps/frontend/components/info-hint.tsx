"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoHintProps {
  /** ホバー/フォーカス/タップで表示する説明文。ユーザー目線の言葉で書く */
  description: string;
  /** aria-label に使う。省略時は「詳しく」 */
  label?: string;
  className?: string;
}

/**
 * ボタンの横などに置く小さな Info アイコン。
 *
 * ラベルだけでは伝わらない操作の意味 (例: 「最新にする」で何が更新されるのか) を、
 * ホバー・フォーカス・タップで補足するために使う。
 * タッチ端末ではホバーが無いので、開閉を自分で持ってタップでも開けるようにする
 * (GlossaryTerm と同じ方針)。
 */
export function InfoHint({ description, label = "詳しく", className }: InfoHintProps) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        type="button"
        aria-label={label}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-700",
          className,
        )}
      >
        <Info className="size-4" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left leading-relaxed">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
