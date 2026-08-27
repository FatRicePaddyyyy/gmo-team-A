/**
 * ドメイン登録機関（レジストリ）のメンテナンス中かどうかの判定と、画面ごとの説明。
 *
 * レジストリは定期的にメンテナンスに入り、その間ドメインの取得・更新・移管など
 * 実体がレジストリ側にある操作は一切できない。これは不具合ではなく想定内の状態なので、
 * 「エラーが起きた」ではなく「いまは順番待ち」と伝えたい。
 *
 * バックエンドは 503 / EPP 2500 を registry_maintenance という専用コードに写像し、
 * 決まった日本語に変換して返す。フロントはその文言から判定する。
 * （封筒が `{ success, data, error }` だけでコードを載せていないため）
 */

/** バックエンドのメンテナンス文言に必ず含まれる語 */
const MAINTENANCE_MARKER = "メンテナンス";

export function isMaintenanceError(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.includes(MAINTENANCE_MARKER);
}

/**
 * メンテナンス中に、その画面で「何ができないのか」「代わりに何ができるのか」。
 *
 * 共通の一文だけだと、検索できないのか買えないのか分からず、
 * 利用者は自分の操作を疑って何度もやり直してしまう。
 */
export const MAINTENANCE_NOTICE: Record<string, string> = {
  search:
    "ドメインの空き状況を確認できません。メンテナンスが終わるまでお待ちください。",
  purchase:
    "ドメインの取得手続きができません。メンテナンス終了後にもう一度お試しください。",
  detail:
    "レジストリから最新の情報を取得できないため、一部の項目が表示できず、設定の変更もできません。ドメイン名や有効期限はこのまま確認できます。",
  renew: "有効期限の延長ができません。メンテナンス終了後にお試しください。",
  nameServers:
    "ネームサーバーを変更できません。メンテナンス終了後にお試しください。",
  authInfo:
    "認証コードを設定できません。メンテナンス終了後にお試しください。",
  lifecycle:
    "ドメインの廃止・復旧ができません。メンテナンス終了後にお試しください。",
  transfer:
    "移管の申請・取消ができません。メンテナンス終了後にお試しください。",
  transferDecision:
    "移管の承認・却下ができません。メンテナンス終了後にお試しください。自動承認までの時間はメンテナンス中も進むため、期限が近い場合は注意してください。",
};

/**
 * 時間をおけば直る失敗かどうか。
 *
 * メンテナンスや通信断は待てば解消するが、「すでに登録されています」のような
 * 失敗は何度やっても同じ。区別せずに再試行を勧めると、利用者を無限に往復させる。
 */
export function isRetryableFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return isMaintenanceError(message) || message.includes("通信に失敗");
}

/** 見出しは共通。何が起きているかを一言で。 */
export const MAINTENANCE_TITLE = "ドメイン登録機関がメンテナンス中です";

export function maintenanceNoticeOf(context: string): string {
  return (
    MAINTENANCE_NOTICE[context] ??
    "この操作はいま行えません。メンテナンス終了後にお試しください。"
  );
}
