/**
 * TLD（.com などドメインの末尾）の料金と、初学者向けの説明をまとめた辞書。
 *
 * このサービスの中核は「学習しながらドメインを取得する」こと。
 * 価格だけでなく「それが何なのか」「誰が取れるのか」を必ずセットで持たせ、
 * 検索結果・料金表・カートのどこから参照しても同じ説明が出るようにしている。
 *
 * TODO: バックエンドに検索APIが入ったら、価格はAPIレスポンス側に持たせ、
 * ここには説明文（summary / detail / eligibility）だけを残す。
 */

import type { Purpose } from "@/shared/lib/purpose";

export interface TldInfo {
  tld: string;
  /** 初年度の価格（円・税込）。0 は初年度無料 */
  firstYearPrice: number;
  /** 2年目以降の年額（円・税込） */
  renewalPrice: number;
  /** 一覧に常時出す1行説明 */
  summary: string;
  /** どんな人向けか（トップページで初学者が直感で選ぶための軸） */
  audience?: string;
  /** どれくらい使われているか（同上） */
  usage?: string;
  /** 「くわしく」で開く説明 */
  detail: string;
  /** 取得条件がある場合の注意文（.jp / .co.jp など） */
  eligibility?: string;
  /** 個人では取得できない（法人限定など） */
  restricted?: boolean;
  /**
   * 取得できる用途。省略＝だれでも取れる。
   * `restricted` が「注意書きの色」だけに使われて素通りしていたため、
   * 実際にカート追加を止める判定はこちらで行う。
   */
  allowedPurposes?: Purpose[];
  /** よく選ばれるTLD */
  popular?: boolean;
  /** 初年度価格が「お1人様1個限り」の特別価格か */
  limitedOffer?: boolean;
}

export const TLD_CATALOG: TldInfo[] = [
  {
    tld: ".com",
    firstYearPrice: 0,
    renewalPrice: 1408,
    summary: "世界でいちばん使われている。迷ったらこれ。個人・法人どちらでもOK。",
    audience: "個人・法人どちらでも。迷ったらこれ",
    usage: "世界でいちばん多く使われている定番",
    detail:
      "1985年から使われている最も一般的なTLDです。誰でも取得でき、見た人が「怪しい」と感じにくいのが強みです。人気があるぶん短い名前は取られていることが多いので、ハイフンや単語の組み合わせで探すのがコツです。",
    popular: true,
    limitedOffer: true,
  },
  {
    tld: ".net",
    firstYearPrice: 0,
    renewalPrice: 1628,
    summary: ".com が埋まっていたときの定番。こちらも誰でも取得できる。",
    audience: ".com が取られていたときの第2候補",
    usage: "世界で古くから使われている定番のひとつ",
    detail:
      "もともとはネットワーク関連の組織向けでしたが、今は用途の制限がありません。希望の名前の .com が取られているときの第2候補としてよく選ばれます。",
    popular: true,
    limitedOffer: true,
  },
  {
    tld: ".jp",
    firstYearPrice: 0,
    renewalPrice: 3124,
    summary: "日本に住所がある人だけが取れる。日本向けのサイトだと一目で伝わる。",
    audience: "日本に住所がある人。日本向けのサイト",
    usage: "日本の国別ドメイン。国内でよく見かける",
    detail:
      "日本の国別TLDです。日本国内に住所がある個人・法人なら取得できます。日本語のサービスであることが伝わりやすい一方、2年目以降の更新料が他より高めなので、長く使う前提で選んでください。",
    eligibility: "日本国内に住所があること（個人でも取得できます）",
    popular: true,
    limitedOffer: true,
  },
  {
    tld: ".co.jp",
    firstYearPrice: 2970,
    renewalPrice: 2970,
    summary: "日本で登記された法人だけが取れる。1社1つまで。信頼性は最も高い。",
    audience: "日本で登記した会社（1社につき1つ）",
    usage: "日本の会社サイトの定番。信頼性は最も高い",
    detail:
      "登記事項の確認を経て発行されるため、「実在する日本の会社」であることの証明になります。そのぶん個人・個人事業主は取得できません。取得後に会社が1つしか持てない点にも注意してください。",
    eligibility: "日本国内で登記された法人のみ。1社につき1つまで",
    restricted: true,
    allowedPurposes: ["corporate"],
  },
  {
    tld: ".xyz",
    firstYearPrice: 0,
    renewalPrice: 2013,
    summary: "安く始められる新しいTLD。メールが迷惑メール扱いされることがある。",
    audience: "お試し・趣味のサイト",
    usage: "新しい末尾の中では使われているほう",
    detail:
      "2014年から使えるようになった新しいTLDです。取得しやすく価格も安めですが、新しいTLDはスパムに使われた経緯から、送ったメールが迷惑メールフォルダに入ってしまう場合があります。お試しや趣味のサイト向きです。",
    limitedOffer: true,
  },
  {
    tld: ".org",
    firstYearPrice: 1628,
    renewalPrice: 1628,
    summary: "非営利団体・コミュニティでよく使われる。初年度から更新料と同じ価格。",
    audience: "非営利団体・コミュニティ・OSS",
    usage: "団体サイトで古くから使われている",
    detail:
      "団体やコミュニティ、オープンソースのプロジェクトでよく使われます。用途の制限はなく誰でも取得できます。初年度から2年目以降と同じ価格なので、値上がりの心配がないのが利点です。",
  },
];

