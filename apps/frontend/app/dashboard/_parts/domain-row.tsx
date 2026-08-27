"use client";

import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MyDomain } from "../_hooks/use-my-domains.hook";
import { formatDate } from "@/shared/lib/format-date";
import { detailActionLabelOf, statusHintOf } from "../_lib/domain-status";
import { StatusBadge } from "./status-badge";

interface DomainRowProps {
  domain: MyDomain;
}

/**
 * 一覧の 1 行。
 *
 * 以前は行の中で更新・廃止までできたが、次の理由で「詳細を開く」だけにした。
 * - 廃止はレジストリに本当に届く操作で、行が増えるほど隣を押す事故が起きる
 * - 更新も「何年延ばすか」の判断が要るので、対象を確認してから決めるべき
 * どちらも詳細ページに揃えてある。
 */
export function DomainRow({ domain }: DomainRowProps) {
  const hint = statusHintOf(domain.status);

  return (
    <Card className="ring-1 ring-gray-200">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/dashboard/${domain.id}`}
              className="block truncate font-heading text-base font-semibold text-gray-900 underline-offset-2 hover:text-[var(--brand)] hover:underline"
            >
              {domain.name}
            </Link>
            <p className="mt-0.5 text-xs text-gray-500">
              レジストリ: {domain.registry} / 取得日:{" "}
              {formatDate(domain.createdAt)}
            </p>
          </div>
          <StatusBadge status={domain.status} />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-700">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-4 text-gray-400" aria-hidden="true" />
            有効期限 {formatDate(domain.expiresAt)}
          </span>
        </div>

        {/* 状態バッジだけでは次に何をすべきか分からないので、一言添える */}
        {hint && <p className="text-xs text-gray-600">{hint}</p>}

        <div className="border-t border-gray-100 pt-3">
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/dashboard/${domain.id}`} />}
          >
            {detailActionLabelOf(domain.status)}
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
