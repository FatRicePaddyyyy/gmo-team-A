"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckoutStepper } from "@/components/checkout-stepper";
import { LearningNote } from "@/components/learning-note";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useCart } from "@/shared/hooks/use-cart.hook";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { saveConfirmedOrder } from "@/shared/lib/order-store";
import { buildFlowSteps } from "@/shared/lib/progress-store";
import {
  checkEligibility,
  findTld,
  formatYen,
  LIMITED_OFFER_NOTE,
  MISCONCEPTION,
  RENEWAL_LESSON,
  renewalWarningOf,
} from "@/shared/lib/tld-catalog";

const CART_STEPS = buildFlowSteps("review");

export default function CartPage() {
  const router = useRouter();
  const { items, remove } = useCart();
  const { state: progress } = useProgress();
  const [showEligibilityError, setShowEligibilityError] = useState(false);

  const lines = useMemo(
    () =>
      items.map((item) => {
        const info = findTld(item.tld);
        return {
          ...item,
          info,
          firstYear: info?.firstYearPrice ?? 0,
          renewal: info?.renewalPrice ?? 0,
          verdict: info ? checkEligibility(info, progress.purpose) : { allowed: true as const },
        };
      }),
    [items, progress.purpose],
  );

  const firstYearTotal = lines.reduce((sum, line) => sum + line.firstYear, 0);
  const renewalTotal = lines.reduce((sum, line) => sum + line.renewal, 0);
  const hasLimitedOffer = lines.some((line) => line.info?.limitedOffer);
  const blocked = lines.filter((line) => !line.verdict.allowed);
  // 直前の候補が消えないよう、検索に戻るときはクエリを持って戻す
  const backToSearchHref = progress.searchedName
    ? `/?q=${encodeURIComponent(progress.searchedName)}`
    : "/";

  const handleSubmit = () => {
    // 取得条件を満たさない末尾が残っていたら、理由を出して止める
    if (blocked.length > 0) {
      setShowEligibilityError(true);
      return;
    }

    saveConfirmedOrder({
      items: items.map((item) => ({ name: item.name, tld: item.tld })),
      purpose: progress.purpose,
      confirmedAt: new Date().toISOString(),
    });
    router.push("/cart/complete");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />
      <CheckoutStepper steps={CART_STEPS} />

      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">お申し込み内容の確認</h1>
        <p className="mb-6 text-sm text-gray-600">
          この画面では課金されません。金額と設定を確認してから次に進んでください。
        </p>

        {/* 空状態 */}
        {lines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-white px-4 py-12 text-center">
            <ShoppingCart className="mx-auto mb-3 size-8 text-gray-400" aria-hidden="true" />
            <p className="mb-1 font-semibold text-gray-900">カートは空です</p>
            <p className="mb-6 text-sm text-gray-600">
              取得したいドメイン名を検索して、気に入ったものをカートに追加しましょう。
            </p>
            <Button
              className="h-11 px-5 text-white"
              style={{ background: "var(--brand)" }}
              nativeButton={false}
              render={<Link href="/" />}
            >
              ドメインを検索する
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <ul className="space-y-3">
              {lines.map((line) => {
                const warning = line.info ? renewalWarningOf(line.info) : undefined;
                return (
                  <li
                    key={`${line.name}${line.tld}`}
                    className="rounded-lg border border-border bg-white px-4 py-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold break-all text-gray-900">
                          {line.name}
                          <span style={{ color: "var(--brand)" }}>{line.tld}</span>
                        </p>
                        {line.info?.summary && (
                          <p className="mt-1 text-sm leading-relaxed text-gray-600">
                            {line.info.summary}
                          </p>
                        )}
                        {line.info?.eligibility && (
                          <p className="mt-1 text-sm text-amber-900">
                            <span className="font-semibold">取得できる人: </span>
                            {line.info.eligibility}
                          </p>
                        )}
                      </div>

                      <dl className="shrink-0 space-y-1 sm:w-56 sm:text-right">
                        <div className="flex items-baseline justify-between gap-2 sm:justify-end">
                          <dt className="text-sm text-gray-600">初年度</dt>
                          <dd className="text-base font-bold" style={{ color: "var(--brand)" }}>
                            {formatYen(line.firstYear)}
                            <span className="text-xs font-normal text-gray-600">（税込）</span>
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 sm:justify-end">
                          <dt className="text-sm text-gray-600">2年目以降</dt>
                          <dd className="text-base font-bold text-gray-900">
                            {formatYen(line.renewal)}
                            <span className="text-xs font-normal text-gray-600">/年（税込）</span>
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {warning && (
                      <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                        {warning}
                      </p>
                    )}

                    {!line.verdict.allowed && (
                      <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-900">
                        <span className="font-bold">あなたの用途では取得できません。</span>
                        {line.verdict.reason}
                      </p>
                    )}

                    <div className="mt-3 text-right">
                      <Button
                        variant="ghost"
                        className="h-11 px-3 text-gray-600"
                        onClick={() => remove({ name: line.name, tld: line.tld })}
                      >
                        <Trash2 className="mr-1 size-4" aria-hidden="true" />
                        <span>
                          カートから外す
                          <span className="sr-only">
                            （{line.name}
                            {line.tld}）
                          </span>
                        </span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* 合計。初年度だけでなく、翌年から毎年かかる金額も同じ大きさで出す */}
            <section
              aria-labelledby="total-heading"
              className="rounded-lg border border-border bg-white px-4 py-4 shadow-sm"
            >
              <h2 id="total-heading" className="mb-3 text-base font-bold text-gray-900">
                お支払い金額
              </h2>
              <dl className="space-y-2">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm text-gray-700">初年度の合計</dt>
                  <dd className="text-xl font-bold" style={{ color: "var(--brand)" }}>
                    {formatYen(firstYearTotal)}
                    <span className="text-xs font-normal text-gray-600">（税込）</span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-sm text-gray-700">2年目以降（毎年）</dt>
                  <dd className="text-xl font-bold text-gray-900">
                    {formatYen(renewalTotal)}
                    <span className="text-xs font-normal text-gray-600">/年（税込）</span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
                  <dt className="text-sm text-gray-700">2年使った場合の合計</dt>
                  <dd className="text-base font-bold text-gray-900">
                    {formatYen(firstYearTotal + renewalTotal)}
                    <span className="text-xs font-normal text-gray-600">（税込）</span>
                  </dd>
                </div>
              </dl>
              {hasLimitedOffer && (
                <p className="mt-3 text-xs text-gray-600">※ {LIMITED_OFFER_NOTE}</p>
              )}
            </section>

            <LearningNote title={RENEWAL_LESSON.title}>
              <p>{RENEWAL_LESSON.body}</p>
            </LearningNote>

            {/* 申し込み確認の直前に出す勘違い1つだけ */}
            <LearningNote title={MISCONCEPTION.publish.title} tone="info">
              <p>{MISCONCEPTION.publish.body}</p>
            </LearningNote>

            {showEligibilityError && blocked.length > 0 && (
              <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3">
                <p className="text-sm font-bold text-red-900">
                  取得条件を満たしていない末尾が含まれています
                </p>
                <ul className="mt-2 space-y-2">
                  {blocked.map((line) => (
                    <li key={`${line.name}${line.tld}`} className="text-sm leading-relaxed text-red-900">
                      <span className="font-semibold">
                        {line.name}
                        {line.tld}
                      </span>
                      : {line.verdict.reason}
                      {line.verdict.suggestion && <> {line.verdict.suggestion}</>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-red-900">
                  上の「カートから外す」で取り除いてから、もう一度お進みください。
                </p>
              </div>
            )}

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
              <Button
                variant="outline"
                className="h-11 px-5"
                nativeButton={false}
                render={<Link href={backToSearchHref} />}
              >
                検索に戻る
              </Button>
              <Button
                className="h-11 px-6 text-white"
                style={{ background: "var(--brand)" }}
                onClick={handleSubmit}
              >
                この内容でお申し込みに進む
                <ArrowRight className="ml-1 size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