/** 2年目以降の値上がり幅がこの額を超えたら警告を出す */
const RENEWAL_GAP_ALERT_YEN = 1000;

export function findTld(tld: string): TldInfo | undefined {
  return TLD_CATALOG.find((info) => info.tld === tld);
}

/** 1408 → 「1,408円」 / 0 → 「0円」 */
export function formatYen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

/** 初年度と2年目以降の差が大きいときだけ返す警告文 */
export function renewalWarningOf(info: TldInfo): string | undefined {
  const gap = info.renewalPrice - info.firstYearPrice;
  if (gap < RENEWAL_GAP_ALERT_YEN) return undefined;
  return `2年目から ${formatYen(info.renewalPrice)}/年 になります`;
}

/** 「2年使うと合計 1,408円（税込）」 */
export function twoYearTotalOf(info: TldInfo): string {
  return `2年使うと合計 ${formatYen(info.firstYearPrice + info.renewalPrice)}（税込）`;
}

/** 更新料の説明。価格の近くで just-in-time に出す */
export const RENEWAL_LESSON = {
  title: "更新料って？",
  body: "ドメインは買い切りではなく、1年ごとの「使用権」です。毎年の更新料を払い続けているあいだだけ使えます。払い忘れるとサイトもメールも止まり、他の人に取られてしまうことがあります。自動更新をオンにしておくのがおすすめです。",
} as const;

/** 「この時点では課金されません」など、取得導線で繰り返し使う文言 */
export const NO_CHARGE_YET_NOTE =
  "この時点では課金されません。次の画面で内容を確認できます。";

export const LIMITED_OFFER_NOTE = "初年度の価格は、お1人様1個限りの特別価格です。";

/** 長いものから判定するための一覧（.co.jp を .jp より先に消すため） */
const KNOWN_TLDS_DESC = TLD_CATALOG.map((info) => info.tld).sort((a, b) => b.length - a.length);

/**
 * 入力値の末尾についている既知のTLDを取り除いて、ドメイン名の部分だけを返す。
 * 「manabi.com」に「.jp」を足すときに「manabi.com.jp」にならないようにするための前処理。
 */
export function stripKnownTld(value: string): string {
  const lower = value.toLowerCase();
  const matched = KNOWN_TLDS_DESC.find((tld) => lower.endsWith(tld));
  if (!matched) return value;
  return value.slice(0, value.length - matched.length);
}

