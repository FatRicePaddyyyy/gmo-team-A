"use client";

import Link from "next/link";
import { useSession } from "@/auth-client";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { FeedbackBanner } from "@/components/feedback-banner";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TransferList } from "./_components/transfer-list";
import { TransferRequestForm } from "./_components/transfer-request-form";
import { useTransferRequests } from "./_hooks/use-transfer-requests.hook";

export default function TransferPage() {
  const { data: session, isPending } = useSession();
  const isSignedIn = Boolean(session?.user);
  const state = useTransferRequests(isSignedIn);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />

      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <BackLink href="/dashboard" label="マイドメインに戻る" />

        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900">
            他社のドメインを移管する
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            いま他の事業者で管理しているドメインを、こちらへ引っ越します。
            移管には現在の管理者の承認が必要なので、申請してもすぐには完了しません。
          </p>
        </div>

        {isSignedIn ? (
          <>
            {state.feedback && (
              <FeedbackBanner
                tone={state.feedback.tone}
                message={state.feedback.message}
              />
            )}

            <TransferRequestForm
              submitting={state.submitting}
              onSubmitRequest={state.request}
            />

            <TransferList state={state} />
          </>
        ) : (
          <div className="mx-auto max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-gray-600">
              移管の申請にはログインが必要です。
            </p>
            <Button className="w-full" render={<Link href="/login" />}>
              ログインページへ
            </Button>
          </div>
        )}

        <BackLink href="/dashboard" label="マイドメインに戻る" />
      </main>

      <SiteFooter />
    </div>
  );
}
