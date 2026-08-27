"use client";

import { useEffect, useState } from "react";
import { Check, X, ArrowRight, SearchX, AlertTriangle, Info, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LearningNote } from "@/components/learning-note";
import {
  isMaintenanceError,
  MAINTENANCE_TITLE,
  maintenanceNoticeOf,
} from "@/shared/lib/maintenance";
import {
  checkEligibility,
  findTld,
  LIMITED_OFFER_NOTE,
  MISCONCEPTION,
  NO_CHARGE_YET_NOTE,
  tldAnchorId,
} from "@/shared/lib/tld-catalog";
import type { Purpose } from "@/shared/lib/purpose";

export interface DomainResult {
  tld: string;
  name: string;
  available: boolean;
  /**
   * 空き確認自体が失敗した（通信障害・レジストリ障害など）。
   * true のときは `available` の値を信用せず、「確認できませんでした」として
   * 取得済みとは別扱いで表示する（通信障害を空きなしと誤表示しないため）。
   */
  checkFailed?: boolean;
  /** 初年度の価格（表示用の文字列） */
  price: string;
  /** 2年目以降の年額（表示用の文字列） */
  renewalPrice?: string;
  popular?: boolean;
  sale?: boolean;
  /** ここから下は任意。TLDの学習用の情報 */
  summary?: string;
  detail?: string;
  /** 取得条件（.jp / .co.jp など） */
  eligibility?: string;
  /** 個人では取得できない（法人限定など） */
  restricted?: boolean;
  /** 2年目以降の値上がりが大きいときの警告 */
  renewalWarning?: string;
  /** 「2年使うと合計 ◯円」 */
  twoYearTotal?: string;
  /** 初年度価格が「お1人様1個限り」の特別価格か */
  limitedOffer?: boolean;
}

interface DomainSearchResultProps {
  query: string;
  results: DomainResult[];
  /** このドメインを選んで購入フローに進む */
  onProceed?: (domain: DomainResult) => void;
  /** 選ばれた用途。取得条件を満たさない末尾を選ばせないために使う */
  purpose?: Purpose | null;
  /** 「登記した会社として取得する」を選んだときに用途を切り替える */
  onDeclarePurpose?: (purpose: Purpose) => void;
  /**
   * 診断（/plan-finder）が勧めた末尾。
   * 一覧の先頭に出して目印を付け、「診断で学んだこと」がそのまま次の操作につながるようにする。
   */
  recommendedTld?: string | null;
  /**
   * 空き確認ができなかった理由（バックエンドの文言）。
   * レジストリのメンテナンス中かどうかで、利用者が取るべき行動が変わるため、
   * 「一時的な問題」で片付けずに理由に応じて書き分ける。
   */
  unavailableReason?: string | null;
}

