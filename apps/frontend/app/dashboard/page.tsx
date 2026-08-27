"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useSession } from "@/auth-client";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { DomainList } from "./_components/domain-list";
import { InboundTransferList } from "./_components/inbound-transfer-list";
import { useInboundTransfers } from "./_hooks/use-inbound-transfers.hook";
import { useMyDomains } from "./_hooks/use-my-domains.hook";

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const isSignedIn = Boolean(session?.user);

  const domainsState = useMyDomains(isSignedIn);
  const { refresh: refreshDomains } = domainsState;

  // 移管を承認 / 却下するとドメインの status が変わるので、両方の一覧を取り直す
  const onDomainsChanged = useCallback(
    () => refreshDomains(),
    [refreshDomains],
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
        {isSignedIn ? (
          <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="font-heading text-2xl font-bold text-gray-900">
                  マイドメイン
                </h1>
                <p className="mt-1 text-sm text-gray-600">
                  {session?.user.name || session?.user.email} さんのドメイン
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href="/transfer" />}
                >
                  <ArrowLeftRight aria-hidden="true" />
                  他社ドメインを移管する
                </Button>
              </div>
            </div>

            <InboundTransferList state={transfersState} />
            <DomainList state={domainsState} />
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
