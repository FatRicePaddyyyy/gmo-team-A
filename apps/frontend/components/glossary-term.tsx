"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface GlossaryTermProps {
  description: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * その場で意味を読める専門用語。
 *
 * 「乗せれば説明が出る」ことに気づく手がかりは、**このコンポーネントが持つ**（Issue #102）。
 * 呼び出し側に点線を書かせていたときは、付いている画面と付いていない画面が生まれ、
 * 「下線がある語だけ説明がある」という規則性も崩れていた。
 *
 * 手がかりは2つ。語の下の点線と、うしろの小さな ⓘ。
 * 文章の途中に置くものなので、アイコンは文字サイズに追従させ（`0.85em`）、
 * 色は周囲の文字色を薄めて使う。読む流れを止めない濃さに留める。
 */
export function GlossaryTerm({ description, children, className }: GlossaryTermProps) {
  // Base UI の Tooltip はホバーとフォーカスでしか開かない。
  // タッチ端末にはホバーが無く、タップしても説明が読めなかったので、
  // 開閉を自分で持ってクリック（＝タップ）でも開くようにする。
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex cursor-help items-center gap-1 border-0 bg-transparent p-0 text-inherit",
          className,
        )}
      >
        {/* 点線は語だけに引く。アイコンまで下線が伸びると記号が読みにくい */}
        <span className="underline decoration-dotted underline-offset-4">{children}</span>
        <Info className="size-[0.85em] shrink-0 opacity-60" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}
