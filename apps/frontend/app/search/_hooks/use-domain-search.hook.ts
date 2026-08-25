import { useCallback, useState } from "react";
import type { DomainResult } from "@/components/domain-search-result";

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

// 同じクエリなら毎回同じ空き状況になるようにするための簡易ハッシュ
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * TODO(Issue #18): バックエンドにドメイン検索APIが実装されたら、
 * この関数を clients.ts 経由の実API呼び出しに差し替える。
 * 現状 apps/backend/src/routes 配下に該当エンドポイントが無いため、
 * フロント単体で確認できるようモックデータを返している。
 */
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

export function useDomainSearch() {
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<DomainResult[]>([]);

  const search = useCallback((value: string) => {
    setQuery(value);
    setResults(mockSearchDomains(value));
  }, []);

  return { query, results, search };
}
