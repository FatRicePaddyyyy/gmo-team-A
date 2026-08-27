"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDate } from "@/shared/lib/format-date";
import {
  MAX_YEARS_FROM_NOW,
  renewableYears,
} from "../../_lib/domain-status";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";

interface RenewCardProps {
  expiresAt: string;
  disabled: boolean;
  running: boolean;
  feedback: DetailFeedback | null;
  onRenew: (years: number) => Promise<boolean>;
}

/**
 * 有効期限の延長。
 *
 * 一覧にも同じ操作があるが、詳細ページは有効期限を見に来る場所なので、
 * 見ているその場で延長できるようにする（一覧に戻らせない）。
 */
export function RenewCard({
  expiresAt,
  disabled,
  running,
  feedback,
  onRenew,
}: RenewCardProps) {
  const [years, setYears] = useState(1);
  // レジストリの上限（現在 + 10 年）を超える年数は最初から出さない
  const options = renewableYears(expiresAt);
  const capped = options.length === 0;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-gray-900">
            <CalendarPlus className="size-4 text-gray-400" aria-hidden="true" />
            有効期限を延ばす
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            いまの期限は {formatDate(expiresAt)} です。延長した分がこの日付に足されます。
          </p>
          {/* 期限を過ぎても即座に失効はしない。知らないと不安になるので先に書く */}
          <p className="mt-1 text-xs text-gray-500">
            期限を過ぎても、すぐに使えなくなるわけではありません。
            レジストリが自動で 1 年延長します。
          </p>
        </div>

        {capped ? (
          <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            有効期限は今日から {MAX_YEARS_FROM_NOW} 年先までしか延ばせません。
            このドメインはすでに上限に達しているため、いまは延長できません。
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="renew-years" className="text-xs text-gray-600">
              延長する期間
            </label>
            <select
              id="renew-years"
              value={years}
              disabled={disabled}
              onChange={(event) => setYears(Number(event.target.value))}
              className="h-11 rounded-lg border border-input bg-white px-3 text-sm text-gray-900 disabled:opacity-50"
            >
              {options.map((year) => (
                <option key={year} value={year}>
                  {year}年
                </option>
              ))}
            </select>
            <Button
              variant="brand"
              disabled={disabled}
              onClick={() => void onRenew(years)}
            >
              {running ? "延長中..." : "延長する"}
            </Button>
          </div>
        )}

        {feedback && (
          <FeedbackBanner
            tone={feedback.tone}
            message={feedback.message}
            unauthorized={feedback.unauthorized}
          />
        )}
      </CardContent>
    </Card>
  );
}
