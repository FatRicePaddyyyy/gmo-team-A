"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, Info } from "lucide-react";
import { useSession } from "@/auth-client";
import { Button } from "@/components/ui/button";
import { CheckoutStepper } from "@/components/checkout-stepper";
import { FeedbackBanner } from "@/components/feedback-banner";
import { GlossaryTerm } from "@/components/glossary-term";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { $createDomain } from "@/clients";
import { callApi } from "@/shared/lib/api-result";
import { isRetryableFailure } from "@/shared/lib/maintenance";
import {
  clearConfirmedOrder,
  loadConfirmedOrder,
  type ConfirmedOrder,
} from "@/shared/lib/order-store";
import { buildFlowSteps } from "@/shared/lib/progress-store";
import { findTld } from "@/shared/lib/tld-catalog";
import { PAYMENT_METHOD } from "@/shared/lib/payment-methods";
import { NoOrderNotice } from "../_components/no-order-notice";

const PAYMENT_STEPS = buildFlowSteps("payment");
// ログインを求めている画面では、進み具合は「お支払い」ではなく「ログイン」。
// ステッパーは開いているページではなく、いま求めている操作に合わせる。
const LOGIN_STEPS = buildFlowSteps("login");

/**
 * ログイン後のお支払い内容の確認画面。
 *
 * このデモに決済機能は無いので、支払い方法はクレジットカード固定で表示するだけ。
 * 「確定する」を押した時点で実際にドメインを登録する
 * （ここまでは取り消しやすい選択なので、確定操作の直前に実行する）。
 */
export default function CartPaymentPage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const isLoggedIn = Boolean(session?.user);
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  // 401 のときだけログインし直す導線を出すため、理由まで持っておく。
  const [failureUnauthorized, setFailureUnauthorized] = useState(false);
  // 「すでに登録されています」等、押し直しても直らない失敗が起きたか。
  // order 自体は消さない（消すと NoOrderNotice に切り替わり、下の失敗メッセージが
  // 表示されないまま消えてしまうため）。表示はそのままに、確定ボタンだけ止める。
  const [orderInvalidated, setOrderInvalidated] = useState(false);

  useEffect(() => {
    setOrder(loadConfirmedOrder());
    setChecked(true);
  }, []);

  // セッションと申し込みの読み込みが終わるまでは、どの画面を出すか決められない。
  // 先に描いてしまうと「ログイン」と「マイドメイン」が一瞬入れ替わったり、
  // 申し込みが無い人に支払いフォームが一瞬見えたりする。
  // dashboard / transfer と同じ出し方に揃えている。
  if (!checked || sessionPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">読み込み中...</div>
      </div>
    );
  }

  if (!order) {
    return <NoOrderNotice isLoggedIn={isLoggedIn} />;
  }

  // 申し込みはあるがログインしていない場合。ドメイン登録は認証必須なので、
  // このまま「確定する」を押しても必ず 401 になる。押させる前に理由と導線を出す。
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SiteHeader />
        <CheckoutStepper steps={LOGIN_STEPS} />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <div className="rounded-lg border border-border bg-white px-4 py-12 text-center shadow-sm">
            <Info className="mx-auto mb-3 size-8 text-gray-400" aria-hidden="true" />
            <h1 className="mb-1 text-xl font-bold text-gray-900">
              お支払いに進むにはログインが必要です
            </h1>
            <p className="mb-6 text-sm leading-relaxed text-gray-600">
              ドメインの管理・更新のため、取得にはアカウントとの紐付けが必須です。
              お申し込みの内容は残っているので、ログインするとこの画面に戻ります。
            </p>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
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
                render={<Link href="/cart/complete" />}
              >
                確認画面に戻る
              </Button>
            </div>
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
    setFailureUnauthorized(false);
    // 確定した各ドメインを登録する。現状は常に1件だが、将来複数対応する余地は残す。
    const results = await Promise.all(
      order.items.map(async (item) => {
        const fullName = `${item.name}${item.tld}`;
        const result = await callApi(
          $createDomain({ json: { name: fullName, period: { unit: "Y", value: 1 } } }),
        );
        return result.success
          ? null
          : {
              message: `${fullName}: ${result.error}`,
              rawError: result.error,
              unauthorized: result.unauthorized,
            };
      }),
    );
    setSubmitting(false);
    const failedResults = results.filter((failure) => failure !== null);
    const failed = failedResults.map((failure) => failure.message);
    if (failed.length > 0) {
      setFailureUnauthorized(failedResults.some((failure) => failure.unauthorized));
      setFailures(failed);
      // セッション切れ・メンテナンス・通信断は時間をおけば直るので、注文を残して
      // 再試行できるようにする。「すでに登録されています」のような直らない失敗が
      // 1件でもあれば、再試行させても無駄なので注文を消して別の名前を探させる。
      const hasNonRetryable = failedResults.some(
        (failure) => !failure.unauthorized && !isRetryableFailure(failure.rawError),
      );
      if (hasNonRetryable) {
        clearConfirmedOrder();
        setOrderInvalidated(true);
      }
      return;
    }
    // 全件成功。取得完了ページで「何が取れたか」を出すため、ConfirmedOrder は
    // ここでは消さず /cart/done 側で表示後に消す（clearConfirmedOrder は /cart/done 内）
    router.push("/cart/done");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />
      <CheckoutStepper steps={PAYMENT_STEPS} />

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-1 text-2xl font-bold text-gray-900">お支払い内容の確認</h1>
        <p className="mb-6 text-sm leading-relaxed text-gray-600">
          内容を確認して「確定する」を押すと、ドメインの取得手続きが始まります。
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

        {/* 選択肢は 1 つしかないので、ラジオボタンにはしない。
            押しても何も変わらないものを操作させると、利用者は
            「まだ選び終えていないのでは」と手を止めてしまう。 */}
        <section
          aria-labelledby="payment-method-heading"
          className="mb-6 rounded-lg border border-border bg-white px-4 py-4 shadow-sm"
        >
          <h2
            id="payment-method-heading"
            className="mb-1 flex items-center gap-2 text-base font-bold text-gray-900"
          >
            <CreditCard className="size-5 shrink-0" aria-hidden="true" />
            お支払い方法
          </h2>
          <p className="font-semibold text-gray-900">{PAYMENT_METHOD.label}</p>
          <p className="mt-1 text-sm text-gray-600">{PAYMENT_METHOD.description}</p>
        </section>

        {failures.length > 0 && (
          <div className="mb-6">
            {/* このデモに決済は無いので「お支払いは完了しました」は事実に反する。
                起きたのはドメイン登録の失敗だけなので、そう書く。 */}
            <FeedbackBanner
              tone="error"
              message="ドメインの登録に失敗しました。"
              unauthorized={failureUnauthorized}
            />
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-900">
              {failures.map((failure) => (
                <li key={failure}>{failure}</li>
              ))}
            </ul>
            {orderInvalidated ? (
              <p className="mt-2 text-sm text-red-900">
                この名前ではこれ以上お申し込みを進められません。別のドメイン名で探し直してください。
              </p>
            ) : (
              <Link
                href="/dashboard"
                className="mt-2 inline-block text-sm font-semibold text-[var(--brand-dark)] underline underline-offset-2"
              >
                ダッシュボードへ進む
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
          {orderInvalidated ? (
            <Button
              className="h-11 px-6 text-white"
              style={{ background: "var(--brand)" }}
              nativeButton={false}
              render={<Link href="/" />}
            >
              ドメインを探し直す
            </Button>
          ) : (
            <>
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
            </>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
