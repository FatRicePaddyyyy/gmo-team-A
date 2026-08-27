/**
 * ドメイン名の入力ルール。
 *
 * 実体はバックエンドの `lib/registry-policy.ts` にあり、ここでは再エクスポートするだけ。
 * 以前はフロント側 (移管申請フォーム) に regex のリテラルが別途書かれていて、
 * 画面ごとにバリデーションの強度がずれていた (Issue #76)。写しを作らないこと。
 *
 * IDN (日本語ドメイン) は現状サポート外。punycode 変換ロジックが無く、
 * kitaqsign が IDN を拒否するため、入力の時点で弾いて理由を伝える。
 */

import {
  DOMAIN_NAME_RULE_MESSAGE,
  FQDN_MAX_LENGTH,
  FQDN_REGEX,
  isValidDomainLabels,
  isValidFqdn,
} from "backend/registry-policy";
import { stripKnownTld } from "@/shared/lib/tld-catalog";

export {
  DOMAIN_NAME_RULE_MESSAGE,
  FQDN_MAX_LENGTH,
  FQDN_REGEX,
  isValidDomainLabels,
  isValidFqdn,
};

/** 移管申請フォームのように FQDN をそのまま打たせる入力欄のメッセージ */
export const FQDN_INPUT_MESSAGE = `${DOMAIN_NAME_RULE_MESSAGE}末尾（.com など）まで含めて入力してください。`;

/**
 * 検索窓の入力を検証する。
 *
 * 検索窓は末尾（TLD）を横のプルダウンで選ぶ作りなので、検証するのは TLD を除いた
 * 「名前の部分」。`searchDomains` が `stripKnownTld` で切り出すのと同じ前処理を使う。
 *
 * @returns 問題があればユーザー向けメッセージ、無ければ null
 */
export function validateSearchInput(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return "調べたいドメイン名を入力してください。";
  }
  const name = stripKnownTld(trimmed).toLowerCase();
  if (!name) {
    return "末尾（.com など）の前に、ドメイン名を入力してください。";
  }
  if (!isValidDomainLabels(name)) {
    return DOMAIN_NAME_RULE_MESSAGE;
  }
  return null;
}
