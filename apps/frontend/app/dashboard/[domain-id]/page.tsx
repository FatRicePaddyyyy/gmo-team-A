"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useInboundTransfers } from "../_hooks/use-inbound-transfers.hook";
import { BackLink } from "@/components/back-link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionErrorNotice } from "@/components/connection-error-notice";
import { FeedbackBanner } from "@/components/feedback-banner";
import { GlossaryTerm } from "@/components/glossary-term";
import { InfoHint } from "@/components/info-hint";
import { GLOSSARY } from "@/shared/lib/glossary";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useAuthStatus } from "@/shared/hooks/use-auth-status.hook";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  canDelete,
  canRenew,
  canRestore,
  canUpdateLocks,
  canUpdateSettings,
  lockReason,
  statusHintOf,
} from "../_lib/domain-status";
import { DomainOverview } from "./_parts/domain-overview";
import { TransferOutSteps, type TransferOutStepKey } from "./_parts/transfer-out-steps";
import { AutoRenewCard } from "./_components/auto-renew-card";
import { NameServerForm } from "./_components/name-server-form";
import { IncomingTransferCard } from "./_components/incoming-transfer-card";
import { LifecycleCard } from "./_components/lifecycle-card";
import { LocksCard } from "./_components/locks-card";
import { RenewCard } from "./_components/renew-card";
import { TransferOutCard } from "./_components/transfer-out-card";
import { useDomainDetail } from "./_hooks/use-domain-detail.hook";
import type { InboundTransfer } from "../_hooks/use-inbound-transfers.hook";

