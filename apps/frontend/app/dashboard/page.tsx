"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionErrorNotice } from "@/components/connection-error-notice";
import { GlossaryTerm } from "@/components/glossary-term";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useAuthStatus } from "@/shared/hooks/use-auth-status.hook";
import { GLOSSARY } from "@/shared/lib/glossary";
import { DomainList } from "./_components/domain-list";
import { InboundTransferList } from "./_components/inbound-transfer-list";
import { useInboundTransferHistory } from "./_hooks/use-inbound-transfer-history.hook";
import { useInboundTransfers } from "./_hooks/use-inbound-transfers.hook";
import { useMyDomains } from "./_hooks/use-my-domains.hook";
import { InboundTransferHistoryList } from "./_components/inbound-transfer-history-list";

export default function DashboardPage() {
  const router = useRouter();
  const { session, isPending, isSignedIn, isConnectionError } = useAuthStatus();

  const domainsState = useMyDomains(isSignedIn);
  const { refresh: refreshDomains } = domainsState;

  // 引き渡し承認直後は詳細ページから `/dashboard?transferred=xxx.com` に飛んでくる。
  // クエリを読んでトーストで「引き渡しました」を告げてから、URL からクエリを消す。
  // useSearchParams はサスペンス境界が要るため、マウント後に window.location から読む。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const transferred = params.get("transferred");
    if (!transferred) return;
    toast.success(`${transferred} を他のレジストラへ引き渡しました`, {
      description:
        "しばらくはレジストリで反映処理中です。相手側で見えるまで少し時間がかかることがあります。",
    });
    // URL からクエリを消して、リロードや戻る操作で 2 回目のトーストが出ないようにする
    router.replace("/dashboard", { scroll: false });
  }, [router]);

  const historyState = useInboundTransferHistory(isSignedIn);
  const { refresh: refreshHistory } = historyState;

  // 移管を承認 / 却下するとドメインの status が変わるので、両方の一覧を取り直す。
  // あわせて履歴も取り直す。処理した申請は受信待ちから消えて履歴へ移るため、
  // ここで取り直さないと「消えただけ」に見えてしまう。
  const onDomainsChanged = useCallback(
    async () => {
      await refreshDomains();
      await refreshHistory();
    },
    [refreshDomains, refreshHistory],
  );
  const transfersState = useInboundTransfers(isSignedIn, onDomainsChanged);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* ヘッダー／フッターが無いと、ここから検索にも解説にも帰れない行き止まりになる */}
      <SiteHeader />

      <main className="w-full flex-1 mx-auto max-w-4xl px-4 py-8">
        {isConnectionError ? (
          <ConnectionErrorNotice />
        ) : isSignedIn ? (
          <div className="space-y-8">
            <div>
              <h1 className="font-heading text-2xl font-bold text-gray-900">
                マイドメイン
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                {session?.user.name || session?.user.email} さんのドメイン
              </p>
            </div>

            {/* 「他のレジストラのドメインをこちらへ移せる」ことは、言われないと思いつかない。
                見出し横の小さなボタンでは気づかれないので、
                何ができるのかを書いた一枚の案内として置く。
                「レジストラ」は初見では通じないので、その場で読める説明を添える (Issue #91)。 */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-light)] p-4">
              <div className="flex items-start gap-3">
                <ArrowLeftRight
                  className="mt-0.5 size-5 shrink-0 text-[var(--brand)]"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-heading text-base font-bold text-gray-900">
                    他の
                    <GlossaryTerm
                      description={GLOSSARY.registrar.description}
                    >
                      {GLOSSARY.registrar.term}
                    </GlossaryTerm>
                    で持っているドメインを、ここへ移せます
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    いま他の事業者で管理しているドメインを、この画面でまとめて管理できるようになります。
                    移管元で発行した認証コードが必要です。
                  </p>
                </div>
              </div>
              <Button
                variant="brand"
                nativeButton={false}
                render={<Link href="/transfer" />}
              >
                移管を申請する
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>

            <InboundTransferList state={transfersState} />
            <DomainList state={domainsState} />
            {/* 履歴は急いで見るものではないので、ドメイン一覧より後に置く */}
            <InboundTransferHistoryList state={historyState} />
          </div>
        ) : (
          <div className="mx-auto max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-sm">
            <h1 className="font-heading text-xl font-bold text-gray-900">
              ログインが必要です
            </h1>
            <p className="text-sm text-gray-600">
              取得済みドメインの管理には、ログインしてください。
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
      </main>

      <SiteFooter />
    </div>
  );
}
