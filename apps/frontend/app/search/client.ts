import type { DomainResult } from "@/components/domain-search-result";
import {
  TLD_CATALOG,
  formatYen,
  renewalWarningOf,
  stripKnownTld,
  twoYearTotalOf,
  type TldInfo,
} from "@/shared/lib/tld-catalog";

/** 同じクエリなら毎回同じ空き状況を返すための簡易ハッシュ */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

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

function mockSearchDomains(query: string): DomainResult[] {
  const seed = hashString(query.toLowerCase());
  return TLD_CATALOG.map((info, index) =>
    toDomainResult(info, query, (seed + index) % 5 !== 0),
  );
}

/**
 * ドメイン検索。
 *
 * TODO(Issue #18): バックエンドに検索APIが実装されたら、この関数の中身だけを
 * clients.ts 経由の実API呼び出しに差し替える（呼び出し側の変更は不要）。
 *
 * 想定する差し替え後の実装（Issue #10 の check 仕様準拠）:
 *   const res = await $checkDomain({ json: { name: query } });
 *   const body = await res.json();
 *   return body.data.results.map(toDomainResult);
 *
 * 現状 apps/backend/src/routes 配下に該当エンドポイントが無いため、
 * フロント単体で確認できるようモックデータを返している。
 */
export async function searchDomains(query: string): Promise<DomainResult[]> {
  const name = stripKnownTld(query.trim());
  if (!name) return [];

  // 実API接続時のローディング表示を確認できるよう、意図的に遅延を入れている
  await new Promise((resolve) => setTimeout(resolve, 300));
  return mockSearchDomains(name);
}
