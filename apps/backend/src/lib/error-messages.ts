// サービス・ブリッジ層の内部エラーコードをユーザー向けメッセージに変換する
// 技術的なエラーコードをそのままAPIレスポンスに出さない

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

  // 操作制限
  operation_prohibited: "現在の状態ではこの操作はできません。ドメインのステータスを確認してください。",
  forbidden: "この操作を行う権限がありません。",

  // 移管
  authInfo_mismatch: "認証コード（AuthCode）が正しくありません。移管元レジストラから正しいコードを取得してください。",
  transfer_not_found: "移管申請が見つかりませんでした。",
  transfer_not_cancellable: "この移管申請はすでに処理済みのため取り消しできません。",

  // コンタクト
  contact_create_failed: "レジストリへの接続中に問題が発生しました。しばらく待ってから再試行してください。",
  contact_not_found: "コンタクト情報が見つかりませんでした。しばらく待ってから再試行してください。",
  contact_id_not_found: "レジストリからコンタクトIDを取得できませんでした。しばらく待ってから再試行してください。",
  contact_id_conflict: "登録処理が競合しました。もう一度お試しください。",

  // 通信 / レジストリ
  network_error: "レジストリとの通信に失敗しました。しばらく待ってから再試行してください。",
  ack_failed: "通知の処理中に問題が発生しました。しばらく待ってから再試行してください。",
  invalid_registry_response: "レジストリから予期しない応答がありました。しばらく待ってから再試行してください。",
  registry_error: "レジストリでエラーが発生しました。しばらく待ってから再試行してください。",
  poll_failed: "通知の取得に失敗しました。しばらく待ってから再試行してください。",
};

export function toUserMessage(error: string): string {
  // unknown_transfer_status: ... のようなプレフィックス付きエラーも処理
  if (error.startsWith("unknown_transfer_status")) {
    return "予期しない状態が発生しました。サポートにお問い合わせください。";
  }
  return errorMessages[error] ?? "予期しないエラーが発生しました。しばらく待ってから再試行してください。";
}
