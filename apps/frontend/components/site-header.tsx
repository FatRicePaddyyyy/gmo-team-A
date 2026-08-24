"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "ドメイン取得", href: "/domain" },
  { label: "ドメイン移管", href: "/transfer" },
  { label: "ドメイン更新", href: "/renewal" },
  { label: "レンタルサーバー", href: "/server" },
  { label: "メール", href: "/mail" },
  { label: "サポート", href: "/support" },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span
            className="rounded px-2 py-0.5 text-lg font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            お名前.com
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
          <Button variant="ghost" size="icon" aria-label="検索">
            <Search className="size-4" />
          </Button>
          <Button
            className="hidden text-white sm:inline-flex"
            style={{ background: "var(--brand)" }}
            render={<Link href="/login" />}
          >
            ログイン
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label="メニュー"
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
          <div className="border-t border-border p-4">
            <Button
              className="w-full text-white"
              style={{ background: "var(--brand)" }}
              render={<Link href="/login" />}
            >
              ログイン
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
