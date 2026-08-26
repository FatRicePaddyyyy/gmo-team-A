"use client";

import { DomainPriceTable } from "@/components/domain-price-table";
import { FaqAccordion } from "@/components/faq-accordion";
import { FeatureCards } from "@/components/feature-cards";
import { StepsGuide } from "@/components/steps-guide";
import { TldGuide } from "@/components/tld-guide";
import { ACQUISITION_STEPS, FAQS, MISCONCEPTIONS, TLD_PRICE_ROWS } from "@/shared/lib/learning-content";

interface LearningSectionsProps {
  /** 料金表の「この末尾で検索する」から検索フォームへ反映する */
  onSelectTld?: (tld: string) => void;
}

/**
 * 検索結果の下に置く学習セクション。
 * 一等地なので、広告ではなく「選ぶために必要な知識」を上から順に並べる。
 * ① 決める前に知ること → ② 末尾の選び方 → ③ 料金 → ④ 取得の流れ → ⑤ 勘違い → ⑥ FAQ
 */
export function LearningSections({ onSelectTld }: LearningSectionsProps) {
  return (
    <>
      <FeatureCards />
      <TldGuide id="learn" />
      <DomainPriceTable prices={TLD_PRICE_ROWS} onSelect={onSelectTld} />
      <div id="flow" className="scroll-mt-16">
        <StepsGuide heading="取得までの流れ" steps={ACQUISITION_STEPS} />
      </div>
      <FaqAccordion heading="よくある勘違い" items={MISCONCEPTIONS} />
      <div id="faq" className="scroll-mt-16">
        <FaqAccordion items={FAQS} />
      </div>
    </>
  );
}
