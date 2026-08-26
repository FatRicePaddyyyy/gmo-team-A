"use client";

import { Trash2, Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export interface OrderLineItem {
  label: string;
  value: string;
  note?: string;
  free?: boolean;
}

export interface OrderDomain {
  name: string;
  tld: string;
  badge?: string;
  lines: OrderLineItem[];
  upsellItems?: UpsellItem[];
  onRemove?: () => void;
}

export interface UpsellItem {
  name: string;
  tld: string;
  price: string;
  onAdd?: () => void;
}

interface OrderDomainCardProps {
  domain: OrderDomain;
}

function OrderDomainCard({ domain }: OrderDomainCardProps) {
  return (
    <li className="rounded-lg border border-border bg-white p-4 shadow-sm">
      {/* domain header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex size-10 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            {domain.tld.replace(".", "").slice(0, 4)}
          </span>
          <div>
            <p className="font-bold text-gray-900">
              {domain.name}
              <span style={{ color: "var(--brand)" }}>{domain.tld}</span>
            </p>
            {domain.badge && (
              <Badge className="mt-0.5 text-xs" variant="outline">
                {domain.badge}
              </Badge>
            )}
          </div>
        </div>
        {domain.onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-gray-400 hover:text-red-500"
            onClick={domain.onRemove}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      {/* line items */}
      <div className="space-y-1.5 rounded-lg bg-gray-50 p-3">
        {domain.lines.map((line, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="flex items-center gap-1 text-gray-600">
              {line.label}
              {line.note && (
                <span className="inline-flex items-center gap-0.5 text-xs text-gray-400">
                  <Info className="size-3" />
                  {line.note}
                </span>
              )}
            </span>
            <span
              className={`font-semibold ${line.free ? "text-green-600" : "text-gray-900"}`}
            >
              {line.value}
            </span>
          </div>
        ))}
      </div>

      {/* upsell */}
      {domain.upsellItems && domain.upsellItems.length > 0 && (
        <div className="mt-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          <p className="mb-2 text-xs font-semibold text-yellow-700">
            ✨ 一緒に取得してお得！
          </p>
          <div className="space-y-2">
            {domain.upsellItems.map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">
                  {item.name}
                  <span style={{ color: "var(--brand)" }}>{item.tld}</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: "var(--brand)" }}>
                    {item.price}
                  </span>
                  <Button
                    size="sm"
                    className="h-6 px-2 text-xs"
                    variant="brand"
                    onClick={item.onAdd}
                  >
                    <Plus className="mr-0.5 size-3" />
                    追加
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

interface OrderSummaryProps {
  heading?: string;
  domains: OrderDomain[];
  totalPrice: string;
  notes?: string[];
}

export function OrderSummary({
  heading = "お申し込み内容",
  domains,
  totalPrice,
  notes = [],
}: OrderSummaryProps) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
        <span
          className="inline-block w-1 self-stretch rounded-full"
          style={{ background: "var(--brand)" }}
        />
        {heading}
      </h3>

      <ul className="space-y-3">
        {domains.map((domain, i) => (
          <OrderDomainCard key={i} domain={domain} />
        ))}
      </ul>

      <Separator />

      {/* total */}
      <div className="flex items-center justify-end gap-4 rounded-lg bg-gray-50 px-4 py-3">
        <p className="text-sm text-gray-500">合計金額（税込）</p>
        <p className="text-2xl font-bold" style={{ color: "var(--brand)" }}>
          {totalPrice}
        </p>
      </div>

      {/* notes */}
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((note, i) => (
            <li key={i} className="text-xs leading-relaxed text-gray-400">
              {note}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