export default function DomainDetailPage() {
  const router = useRouter();
  const params = useParams<{ "domain-id": string }>();
  const domainId = params["domain-id"];
  const { isPending, isSignedIn, isConnectionError } = useAuthStatus();

  const state = useDomainDetail(domainId, isSignedIn);
  // このドメインに対して他のレジストラへの引き渡し申請が来ていないか。
  // 一覧と同じ API を使い、対象の 1 件だけを取り出す。
  const inbound = useInboundTransfers(isSignedIn, state.refresh);
  const incoming = inbound.transfers.find((t) => t.domainId === domainId) ?? null;
  const { domain, loading, loadError, loadUnauthorized, running, feedback } =
    state;
  const [activeTab, setActiveTab] = useState<string>("overview");
  // 承認直後は refresh でドメインが消えて「見つかりませんでした」が瞬間的に出るのを
  // 避けたい。承認したら即マイドメイン一覧に飛ばし、飛んだ先でトーストを出す。
  // このフラグが立っている間は「見つかりませんでした」を出さない。
  const [handingOff, setHandingOff] = useState(false);

  const handleApproveIncoming = async (transfer: InboundTransfer) => {
    setHandingOff(true);
    const ok = await inbound.approve(transfer);
    if (ok) {
      // 承認完了 = このドメインは自分のものではなくなった。マイドメイン一覧へ戻し、
      // 遷移先で「引き渡しました」トーストを出す (query の transferred でドメイン名を渡す)
      router.push(`/dashboard?transferred=${encodeURIComponent(transfer.domainName)}`);
      return;
    }
    setHandingOff(false);
  };

  // レジストリに問い合わせられなかったとき（メンテナンス・疎通不良）。
  // DB の情報だけが返ってきているので、表示は続けつつ操作は止める。
  // 古い前提のまま操作を送ると、実際の状態と食い違ったまま実行されてしまう。
  const registryDown = domain ? !domain.registryAvailable : false;

  // 手続き中・廃止済み・clientUpdateProhibited のドメインはレジストリ側が変更を受け付けない。
  // ボタンを出しても 409 で弾かれるだけなので、その理由を先に見せる。
  const settingsEditable = domain
    ? canUpdateSettings(domain.status, domain.statuses) && !registryDown
    : false;
  // 更新は廃止済み・clientRenewProhibited でもできない一方、pendingUpdate などの手続き中とは
  // 条件が違うので設定変更（canUpdateSettings）とは別に判定する。
  // カードを消すのではなく、出したまま操作だけ止める。
  // メンテのたびに画面の形が変わると「機能が無くなった」と誤解されるため。
  const renewable = domain ? canRenew(domain.status, domain.statuses) : false;
  // ロックの管理カード自体は「自分でロックを解除する」ためのカードなので、
  // clientUpdateProhibited で自身を封じることは無い。手続き中・廃止済みだけを弾く。
  const locksEditable = domain
    ? canUpdateLocks(domain.status) && !registryDown
    : false;
  const busy = running !== null;

  // 他のレジストラへ渡すステップの現在位置。
  //   - authInfo 未設定 → ① 発行
  //   - authInfo 設定成功後・移管先申請前 → ② 移管先に伝える
  //   - status が pendingTransfer → ③ 移管先が申請済み・承認待ち
  //   - status が clientTransferProhibited 系や serverApproved は表示範囲外だが、
  //     基本的に status="pendingTransfer" になるまでの間は ② で扱う
  const transferOutStep: TransferOutStepKey = useMemo(() => {
    if (!domain) return "issue";
    if (domain.status === "pendingTransfer") return "wait";
    // authInfoFeedback (成功) が出ている間はステップ②に進める
    if (feedback?.source === "authInfo" && feedback.tone === "success") {
      return "hand-over";
    }
    return "issue";
  }, [domain, feedback]);


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

        {isConnectionError ? (
          <ConnectionErrorNotice />
        ) : !isSignedIn ? (
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
                  <GlossaryTerm description={GLOSSARY.nameServer.description}>
                    {GLOSSARY.nameServer.term}
                  </GlossaryTerm>
                  の変更と、他の
                  <GlossaryTerm
                    description={GLOSSARY.registrar.description}
                  >
                    {GLOSSARY.registrar.term}
                  </GlossaryTerm>
                  へ移管するための設定ができます。
                </p>
              </div>
              {/* レジストリへの反映が遅れることがあるので、取り直す手段を置く。
                  変更が反映されなかったときのエラー文もこのボタンを案内している。 */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || busy}
                  onClick={() => {
                    // ドメイン本体だけでなく、引き渡し申請の一覧も取り直す。
                    // ボタンの意図は「今の画面を最新に」なので、両方の情報を巻き込む。
                    void state.refresh();
                    void inbound.refresh();
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  {loading ? "読み込み中..." : "最新にする"}
                </Button>
                <InfoHint
                  label="「最新にする」で何が更新されるか"
                  description="このドメインの有効期限・ステータス・ネームサーバー・引き渡し申請の有無を、レジストリに問い合わせて取り直します。設定を変えたのに反映が遅い、他のレジストラからの引き渡し申請が来ているかもしれない、というときに使います。"
                />
              </div>
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

            {!loading && !domain && !loadError && !handingOff && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
                <p className="text-sm text-gray-700">
                  このドメインは見つかりませんでした。
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  すでに手放したか、他のアカウントで管理している可能性があります。
                </p>
              </div>
            )}

            {handingOff && (
              <p className="py-8 text-center text-sm text-gray-600">
                引き渡し処理中です...
              </p>
            )}

            {domain && (
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(String(v))}
                className="gap-4"
              >
                {/*
                  タブは 6 つ:
                    - overview: 現在の状態 (dl 一覧)
                    - renew:    有効期限を延ばす
                    - ns:       ネームサーバー
                    - transfer: 他のレジストラへ渡す (ステップインジケーター付き)
                    - locks:    保護 (client*Prohibited の 5 種トグル、Issue #107)
                    - lifecycle: 廃止・復旧
                */}
                <TabsList className="h-auto w-full flex-wrap gap-1 sm:flex-nowrap">
                  <TabsTrigger value="overview">現在の状態</TabsTrigger>
                  <TabsTrigger value="renew">有効期限を延ばす</TabsTrigger>
                  <TabsTrigger value="ns">ネームサーバー</TabsTrigger>
                  <TabsTrigger value="transfer">他のレジストラへ渡す</TabsTrigger>
                  <TabsTrigger value="locks">保護</TabsTrigger>
                  <TabsTrigger value="lifecycle">廃止・復旧</TabsTrigger>
                </TabsList>

                {/* レジストリが落ちているときはどのタブを開いても同じ制約 (最新値が取れない・変更が届かない)
                    がかかるので、Tabs 全体の直下 1 箇所にまとめて出す。以前は tab ごとに個別配置していたが、
                    抜けや文言差が出るので統一する。 */}
                {registryDown && (
                  <FeedbackBanner
                    tone="error"
                    context="detail"
                    message={
                      domain.registryUnavailableReason ??
                      "レジストリから最新の情報を取得できませんでした。"
                    }
                  />
                )}

                <TabsContent value="overview" className="space-y-4">
                  <DomainOverview domain={domain} />
                </TabsContent>

                <TabsContent value="renew" className="space-y-4">
                  {renewable ? (
                    <RenewCard
                      domainName={domain.name}
                      expiresAt={domain.expiresAt}
                      disabled={busy || registryDown}
                      running={running === "renew"}
                      feedback={feedback?.source === "renew" ? feedback : null}
                      onRenew={state.renew}
                    />
                  ) : (
                    <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
                      {/* clientRenewProhibited は status に出ないので、ロック起因なら
                          先に「保護タブで解除して」の導線を出す。 */}
                      {lockReason("clientRenewProhibited", domain.statuses) ??
                        statusHintOf(domain.status) ??
                        "このドメインはいま延長できない状態です。"}
                    </p>
                  )}

                  {/*
                    自動更新はDBの設定だけなので、レジストリ疎通不良（registryDown）でも
                    延長不可（!renewable）でも切り替えられる。busyだけで止める。
                  */}
                  <AutoRenewCard
                    autoRenew={domain.autoRenew}
                    disabled={busy}
                    running={running === "autoRenew"}
                    feedback={feedback?.source === "autoRenew" ? feedback : null}
                    onChange={state.updateAutoRenew}
                  />
                </TabsContent>

                <TabsContent value="ns" className="space-y-4">
                  {!settingsEditable && !registryDown && (
                    <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                      {lockReason("clientUpdateProhibited", domain.statuses) ??
                        statusHintOf(domain.status) ??
                        "このドメインはいま手続き中のため、設定を変更できません。"}
                    </p>
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
                </TabsContent>

                <TabsContent value="transfer" className="space-y-4">
                  <TransferOutSteps current={transferOutStep} />

                  {/* registryDown 時のバナーは Tabs 直下でまとめて表示している */}

                  {incoming && (
                    <IncomingTransferCard
                      transfer={incoming}
                      running={inbound.running}
                      feedback={inbound.feedback}
                      onApprove={handleApproveIncoming}
                      onReject={inbound.reject}
                    />
                  )}

                  {!settingsEditable && !incoming && !registryDown && (
                    <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                      {lockReason("clientUpdateProhibited", domain.statuses) ??
                        statusHintOf(domain.status) ??
                        "このドメインはいま手続き中のため、設定を変更できません。"}
                    </p>
                  )}

                  <TransferOutCard
                    disabled={!settingsEditable || busy}
                    runningAuthInfo={running === "authInfo"}
                    authInfoFeedback={
                      feedback?.source === "authInfo" ? feedback : null
                    }
                    onUpdateAuthInfo={state.updateAuthInfo}
                  />
                </TabsContent>

                <TabsContent value="locks" className="space-y-4">
                  {/* Issue #107 (2): client*Prohibited フラグの管理 UI。
                       レジストリが info を返せない状態 (メンテ等) では現状値が読めないので
                       操作は止める。廃止済み・移管中も現在は変更できないので同じ扱い。
                       clientUpdateProhibited が立っていても、このカードだけは自己解除できるように
                       他の設定変更カード (canUpdateSettings) とは別の canUpdateLocks で判定する。
                       registryDown 時のバナーは Tabs 直下でまとめて表示している。 */}
                  {!locksEditable && !registryDown && (
                    <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                      {statusHintOf(domain.status) ??
                        "このドメインはいま手続き中のため、保護設定を変更できません。"}
                    </p>
                  )}
                  <LocksCard
                    currentStatuses={domain.statuses ?? []}
                    disabled={!locksEditable || busy}
                    running={running === "locks"}
                    feedback={feedback?.source === "locks" ? feedback : null}
                    onSave={state.updateLocks}
                  />
                </TabsContent>

                <TabsContent value="lifecycle" className="space-y-4">
                  {/* clientDeleteProhibited は domain.status に出ないので、
                       LifecycleCard がカードを消しても statusHintOf からは理由を出せない。
                       保護タブでロックしていることを明示して、解除導線を示す。 */}
                  {!canDelete(domain.status, domain.statuses) &&
                    !canRestore(domain.status) &&
                    lockReason("clientDeleteProhibited", domain.statuses) && (
                      <p className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
                        {lockReason("clientDeleteProhibited", domain.statuses)}
                      </p>
                    )}
                  <LifecycleCard
                    domainName={domain.name}
                    canDelete={canDelete(domain.status, domain.statuses)}
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
                </TabsContent>
              </Tabs>
            )}
          </>
        )}

        <BackLink href="/dashboard" label="マイドメインに戻る" />
      </main>

      <SiteFooter />
    </div>
  );
}
