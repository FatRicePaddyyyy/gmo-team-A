import Link from "next/link";
import { Separator } from "@/components/ui/separator";

/**
 * 実在するページへのリンクだけを置く。
 * 未実装のページはリンクにせず「準備中」と明記して、行き止まりを作らない。
 */
const footerLinks = [
  {
    heading: "ドメインを取得する",
    links: [
      { label: "ドメインを検索する", href: "/" },
      { label: "カートを見る", href: "/cart" },
      { label: "マイドメイン", href: "/dashboard" },
      { label: "他社ドメインを移管する", href: "/transfer" },
    ],
  },
  {
    heading: "ドメインを学ぶ",
    links: [
      { label: "TLD（.com など）の選び方", href: "/learn" },
      { label: "取得の流れ", href: "/#flow" },
      { label: "よくある質問", href: "/#faq" },
    ],
  },
];

const preparingLinks = ["レンタルサーバー", "SSL証明書", "お問い合わせ"];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-gray-900 text-gray-300">
      <div className="mx-auto max-w-7xl px-4 py-10">
        {/* Link grid */}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {footerLinks.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-3 text-sm font-semibold text-white">{col.heading}</h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-gray-400 hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <h3 className="mb-3 text-sm font-semibold text-white">準備中の機能</h3>
            <ul className="space-y-2">
              {preparingLinks.map((label) => (
                <li key={label} className="text-sm text-gray-500">
                  {label}
                  <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                    準備中
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <Separator className="my-8 bg-gray-700" />

        {/* Bottom row */}
        <div className="flex flex-col items-center justify-between gap-4 text-xs text-gray-500 sm:flex-row">
          <Link href="/" className="flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-sm font-bold text-white"
              style={{ background: "var(--brand)" }}
            >
              まなびドメイン
            </span>
          </Link>
          <p>© 2026 まなびドメイン（学習用のデモサイトです）</p>
        </div>
      </div>
    </footer>
  );
}
