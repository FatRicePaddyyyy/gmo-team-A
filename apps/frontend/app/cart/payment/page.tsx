"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckoutStepper } from "@/components/checkout-stepper";
import { FeedbackBanner } from "@/components/feedback-banner";
import { GlossaryTerm } from "@/components/glossary-term";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { $createDomain } from "@/clients";
import { callApi } from "@/shared/lib/api-result";
import {
  clearConfirmedOrder,
  loadConfirmedOrder,
  type ConfirmedOrder,
} from "@/shared/lib/order-store";
import { buildFlowSteps } from "@/shared/lib/progress-store";
import { findTld } from "@/shared/lib/tld-catalog";
import { PAYMENT_METHODS, type PaymentMethod } from "@/shared/lib/payment-methods";

const PAYMENT_STEPS = buildFlowSteps("payment");

/**
 * ログイン後のお支払い方法選択画面。
 *
 * このデモに決済機能は無いため、選んだ方法は保存も送信もしない。
 * 「確定する」を押した時点で実際にドメインを登録する
 * （ここまでは取り消しやすい選択なので、確定操作の直前に実行する）。
 */
export default function CartPaymentPage() {
  const router = useRouter();
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [checked, setChecked] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("credit-card");
  const [submitting, setSubmitting] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  useEffect(() => {
    setOrder(loadConfirmedOrder());
    setChecked(true);
  }, []);

  if (checked && !order) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <div className="rounded-lg border border-dashed border-border bg-white px-4 py-12 text-center">
            <Info className="mx-auto mb-3 size-8 text-gray-400" aria-hidden="true" />
            <h1 className="mb-1 text-xl font-bold text-gray-900">まだお申し込みはありません</h1>
            <p className="mb-6 text-sm leading-relaxed text-gray-600">
              このページは、お申し込み内容の確認を終えた方に表示されます。
              まずはドメインを選んで、確認画面で設定を決めてください。
            </p>
            <Button
              className="h-11 px-5 text-white"
              style={{ background: "var(--brand)" }}
              onClick={() => router.push("/")}
            >
              ドメインを検索する
            </Button>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const handleConfirm = async () => {
    if (!order) return;
    setSubmitting(true);
    setFailures([]);
    // 確定した各ドメインを登録する。現状は常に1件だが、将来複数対応する余地は残す。
    const results = await Promise.all(
      order.items.map(async (item) => {
        const fullName = `${item.name}${item.tld}`;
        const result = await callApi(
          $createDomain({ json: { name: fullName, period: { unit: "Y", value: 1 } } }),
        );
        return result.success ? null : `${fullName}: ${result.error}`;
      }),
    );
    clearConfirmedOrder();
    setSubmitting(false);
    const failed = results.filter((failure): failure is string => failure !== null);
    if (failed.length > 0) {
      setFailures(failed);
      return;
    }
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />
      <CheckoutStepper steps={PAYMENT_STEPS} />

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">お支払い方法の選択</h1>
        <p className="mb-6 text-sm leading-relaxed text-gray-600">
          このデモに決済機能は無いため、選んだ方法にかかわらず料金は発生しません。
        </p>

        {order && (
          <section
            aria-labelledby="confirmed-heading"
            className="mb-6 rounded-lg border border-border bg-white px-4 py-4 shadow-sm"
          >
            <h2 id="confirmed-heading" className="mb-3 text-base font-bold text-gray-900">
              お申し込みのドメイン
            </h2>
            <ul className="space-y-1">
              {order.items.map((item) => (
                <li key={`${item.name}${item.tld}`} className="font-medium break-all text-gray-900">
                  {item.name}
                  <GlossaryTerm
                    description={
                      findTld(item.tld)?.summary ??
                      "インターネット上の住所（ドメイン名）の末尾につく「TLD」です。"
                    }
                  >
                    <span style={{ color: "var(--brand)" }}>{item.tld}</span>
                  </GlossaryTerm>
                </li>
              ))}
            </ul>
          </section>
        )}

        <fieldset className="mb-6 space-y-3 rounded-lg border border-border bg-white px-4 py-4 shadow-sm">
          <legend className="mb-1 flex items-center gap-2 text-base font-bold text-gray-900">
            <CreditCard className="size-5 shrink-0" aria-hidden="true" />
            お支払い方法
          </legend>
          {PAYMENT_METHODS.map((option) => (
            <label
              key={option.id}
              className="flex items-start gap-3 rounded-lg border border-border px-3 py-3 text-sm text-gray-900 has-[:checked]:border-[var(--brand)] has-[:checked]:bg-[var(--brand-light)]"
            >
              <input
                type="radio"
                name="payment-method"
                value={option.id}
                checked={method === option.id}
                onChange={() => setMethod(option.id)}
                className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
              />
              <span>
                <span className="font-semibold">{option.label}</span>
                <span className="mt-1 block text-gray-600">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {failures.length > 0 && (
          <div className="mb-6">
            <FeedbackBanner
              tone="error"
              message="お支払いは完了しましたが、一部のドメインの登録に失敗しました。"
            />
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900">
              {failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
            <Link
              href="/dashboard"
              className="mt-2 inline-block text-sm font-semibold text-[var(--brand-dark)] underline underline-offset-2"
            >
              ダッシュボードへ進む
            </Link>
          </div>
        )}

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            className="h-11 px-5"
            nativeButton={false}
            render={<Link href="/cart/complete" />}
          >
            確認画面に戻る
          </Button>
          <Button
            className="h-11 px-6 text-white"
            style={{ background: "var(--brand)" }}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "登録中..." : "この内容で確定する"}
          </Button>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