/**
 * 入力値の末尾に既知のTLDが付いていれば、そのTLDの情報を返す。
 * 検索結果をそのTLD1件だけに絞り込むために使う（`.co.jp` を `.jp` より先に判定）。
 */
export function matchKnownTld(value: string): TldInfo | undefined {
  const lower = value.toLowerCase();
  const matchedTld = KNOWN_TLDS_DESC.find((tld) => lower.endsWith(tld));
  if (!matchedTld) return undefined;
  return findTld(matchedTld);
}

/** 取得可否の判定結果。「隠す」のではなく「なぜ選べないか」を返す */
export interface EligibilityVerdict {
  allowed: boolean;
  /** 選べない理由（1〜2文） */
  reason?: string;
  /** 代わりに何を見ればよいか */
  suggestion?: string;
}

/**
 * その用途でこの TLD を取得できるか。
 * 用途が未選択のときは止めない（強制しないため）。ただし条件付きの TLD には注意文を出す。
 */
export function checkEligibility(
  info: TldInfo,
  purpose: Purpose | null,
): EligibilityVerdict {
  if (!info.allowedPurposes) return { allowed: true };
  if (purpose === null) return { allowed: true };
  if (info.allowedPurposes.includes(purpose)) return { allowed: true };

  if (info.tld === ".co.jp") {
    return {
      allowed: false,
      reason:
        "「会社（登記済み）」を選んだ方だけが取得できます。日本の法務局で登記された法人が対象で、1社につき1つまでです。",
      suggestion:
        "個人・個人事業の方は .com か .jp を選んでください。どちらも同じ名前で取得できます。",
    };
  }

  return {
    allowed: false,
    reason: info.eligibility ?? "この末尾には取得条件があります。",
    suggestion: "条件のない .com や .net を検討してください。",
  };
}

/** 用途ごとの「まずこれ」。解説を自分ごとに変えるための1件だけの推奨 */
export function recommendedTldFor(purpose: Purpose | null): string {
  if (purpose === "corporate") return ".co.jp";
  if (purpose === "sole") return ".jp";
  return ".com";
}

/**
 * よくある勘違い。まとめて置くと読まれないので、
 * 「それが関係する意思決定の直前」で1つだけ出すためにキーで引けるようにする。
 */
export const MISCONCEPTION = {
  /** 末尾（TLD）を選ぶところ */
  tld: {
    title: "「.co.jp は誰でも取れる」は勘違いです",
    body: ".co.jp は日本で登記された法人だけ、1社につき1つまでです。個人や個人事業の方は取得できません。",
  },
  /** 価格を見比べる検索結果のところ */
  price: {
    title: "「安いほど得」は勘違いです",
    body: "初年度だけ安い末尾があります。2年目以降の金額と、その末尾の印象（迷惑メール扱いされやすいかなど）まで見て決めてください。",
  },
  /** 更新料・自動更新を選ぶところ */
  renewal: {
    title: "「一度取れば永久に自分のもの」は勘違いです",
    body: "ドメインは買い切りではなく1年ごとの使用権です。更新料を払い続けているあいだだけ使えます。",
  },
  /** 申し込み確認の直前 */
  publish: {
    title: "「ドメインを取ればサイトが自動で公開される」は勘違いです",
    body: "ドメインは住所にあたるものです。サイトの中身を置くサーバーは別に必要で、ネームサーバー（ドメインとサーバーを結びつける設定）でつなぎます。",
  },
  /** 名前を決めるところ */
  refund: {
    title: "「間違えて取っても返品できる」は勘違いです",
    body: "原則できません。ドメインの取得は取り消しにくい手続きです。つづりと末尾は申し込む前に必ず確認してください。",
  },
} as const;

/**
 * 検索結果カードのアンカー ID。
 * 「どの末尾のことを言っているのか」に視線を飛ばすために使う（`.co.jp` → `result-co-jp`）。
 */
export function tldAnchorId(tld: string): string {
  return `result-${tld.replace(/^\./, "").replace(/\./g, "-")}`;
}
