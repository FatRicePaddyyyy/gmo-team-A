"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeedbackBanner } from "@/components/feedback-banner";
import { formatDate } from "@/shared/lib/format-date";
import { formatYen, matchKnownTld } from "@/shared/lib/tld-catalog";
import { PAYMENT_METHOD } from "@/shared/lib/payment-methods";
import {
  MAX_YEARS_FROM_NOW,
  renewableYears,
} from "../../_lib/domain-status";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";

interface RenewCardProps {
  domainName: string;
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
  domainName,
  expiresAt,
  disabled,
  running,
  feedback,
  onRenew,
}: RenewCardProps) {
  const [years, setYears] = useState(1);
  // 支払い内容の確認を挟んでから実際に延長する（年数を選ぶ→内容の確認→確定）
  const [phase, setPhase] = useState<"select" | "payment">("select");
  // レジストリの上限（現在 + 10 年）を超える年数は最初から出さない
  const options = renewableYears(expiresAt);
  const capped = options.length === 0;
  // 金額は tld-catalog（唯一の出典）から引く。二重定義を避ける
  const tldInfo = matchKnownTld(domainName);
  const renewalTotal = tldInfo ? tldInfo.renewalPrice * years : null;

  const handleConfirm = async () => {
    const success = await onRenew(years);
    // 成功したら期間選択に戻す。失敗時は確認画面のまま、そのまま再試行できるようにする
    if (success) setPhase("select");
  };

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
        ) : phase === "select" ? (
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
              onClick={() => setPhase("payment")}
            >
              次へ
            </Button>
            {renewalTotal !== null && (
              <p className="w-full text-sm text-gray-700">
                {years}年延長すると
                <span className="font-bold" style={{ color: "var(--brand)" }}>
                  {formatYen(renewalTotal)}
                </span>
                （税込）かかります
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              {years}年延長 ={" "}
              <span className="font-bold" style={{ color: "var(--brand)" }}>
                {renewalTotal !== null ? formatYen(renewalTotal) : "-"}
              </span>
              （税込）
            </p>

            {/* 支払い方法は 1 つだけなので選ばせない。押しても何も変わらない
                ラジオボタンを置くと、選び終えていないように見えて手が止まる。 */}
            <div className="rounded-lg border border-border p-3">
              <p className="px-1 text-xs font-bold text-gray-900">お支払い方法</p>
              <p className="mt-1 px-1 text-sm font-semibold text-gray-900">{PAYMENT_METHOD.label}</p>
              <p className="mt-1 px-1 text-sm text-gray-600">{PAYMENT_METHOD.description}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => setPhase("select")}
              >
                戻る
              </Button>
              <Button
                variant="brand"
                disabled={disabled}
                onClick={() => void handleConfirm()}
              >
                {running ? "処理中..." : "この内容で確定する"}
              </Button>
            </div>
          </div>
        )}

        {feedback && (
          <FeedbackBanner
              context="renew"
            tone={feedback.tone}
            message={feedback.message}
            unauthorized={feedback.unauthorized}
          />
        )}
      </CardContent>
    </Card>
  );
}
