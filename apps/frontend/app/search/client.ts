import { $checkDomain } from "@/clients";
import { NETWORK_ERROR_MESSAGE } from "@/shared/lib/api-result";
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

/**
 * 確認できなかった理由。
 *
 * これまで理由を捨てていたため、レジストリのメンテナンス中でも
 * 「通信状況やレジストリ側の一時的な問題」としか出せず、
 * 利用者は何度も検索し直すことになっていた。
 */
export interface BulkCheckOutcome {
  checks: Map<string, AvailabilityCheck>;
  /** 失敗したときのバックエンドからのメッセージ。成功時は null */
  failureMessage: string | null;
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
async function checkAvailabilityBulk(fullNames: string[]): Promise<BulkCheckOutcome> {
  const allFailed = (message: string): BulkCheckOutcome => {
    const map = new Map<string, AvailabilityCheck>();
    for (const fullName of fullNames) map.set(fullName, { avail: false, failed: true });
    return { checks: map, failureMessage: message };
  };

  try {
    const response = await $checkDomain({ json: { names: fullNames } });
    const body = await response.json();
    if (!body.success) {
      return allFailed(body.error || NETWORK_ERROR_MESSAGE);
    }
    const map = new Map<string, AvailabilityCheck>();
    for (const result of body.data.results) {
      map.set(result.name, { avail: result.avail, failed: result.failed });
    }
    // 項目ごとに失敗することがある（レジストリ単位で落ちるため）。
    // 理由は項目に付いてくるので、最初に見つかったものを画面へ渡す。
    const firstReason = body.data.results.find((r) => r.failed && r.reason)?.reason;
    return { checks: map, failureMessage: firstReason ?? null };
  } catch (caught) {
    console.error("Domain check failed:", caught);
    return allFailed(NETWORK_ERROR_MESSAGE);
  }
}

/**
 * ドメイン検索。
 *
 * 入力の末尾に既知のTLD（プルダウン選択 or 手入力）が付いている場合は、そのTLD1件だけに
 * 絞り込む。付いていない（「指定なし」）場合は、カタログの全TLDについてまとめて実際の
 * レジストリへ空き確認（Issue #10 の check 仕様）を問い合わせる。価格・説明はTLD_CATALOGの静的データを使う。
 */
export interface SearchOutcome {
  results: DomainResult[];
  /** 空き確認ができなかった理由。全件確認できた場合は null */
  failureMessage: string | null;
}

export async function searchDomains(query: string): Promise<SearchOutcome> {
  const trimmed = query.trim();
  const matchedTld = matchKnownTld(trimmed);
  const name = stripKnownTld(trimmed);
  if (!name) return { results: [], failureMessage: null };

  const candidates = matchedTld ? [matchedTld] : TLD_CATALOG;
  const fullNames = candidates.map((info) => `${name}${info.tld}`);
  const { checks, failureMessage } = await checkAvailabilityBulk(fullNames);

  return {
    results: candidates.map((info, index) => {
      const check = checks.get(fullNames[index]) ?? { avail: false, failed: true };
      return toDomainResult(info, name, check);
    }),
    failureMessage,
  };
}
