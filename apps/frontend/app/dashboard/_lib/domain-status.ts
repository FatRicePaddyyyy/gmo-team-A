/**
 * バックエンドの `domains.status`（レジストリの EPP ステータスを 1 つに畳んだもの）を
 * 画面用のラベルと「いま何ができるか」に翻訳する。
 *
 * 復旧できるのは `redemptionPeriod` のときだけ。廃止から 45 日を過ぎると
 * `pendingDelete` だけが残り、その時点で復旧はできなくなる。
 */

export const DOMAIN_STATUS_LABELS: Record<string, string> = {
  ok: "有効",
  pendingCreate: "登録手続き中",
  pendingTransfer: "移管手続き中",
  pendingUpdate: "変更手続き中",
  redemptionPeriod: "廃止済み（復旧できます）",
  pendingDelete: "削除待ち（復旧できません）",
  serverHold: "利用停止中",
  clientHold: "利用停止中",
  serverUpdateProhibited: "変更ロック中",
  clientUpdateProhibited: "変更ロック中",
};

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

/** レジストラロック（移管防止）に使う EPP ステータス */
export const TRANSFER_LOCK_STATUS = "clientTransferProhibited";

/** 詳細 API の statuses からロック中かを判定する */
export function isTransferLocked(statuses: readonly string[]): boolean {
  return statuses.includes(TRANSFER_LOCK_STATUS);
}

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
  upDate: string | null;
  now?: Date;
}): number | null {
  if (params.status !== "redemptionPeriod") return null;
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
