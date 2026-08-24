import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export interface ServiceItem {
  title: string;
  description: string;
  href: string;
  icon?: React.ReactNode;
  badge?: string;
}

interface ServiceCardGridProps {
  heading: string;
  items: ServiceItem[];
}

export function ServiceCardGrid({ heading, items }: ServiceCardGridProps) {
  return (
    <section className="py-12">
      <div className="mx-auto max-w-5xl px-4">
        <h2 className="mb-8 text-2xl font-bold text-gray-900">{heading}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link key={item.href} href={item.href}>
              <Card className="h-full border-border transition-all hover:border-[var(--brand)] hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  {item.icon && (
                    <div
                      className="flex size-10 items-center justify-center rounded-lg"
                      style={{ background: "var(--brand-light)" }}
                    >
                      {item.icon}
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <h3 className="font-bold text-gray-900">{item.title}</h3>
                      {item.badge && (
                        <span
                          className="rounded px-1.5 py-0.5 text-xs text-white"
                          style={{ background: "var(--brand)" }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-gray-500">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-medium" style={{ color: "var(--brand)" }}>
                    詳しく見る
                    <ArrowRight className="size-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
