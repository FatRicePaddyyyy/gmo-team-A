import { $checkDomain } from "@/clients";
import type { DomainResult } from "@/components/domain-search-result";
import {
  TLD_CATALOG,
  formatYen,
  renewalWarningOf,
  stripKnownTld,
  twoYearTotalOf,
  type TldInfo,
} from "@/shared/lib/tld-catalog";

/** TLD辞書の1件を、検索結果1行の表示データに変換する */
function toDomainResult(info: TldInfo, name: string, available: boolean): DomainResult {
  return {
    tld: info.tld,
    name,
    available,
    price: formatYen(info.firstYearPrice),
    renewalPrice: formatYen(info.renewalPrice),
    popular: info.popular,
    summary: info.summary,
    detail: info.detail,
    eligibility: info.eligibility,
    restricted: info.restricted,
    renewalWarning: renewalWarningOf(info),
    twoYearTotal: twoYearTotalOf(info),
    limitedOffer: info.limitedOffer,
  };
}

/**
 * 1つのTLDについて空き状況を確認する。
 *
 * 非対応TLD（unsupported_tld）やネットワークエラーも含め、失敗はすべて
 * 「空きなし」として扱う。検索結果は複数TLDの一覧なので、1件のエラーで
 * 画面全体を落とさないことを優先する。
 */
async function checkAvailability(fullName: string): Promise<boolean> {
  try {
    const response = await $checkDomain({ json: { name: fullName } });
    const body = await response.json();
    if (!body.success) return false;
    return body.data.avail;
  } catch {
    return false;
  }
}

/**
 * ドメイン検索。
 *
 * カタログの各TLDについて、実際のレジストリへ空き確認（Issue #10 の check 仕様）を
 * 並列で問い合わせる。価格・説明はTLD_CATALOGの静的データを使う。
 */
export async function searchDomains(query: string): Promise<DomainResult[]> {
  const name = stripKnownTld(query.trim());
  if (!name) return [];

  return Promise.all(
    TLD_CATALOG.map(async (info) => {
      const available = await checkAvailability(`${name}${info.tld}`);
      return toDomainResult(info, name, available);
    }),
  );
}
