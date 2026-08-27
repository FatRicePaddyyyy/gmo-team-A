/**
 * バックエンドの `domains.status`（レジストリの EPP ステータスを 1 つに畳んだもの）を
 * 画面用のラベルと「いま何ができるか」に翻訳する。
 *
 * 復旧できるのは `redemptionPeriod` のときだけ。廃止から 45 日を過ぎると
 * `pendingDelete` だけが残り、その時点で復旧はできなくなる。
 */

export const DOMAIN_STATUS_LABELS: Record<string, string> = {
  ok: "使えます",
  pendingCreate: "登録手続き中",
  // 「移管」だけでは渡す側か受け取る側か分からない。自分のドメインに対して
  // 起きている以上、必ず「他のレジストラへ渡す」側なのでそう書く。
  pendingTransfer: "他のレジストラへ渡す手続き中",
  pendingUpdate: "変更手続き中",
  redemptionPeriod: "廃止済み（まだ戻せます）",
  pendingDelete: "削除待ち（もう戻せません）",
  serverHold: "利用停止中",
  clientHold: "利用停止中",
  serverUpdateProhibited: "変更ロック中",
  clientUpdateProhibited: "変更ロック中",
};

/**
 * 状態バッジだけでは「で、どうすればいいのか」が分からないので、
 * 一言の補足を添える。ドメインを初めて持つ人が読む前提で書く。
 */
export const DOMAIN_STATUS_HINTS: Record<string, string> = {
  ok: "サイトやメールに使えます。",
  pendingCreate: "登録が終わるまで少し待ってください。",
  pendingTransfer:
    "他のレジストラから引き渡しの申請が来ています。承認するか却下するか決めてください。放置すると自動で承認されます。",
  pendingUpdate: "変更が反映されるまで少し待ってください。",
  redemptionPeriod:
    "廃止しましたが、猶予期間のうちなら元に戻せます。過ぎると他の人が取得できるようになります。",
  pendingDelete: "猶予期間を過ぎたため、元に戻せません。",
  serverHold: "レジストリの判断で止まっています。",
  clientHold: "掲載を止めているので、サイトが見られません。",
  serverUpdateProhibited: "変更が禁止されています。",
  clientUpdateProhibited: "変更が禁止されています。",
};

export function statusHintOf(status: string): string | null {
  return DOMAIN_STATUS_HINTS[status] ?? null;
}

/**
 * 一覧のボタンに「この先で何ができるか」を出すための文言。
 * 「設定・詳細」だけでは中身が想像できないので、状態ごとに変える。
 */
export function detailActionLabelOf(status: string): string {
  if (status === "redemptionPeriod") return "復旧する・詳しく見る";
  if (status === "pendingTransfer") return "承認・却下する";
  if (status === "pendingDelete") return "詳しく見る";
  return "更新・設定を変える";
}

export type DomainStatusTone = "ok" | "warning" | "danger" | "neutral";

export function statusLabelOf(status: string): string {
  return DOMAIN_STATUS_LABELS[status] ?? status;
}

export function statusToneOf(status: string): DomainStatusTone {
  if (status === "ok") return "ok";
  if (status === "redemptionPeriod") return "warning";
  if (status === "pendingDelete") return "danger";
  if (status.startsWith("pending")) return "warning";
  return "neutral";
}

/** 復旧できる猶予状態か */
export function canRestore(status: string): boolean {
  return status === "redemptionPeriod";
}

/** 廃止済み（＝更新も廃止もできない）か */
export function isDeleted(status: string): boolean {
  return status === "redemptionPeriod" || status === "pendingDelete";
}

/** 更新（期間延長）できるか。移管手続き中と廃止済みは不可 */
export function canRenew(status: string): boolean {
  return !isDeleted(status) && status !== "pendingTransfer";
}

/** 廃止できるか。移管手続き中と廃止済みは不可 */
export function canDelete(status: string): boolean {
  return !isDeleted(status) && status !== "pendingTransfer";
}

/** 設定（ネームサーバー・AuthCode・ロック）を変更できるか。手続き中と廃止済みは不可 */
export function canUpdateSettings(status: string): boolean {
  return !isDeleted(status) && !status.startsWith("pending");
}

