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
import { useMyDomains } from "../dashboard/_hooks/use-my-domains.hook";

export default function TransferPage() {
  const { data: session, isPending } = useSession();
  const isSignedIn = Boolean(session?.user);
  const state = useTransferRequests(isSignedIn);
  // 入力欄に「いま持っているドメイン」を出すためだけに使う
  const myDomains = useMyDomains(isSignedIn);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <SiteHeader />

      <main className="w-full flex-1 mx-auto max-w-3xl space-y-8 px-4 py-8">
        <BackLink href="/dashboard" label="マイドメインに戻る" />

        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900">
            他社のドメインをここへ移す
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            いま他の事業者で管理しているドメインを、こちらへ引き取ります。
            引き取るには移管元の管理画面で発行した「認証コード」が必要で、
            現在の管理者が承認するまで完了しません。数日かかることもあります。
          </p>

          {/* 逆向き（自分のドメインを他社へ渡す）はドメインごとの操作なので、
              ここには置かず設定画面へ案内するだけにする */}
          <p className="mt-3 border-l-2 border-gray-300 pl-4 text-sm text-gray-600">
            逆に
            <span className="font-semibold text-gray-900">
              自分のドメインを他社へ渡したい
            </span>
            ときは、この画面ではなく
            <Link
              href="/dashboard"
              className="font-semibold text-[var(--brand)] underline underline-offset-2"
            >
              マイドメイン
            </Link>
            から対象のドメインを開き、設定の中で手続きします。
          </p>
        </div>

        {isSignedIn ? (
          <>
            {state.feedback && (
              <FeedbackBanner
                tone={state.feedback.tone}
                message={state.feedback.message}
                unauthorized={state.feedback.unauthorized}
              />
            )}

            <TransferRequestForm
              submitting={state.submitting}
              onSubmitRequest={state.request}
              ownedNames={myDomains.domains.map((domain) => domain.name)}
            />

            <TransferList state={state} />
          </>
        ) : (
          <div className="mx-auto max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-gray-600">
              移管の申請にはログインが必要です。
            </p>
            <Button
              className="w-full"
              variant="brand"
              nativeButton={false}
              render={<Link href="/login" />}
            >
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
