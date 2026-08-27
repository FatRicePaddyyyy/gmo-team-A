// RFC 1035 準拠の FQDN 正規表現。
// - 各ラベル 1〜63 文字
// - ラベルは英数字始まり・英数字終わり、間はハイフン可
// - トップラベル (TLD) は 2 文字以上、英字のみ
// - 末尾ドット (root) は許可しない
// この regex は先頭・末尾ハイフン、連続ドットを弾く。
export const FQDN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// FQDN 検証。正規化 (trim + lowercase) 済みの前提。
export function isValidFqdn(name: string): boolean {
  if (name.length > 253) {return false;}
  return FQDN_REGEX.test(name);
}
