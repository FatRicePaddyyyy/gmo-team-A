/**
 * 「寄り道から必ず帰ってこられる」ための戻り先の解決。
 *
 * 解説ページ（/learn など）は検索結果からの寄り道なので、必ず元の判断に帰れる必要がある。
 * ブラウザ履歴（router.back）は直リンクで来たときに壊れるため使わない。
 * 代わりに URL の `?from=` と、進捗（localStorage）の検索名の2段構えで戻り先を決める。
 */

export interface ReturnTarget {
  /** 戻り先の URL。必ずサイト内の絶対パス */
  href: string;
  /** リンクの文言（← は表示側で付ける） */
  label: string;
}

/** トップへのフォールバック。どの経路でも最低限ここには帰れる */
const HOME_TARGET: ReturnTarget = { href: "/", label: "トップに戻る" };

/** 検索結果 URL を組み立てる */
export function searchHref(query: string | null | undefined): string {
  const trimmed = query?.trim();
  return trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search";
}

/**
 * 寄り道リンクに付ける `?from=` 付きの URL を作る。
 *
 * @param to 寄り道先のパス（例: `/learn`）
 * @param from 戻り先のサイト内パス（例: `/search?q=manabi`）
 */
export function withReturnTo(to: string, from: string): string {
  return `${to}?from=${encodeURIComponent(from)}`;
}

/**
 * サイト内パスかどうか。`//evil.com` や `https://…` のような外部への戻りは受け付けない。
 */
function isInternalPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

/** 戻り先のパスから、押す前に行き先が分かる文言を決める */
function labelFor(path: string): string {
  if (path.startsWith("/search")) return "検索結果に戻る";
  if (path === "/" || path.startsWith("/?") || path.startsWith("/#")) return "トップに戻る";
  return "前のページに戻る";
}

/**
 * 戻り先を決める。
 *
 * 1. `?from=` が付いていればそれ（サイト内パスのときだけ）
 * 2. 無ければ、直前に検索した名前から検索結果へ
 * 3. どちらも無ければトップへ
 */
export function resolveReturnTo(
  rawFrom: string | null | undefined,
  searchedName: string | null | undefined,
): ReturnTarget {
  if (rawFrom) {
    let decoded = rawFrom;
    try {
      decoded = decodeURIComponent(rawFrom);
    } catch {
      // 壊れたエスケープが来たら、デコードせずそのまま検証に回す
    }
    if (isInternalPath(decoded)) {
      return { href: decoded, label: labelFor(decoded) };
    }
  }

  const trimmed = searchedName?.trim();
  if (trimmed) {
    return { href: searchHref(trimmed), label: "検索結果に戻る" };
  }

  return HOME_TARGET;
}

/** クライアントで現在の URL から `from` を読む。SSR では null */
export function readFromParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("from");
}
