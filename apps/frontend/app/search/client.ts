import { $checkDomain } from "@/clients";
import type { DomainResult } from "@/components/domain-search-result";
import {
  TLD_CATALOG,
  formatYen,
  matchKnownTld,
  renewalWarningOf,
  stripKnownTld,
  twoYearTotalOf,
  type TldInfo,
} from "@/shared/lib/tld-catalog";

interface AvailabilityCheck {
  avail: boolean;
  /** 通信障害・レジストリ障害などで確認自体ができなかった */
  failed: boolean;
}

/** TLD辞書の1件を、検索結果1行の表示データに変換する */
function toDomainResult(info: TldInfo, name: string, check: AvailabilityCheck): DomainResult {
  return {
    tld: info.tld,
    name,
    available: check.avail,
    checkFailed: check.failed,
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
 * 候補TLDすべての空き状況を、1回のAPI呼び出しでまとめて確認する（Issue #45 B-3）。
 *
 * バックエンドが registry ごとにまとめて確認してくれるため、TLDの数だけ
 * リクエストを送っていた以前より通信回数を減らせる。
 * 通信自体が失敗した場合は、全候補を `failed: true` として返す
 * （空きなしと誤表示しないため。Issue #45 B-1）。
 */
async function checkAvailabilityBulk(fullNames: string[]): Promise<Map<string, AvailabilityCheck>> {
  try {
    const response = await $checkDomain({ json: { names: fullNames } });
    const body = await response.json();
    const map = new Map<string, AvailabilityCheck>();
    if (!body.success) {
      for (const fullName of fullNames) map.set(fullName, { avail: false, failed: true });
      return map;
    }
    for (const result of body.data.results) {
      map.set(result.name, { avail: result.avail, failed: result.failed });
    }
    return map;
  } catch {
    const map = new Map<string, AvailabilityCheck>();
    for (const fullName of fullNames) map.set(fullName, { avail: false, failed: true });
    return map;
  }
}

/**
 * ドメイン検索。
 *
 * 入力の末尾に既知のTLD（プルダウン選択 or 手入力）が付いている場合は、そのTLD1件だけに
 * 絞り込む。付いていない（「指定なし」）場合は、カタログの全TLDについてまとめて実際の
 * レジストリへ空き確認（Issue #10 の check 仕様）を問い合わせる。価格・説明はTLD_CATALOGの静的データを使う。
 */
export async function searchDomains(query: string): Promise<DomainResult[]> {
  const trimmed = query.trim();
  const matchedTld = matchKnownTld(trimmed);
  // 小文字に揃えてから送る。ドメイン名は大文字小文字を区別しないうえ、
  // バックエンドが受け取った名前を小文字化して返すため、ここで揃えておかないと
  // 下の checks.get() が空振りして「通信に失敗しました」と表示されてしまう。
  const name = stripKnownTld(trimmed).toLowerCase();
  if (!name) return [];

  const candidates = matchedTld ? [matchedTld] : TLD_CATALOG;
  const fullNames = candidates.map((info) => `${name}${info.tld}`);
  const checks = await checkAvailabilityBulk(fullNames);

  return candidates.map((info, index) => {
    const check = checks.get(fullNames[index]) ?? { avail: false, failed: true };
    return toDomainResult(info, name, check);
  });
}