export function DomainSearchResult({
  query,
  results,
  onProceed,
  purpose = null,
  onDeclarePurpose,
  recommendedTld = null,
  unavailableReason = null,
}: DomainSearchResultProps) {
  // 「なぜ選べないか」を開いている末尾。隠すのではなく、押したら理由を学べるようにする
  const [explainedTld, setExplainedTld] = useState<string | null>(null);
  // 勧めた末尾は先頭に出す。下までスクロールしないと見つからないと、診断の結果が死ぬ
  const available = results
    .filter((r) => r.available && !r.checkFailed)
    .sort((a, b) =>
      a.tld === recommendedTld ? -1 : b.tld === recommendedTld ? 1 : 0,
    );
  const taken = results.filter((r) => !r.available && !r.checkFailed);
  const checkFailed = results.filter((r) => r.checkFailed);
  const recommendedAvailable = available.some((r) => r.tld === recommendedTld);
  const recommendedTaken = taken.some((r) => r.tld === recommendedTld);

  // 診断から来た人を、勧めた末尾の行まで運ぶ
  useEffect(() => {
    if (!recommendedTld || !recommendedAvailable) return;
    const target = document.getElementById(tldAnchorId(recommendedTld));
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [recommendedTld, recommendedAvailable, query]);
  const hasLimitedOffer = available.some((r) => r.limitedOffer);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h2 className="mb-1 text-xl font-bold text-gray-900">
        「<span style={{ color: "var(--brand)" }}>{query}</span>」の検索結果
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        {results.length === 0
          ? "該当するドメインは見つかりませんでした"
          : checkFailed.length > 0
            ? `${available.length}件のドメインが取得可能です（${checkFailed.length}件は確認できませんでした）`
            : `${available.length}件のドメインが取得可能です`}
      </p>

      {/* 空状態 */}
      {results.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-white px-4 py-10 text-center">
          <SearchX className="mx-auto mb-3 size-8 text-gray-400" aria-hidden="true" />
          <p className="mb-1 font-semibold text-gray-900">検索結果がありません</p>
          <p className="text-sm text-gray-500">
            別のドメイン名でお試しください。記号を含まない半角英数字での検索がおすすめです。
          </p>
        </div>
      )}

      {/* 診断から来た人には、まず「さっきの結論」を画面上で再確認させる */}
      {recommendedTld && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-[var(--brand)] bg-[var(--brand-light)] px-3 py-2 text-sm text-gray-800">
          <Sparkles
            className="mt-0.5 size-4 shrink-0 text-[var(--brand)]"
            aria-hidden="true"
          />
          <span>
            診断の結果、あなたには{" "}
            <span className="font-bold" style={{ color: "var(--brand)" }}>
              {recommendedTld}
            </span>{" "}
            をおすすめしています。
            {recommendedAvailable
              ? "一覧の先頭に印をつけました。"
              : recommendedTaken
                ? "ただし、この名前ではすでに取得されています。別の名前か、下の他の末尾を検討してください。"
                : "この検索結果には含まれていません。別の末尾から選んでください。"}
          </span>
        </div>
      )}

      {available.length > 0 && (
        <div className="mb-4 space-y-3">
          {/* 各カードに繰り返すと読み飛ばされるので、リスト全体で1回だけ出す */}
          <p className="flex items-start gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-gray-700">
            <Info className="mt-0.5 size-4 shrink-0 text-gray-500" aria-hidden="true" />
            {NO_CHARGE_YET_NOTE}
          </p>

          {/* 検索結果を早く見たい人の邪魔をしないよう、既定では畳んでおく */}
          <LearningNote title="末尾（TLD）で何が変わるの？" collapsible>
            <p>
              <span className="font-semibold">.com</span> や{" "}
              <span className="font-semibold">.jp</span> のような末尾を「TLD」と呼びます。
              値段だけでなく<span className="font-semibold">取れる人の条件</span>も違います。
              各行の「このドメインについてくわしく」を開くと、選び方が分かります。
            </p>
          </LearningNote>

          {/* 価格を見比べる、まさにその場で出す勘違い1つだけ */}
          <LearningNote title={MISCONCEPTION.price.title} tone="warn" collapsible>
            <p>{MISCONCEPTION.price.body}</p>
          </LearningNote>
        </div>
      )}

      {/* 取得可能 */}
      {available.length > 0 && (
        <ul className="mb-6 space-y-3">
          {available.map((result) => {
            const info = findTld(result.tld);
            const verdict = info ? checkEligibility(info, purpose) : { allowed: true as const };
            const explaining = explainedTld === result.tld;
            const isRecommended = result.tld === recommendedTld;

            return (
              <li
                key={result.tld}
                id={tldAnchorId(result.tld)}
                className={`scroll-mt-24 rounded-lg bg-white px-4 py-4 shadow-sm transition-shadow hover:shadow-md ${
                  isRecommended
                    ? "border-2 border-[var(--brand)] ring-2 ring-[var(--brand-light)]"
                    : "border border-border"
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                        <Check className="size-4" aria-hidden="true" />
                        取得可能
                      </span>
                      <span className="font-semibold break-all text-gray-900">
                        {result.name}
                        <span style={{ color: "var(--brand)" }}>{result.tld}</span>
                      </span>
                      <span className="flex gap-1">
                        {isRecommended && (
                          <Badge className="bg-[var(--brand)] text-xs text-white">
                            診断のおすすめ
                          </Badge>
                        )}
                        {result.popular && (
                          <Badge className="bg-orange-500 text-xs text-white">人気</Badge>
                        )}
                        {result.restricted && (
                          <Badge className="bg-amber-500 text-xs text-white">法人のみ</Badge>
                        )}
                      </span>
                    </div>

                    {/* TLDが何なのかを、価格より先に1行で示す */}
                    {result.summary && (
                      <p className="mt-2 text-sm leading-relaxed text-gray-700">
                        {result.summary}
                      </p>
                    )}
                  </div>

                  {/* 価格: 初年度と2年目以降を同じ視認性で並べる */}
                  <div className="shrink-0 sm:w-56 sm:text-right">
                    <dl className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2 sm:justify-end">
                        <dt className="text-sm text-gray-600">初年度</dt>
                        <dd className="text-base font-bold" style={{ color: "var(--brand)" }}>
                          {result.price}
                          <span className="text-xs font-normal text-gray-600">（税込）</span>
                        </dd>
                      </div>
                      {result.renewalPrice && (
                        <div className="flex items-baseline justify-between gap-2 sm:justify-end">
                          <dt className="text-sm text-gray-600">2年目以降</dt>
                          <dd className="text-base font-bold text-gray-900">
                            {result.renewalPrice}
                            <span className="text-xs font-normal text-gray-600">/年（税込）</span>
                          </dd>
                        </div>
                      )}
                    </dl>
                    {result.twoYearTotal && (
                      <p className="mt-1 text-xs text-gray-600">{result.twoYearTotal}</p>
                    )}
                  </div>
                </div>

                {/* 2年目以降の値上がりが大きいTLDは、押す前に必ず見せる */}
                {result.renewalWarning && (
                  <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {result.renewalWarning}
                  </p>
                )}

                {/* 取得条件（.co.jp の法人限定など）は取得可否に直結するので目立たせる */}
                {result.eligibility && (
                  <p className="mt-2 flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gray-500" aria-hidden="true" />
                    <span>
                      <span className="font-semibold">取得できる人: </span>
                      {result.eligibility}
                    </span>
                  </p>
                )}

                {result.detail && (
                  <Accordion className="mt-2 border-t border-border">
                    <AccordionItem
                      value={`detail-${result.tld}`}
                      className="border-b-0 last:border-b-0"
                    >
                      <AccordionTrigger className="text-[var(--brand)]">
                        このドメインについてくわしく
                      </AccordionTrigger>
                      <AccordionContent className="text-sm leading-relaxed text-gray-700">
                        <p>{result.detail}</p>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}

                {/* 取得条件を満たさない末尾は、隠さずに止めて理由を説明する */}
                {explaining && !verdict.allowed && (
                  <div
                    role="alert"
                    className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3"
                  >
                    <p className="text-sm font-bold text-amber-950">
                      {result.tld} は選べません
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-amber-950">{verdict.reason}</p>
                    {verdict.suggestion && (
                      <p className="mt-1 text-sm leading-relaxed text-amber-950">
                        {verdict.suggestion}
                      </p>
                    )}
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      {onDeclarePurpose && (
                        <Button
                          variant="outline"
                          className="h-11 px-4"
                          onClick={() => {
                            onDeclarePurpose("corporate");
                            setExplainedTld(null);
                          }}
                        >
                          登記した会社として取得する
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        className="h-11 px-4"
                        onClick={() => setExplainedTld(null)}
                      >
                        別の末尾を見る
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
                  {!verdict.allowed && (
                    <p className="text-xs text-amber-900 sm:mr-auto">
                      あなたの用途では取得できない末尾です
                    </p>
                  )}
                  {verdict.allowed ? (
                    <Button
                      className="h-11 min-w-11 px-4 text-white"
                      style={{ background: "var(--brand)" }}
                      onClick={() => onProceed?.(result)}
                    >
                      <span>
                        このドメインで進む
                        <span className="sr-only">
                          （{result.name}
                          {result.tld}）
                        </span>
                      </span>
                      <ArrowRight className="ml-1 size-4" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-11 min-w-11 px-4"
                      aria-expanded={explaining}
                      onClick={() => setExplainedTld(explaining ? null : result.tld)}
                    >
                      <AlertTriangle className="mr-1 size-4" aria-hidden="true" />
                      <span>
                        なぜ選べないか見る
                        <span className="sr-only">
                          （{result.name}
                          {result.tld}）
                        </span>
                      </span>
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hasLimitedOffer && (
        <p className="mb-6 text-xs text-gray-600">※ {LIMITED_OFFER_NOTE}</p>
      )}

      {/* 確認できなかった分。空きなしと混同されないよう別枠で正直に出す */}
      {checkFailed.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="flex items-start gap-2 text-sm font-bold text-amber-950">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {isMaintenanceError(unavailableReason)
              ? MAINTENANCE_TITLE
              : "空き状況を確認できませんでした"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-amber-950">
            {isMaintenanceError(unavailableReason)
              ? `${maintenanceNoticeOf("search")}これらのドメインが取得できないという意味ではありません。`
              : "通信状況やレジストリ側の一時的な問題により確認できませんでした。実際には取得できる可能性があります。時間をおいて再検索してください。"}
          </p>
          <ul className="mt-2 space-y-1">
            {checkFailed.map((result) => (
              <li key={result.tld} className="font-medium break-all text-amber-950">
                {result.name}
                {result.tld}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 取得済み */}
      {taken.length > 0 && (
        <>
          <Separator className="mb-4" />
          <p className="mb-3 text-sm font-medium text-gray-600">
            取得済みのドメイン（すでに他の人が使っています）
          </p>
          <ul className="space-y-2">
            {taken.map((result) => (
              <li
                key={result.tld}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-gray-50 px-4 py-3"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">
                  <X className="size-4" aria-hidden="true" />
                  取得済み
                </span>
                <span className="font-medium break-all text-gray-600 line-through">
                  {result.name}
                  {result.tld}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
