import type { DomainResult } from "@/components/domain-search-result";

/**
 * 検索候補として引くTLDと価格。
 * バックエンドの検索APIが入ったら、価格はAPIレスポンス側に持たせる。
 */
const CANDIDATE_TLDS: Array<{
  tld: string;
  newPrice: string;
  renewalPrice: string;
  popular?: boolean;
  sale?: boolean;
}> = [
  { tld: ".com", newPrice: "0円", renewalPrice: "1,408円", popular: true, sale: true },
  { tld: ".net", newPrice: "0円", renewalPrice: "1,628円", popular: true, sale: true },
  { tld: ".jp", newPrice: "0円", renewalPrice: "3,124円", popular: true },
  { tld: ".co.jp", newPrice: "2,970円", renewalPrice: "2,970円" },
  { tld: ".xyz", newPrice: "0円", renewalPrice: "2,013円", sale: true },
  { tld: ".org", newPrice: "1,628円", renewalPrice: "1,628円" },
];

/** 同じクエリなら毎回同じ空き状況を返すための簡易ハッシュ */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mockSearchDomains(query: string): DomainResult[] {
  const seed = hashString(query.toLowerCase());
  return CANDIDATE_TLDS.map((candidate, index) => {
    const available = (seed + index) % 5 !== 0;
    return {
      tld: candidate.tld,
      name: query,
      available,
      price: available ? candidate.newPrice : candidate.renewalPrice,
      renewalPrice: available ? candidate.renewalPrice : undefined,
      popular: candidate.popular,
      sale: available ? candidate.sale : undefined,
    };
  });
}

/**
 * 検索語の末尾に TLD が付いていたら取り除く。
 * 「onamae.co.jp」で検索したときに「onamae.co.jp.com」のような候補が出るのを防ぐ。
 * 長い TLD から先に判定する（.co.jp を .jp より先に消す）。
 */
const KNOWN_TLDS = CANDIDATE_TLDS.map((candidate) => candidate.tld).sort(
  (a, b) => b.length - a.length,
);

function stripKnownTld(value: string): string {
  const lower = value.toLowerCase();
  for (const tld of KNOWN_TLDS) {
    if (lower.endsWith(tld) && lower.length > tld.length) {
      return value.slice(0, -tld.length);
    }
  }
  return value;
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
