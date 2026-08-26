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
