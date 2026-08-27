"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * `/search` は廃止し、検索機能そのものはトップページ（`/`）に統合した。
 * 既存のリンク（`/search?q=...` など）を壊さないよう、クエリを引き継いで
 * トップページへリダイレクトするだけの薄いラッパーとして残す。
 */
export default function SearchRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/${window.location.search}`);
  }, [router]);

  return null;
}
