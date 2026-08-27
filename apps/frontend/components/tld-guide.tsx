"use client";

import { AlertTriangle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LearningNote } from "@/components/learning-note";
import {
  TLD_CATALOG,
  formatYen,
  renewalWarningOf,
  RENEWAL_LESSON,
} from "@/shared/lib/tld-catalog";

interface TldGuideProps {
  heading?: string;
  /** アンカーリンク用の id */
  id?: string;
}

/**
 * 「.com と .jp は何が違うの？」に答える学習セクション。
 * 一覧では1行だけ見せ、知りたい人だけがアコーディオンを開く（段階的開示）。
 */
export function TldGuide({ heading = "末尾（TLD）の選び方", id }: TldGuideProps) {
  return (
    <section id={id} className="scroll-mt-16 bg-white py-12">
      <div className="mx-auto max-w-3xl px-4">
        <h2 className="mb-2 text-center text-2xl font-bold text-gray-900">{heading}</h2>
        <p className="mb-8 text-center text-sm leading-relaxed text-gray-600">
          ドメインの末尾（.com など）を TLD と呼びます。値段だけでなく、
          <span className="font-semibold">取れる人の条件</span>と
          <span className="font-semibold">2年目以降の金額</span>が違います。
        </p>

        <Accordion className="space-y-2">
          {TLD_CATALOG.map((info) => {
            const warning = renewalWarningOf(info);
            return (
              <AccordionItem
                key={info.tld}
                value={info.tld}
                className="rounded-lg border border-border bg-white px-4"
              >
                <AccordionTrigger className="text-left font-medium text-gray-900 hover:no-underline">
                  <span className="flex flex-col gap-1 pr-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold" style={{ color: "var(--brand)" }}>
                        {info.tld}
                      </span>
                      {info.restricted && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                          法人のみ
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-normal leading-relaxed text-gray-700">
                      {info.summary}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-gray-700">
                  <p>{info.detail}</p>

                  <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 px-4 py-3 text-sm">
                    <dt className="text-gray-600">初年度</dt>
                    <dd className="text-right font-bold" style={{ color: "var(--brand)" }}>
                      {formatYen(info.firstYearPrice)}（税込）
                    </dd>
                    <dt className="text-gray-600">2年目以降</dt>
                    <dd className="text-right font-bold text-gray-900">
                      {formatYen(info.renewalPrice)}/年（税込）
                    </dd>
                  </dl>

                  {warning && (
                    <p className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      {warning}
                    </p>
                  )}

                  {info.eligibility && (
                    <p className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800">
                      <span className="font-semibold">取得できる人: </span>
                      {info.eligibility}
                    </p>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <div className="mt-6 space-y-3">
          {/* 上の TLD 一覧を見終えた人向けの補足。畳んでおいて、必要な人だけ開く */}
          <LearningNote title="迷ったらどうする？" collapsible>
            <p>
              個人でこれから始めるなら <span className="font-semibold">.com</span> が無難です。
              日本向けだと伝えたいなら <span className="font-semibold">.jp</span>、
              日本で登記した会社なら <span className="font-semibold">.co.jp</span> を検討してください。
            </p>
          </LearningNote>
          <LearningNote title={RENEWAL_LESSON.title} collapsible>
            <p>{RENEWAL_LESSON.body}</p>
          </LearningNote>
        </div>
      </div>
    </section>
  );
}
