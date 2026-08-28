import { GlossaryTerm } from "@/components/glossary-term";
import { GLOSSARY } from "@/shared/lib/glossary";
import type { TldPrice } from "@/components/domain-price-table";
import type { FaqItem } from "@/components/faq-accordion";
import type { Step } from "@/components/steps-guide";
import { TLD_CATALOG, formatYen, renewalWarningOf } from "@/shared/lib/tld-catalog";

/** 料金表は数字だけを渡す（単位はコンポーネント側で付ける） */
function toPriceRow(amount: number): string {
  return formatYen(amount).replace("円", "");
}

export const TLD_PRICE_ROWS: TldPrice[] = TLD_CATALOG.map((info) => ({
  tld: info.tld,
  newPrice: toPriceRow(info.firstYearPrice),
  renewalPrice: toPriceRow(info.renewalPrice),
  popular: info.popular,
  summary: info.summary,
  eligibility: info.eligibility,
  renewalWarning: renewalWarningOf(info),
}));

export const ACQUISITION_STEPS: Step[] = [
  {
    number: 1,
    title: "ドメインを探す",
    description: "使いたい名前で空き状況を確認します。ここでは課金されません",
  },
  {
    number: 2,
    title: "内容を確認する",
    description: "末尾・初年度と2年目以降の金額をここで確認します",
  },
  {
    number: 3,
    title: "ログイン",
    description: "アカウントは運営からの発行です。お持ちのメールアドレスとパスワードでログインします",
  },
  {
    number: 4,
    title: "お支払い",
    description: "ここではじめて課金されます。金額は確認画面と同じです",
  },
  {
    number: 5,
    title: "取得完了",
    description: "マイドメインで有効期限や状態を確認できます",
  },
];

/** 初学者がつまずく順に並べる */
export const FAQS: FaqItem[] = [
  {
    question: "そもそもドメインとは何ですか？",
    answer:
      "インターネット上の「住所」です。example.com のような文字列で、あなたのサイトのURLやメールアドレスの名前になります。世界で1つだけのもので、早い者勝ちです。",
  },
  {
    question: "「初年度0円」なら本当に無料で使えますか？",
    answer:
      "無料なのは最初の1年だけです。2年目からは更新料（例: .com なら 1,408円/年、税込）がかかります。検索結果では初年度と2年目以降の両方を並べて表示しています。",
  },
  {
    question: "更新を忘れるとどうなりますか？",
    answer: (
      <>
        有効期限が切れると、サイトもメールも止まります。一定の
        <GlossaryTerm description={GLOSSARY.gracePeriod.description}>猶予期間</GlossaryTerm>
        を過ぎるとドメインは削除され、他の人が取得できる状態になります。更新日が近づいたらマイドメインで確認しましょう。
      </>
    ),
  },
  {
    question: "取得すると自分の名前や住所が公開されますか？",
    answer: (
      <>
        はい。ドメインを取得すると登録者の氏名・住所・電話番号が{" "}
        <GlossaryTerm description={GLOSSARY.whois.description}>Whois</GlossaryTerm>{" "}
        という仕組みで公開されます。公開された内容は、外部の Whois
        検索サイトから誰でも確認できます（このサービス内では確認できません）。
        個人で取得する場合は、氏名や住所の代わりに事業者の情報を表示する「公開代行」を検討してください。
      </>
    ),
  },
  {
    question: ".co.jp は個人でも取れますか？",
    answer:
      "取れません。.co.jp は日本国内で登記された法人だけが取得でき、1社につき1つまでです。個人の方は .com や .jp を選んでください。",
  },
  {
    question: "取得したドメインは他のサービスでも使えますか？",
    answer:
      "使えます。ネームサーバーの設定を変えることで、他社のサーバーやサービスに向けられます。ドメインとサーバーは別のものだと考えてください。",
  },
];

/** 「知らないと損する」より「勘違いしやすい」から入る */
export const MISCONCEPTIONS: FaqItem[] = [
  {
    question: "ドメインを買えば、ずっと自分のものになる？",
    answer:
      "なりません。ドメインは買い切りではなく1年ごとの使用権です。更新料を払い続けているあいだだけ使えます。",
  },
  {
    question: "ドメインを取れば、すぐサイトが見られる？",
    answer: (
      <>
        見られません。ドメインは住所にあたるもので、サイトの中身を置く
        <GlossaryTerm description={GLOSSARY.server.description}>サーバー</GlossaryTerm>
        は別に必要です。サーバーはレンタルサーバー事業者と契約して借り、
        <GlossaryTerm description={GLOSSARY.nameServer.description}>ネームサーバー</GlossaryTerm>
        の設定でドメインと結びつけます。このサービスではサーバーの取り扱いはありません（準備中）。
      </>
    ),
  },
  {
    question: "安い末尾を選べば得？",
    answer:
      "初年度だけ安いことがあります。2年目以降の金額と、その末尾の印象（迷惑メール扱いされやすいかなど）まで見て決めてください。",
  },
  {
    question: "間違えて取っても、あとで返品できる？",
    answer:
      "原則できません。ドメインの取得は取り消しにくい手続きです。お支払いの前に、名前のつづりと末尾を必ず確認してください。",
  },
];
