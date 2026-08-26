"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, ShoppingCart, UserRound } from "lucide-react";
import { useSession } from "@/auth-client";
import { Button } from "@/components/ui/button";
import { useCart } from "@/shared/hooks/use-cart.hook";

/**
 * 実在するページだけをナビに載せる。
 * 行き止まり（404）を作らないため、未実装の項目はナビに置かない。
 */
const navItems = [
  { label: "ドメインを探す", href: "/search" },
  { label: "ドメインを学ぶ", href: "/learn" },
  { label: "マイドメイン", href: "/dashboard" },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { count } = useCart();
  const { data: session, isPending } = useSession();
  const signedInName = session?.user
    ? session.user.name || session.user.email
    : null;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-lg font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            まなびドメイン
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-red-50 hover:text-[var(--brand)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* カートは主要導線なのでモバイルでもヘッダーに残す */}
          <Link
            href="/cart"
            className="relative inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-3 text-gray-700 transition-colors hover:bg-red-50 hover:text-[var(--brand)]"
          >
            <ShoppingCart className="size-5" aria-hidden="true" />
            <span className="sr-only">カートを見る（{count}件）</span>
            {count > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: "var(--brand)" }}
              >
                {count}
              </span>
            )}
          </Link>
          {/* セッション判定中は同じ幅の箱を置いてレイアウトを揺らさない */}
          {isPending ? (
            <div className="h-11 w-24" aria-hidden="true" />
          ) : signedInName ? (
            <Button
              variant="ghost"
              className="h-11 max-w-40"
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              <UserRound aria-hidden="true" />
              <span className="truncate">{signedInName}</span>
            </Button>
          ) : (
            <Button
              variant="brand"
              className="h-11"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              ログイン
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-11 md:hidden"
            aria-label={mobileOpen ? "メニューを閉じる" : "メニューを開く"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="border-t border-border bg-white md:hidden">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-3 text-sm font-medium text-gray-700 hover:bg-red-50 hover:text-[var(--brand)]"
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
