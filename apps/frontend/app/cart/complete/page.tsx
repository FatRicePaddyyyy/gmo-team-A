"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Info } from "lucide-react";
import { useSession } from "@/auth-client";
import { Button } from "@/components/ui/button";
import { CheckoutStepper } from "@/components/checkout-stepper";
import { GlossaryTerm } from "@/components/glossary-term";
import { LearningNote } from "@/components/learning-note";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { loadConfirmedOrder, type ConfirmedOrder } from "@/shared/lib/order-store";
import { buildFlowSteps } from "@/shared/lib/progress-store";
import { purposeLabel } from "@/shared/lib/purpose";
import { findTld, MISCONCEPTION } from "@/shared/lib/tld-catalog";

const COMPLETE_STEPS = buildFlowSteps("login");

/**
 * 確認までを終えた画面。
 *
 * 確認していない人が URL 直打ちで来たときは「完了」を名乗らない。
 */
export default function CartCompletePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isLoggedIn = Boolean(session?.user);
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [checked, setChecked] = useState(false);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />
      <CheckoutStepper steps={COMPLETE_STEPS} />

      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-lg border border-border bg-white px-4 py-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto mb-3 size-10 text-green-600" aria-hidden="true" />
          <h1 className="mb-2 text-2xl font-bold text-gray-900">
            お申し込み内容の確認まで完了しました
          </h1>
          <p className="text-sm leading-relaxed text-gray-600">
            まだ課金は発生していません。実際に取得するには、このあと
            {isLoggedIn ? "お支払い方法の選択" : "ログイン"}が必要です。
          </p>
        </div>

        {order && (
          <section
            aria-labelledby="confirmed-heading"
            className="mt-6 rounded-lg border border-border bg-white px-4 py-4 shadow-sm"
          >
            <h2 id="confirmed-heading" className="mb-3 text-base font-bold text-gray-900">
              確認したドメイン
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
            <p className="mt-3 text-sm text-gray-600">
              用途: <span className="font-semibold text-gray-900">{purposeLabel(order.purpose)}</span>
            </p>
          </section>
        )}

        <div className="mt-6 space-y-3">
          <LearningNote title="この先で起きること" tone="info">
            <p>
              {isLoggedIn
                ? "お支払い方法の選択に進みます。"
                : "ログインすると、お支払い方法の選択に進みます。"}
              選択後に「確定する」を押すと、その場でこのドメインが登録されます。
            </p>
          </LearningNote>

          <LearningNote title={MISCONCEPTION.publish.title} tone="warn">
            <p>{MISCONCEPTION.publish.body}</p>
          </LearningNote>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <Info className="mt-0.5 size-4 shrink-0 text-gray-500" aria-hidden="true" />
            <p>
              このサイトは学習用のデモです。お支払い方法はどれを選んでも、実際の決済機能が無いため料金が請求されることはありません。
            </p>
          </div>
        </div>

        {!isLoggedIn && (
          <div className="mt-6 rounded-lg border border-border bg-gray-50 px-4 py-4 text-center">
            <p className="text-sm font-bold text-gray-900">
              お申し込みにはログインが必要です
            </p>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              ドメインの管理・更新のため、購入にはアカウントとの紐付けが必須です。
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Button
            className="h-11 px-6 text-white"
            style={{ background: "var(--brand)" }}
            nativeButton={false}
            render={<Link href={isLoggedIn ? "/cart/payment" : "/login"} />}
          >
            {isLoggedIn ? "お支払い方法の選択に進む" : "ログイン"}
          </Button>
          <Button
            variant="outline"
            className="h-11 px-5"
            nativeButton={false}
            render={<Link href="/" />}
          >
            別のドメインを探す
          </Button>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
