"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useSession } from "@/auth-client";
import { useInboundTransfers } from "../_hooks/use-inbound-transfers.hook";
import { BackLink } from "@/components/back-link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackBanner } from "@/components/feedback-banner";
import { GlossaryTerm } from "@/components/glossary-term";
import { GLOSSARY } from "@/shared/lib/glossary";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  canDelete,
  canRenew,
  canRestore,
  canUpdateSettings,
  statusHintOf,
} from "../_lib/domain-status";
import { DomainOverview } from "./_parts/domain-overview";
import { NameServerForm } from "./_components/name-server-form";
import { IncomingTransferCard } from "./_components/incoming-transfer-card";
import { LifecycleCard } from "./_components/lifecycle-card";
import { RenewCard } from "./_components/renew-card";
import { TransferOutCard } from "./_components/transfer-out-card";
import { useDomainDetail } from "./_hooks/use-domain-detail.hook";

export default function DomainDetailPage() {
  const params = useParams<{ "domain-id": string }>();
  const domainId = params["domain-id"];
  const { data: session, isPending } = useSession();
  const isSignedIn = Boolean(session?.user);

  const state = useDomainDetail(domainId, isSignedIn);
  // このドメインに対して他のレジストラへの引き渡し申請が来ていないか。
  // 一覧と同じ API を使い、対象の 1 件だけを取り出す。
  const inbound = useInboundTransfers(isSignedIn, state.refresh);
  const incoming = inbound.transfers.find((t) => t.domainId === domainId) ?? null;
  const { domain, loading, loadError, loadUnauthorized, running, feedback } =
    state;

  // レジストリに問い合わせられなかったとき（メンテナンス・疎通不良）。
  // DB の情報だけが返ってきているので、表示は続けつつ操作は止める。
  // 古い前提のまま操作を送ると、実際の状態と食い違ったまま実行されてしまう。
  const registryDown = domain ? !domain.registryAvailable : false;

  // 手続き中・廃止済みのドメインはレジストリ側が変更を受け付けない。
  // ボタンを出しても 409 で弾かれるだけなので、その理由を先に見せる。
  const settingsEditable = domain
    ? canUpdateSettings(domain.status) && !registryDown
    : false;
  // 更新は廃止済みでもできない一方、pendingUpdate などの手続き中とは条件が違うので
  // 設定変更（canUpdateSettings）とは別に判定する。
  // カードを消すのではなく、出したまま操作だけ止める。
  // メンテのたびに画面の形が変わると「機能が無くなった」と誤解されるため。
  const renewable = domain ? canRenew(domain.status) : false;
  const busy = running !== null;


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

      <main className="w-full flex-1 mx-auto max-w-3xl space-y-6 px-4 py-8">
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-heading text-2xl font-bold break-all text-gray-900">
                  {domain?.name ?? "ドメインの詳細"}
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  ネームサーバーの変更と、他の
                  <GlossaryTerm
                    description={GLOSSARY.registrar.description}
                    className="underline decoration-dotted underline-offset-4"
                  >
                    {GLOSSARY.registrar.term}
                  </GlossaryTerm>
                  へ移管するための設定ができます。
                </p>
              </div>
              {/* レジストリへの反映が遅れることがあるので、取り直す手段を置く。
                  変更が反映されなかったときのエラー文もこのボタンを案内している。 */}
              <Button
                variant="outline"
                size="sm"
                disabled={loading || busy}
                onClick={() => void state.refresh()}
              >
                <RefreshCw aria-hidden="true" />
                {loading ? "読み込み中..." : "最新にする"}
              </Button>
            </div>

            {loadError && (
              <FeedbackBanner
              context="detail"
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

                {incoming && (
                  <IncomingTransferCard
                    transfer={incoming}
                    running={inbound.running}
                    feedback={inbound.feedback}
                    onApprove={inbound.approve}
                    onReject={inbound.reject}
                  />
                )}

                {/* レジストリが落ちているときは理由が違うので、状態ヒントより先に出す */}
                {registryDown && (
                  /* 理由はバックエンドが返す。メンテナンスなら帯がそう出し、
                     通信不良ならその文言のまま出る。こちらで決めつけない。 */
                  <FeedbackBanner
                    tone="error"
                    context="detail"
                    message={
                      domain.registryUnavailableReason ??
                      "レジストリから最新の情報を取得できませんでした。"
                    }
                  />
                )}

                {!settingsEditable && !incoming && !registryDown && (
                  <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                    {statusHintOf(domain.status) ??
                      "このドメインはいま手続き中のため、設定を変更できません。"}
                  </p>
                )}

                {renewable && (
                  <RenewCard
                    domainName={domain.name}
                    expiresAt={domain.expiresAt}
                    disabled={busy || registryDown}
                    running={running === "renew"}
                    feedback={feedback?.source === "renew" ? feedback : null}
                    onRenew={state.renew}
                  />
                )}

                <NameServerForm
                  current={domain.nameservers ?? []}
                  unavailable={registryDown}
                  disabled={!settingsEditable || busy}
                  running={running === "nameServers"}
                  feedback={
                    feedback?.source === "nameServers" ? feedback : null
                  }
                  onSubmit={state.updateNameServers}
                />

                <TransferOutCard
                  disabled={!settingsEditable || busy}
                  runningAuthInfo={running === "authInfo"}
                  authInfoFeedback={
                    feedback?.source === "authInfo" ? feedback : null
                  }
                  onUpdateAuthInfo={state.updateAuthInfo}
                />

                <LifecycleCard
                  domainName={domain.name}
                  canDelete={canDelete(domain.status)}
                  canRestore={canRestore(domain.status)}
                  disabled={busy || registryDown}
                  runningDelete={running === "delete"}
                  runningRestore={running === "restore"}
                  feedback={
                    feedback?.source === "delete" ||
                    feedback?.source === "restore"
                      ? feedback
                      : null
                  }
                  onDelete={state.remove}
                  onRestore={state.restore}
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
