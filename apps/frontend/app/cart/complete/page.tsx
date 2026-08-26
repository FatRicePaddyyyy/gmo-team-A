"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckoutStepper } from "@/components/checkout-stepper";
import { LearningNote } from "@/components/learning-note";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useCart } from "@/shared/hooks/use-cart.hook";
import { loadConfirmedOrder, type ConfirmedOrder } from "@/shared/lib/order-store";
import { buildFlowSteps } from "@/shared/lib/progress-store";
import { purposeLabel } from "@/shared/lib/purpose";
import { MISCONCEPTION } from "@/shared/lib/tld-catalog";

const COMPLETE_STEPS = buildFlowSteps("signup");

/**
 * 確認までを終えた画面。
 *
 * 「あなたが選んだ設定」を必ず出す。取り消しにくい選択が押した瞬間に消えると、
 * 学習どころか間違った理解を与えてしまうため。
 * 確認していない人が URL 直打ちで来たときは「完了」を名乗らない。
 */
export default function CartCompletePage() {
  const router = useRouter();
  const { clear } = useCart();
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [checked, setChecked] = useState(false);

  // ハイドレーション後に、確定した内容を読み出してからカートを空にする
  useEffect(() => {
    const loaded = loadConfirmedOrder();
    setOrder(loaded);
    setChecked(true);
    if (loaded) clear();
  }, [clear]);

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
              onClick={() => router.push("/cart")}
            >
              確認画面へ進む
            </Button>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  const settings = order?.settings;

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
            まだ課金は発生していません。実際に取得するには、このあとログインが必要です。
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
                  <span style={{ color: "var(--brand)" }}>{item.tld}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-gray-600">
              用途: <span className="font-semibold text-gray-900">{purposeLabel(order.purpose)}</span>
            </p>
          </section>
        )}

        {/* 取り消しにくい選択は、選んだ瞬間に消さず必ずここに出す */}
        {settings && (
          <section
            aria-labelledby="settings-heading"
            className="mt-6 rounded-lg border border-border bg-white px-4 py-4 shadow-sm"
          >
            <h2 id="settings-heading" className="mb-3 text-base font-bold text-gray-900">
              あなたが選んだ設定
            </h2>
            <ul className="space-y-3">
              <li
                className={`rounded-lg px-3 py-3 ${
                  settings.whoisProxy ? "bg-gray-50" : "bg-red-50"
                }`}
              >
                <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  {settings.whoisProxy ? (
                    <ShieldCheck className="size-4 shrink-0 text-green-600" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="size-4 shrink-0 text-red-600" aria-hidden="true" />
                  )}
                  Whois 情報公開代行: {settings.whoisProxy ? "使う" : "使わない"}
                </p>
                <p
                  className={`mt-1 text-sm leading-relaxed ${
                    settings.whoisProxy ? "text-gray-700" : "text-red-900"
                  }`}
                >
                  {settings.whoisProxy
                    ? "あなたの氏名・住所・電話番号は公開されません。代わりに当社（ドメインを登録する事業者）の情報が表示されます。"
                    : "あなたの氏名・住所・電話番号が公開されます。一度公開された情報は完全には取り消せません。"}
                </p>
                <Link
                  href="/cart"
                  className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-[var(--brand)] underline underline-offset-2"
                >
                  変更する
                </Link>
              </li>

              <li
                className={`rounded-lg px-3 py-3 ${settings.autoRenew ? "bg-gray-50" : "bg-red-50"}`}
              >
                <p className="flex items-center gap-2 text-sm font-bold text-gray-900">
                  {settings.autoRenew ? (
                    <ShieldCheck className="size-4 shrink-0 text-green-600" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="size-4 shrink-0 text-red-600" aria-hidden="true" />
                  )}
                  自動更新: {settings.autoRenew ? "オン" : "オフ"}
                </p>
                <p
                  className={`mt-1 text-sm leading-relaxed ${
                    settings.autoRenew ? "text-gray-700" : "text-red-900"
                  }`}
                >
                  {settings.autoRenew
                    ? "毎年の更新料が自動で請求され、更新し忘れによる失効を防げます。"
                    : "毎年ご自身で更新手続きが必要です。忘れるとサイトもメールも止まり、他の人に取られることがあります。"}
                </p>
                <Link
                  href="/cart"
                  className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-[var(--brand)] underline underline-offset-2"
                >
                  変更する
                </Link>
              </li>
            </ul>
          </section>
        )}

        <div className="mt-6 space-y-3">
          <LearningNote title="この先で起きること" tone="info">
            <p>
              ログインすると、その場でこのドメインが登録されます（設定: Whois 情報公開代行:{" "}
              {settings?.whoisProxy ? "使う" : "使わない"} ／ 自動更新:{" "}
              {settings?.autoRenew ? "オン" : "オフ"}
              ）。このデモに決済機能は無いため、料金は発生しません。
            </p>
          </LearningNote>

          <LearningNote title={MISCONCEPTION.publish.title} tone="warn">
            <p>{MISCONCEPTION.publish.body}</p>
          </LearningNote>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-gray-50 px-4 py-3 text-sm text-gray-700">
            <Info className="mt-0.5 size-4 shrink-0 text-gray-500" aria-hidden="true" />
            <p>
              このサイトは学習用のデモです。ログインと同時にドメインの登録は実際に行われますが、
              決済機能は無いため料金が請求されることはありません。
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-border bg-gray-50 px-4 py-4 text-center">
          <p className="text-sm font-bold text-gray-900">
            お申し込みにはログインが必要です
          </p>
          <p className="mt-1 text-sm leading-relaxed text-gray-600">
            ドメインの管理・更新のため、購入にはアカウントとの紐付けが必須です。
          </p>
        </div>

        <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Button
            className="h-11 px-6 text-white"
            style={{ background: "var(--brand)" }}
            nativeButton={false}
            render={<Link href="/login" />}
          >
            ログイン
          </Button>
          <Button
            variant="outline"
            className="h-11 px-5"
            nativeButton={false}
            render={<Link href="/search" />}
          >
            別のドメインを探す
          </Button>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
