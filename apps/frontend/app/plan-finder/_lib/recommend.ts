/**
 * 「どの末尾（TLD）とオプションを選べばいいか」を、4問までの質問から決める純粋ロジック。
 *
 * ここが持つのは **質問の定義と、答え → おすすめへの変換だけ**。
 * TLD が何なのか・いくらなのか・誰が取れるのかという知識は持たず、
 * すべて `shared/lib/tld-catalog.ts` から引く（説明が二重定義になると必ずズレるため）。
 * 用途（purpose）も独自の型を作らず、既存の `shared/lib/purpose.ts` の値に変換して返す。
 */

import type { Purpose } from "@/shared/lib/purpose";
import {
  findTld,
  formatYen,
  recommendedTldFor,
  type TldInfo,
} from "@/shared/lib/tld-catalog";

/* ------------------------------------------------------------------ *
 * 答えの型
 * ------------------------------------------------------------------ */

/** Q1「何のために取るか」。用途（Purpose）より細かい、生活側の言葉 */
export type Scene = "personal" | "shop" | "company" | "event";

export type YesNo = "yes" | "no";

export interface QuizAnswers {
  scene?: Scene;
  /** Q2: 法人登記が済んでいるか（Q1 が company のときだけ聞く） */
  registered?: YesNo;
  /** Q3: 乗っ取り・誤操作が心配か */
  security?: YesNo;
}

export type QuestionId = keyof QuizAnswers;

export interface QuestionOption {
  value: string;
  label: string;
  /** 選択肢の意味を1行で。初学者は用語より「自分の状況」で選ぶ */
  description: string;
}

export interface Question {
  id: QuestionId;
  /** 質問文 */
  title: string;
  /** 質問の意図。なぜ聞かれるのかが分かると答えやすい */
  help: string;
  options: QuestionOption[];
  /** これまでの答えを見て、この質問を出すか決める */
  shouldAsk: (answers: QuizAnswers) => boolean;
}

/* ------------------------------------------------------------------ *
 * 質問の定義（最大4問）
 * ------------------------------------------------------------------ */

export const QUESTIONS: Question[] = [
  {
    id: "scene",
    title: "何のためにドメインを取得しますか？",
    help: "使いみちで、選べる末尾（TLD）と必要なオプションが変わります。",
    options: [
      {
        value: "personal",
        label: "個人のサイト",
        description: "ブログ・ポートフォリオ・趣味のサイトなど",
      },
      {
        value: "shop",
        label: "お店・個人事業",
        description: "お店の紹介ページやフリーランスの仕事用サイト",
      },
      {
        value: "company",
        label: "会社",
        description: "会社の公式サイトや、会社で使うメールアドレス",
      },
      {
        value: "event",
        label: "イベント・お試し",
        description: "期間限定のイベント告知や、まず試してみたい場合",
      },
    ],
    shouldAsk: () => true,
  },
  {
    id: "registered",
    title: "その会社は、すでに法人登記されていますか？",
    help: "登記済みの会社だけが取れる末尾（.co.jp）があるため、ここで分かれます。",
    options: [
      {
        value: "yes",
        label: "登記済み",
        description: "法務局で登記が完了している（登記事項証明書が取れる）",
      },
      {
        value: "no",
        label: "まだ登記していない",
        description: "これから設立する、または個人事業として活動している",
      },
    ],
    shouldAsk: (answers) => answers.scene === "company",
  },
  {
    id: "security",
    title: "乗っ取りや、うっかり操作が心配ですか？",
    help: "ドメインを他人に移されたり、自分で消してしまうと、サイトもメールも止まります。",
    options: [
      {
        value: "yes",
        label: "心配なので守りたい",
        description: "第三者への移管や設定変更をロックしておきたい",
      },
      {
        value: "no",
        label: "いまは必要ない",
        description: "止まっても影響が小さいので、まずは最低限で始めたい",
      },
    ],
    shouldAsk: () => true,
  },
];

/** いまの答えで実際に出題する質問だけを返す（Q2 は会社のときだけ） */
export function visibleQuestions(answers: QuizAnswers): Question[] {
  return QUESTIONS.filter((question) => question.shouldAsk(answers));
}

/** 出題される質問すべてに答えたか */
export function isComplete(answers: QuizAnswers): boolean {
  return visibleQuestions(answers).every((question) => answers[question.id] !== undefined);
}

/* ------------------------------------------------------------------ *
 * 答え → 用途（Purpose）
 * ------------------------------------------------------------------ */

/**
 * 診断の答えを、サービス全体で使っている用途の値に変換する。
 *
 * ここを通すことで、診断を受けた人は `/search` で「だれのドメイン？」を
 * もう一度聞かれない（同じ値が `progress-store` に入るため）。
 */
