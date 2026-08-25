import type { Registry } from "./bridge/types";

// Issue #25: TLD からレジストリを判定する方針
// - Kitaqsign: .com .net .org .info（レジストリ側の supportedTlds に準拠）
// - Kitaqnic: それ以外（18 gTLD）
// 対応 TLD 一覧は Swagger の GET /api/v1/epp/sessions/hello で取得可能だが、
// ハッカソン期間中は静的テーブルで固定する。

const KITAQSIGN_TLDS = new Set(["com", "net", "org", "info"]);

/**
 * FQDN からレジストリを判定する。
 * 例: example.com → kitaqsign
 * 例: example.jp → kitaqnic
 * @param name FQDN（例: "example.com"）
 * @returns Registry。判定不能な場合は null
 */
export function detectRegistry(name: string): Registry | null {
  const trimmed = name.trim().toLowerCase();
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot < 0 || lastDot === trimmed.length - 1) {return null;}
  const tld = trimmed.slice(lastDot + 1);
  if (!tld) {return null;}
  if (KITAQSIGN_TLDS.has(tld)) {return "kitaqsign";}
  return "kitaqnic";
}
