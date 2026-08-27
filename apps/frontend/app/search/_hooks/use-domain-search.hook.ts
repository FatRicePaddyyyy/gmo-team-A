"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DomainResult } from "@/components/domain-search-result";
import { validateSearchInput } from "@/shared/lib/domain-name";
import { searchDomains } from "../client";

const SEARCH_ERROR_MESSAGE = "検索に失敗しました。時間をおいてもう一度お試しください。";

/**
 * ドメイン検索の状態を持つフック。
 * 検索処理そのものは `../client` の `searchDomains()` に閉じ込めてあるため、
 * 実APIへの差し替え時にこのフックを変更する必要はない。
 */
export function useDomainSearch() {
  const router = useRouter();
  const [query, setQuery] = useState<string | null>(null);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  // 連打時に古いレスポンスが新しい結果を上書きしないよう、最新リクエストIDだけを採用する
  const latestRequestIdRef = useRef(0);

  const search = useCallback(
    async (value: string, options?: { syncUrl?: boolean }) => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;

      setQuery(value);
      // 学習は行き来する行為。リロード・戻る・共有で同じ結果に戻れるよう URL を合わせる。
      // ただし URL の ?q= から初期表示する場合は既に URL が正しいので呼ばない
      // （呼ぶと、この環境では replace がフルリロードを起こし、マウント→search→replace→
      // リロード…の無限ループになる）。
      // 検索がトップページ（/）になったため、? q= もルートに書く。
      if (options?.syncUrl !== false) {
        router.replace(`/?q=${encodeURIComponent(value)}`, { scroll: false });
      }
      // 検索フォームは送信前に弾いているが、URL の ?q= から直接来る経路は
      // フォームを通らない。ここでも止めないと日本語入力がレジストリまで届き、
      // 422 が failed に化けて「通信に失敗しました」と出てしまう（Issue #76）。
      const invalidReason = validateSearchInput(value);
      if (invalidReason) {
        setResults([]);
        setError(invalidReason);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setUnavailableReason(null);

      try {
        const outcome = await searchDomains(value);
        if (latestRequestIdRef.current !== requestId) return;
        setResults(outcome.results);
        // 空き確認ができなかったときは理由をそのまま画面へ渡す。
        // メンテナンス中かどうかで利用者の取るべき行動が変わるため。
        setUnavailableReason(outcome.failureMessage);
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
    },
    [router],
  );

  return { query, results, loading, error, unavailableReason, search };
}
