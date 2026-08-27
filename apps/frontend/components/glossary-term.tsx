"use client";

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface GlossaryTermProps {
  description: string;
  children: React.ReactNode;
  className?: string;
}

export function GlossaryTerm({ description, children, className }: GlossaryTermProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "inline-flex cursor-help items-center gap-1 border-0 bg-transparent p-0 text-inherit",
          className,
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  );
}
