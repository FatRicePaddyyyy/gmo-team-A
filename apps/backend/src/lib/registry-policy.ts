// RFC 1035 準拠の FQDN 正規表現。
// - 各ラベル 1〜63 文字
// - ラベルは英数字始まり・英数字終わり、間はハイフン可
// - トップラベル (TLD) は 2 文字以上、英字のみ
// - 末尾ドット (root) は許可しない
// この regex は先頭・末尾ハイフン、連続ドットを弾く。
//
// IDN (日本語ドメイン) はこの regex を通らない。これは意図的で、
// 現状このリポジトリに punycode 変換ロジックが無く、kitaqsign は IDN を拒否する
// (Swagger の 422 = TLD ポリシー違反 / IDN 不可) ため、IDN はサポート外。
// 詳細と将来の方針は README の「ドメイン名の入力ルール」を参照。
export const FQDN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// FQDN 全体の最大長 (RFC 1035)。
export const FQDN_MAX_LENGTH = 253;

// TLD を除いた「名前の部分」用。ドットで区切られた 1 つ以上のラベル。
// 検索窓のようにユーザーが TLD を別途プルダウンで選ぶ画面で使う。
export const DOMAIN_LABELS_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

// 入力ルールをユーザーに説明する一文。
// バックエンドのエラーメッセージとフロントのフォーム両方でこれを使い、
// 画面ごとに文言がぶれないようにする。
export const DOMAIN_NAME_RULE_MESSAGE =
  "ドメイン名は半角の英数字とハイフンで入力してください。日本語や記号は使えません。";

// FQDN 検証。正規化 (trim + lowercase) 済みの前提。
export function isValidFqdn(name: string): boolean {
  if (name.length > FQDN_MAX_LENGTH) {return false;}
  return FQDN_REGEX.test(name);
}

// TLD を除いた名前部分の検証。正規化 (trim + lowercase) 済みの前提。
export function isValidDomainLabels(name: string): boolean {
  if (name.length > FQDN_MAX_LENGTH) {return false;}
  return DOMAIN_LABELS_REGEX.test(name);
}
