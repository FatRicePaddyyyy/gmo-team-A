"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { useSession } from "@/auth-client";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";

/**
 * 実在するページだけをナビに載せる。
 * 行き止まり（404）を作らないため、未実装の項目はナビに置かない。
 */
const navItems = [
  { label: "ドメインを探す", href: "/" },
  { label: "ドメインを学ぶ", href: "/learn" },
  { label: "マイドメイン", href: "/dashboard" },
];

/** 今いる画面がこのナビ項目に該当するか。「/」は完全一致、それ以外は配下も含める */
function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
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
          {navItems.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-red-50 font-bold text-[var(--brand)]"
                    : "text-gray-700 hover:bg-red-50 hover:text-[var(--brand)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/*
            幅を固定した枠に入れる。中身（判定中の空 → ログイン or ユーザー名）で
            横幅が変わっても、枠の外にあるナビが動かない。
            名前が長い場合は枠の中で truncate される。
          */}
          <div className="flex w-32 justify-end">
            {isPending ? null : signedInName ? (
              <AccountMenu name={signedInName} />
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
          </div>
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
          {navItems.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block px-4 py-3 text-sm font-medium ${
                  active
                    ? "border-l-4 border-[var(--brand)] bg-red-50 font-bold text-[var(--brand)]"
                    : "text-gray-700 hover:bg-red-50 hover:text-[var(--brand)]"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
