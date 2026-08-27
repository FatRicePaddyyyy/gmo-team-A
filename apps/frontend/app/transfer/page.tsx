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
import { OutgoingDomainPicker } from "./_components/outgoing-domain-picker";

export default function TransferPage() {
  const { data: session, isPending } = useSession();
  const isSignedIn = Boolean(session?.user);
  const state = useTransferRequests(isSignedIn);
  // 「渡す」側の入口として、自分のドメインも並べる
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
            ドメインの引っ越し
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            ドメインは事業者をまたいで移せます。移すには相手の事業者が発行した「認証コード」が必要で、
            現在の管理者が承認するまで完了しません。数日かかることもあります。
          </p>

          {/* 「移管元」「移管先」という言葉は初めての人には向きが分からないので、
              どちらの立場なのかを日本語で言い換える。
              カードや枠で囲むと押せるものに見えてしまうため、地の文として置く。 */}
          <dl className="mt-4 space-y-2 border-l-2 border-gray-300 pl-4 text-sm text-gray-600">
            <div>
              <dt className="inline font-semibold text-gray-900">
                もらう（移管先になる）
              </dt>
              <dd className="inline">
                … 他社にあるドメインを、こちらへ引き取ることです。
                相手から認証コードをもらって申請します。
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold text-gray-900">
                渡す（移管元になる）
              </dt>
              <dd className="inline">
                … いま持っているドメインを、他社へ引き渡すことです。
                こちらで認証コードを発行して相手に伝えます。
              </dd>
            </div>
          </dl>
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

            {/* --- もらう側（他社 → ここ） --- */}
            <section className="space-y-4">
              <div>
                <h2 className="font-heading text-xl font-bold text-gray-900">
                  他社のドメインをここへ移す
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  いま他の事業者で管理しているドメインを、こちらへ引き取ります。
                  移管元の管理画面で発行した認証コードを用意してください。
                </p>
              </div>

              <TransferRequestForm
                submitting={state.submitting}
                onSubmitRequest={state.request}
                ownedNames={myDomains.domains.map((domain) => domain.name)}
              />

              <TransferList state={state} />
            </section>

            <hr className="border-gray-200" />

            {/* --- 渡す側（ここ → 他社） --- */}
            <OutgoingDomainPicker state={myDomains} />
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
