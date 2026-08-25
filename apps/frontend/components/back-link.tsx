import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface BackLinkProps {
  /** 戻り先のサイト内パス */
  href: string;
  /** 文言。`←` はこのコンポーネントが付ける */
  label: string;
  className?: string;
}

/**
 * 寄り道（解説ページなど）から元の判断へ帰るためのリンク。
 *
 * 解説は上から下まで読むものなので、**ページの上部と下部の両方**に置くこと。
 * モバイルでも押しやすいよう、タッチターゲットは 44px 以上を確保する。
 */
export function BackLink({ href, label, className = "" }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-gray-800 transition-colors hover:border-[var(--brand)] hover:text-[var(--brand)] ${className}`}
    >
      <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
      {label}
    </Link>
  );
}