export function purposeFromAnswers(answers: QuizAnswers): Purpose | null {
  switch (answers.scene) {
    case "company":
      // 登記が済んでいなければ、法人向けの末尾は取れない。個人事業と同じ扱いにする
      if (answers.registered === undefined) return null;
      return answers.registered === "yes" ? "corporate" : "sole";
    case "shop":
      return "sole";
    case "personal":
    case "event":
      return "personal";
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * おすすめのオプション
 * ------------------------------------------------------------------ */

export type PlanOptionId = "diagnosis" | "protection";

export interface PlanOption {
  id: PlanOptionId;
  name: string;
  /** 表示用の価格。無料のものは「無料」 */
  price: string;
  summary: string;
}

export const PLAN_OPTIONS: Record<PlanOptionId, PlanOption> = {
  diagnosis: {
    id: "diagnosis",
    name: "ネットde診断",
    price: "無料",
    summary:
      "ドメインの設定に問題がないかを自動で点検します。メールが届かない・サイトが表示されないといった、気づきにくい設定ミスを見つけられます。",
  },
  protection: {
    id: "protection",
    name: "ドメインプロテクション",
    price: `年 ${formatYen(1078)}（税込）`,
    summary:
      "第三者への移管や、登録者情報・ネームサーバーの変更をロックします。うっかり操作や乗っ取りでサイトとメールが止まるのを防げます。",
  },
};

export interface RecommendedOption extends PlanOption {
  /** なぜあなたに勧めるのか */
  reason: string;
}

/* ------------------------------------------------------------------ *
 * 診断結果
 * ------------------------------------------------------------------ */

export interface AlternativeTld {
  /** 代わりの末尾（`.store` など） */
  tld: string;
  /** 末尾の詳細。価格・説明は必ずここ（カタログ）から出す */
  info: TldInfo | undefined;
  /** なぜこれも候補になるのか */
  reason: string;
}

export interface Recommendation {
  /** おすすめする末尾（`.co.jp` など） */
  tld: string;
  /** 末尾の詳細。価格・説明・取得条件は必ずここ（カタログ）から出す */
  info: TldInfo | undefined;
  /** なぜこの末尾なのか */
  reason: string;
  /** 診断から決まった用途。以降の画面でも使い回す */
  purpose: Purpose;
  options: RecommendedOption[];
  /** 一番のおすすめの他にも見せる、用途に合う候補（無ければ空配列） */
  alternatives: AlternativeTld[];
}

/** 用途だけでは決まらない、診断ならではの上書き（イベント・お試し／お店） */
function tldForAnswers(answers: QuizAnswers, purpose: Purpose): string {
  if (answers.scene === "event") return ".xyz";
  // お店・個人事業は「ネットショップ」であることが伝わる .store のほうが、
  // 用途（sole）から機械的に出る .jp より初学者に刺さる
  if (answers.scene === "shop") return ".store";
  return recommendedTldFor(purpose);
}

/** 一番のおすすめ以外にも見せておきたい候補（無いシーンでは空配列） */
function alternativesFor(answers: QuizAnswers): AlternativeTld[] {
  if (answers.scene === "event") {
    return [".fun", ".space"].map((tld) => ({
      tld,
      info: findTld(tld),
      reason: "同じく安価な新しいTLDで、カジュアルな響きがイベント告知にも合います。",
    }));
  }
  return [];
}

function reasonFor(answers: QuizAnswers, tld: string): string {
  const info = findTld(tld);
  const audience = info?.audience ?? info?.summary ?? "";

  switch (answers.scene) {
    case "company":
      return answers.registered === "yes"
        ? `登記済みの会社だけが取得できる末尾です。${info?.summary ?? ""}会社の実在が確認されたことの証明になるため、取引先からの信頼を得やすくなります。`
        : `まだ登記していない場合、${".co.jp"} は取得できません。${audience}。登記が済んだあとに改めて .co.jp を検討できます。`;
    case "shop":
      return `${audience}。「ストア」という単語が入っているので、訪れた人にひと目でネットショップだと伝わります。ただし2年目以降の更新料は .com より高めなので、長く使う前提で金額も確認してください。`;
    case "event":
      return `${audience}。短期間だけ使うなら費用を抑えられます。ただし新しい末尾のため、送ったメールが迷惑メール扱いされることがあります。長く使う予定に変わったら .com も検討してください。`;
    default:
      return `${audience}。取得条件が無く、見た人に怪しいと思われにくいので、最初の1つとして安心して選べます。`;
  }
}

function optionsFor(answers: QuizAnswers): RecommendedOption[] {
  const recommended: RecommendedOption[] = [
    {
      ...PLAN_OPTIONS.diagnosis,
      reason: "無料で使えて損がないため、どなたにもおすすめしています。",
    },
  ];

  if (answers.security === "yes" || answers.scene === "company" || answers.scene === "shop") {
    recommended.push({
      ...PLAN_OPTIONS.protection,
      reason:
        answers.security === "yes"
          ? "「乗っ取りやうっかり操作が心配」と答えたためです。"
          : "仕事で使うドメインは、止まったときの影響が大きいためです。",
    });
  }

  return recommended;
}

/** 答えが揃っていなければ null。揃っていれば末尾とオプションのおすすめを返す */
export function recommend(answers: QuizAnswers): Recommendation | null {
  if (!isComplete(answers)) return null;
  const purpose = purposeFromAnswers(answers);
  if (!purpose) return null;

  const tld = tldForAnswers(answers, purpose);
  return {
    tld,
    info: findTld(tld),
    reason: reasonFor(answers, tld),
    purpose,
    options: optionsFor(answers),
    alternatives: alternativesFor(answers),
  };
}
