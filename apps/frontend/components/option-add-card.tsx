"use client";

import { useState } from "react";
import { Plus, Shield, Mail, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface OptionItem {
  id: string;
  icon?: "shield" | "mail" | React.ReactNode;
  title: string;
  subtitle: string;
  monthlyPrice: string;
  yearlyPrice: string;
  features: string[];
  added?: boolean;
  onAdd?: (id: string) => void;
  onRemove?: (id: string) => void;
}

const ICON_MAP = {
  shield: <Shield className="size-8 text-blue-500" />,
  mail: <Mail className="size-8 text-blue-500" />,
};

interface OptionAddCardProps {
  item: OptionItem;
}

function OptionAddCard({ item }: OptionAddCardProps) {
  const icon =
    typeof item.icon === "string"
      ? ICON_MAP[item.icon as keyof typeof ICON_MAP]
      : item.icon;

  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-4">
        {/* icon */}
        <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-blue-50">
          {icon ?? <Info className="size-8 text-blue-400" />}
        </div>

        {/* content */}
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-gray-900">{item.title}</p>
            <Badge variant="outline" className="text-xs text-gray-500">
              {item.subtitle}
            </Badge>
          </div>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {item.features.map((f, i) => (
              <li key={i} className="flex items-start gap-1 text-xs text-gray-600">
                <span className="mt-0.5 text-green-500">✓</span>
                <span dangerouslySetInnerHTML={{ __html: f }} />
              </li>
            ))}
          </ul>
        </div>

        {/* price + button */}
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="text-right">
            <p className="text-xs text-gray-400">月換算 {item.monthlyPrice}</p>
            <p className="text-xl font-bold text-gray-900">
              {item.yearlyPrice}
              <span className="text-sm font-normal text-gray-500"> 円/年</span>
            </p>
          </div>
          {item.added ? (
            <Button
              size="sm"
              variant="outline"
              className="border-[var(--brand)] text-[var(--brand)]"
              onClick={() => item.onRemove?.(item.id)}
            >
              追加済み ✓
            </Button>
          ) : (
            <Button
              size="sm"
              variant="brand"
              onClick={() => item.onAdd?.(item.id)}
            >
              <Plus className="mr-1 size-3" />
              追加
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface OptionSectionProps {
  heading?: string;
  items: OptionItem[];
  onAdd?: (id: string) => void;
  onRemove?: (id: string) => void;
}

export function OptionSection({ heading = "追加で選べるお得なオプション", items, onAdd, onRemove }: OptionSectionProps) {
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const handleAdd = (id: string) => {
    setAddedIds((prev) => new Set(prev).add(id));
    onAdd?.(id);
  };

  const handleRemove = (id: string) => {
    setAddedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    onRemove?.(id);
  };

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
        <span
          className="inline-block w-1 self-stretch rounded-full"
          style={{ background: "var(--brand)" }}
        />
        {heading}
      </h3>
      <div className="space-y-3">
        {items.map((item) => (
          <OptionAddCard
            key={item.id}
            item={{ ...item, added: addedIds.has(item.id), onAdd: handleAdd, onRemove: handleRemove }}
          />
        ))}
      </div>
    </section>
  );
}
