"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/auth-client";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { FeedbackBanner } from "@/components/feedback-banner";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { canUpdateSettings, isTransferLocked } from "../_lib/domain-status";
import { DomainOverview } from "./_parts/domain-overview";
import { NameServerForm } from "./_components/name-server-form";
import { TransferOutCard } from "./_components/transfer-out-card";
import { useDomainDetail } from "./_hooks/use-domain-detail.hook";

export default function DomainDetailPage() {
  const params = useParams<{ "domain-id": string }>();
  const domainId = params["domain-id"];
  const { data: session, isPending } = useSession();
  const isSignedIn = Boolean(session?.user);

  const state = useDomainDetail(domainId, isSignedIn);
  const { domain, loading, loadError, loadUnauthorized, running, feedback } =
    state;

  // 手続き中・廃止済みのドメインはレジストリ側が変更を受け付けない。
  // ボタンを出しても 409 で弾かれるだけなので、その理由を先に見せる。
  const settingsEditable = domain ? canUpdateSettings(domain.status) : false;
  const busy = running !== null;

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

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <BackLink href="/dashboard" label="マイドメインに戻る" />

        {!isSignedIn ? (
          <div className="mx-auto max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-sm">
            <h1 className="font-heading text-xl font-bold text-gray-900">
              ログインが必要です
            </h1>
            <p className="text-sm text-gray-600">
              ドメインの詳細を見るには、ログインしてください。
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
        ) : (
          <>
            <div>
              <h1 className="font-heading text-2xl font-bold break-all text-gray-900">
                {domain?.name ?? "ドメインの詳細"}
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                ネームサーバーの変更と、他社へ移管するための設定ができます。
              </p>
            </div>

            {feedback && (
              <FeedbackBanner
                tone={feedback.tone}
                message={feedback.message}
                unauthorized={feedback.unauthorized}
              />
            )}
            {loadError && (
              <FeedbackBanner
                tone="error"
                message={loadError}
                unauthorized={loadUnauthorized}
              />
            )}

            {loading && !domain && (
              <p className="py-8 text-center text-sm text-gray-600">
                ドメインを読み込んでいます...
              </p>
            )}

            {!loading && !domain && !loadError && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
                <p className="text-sm text-gray-700">
                  このドメインは見つかりませんでした。
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  すでに手放したか、他のアカウントで管理している可能性があります。
                </p>
              </div>
            )}

            {domain && (
              <>
                <DomainOverview domain={domain} />

                {!settingsEditable && (
                  <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                    このドメインはいま手続き中か廃止済みのため、設定を変更できません。
                  </p>
                )}

                <NameServerForm
                  current={domain.nameservers ?? []}
                  disabled={!settingsEditable || busy}
                  running={running === "nameServers"}
                  onSubmit={state.updateNameServers}
                />

                <TransferOutCard
                  locked={isTransferLocked(domain.statuses ?? [])}
                  disabled={!settingsEditable || busy}
                  runningAuthInfo={running === "authInfo"}
                  runningLock={running === "transferLock"}
                  onUpdateAuthInfo={state.updateAuthInfo}
                  onSetLock={state.setTransferLock}
                />
              </>
            )}
          </>
        )}

        <BackLink href="/dashboard" label="マイドメインに戻る" />
      </main>

      <SiteFooter />
    </div>
  );
}
