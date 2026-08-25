import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowRight } from "lucide-react";

export interface NewsItem {
  date: string;
  category: string;
  title: string;
  href: string;
}

const categoryColors: Record<string, string> = {
  お知らせ: "bg-blue-100 text-blue-700",
  キャンペーン: "bg-orange-100 text-orange-700",
  メンテナンス: "bg-yellow-100 text-yellow-700",
  重要: "bg-red-100 text-red-700",
};

interface NewsListProps {
  heading?: string;
  items: NewsItem[];
  moreHref?: string;
}

export function NewsList({ heading = "NEWS", items, moreHref }: NewsListProps) {
  return (
    <div>
      {heading && (
        <h2 className="mb-4 text-xl font-bold text-gray-900">{heading}</h2>
      )}
      <div className="divide-y divide-border rounded-xl border border-border bg-white">
        {items.map((item, i) => (
          <Link
            key={i}
            href={item.href}
            className="flex min-h-11 flex-col justify-center gap-1 px-4 py-3 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--brand)] sm:flex-row sm:items-center sm:gap-4"
          >
            <time dateTime={item.date.replaceAll("/", "-")} className="shrink-0 text-sm text-gray-600">
              {item.date}
            </time>
            <Badge
              variant="outline"
              className={`w-fit shrink-0 text-xs ${categoryColors[item.category] ?? "bg-gray-100 text-gray-600"}`}
            >
              {item.category}
            </Badge>
            <span className="flex-1 text-sm text-gray-700 hover:text-[var(--brand)]">
              {item.title}
            </span>
          </Link>
        ))}
      </div>
      {moreHref && (
        <div className="mt-3 text-right">
          <Link
            href={moreHref}
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium hover:underline"
            style={{ color: "var(--brand)" }}
          >
            もっと見る <ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        </div>
      )}
      <Separator className="mt-4 hidden" />
    </div>
  );
}
