"use client";

import { useSession } from "@/auth-client";

/**
 * `useSession()` をそのまま使うと、「未ログイン」と「バックエンドに接続できない」が
 * どちらも `data: null` に見えてしまい、ログインしても直らない状態なのに
 * 「ログインが必要です」と表示してしまう（issue #80）。
 *
 * `useSession()` は通信エラー時に `error` を返すので、それを見て区別する。
 */
export function useAuthStatus() {
  const { data: session, error, isPending } = useSession();
  const isSignedIn = Boolean(session?.user);

  return {
    isPending,
    isSignedIn,
    // セッションが取れていない状態でエラーがあるときだけ「接続できない」とみなす。
    // 既にセッションを持っている状態での裏側の再検証エラーまでは崩さない。
    isConnectionError: Boolean(error) && !isSignedIn,
    session,
  };
}
