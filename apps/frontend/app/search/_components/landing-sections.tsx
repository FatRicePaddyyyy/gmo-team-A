"use client";

import { Globe, Mail, Server, ShieldCheck } from "lucide-react";
import { FeatureCards } from "@/components/feature-cards";
import { DomainPriceTable, type TldPrice } from "@/components/domain-price-table";
import { ServiceCardGrid, type ServiceItem } from "@/components/service-card-grid";
import { CampaignBannerGrid, type CampaignBannerProps } from "@/components/campaign-banner";
import { FaqAccordion, type FaqItem } from "@/components/faq-accordion";
import { StepsGuide, type Step } from "@/components/steps-guide";
import { TestimonialCards, type Testimonial } from "@/components/testimonial-cards";
import { NewsList, type NewsItem } from "@/components/news-list";

const prices: TldPrice[] = [
  { tld: ".com", newPrice: "0", renewalPrice: "1,408", popular: true, sale: true },
  { tld: ".net", newPrice: "0", renewalPrice: "1,628", popular: true, sale: true },
  { tld: ".jp", newPrice: "0", renewalPrice: "3,124", popular: true },
  { tld: ".co.jp", newPrice: "2,970", renewalPrice: "2,970" },
  { tld: ".xyz", newPrice: "0", renewalPrice: "2,013", sale: true },
  { tld: ".org", newPrice: "1,628", renewalPrice: "1,628" },
];

const services: ServiceItem[] = [
  {
    title: "ドメイン取得",
    description: "サイトの開設・運営に必須なドメインを630種類以上の中から取得する",
    href: "/service/domainregist/",
    icon: <Globe className="size-5" style={{ color: "var(--brand)" }} aria-hidden="true" />,
    badge: "0円〜",
  },
  {
    title: "ドメイン移管",
    description: "他社で取得したドメインの管理をお名前.comにお引越しして一元管理する",
    href: "/transfer/",
    icon: <Server className="size-5" style={{ color: "var(--brand)" }} aria-hidden="true" />,
  },
  {
    title: "レンタルサーバー",
    description: "使いやすさと高機能の両立を実現。独自ドメイン＋サーバーが初期費用0円",
    href: "/server/rs/",
    icon: <Server className="size-5" style={{ color: "var(--brand)" }} aria-hidden="true" />,
    badge: "人気",
  },
  {
    title: "お名前メール",
    description: "独自ドメインでのメールサービス。メールアドレスは無制限で作成可能",
    href: "/service/mail/",
    icon: <Mail className="size-5" style={{ color: "var(--brand)" }} aria-hidden="true" />,
  },
  {
    title: "SSL証明書",
    description: "Webサイトのセキュリティを強化。Google検索ランキングにも有利",
    href: "/service/ssl/",
    icon: <ShieldCheck className="size-5" style={{ color: "var(--brand)" }} aria-hidden="true" />,
  },
  {
    title: "AIホームページパック",
    description: "必要なのはアイディアだけ！専門知識がなくてもAIがホームページを作成",
    href: "/campaign/aihppack/",
    icon: <Globe className="size-5" style={{ color: "var(--brand)" }} aria-hidden="true" />,
    badge: "NEW",
  },
];

const campaigns: CampaignBannerProps[] = [
  {
    badge: "期間限定",
    title: "ドメイン＋サーバーでドメイン永久無料",
    description: "対象のドメインは永久無料でご利用いただけます！",
    href: "/server/rs/campaign/simulregist/",
    variant: "red",
  },
  {
    badge: "キャッシュバック",
    title: "他社ドメイン移管で料金100%キャッシュバック",
    description: "国内事業者の他社ドメインをご利用の方に移管料金を全額返金",
    href: "/campaign/transferincp/",
    variant: "dark",
  },
  {
    badge: "SALE",
    title: ".monster ドメイン 0円",
    description: "モンスター・怪獣に関する商品を取り扱う企業に最適なドメイン",
    href: "/campaign/monster/",
    variant: "yellow",
  },
];

const faqs: FaqItem[] = [
  {
    question: "ドメインとは何ですか？",
    answer:
      "ドメインとは、インターネット上でWebサイトやメールアドレスを識別する「住所」のような文字列です。「example.com」のようにURLやメールアドレスに含まれます。",
  },
  {
    question: "ドメインを取得してからどのくらいで使えますか？",
    answer:
      "お申し込み完了後、最短で数分から数時間でご利用いただけます。ただし、DNS の浸透には最大72時間かかる場合があります。",
  },
  {
    question: "取得したドメインを他のサービスで使えますか？",
    answer:
      "はい、ご利用いただけます。ネームサーバーの変更により、他社のサーバーやサービスとの連携が可能です。",
  },
  {
    question: "ドメインの更新を忘れた場合はどうなりますか？",
    answer:
      "有効期限が切れると一定の猶予期間後にドメインが削除されます。自動更新の設定をおすすめします。",
  },
];

const steps: Step[] = [
  { number: 1, title: "ドメイン検索", description: "取得したいドメイン名を検索して空きを確認" },
  { number: 2, title: "カートに追加", description: "希望のドメインをカートに入れて申し込み" },
  { number: 3, title: "会員登録", description: "お名前.comに会員登録（すでにお持ちの方はログイン）" },
  { number: 4, title: "お支払い", description: "クレジットカード等でお支払い完了" },
  { number: 5, title: "取得完了", description: "最短数分でドメインが使えるようになります" },
];

const testimonials: Testimonial[] = [
  {
    text: "ドメインとサーバーをまとめて管理できるため、色々なコンパネにログインする手間がない",
    author: "個人事業主 A様",
  },
  {
    text: "ドメインとサーバーのサポートを1つの窓口でまとめて受けられるのでお問い合わせ時間を短縮できる",
    author: "株式会社 B様",
  },
  {
    text: "ドメイン費用が安くサポートもしっかりしているのでおすすめできます",
    author: "フリーランス C様",
  },
  {
    text: "東証プライム上場企業運営なので、安心感がある",
    author: "法人 D様",
  },
];

const news: NewsItem[] = [
  { date: "2026/08/20", category: "キャンペーン", title: ".comドメイン 0円キャンペーン開催中！", href: "#" },
  { date: "2026/08/15", category: "お知らせ", title: "新TLD「.ai」の取り扱いを開始しました", href: "#" },
  { date: "2026/08/10", category: "メンテナンス", title: "8/12 2:00〜4:00 システムメンテナンスのお知らせ", href: "#" },
  { date: "2026/08/01", category: "重要", title: "利用規約の一部改定について", href: "#" },
];

interface LandingSectionsProps {
  /** 価格表の「選択」から検索フォームへ戻す導線 */
  onSelectTld?: (tld: string) => void;
}

/** 検索フォーム以外の静的な集客セクション。ページを薄く保つためにまとめている */
export function LandingSections({ onSelectTld }: LandingSectionsProps) {
  return (
    <>
      <FeatureCards />
      <DomainPriceTable prices={prices} onSelect={onSelectTld} />
      <StepsGuide steps={steps} />
      <ServiceCardGrid heading="ドメインの取得・管理" items={services} />
      <CampaignBannerGrid heading="キャンペーン・お得な情報" items={campaigns} />
      <TestimonialCards items={testimonials} />
      <FaqAccordion items={faqs} />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <NewsList items={news} moreHref="#" />
      </div>
    </>
  );
}
