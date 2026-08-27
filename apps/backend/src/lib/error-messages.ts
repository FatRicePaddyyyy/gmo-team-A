// サービス・ブリッジ層の内部エラーコードをユーザー向けメッセージに変換する
// 技術的なエラーコードをそのままAPIレスポンスに出さない

import { DOMAIN_NAME_RULE_MESSAGE } from "./registry-policy";

const errorMessages: Record<string, string> = {
  // ドメイン
  domain_not_found: "ドメインが見つかりませんでした。ドメイン名を確認してください。",
  domain_exists: "このドメインはすでに登録されています。別のドメイン名をお試しください。",
  domain_not_transferable: "現在の状態では移管できません。ドメインのステータスを確認してください。",
  domain_pending_transfer: "移管手続き中のため、この操作はできません。移管が完了するまでお待ちください。",
  not_found: "ドメインが見つかりませんでした。",
  invalid_tld: "このドメインの拡張子（TLD）には対応していません。別のドメイン名をお試しください。",
  invalid_period: "登録期間の指定が正しくありません。1〜10年の範囲で指定してください。",
  invalid_expires_at: "有効期限の取得に失敗しました。しばらく待ってから再試行してください。",
  invalid_domain_name: `${DOMAIN_NAME_RULE_MESSAGE}末尾（.com など）まで含めて入力してください。`,
  unsupported_tld: "このドメインの拡張子（TLD）には対応していません。別のドメインをお試しください。",

  // 操作制限
  operation_prohibited: "現在の状態ではこの操作はできません。ドメインのステータスを確認してください。",
  forbidden: "この操作を行う権限がありません。",

  // 移管
  authInfo_mismatch: "認証コード（AuthCode）が正しくありません。移管元レジストラから正しいコードを取得してください。",
  transfer_not_found: "移管申請が見つかりませんでした。",
  transfer_not_cancellable: "この移管申請はすでに処理済みのため取り消しできません。",
  self_transfer: "自分が所有するドメインには移管申請できません。",
  transfer_already_pending: "このドメインには既に処理中の移管申請があります。取消してから再申請してください。",
  transfer_expired: "移管申請の待機時間が上限を超えました。もう一度申請してください。",
  // Issue #107: clientTransferProhibited が付いているケース。
  // 「一時障害」ではなくロックを外すまで永久に受理されないので、再試行を促さない文言にする。
  transfer_prohibited: "このドメインは移管が禁止されています。設定画面で移管ロックを解除してから再度お試しください。",
  queue_unavailable: "システムが一時的に応答できません。しばらくしてから再試行してください。",
  invalid_domain_registry: "ドメイン名とレジストリの組み合わせが正しくありません。",

  // コンタクト
  contact_create_failed: "レジストリへの接続中に問題が発生しました。しばらく待ってから再試行してください。",
  contact_not_found: "コンタクト情報が見つかりませんでした。しばらく待ってから再試行してください。",
  contact_id_conflict: "登録処理が競合しました。もう一度お試しください。",
  invalid_contact_payload: "コンタクト情報がレジストリの制約に違反しています。氏名やメールを確認してください。",

  // ユーザー / 認証
  user_not_found: "ユーザー情報が見つかりませんでした。ログインし直してから再試行してください。",
  session_expired: "セッションの有効期限が切れました。再度ログインしてください。",
  auth_error: "認証中にエラーが発生しました。再度ログインしてください。",

  // バリデーション (Zod default hook 用)
  validation_error: "入力内容に誤りがあります。項目を確認してください。",

  // データベース
  db_error: "データの取得または保存に失敗しました。しばらく待ってから再試行してください。",
  unique_violation: "同じデータが既に存在するため、この操作は行えません。",
  fk_violation: "関連するデータが見つからないため、この操作は行えません。",
  transfer_create_failed: "移管レコードの作成に失敗しました。しばらく待ってから再試行してください。",
  domain_create_failed: "ドメインの作成に失敗しました。しばらく待ってから再試行してください。",

  // 通信 / レジストリ
  network_error: "レジストリとの通信に失敗しました。しばらく待ってから再試行してください。",
  ack_failed: "通知の処理中に問題が発生しました。しばらく待ってから再試行してください。",
  invalid_registry_response: "レジストリから予期しない応答がありました。しばらく待ってから再試行してください。",
  registry_error: "レジストリでエラーが発生しました。しばらく待ってから再試行してください。",
  // メンテナンスは「予期しない応答」ではなく予期できる状態。原因と、利用者が
  // 取れる行動（待つしかない）がはっきり分かる文言にする。
  registry_maintenance: "ただいまドメイン登録機関がメンテナンス中のため、この操作は行えません。時間をおいてからお試しください。",
  referenced_object_not_found: "指定したネームサーバーやコンタクトがレジストリに登録されていません。内容を確認してください。",
  poll_failed: "通知の取得に失敗しました。しばらく待ってから再試行してください。",
};

// bridge が `"code: detail"` 形式で返してきた場合、":" 前のコードで定型文言を引き、
// ":" 後のレジストリ由来メッセージ (メンテ中の理由など) を「(理由: ...)」で末尾に付加する。
// これによりレジストリ障害の内容がユーザー応答まで届く。
export function toUserMessage(error: string): string {
  const sep = error.indexOf(":");
  if (sep > 0) {
    const code = error.slice(0, sep).trim();
    const detail = error.slice(sep + 1).trim();
    const base = errorMessages[code] ?? "予期しないエラーが発生しました。しばらく待ってから再試行してください。";
    return detail ? `${base} (理由: ${detail})` : base;
  }
  return errorMessages[error] ?? "予期しないエラーが発生しました。しばらく待ってから再試行してください。";
}

// Zod のバリデーション失敗を「どの入力がなぜ駄目なのか」まで伝えるための判定。
// スキーマ側は message にこのファイルのエラーコード (例: "invalid_domain_name") を書き、
// defaultHook がそれを拾って定型文言に変換する。
// 詳細は lib/openapi-hono.ts の defaultHook を参照。
export function hasUserMessage(code: string): boolean {
  return code in errorMessages;
}

/**
 * レジストリのメンテナンス中に出るエラーかどうか。
 *
 * メンテナンスは「サーバー内部で異常が起きた」のではなく
 * 「いまは受け付けられない、待てば戻る」状態なので、HTTP は 500 ではなく
 * 503 を返す。監視やログを見る側が、障害と定期メンテを取り違えずに済む。
 *
 * bridge は `"registry_maintenance: 理由"` の形でも返すため、
 * ":" より前のコードで判定する。
 */
export function isMaintenanceError(error: string): boolean {
  const code = error.indexOf(":") > 0 ? error.slice(0, error.indexOf(":")).trim() : error.trim();
  return code === "registry_maintenance";
}