/** 一覧の絞り込み用の3分類（issue #83）。ロック中・利用停止中は「使えるもの」に含める */
export type DomainStatusCategory = "usable" | "pending" | "deleted";

export function domainStatusCategoryOf(status: string): DomainStatusCategory {
  if (isDeleted(status)) return "deleted";
  if (status.startsWith("pending")) return "pending";
  return "usable";
}

export const DOMAIN_STATUS_CATEGORY_LABELS: Record<DomainStatusCategory, string> = {
  usable: "使えるもの",
  pending: "手続き中",
  deleted: "廃止済み",
};


/**
 * 廃止したドメインが復旧できなくなるまでの残り日数。
 *
 * RGP（Redemption Grace Period）は廃止から 45 日。`rgpStatus` に
 * `redemptionPeriod` が含まれる間は復旧でき、`pendingDelete` に移ると復旧できない。
 * レジストリは残り日数を返さないので、廃止日（= upDate）からの経過で算出する。
 * upDate が無い場合は日数を出さない（嘘の数字を見せない）。
 */
export const REDEMPTION_PERIOD_DAYS = 45;

export function redemptionDaysLeft(params: {
  status: string;
  /** レジストリが返す RGP の状態。DB の status より新しいことがある */
  rgpStatus?: readonly string[];
  upDate: string | null;
  now?: Date;
}): number | null {
  if (params.status !== "redemptionPeriod") return null;
  // レジストリ側が既に猶予期間を抜けている場合、DB の status はまだ
  // redemptionPeriod のことがある。そのまま日数を出すと嘘になるので、
  // rgpStatus が渡されていて猶予期間を含まないなら出さない。
  if (params.rgpStatus && !params.rgpStatus.includes("redemptionPeriod")) {
    return null;
  }
  if (!params.upDate) return null;

  const deletedAt = new Date(params.upDate);
  if (Number.isNaN(deletedAt.getTime())) return null;

  const now = params.now ?? new Date();
  const elapsedDays = Math.floor(
    (now.getTime() - deletedAt.getTime()) / (1000 * 60 * 60 * 24),
  );
  const left = REDEMPTION_PERIOD_DAYS - elapsedDays;
  // 期限を過ぎていても負数は出さない。レジストリ側の反映待ちのことがある。
  return left > 0 ? left : 0;
}

/**
 * 更新（延長）で選べる年数。
 *
 * レジストリの制約（1〜10年）をそのまま1年刻みで出す。
 * 一覧（domain-row）と詳細（renew-card）の両方から使うので、ここに一本化する。
 * 片方だけ変えると、同じ操作なのに選べる年数が食い違う。
 */
export const RENEW_YEARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

/**
 * 更新後の有効期限の上限。レジストリは「現在 + 10 年」を超える更新を
 * 2004 (Parameter value range error) で拒否する。
 * 選べない年数を出しておいて後から失敗させるより、最初から出さない。
 */
export const MAX_YEARS_FROM_NOW = 10;

export function renewableYears(
  expiresAt: string,
  now: Date = new Date(),
): readonly number[] {
  const current = new Date(expiresAt);
  if (Number.isNaN(current.getTime())) return RENEW_YEARS;

  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() + MAX_YEARS_FROM_NOW);

  return RENEW_YEARS.filter((years) => {
    const after = new Date(current);
    after.setFullYear(after.getFullYear() + years);
    return after.getTime() <= limit.getTime();
  });
}

/**
 * RGP（Registry Grace Period）の状態。レジストリは英語のコードを返すので、
 * そのまま出しても何のことか分からない。
 * 「いま何が起きていて、自分は何をすべきか」が分かる言葉にする。
 */
export const RGP_STATUS_LABELS: Record<string, string> = {
  addPeriod: "取得直後（取得から数日間）",
  autoRenewPeriod: "自動更新の直後",
  renewPeriod: "更新の直後",
  transferPeriod: "移管の直後",
  redemptionPeriod: "廃止後の猶予期間（まだ戻せます）",
  pendingRestore: "復旧の手続き中",
  pendingDelete: "削除待ち（もう戻せません）",
};

export function rgpStatusLabelOf(status: string): string {
  return RGP_STATUS_LABELS[status] ?? status;
}
