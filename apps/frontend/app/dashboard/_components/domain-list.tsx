"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoHint } from "@/components/info-hint";
import { GlossaryTerm } from "@/components/glossary-term";
import { GLOSSARY } from "@/shared/lib/glossary";
import type { useMyDomains } from "../_hooks/use-my-domains.hook";
import { FeedbackBanner } from "@/components/feedback-banner";
import { DomainRow } from "../_parts/domain-row";
import {
  DOMAIN_STATUS_CATEGORY_LABELS,
  domainStatusCategoryOf,
  type DomainStatusCategory,
} from "../_lib/domain-status";

interface DomainListProps {
  state: ReturnType<typeof useMyDomains>;
}

const STATUS_FILTER_OPTIONS: Array<DomainStatusCategory | "all"> = [
  "all",
  "usable",
  "pending",
  "deleted",
];

type SortKey = "expiry" | "name" | "createdAt";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "expiry", label: "有効期限が近い順" },
  { value: "name", label: "名前順" },
  { value: "createdAt", label: "取得日が新しい順" },
];

function compareDomains(a: { name: string; expiresAt: string; createdAt: string }, b: typeof a, sortKey: SortKey): number {
  if (sortKey === "name") return a.name.localeCompare(b.name);
  if (sortKey === "createdAt") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
}

/**
 * 取得済みドメインの一覧セクション。取得も操作も `useMyDomains` が持つ。
 *
 * 並び替え・絞り込みは表示だけの関心事なので、ここでローカルに持つ（issue #83）。
 * 保有数がまだ少ないうちはフロント側の処理で足りる。
 */
export function DomainList({ state }: DomainListProps) {
  const { domains, loading, loadError, loadUnauthorized, refresh } = state;
  const [statusFilter, setStatusFilter] = useState<DomainStatusCategory | "all">("all");
  const [nameFilter, setNameFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("expiry");

  const visibleDomains = useMemo(() => {
    const query = nameFilter.trim().toLowerCase();
    return domains
      .filter((domain) => {
        if (statusFilter !== "all" && domainStatusCategoryOf(domain.status) !== statusFilter) {
          return false;
        }
        if (query && !domain.name.toLowerCase().startsWith(query)) return false;
        return true;
      })
      .sort((a, b) => compareDomains(a, b, sortKey));
  }, [domains, statusFilter, nameFilter, sortKey]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-xl font-bold text-gray-900">
            取得済みのドメイン
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            それぞれのドメインを開くと、期限の延長・
            <GlossaryTerm description={GLOSSARY.nameServer.description}>
              {GLOSSARY.nameServer.term}
            </GlossaryTerm>
            の変更・他の
            <GlossaryTerm
              description={GLOSSARY.registrar.description}
            >
              {GLOSSARY.registrar.term}
            </GlossaryTerm>
            への引き渡し・廃止ができます。
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden="true" />
            {loading ? "読み込み中..." : "最新にする"}
          </Button>
          <InfoHint
            label="「最新にする」で何が更新されるか"
            description="有効期限や状態、他のレジストラからの引き渡し申請の有無を、レジストリに問い合わせて取り直します。放置していると自動で承認されてしまう申請にも、押した時点で気づけます。"
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

      {loading && domains.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-600">
          ドメインを読み込んでいます...
        </p>
      )}

      {!loading && !loadError && domains.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-sm text-gray-700">
            まだドメインを取得していません。
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              size="sm"
              variant="brand"
              nativeButton={false}
              render={<Link href="/" />}
            >
              ドメインを探す
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href="/transfer" />}
            >
              他のレジストラのドメインをここへ移す
            </Button>
          </div>
        </div>
      )}

      {domains.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={nameFilter}
              onChange={(event) => setNameFilter(event.target.value)}
              placeholder="ドメイン名で絞り込む（前方一致）"
              className="h-11 max-w-xs"
              aria-label="ドメイン名で絞り込む"
            />
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as DomainStatusCategory | "all")
              }
              aria-label="状態で絞り込む"
              className="h-11 rounded-lg border border-input bg-white px-3 text-sm text-gray-900 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "すべての状態" : DOMAIN_STATUS_CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              aria-label="並び替え"
              className="h-11 rounded-lg border border-input bg-white px-3 text-sm text-gray-900 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {visibleDomains.length === 0 ? (
            // domains.length > 0 の分岐内なので、ここに来るのは絞り込みで0件になったときだけ
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
              絞り込み条件に一致するドメインはありません。
            </p>
          ) : (
            <div className="space-y-3">
              {visibleDomains.map((domain) => (
                <DomainRow key={domain.id} domain={domain} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
