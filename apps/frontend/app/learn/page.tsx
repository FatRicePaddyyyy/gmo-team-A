"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { LearningSections } from "@/components/learning-sections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { useProgress } from "@/shared/hooks/use-progress.hook";
import { readFromParam, resolveReturnTo } from "@/shared/lib/return-to";

/**
 * じっくり読むための解説ページ。
 *
 * 検索の途中で読まされると邪魔になる静的な解説（料金表・TLD ガイド・FAQ・勘違い一覧）は
 * ここに集約する。`/search` は結果と次の一手だけに絞る。
 *
 * ここは検索結果からの「寄り道」なので、**必ず元の判断に帰れる**ようにする。
 * 戻り先は `?from=` →（無ければ）直前に検索した名前 →（それも無ければ）トップ の順で決める。
 */
export default function LearnPage() {
  const router = useRouter();
  const { state } = useProgress();
  const [from, setFrom] = useState<string | null>(null);

  // useSearchParams はサスペンス境界が要るため、マウント後に location から読む
  useEffect(() => {
    setFrom(readFromParam());
  }, []);

  const backTo = resolveReturnTo(from, state.searchedName);

  /** 料金表の「この末尾で検索する」。読んだ知識をそのまま行動に接続する */
  const handleSelectTld = useCallback(
    (tld: string) => {
      const base = state.searchedName?.trim() || "example";
      router.push(`/?q=${encodeURIComponent(`${base}${tld}`)}`);
    },
    [router, state.searchedName],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />

      {/* 上部の戻り導線。読み始める前に「いつでも帰れる」ことを見せる */}
      <div className="border-b border-border bg-white">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <BackLink href={backTo.href} label={backTo.label} />
        </div>
      </div>

      <div className="bg-white py-8">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h1 className="mb-2 text-2xl font-bold text-gray-900">ドメインを学ぶ</h1>
          <p className="text-sm leading-relaxed text-gray-600">
            決める前に知っておきたいこと、末尾（TLD）の違い、料金、取得の流れ、よくある勘違いをまとめています。
          </p>
        </div>
      </div>

      <LearningSections onSelectTld={handleSelectTld} />

      {/* 下部の戻り導線。読み終わる位置はここなので、ここから帰れないと意味がない */}
      <section className="bg-gray-50 pb-12">
        <div className="mx-auto max-w-3xl px-4">
          <div className="rounded-xl border border-border bg-white px-4 py-5 text-center shadow-sm">
            <p className="mb-3 text-sm leading-relaxed text-gray-700">
              ここまでが解説です。読んだことを使って、続きを決めましょう。
            </p>
            <BackLink href={backTo.href} label={backTo.label} />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
