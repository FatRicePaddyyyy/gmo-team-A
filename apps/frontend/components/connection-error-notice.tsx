"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * バックエンドに接続できないときの表示（issue #80）。
 *
 * 「未ログイン」と見た目を分ける。ログインし直しても直らない問題なので、
 * ログインを促す文言・ボタンは出さない。再読み込みだけを案内する。
 */
export function ConnectionErrorNotice() {
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-sm">
      <h1 className="font-heading text-xl font-bold text-gray-900">
        サーバーに接続できません
      </h1>
      <p className="text-sm text-gray-600">
        しばらくしてからもう一度お試しください。ログインし直しても解決しません。
      </p>
      <Button
        className="w-full"
        variant="brand"
        onClick={() => window.location.reload()}
      >
        <RefreshCw aria-hidden="true" />
        再読み込み
      </Button>
    </div>
  );
}
