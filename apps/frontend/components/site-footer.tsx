import Link from "next/link";
import { Separator } from "@/components/ui/separator";

const footerLinks = [
  {
    heading: "ドメインを取得する",
    links: [
      { label: "ドメイン取得", href: "/service/domainregist/" },
      { label: "ドメイン移管", href: "/transfer/" },
      { label: "ドメイン更新", href: "/renewal/" },
      { label: "空きドメイン検索", href: "/advanced/" },
      { label: "RDAP検索", href: "/service/whois/" },
    ],
  },
  {
    heading: "オプションサービス",
    links: [
      { label: "レンタルサーバー", href: "/server/rs/" },
      { label: "お名前メール", href: "/service/mail/" },
      { label: "AIホームページパック", href: "/campaign/aihppack/" },
      { label: "SSL証明書", href: "/service/ssl/" },
    ],
  },
  {
    heading: "サポート",
    links: [
      { label: "よくある質問", href: "/support/faq/" },
      { label: "お問い合わせ", href: "/support/contact/" },
      { label: "ご利用ガイド", href: "/guide/" },
      { label: "障害・メンテナンス情報", href: "/support/maintenance/" },
    ],
  },
  {
    heading: "お名前.comについて",
    links: [
      { label: "会社概要", href: "/info/company/" },
      { label: "プライバシーポリシー", href: "/info/privacy/" },
      { label: "利用規約", href: "/info/agreement/" },
      { label: "特定商取引法", href: "/info/commercial/" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-7xl px-4 py-10">
        {/* Link grid */}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {footerLinks.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-3 text-sm font-semibold text-white">{col.heading}</h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-400 hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Separator className="my-8 bg-gray-700" />

        {/* Bottom row */}
        <div className="flex flex-col items-center justify-between gap-4 text-xs text-gray-500 sm:flex-row">
          <Link href="/" className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-sm font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              お名前.com
            </span>
          </Link>
          <p>© 2026 GMO Internet, Inc. All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}
