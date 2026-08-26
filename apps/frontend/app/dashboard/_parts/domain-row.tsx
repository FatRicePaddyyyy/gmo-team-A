"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  MyDomain,
  RenewPeriodUnit,
  RunningDomainAction,
} from "../_hooks/use-my-domains.hook";
import { formatDate } from "@/shared/lib/format-date";
import { ConfirmAction } from "@/components/confirm-action";
import { canDelete, canRenew, canRestore } from "../_lib/domain-status";
import { StatusBadge } from "./status-badge";

/** レジストリの制約に合わせて 1〜10 年。UI ではよく使う年数だけ出す */
const RENEW_YEARS = [1, 2, 3, 5, 10];

interface DomainRowProps {
  domain: MyDomain;
  running: RunningDomainAction | null;
  onRenew: (
    domain: MyDomain,
    period: { unit: RenewPeriodUnit; value: number },
  ) => void | Promise<void>;
  onDelete: (domain: MyDomain) => void | Promise<void>;
  onRestore: (domain: MyDomain) => void | Promise<void>;
}

export function DomainRow({
  domain,
  running,
  onRenew,
  onDelete,
  onRestore,
}: DomainRowProps) {
  const [years, setYears] = useState(1);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 他の行の操作中でも押せてしまうと二重送信になるので、実行中は全ボタンを止める
  const busy = running !== null;
  const runningHere = running?.domainId === domain.id ? running.kind : null;

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
          <span className="text-xs text-gray-500">
            自動更新 {domain.autoRenew ? "オン" : "オフ"}
          </span>
        </div>

        {confirmingDelete ? (
          <ConfirmAction
            question={`${domain.name} を廃止しますか？`}
            detail="廃止するとサイトやメールがすぐ使えなくなります。しばらくの間は復旧できますが、猶予期間を過ぎると他の人が取得できるようになります。"
            confirmLabel="廃止する"
            running={runningHere === "delete"}
            onConfirm={async () => {
              // 閉じるのは完了後。先に閉じると「処理中...」が一度も出ない
              await onDelete(domain);
              setConfirmingDelete(false);
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            {canRenew(domain.status) && (
              <div className="flex items-center gap-1.5">
                <label
                  htmlFor={`renew-years-${domain.id}`}
                  className="text-xs text-gray-600"
                >
                  更新期間
                </label>
                <select
                  id={`renew-years-${domain.id}`}
                  value={years}
                  disabled={busy}
                  onChange={(event) => setYears(Number(event.target.value))}
                  className="h-8 rounded-lg border border-input bg-white px-2 text-sm text-gray-900 disabled:opacity-50"
                >
                  {RENEW_YEARS.map((year) => (
                    <option key={year} value={year}>
                      {year}年
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="brand"
                  disabled={busy}
                  onClick={() =>
                    void onRenew(domain, { unit: "Y", value: years })
                  }
                >
                  {runningHere === "renew" ? "更新中..." : "更新する"}
                </Button>
              </div>
            )}

            {canRestore(domain.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void onRestore(domain)}
              >
                <RotateCcw aria-hidden="true" />
                {runningHere === "restore" ? "復旧中..." : "復旧する"}
              </Button>
            )}

            {canDelete(domain.status) && (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                廃止する
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={`/dashboard/${domain.id}`} />}
            >
              <Settings2 aria-hidden="true" />
              設定・詳細
            </Button>

            {!canRenew(domain.status) && !canRestore(domain.status) && (
              <p className="text-xs text-gray-500">
                いまは更新・復旧を行えません。状態は「設定・詳細」から確認できます。
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
