/**
 * `transfers.status`（自分が出した移管申請の状態）を画面用の言葉にする。
 * 取り消せるのは相手がまだ何もしていない `pendingTransfer` のときだけ。
 */

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  pendingTransfer: "承認待ち",
  clientApproved: "承認されました",
  serverApproved: "自動承認されました",
  clientRejected: "却下されました",
  clientCancelled: "取り消しました",
  expired: "期限切れ",
};

export function transferStatusLabelOf(status: string): string {
  return TRANSFER_STATUS_LABELS[status] ?? status;
}

export function isCancellable(status: string): boolean {
  return status === "pendingTransfer";
}

export function isPending(status: string): boolean {
  return status === "pendingTransfer";
}
