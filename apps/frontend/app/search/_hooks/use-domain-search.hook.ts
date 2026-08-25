"use client";

import { useCallback, useRef, useState } from "react";
import type { DomainResult } from "@/components/domain-search-result";
import { searchDomains } from "../client";

const SEARCH_ERROR_MESSAGE = "検索に失敗しました。時間をおいてもう一度お試しください。";

/**
 * ドメイン検索の状態を持つフック。
 * 検索処理そのものは `../client` の `searchDomains()` に閉じ込めてあるため、
 * 実APIへの差し替え時にこのフックを変更する必要はない。
 */
export function useDomainSearch() {
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 連打時に古いレスポンスが新しい結果を上書きしないよう、最新リクエストIDだけを採用する
  const latestRequestIdRef = useRef(0);

  const search = useCallback(async (value: string) => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;

    setQuery(value);
    setLoading(true);
    setError(null);

    try {
      const data = await searchDomains(value);
      if (latestRequestIdRef.current !== requestId) return;
      setResults(data);
    } catch (caught) {
      if (latestRequestIdRef.current !== requestId) return;
      console.error("Domain search error:", caught);
      setResults([]);
      setError(SEARCH_ERROR_MESSAGE);
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  return { query, results, loading, error, search };
}
