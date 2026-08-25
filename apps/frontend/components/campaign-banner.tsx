import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface CampaignBannerProps {
  badge?: string;
  title: string;
  description: string;
  href: string;
  variant?: "red" | "dark" | "yellow";
}

const variantStyles = {
  red: {
    wrapper: "text-white",
    bg: "background: linear-gradient(135deg, var(--brand) 0%, #a80015 100%)",
    badgeClass: "border-white/40 bg-white/20 text-white",
    arrowClass: "text-white/80",
  },
  dark: {
    wrapper: "text-white",
    bg: "background: linear-gradient(135deg, #1f2937 0%, #111827 100%)",
    badgeClass: "border-white/40 bg-white/20 text-white",
    arrowClass: "text-white/80",
  },
  yellow: {
    wrapper: "text-gray-900",
    bg: "background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
    badgeClass: "border-gray-900/20 bg-gray-900/10 text-gray-900",
    arrowClass: "text-gray-700",
  },
};

export function CampaignBanner({
  badge,
  title,
  description,
  href,
  variant = "red",
}: CampaignBannerProps) {
  const s = variantStyles[variant];
  return (
    <Link
      href={href}
      className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
    >
      <div
        className={`group relative overflow-hidden rounded-xl p-6 transition-opacity hover:opacity-95 ${s.wrapper}`}
        style={{ [s.bg.split(":")[0]]: s.bg.split(": ")[1] } as React.CSSProperties}
      >
        <div
          className="absolute inset-0 rounded-xl opacity-0 ring-2 ring-white/30 transition-opacity group-hover:opacity-100"
        />
        {badge && (
          <Badge variant="outline" className={`mb-3 text-xs ${s.badgeClass}`}>
            {badge}
          </Badge>
        )}
        <h3 className="mb-1 text-lg font-bold">{title}</h3>
        <p className="text-sm opacity-90">{description}</p>
        <div className={`mt-4 flex items-center gap-1 text-sm font-medium ${s.arrowClass}`}>
          詳しく見る <ArrowRight className="size-3" aria-hidden="true" />
        </div>
      </div>
    </Link>
  );
}

interface CampaignBannerGridProps {
  heading?: string;
  items: CampaignBannerProps[];
}

export function CampaignBannerGrid({ heading, items }: CampaignBannerGridProps) {
  return (
    <section className="bg-gray-50 py-12">
      <div className="mx-auto max-w-5xl px-4">
        {heading && (
          <h2 className="mb-8 text-2xl font-bold text-gray-900">{heading}</h2>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <CampaignBanner key={item.href} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}
