"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

interface NoOrderNoticeProps {
  /** ログイン済みかどうか。2つ目の出口を「ログイン」と「マイドメイン」で出し分ける */
  isLoggedIn: boolean;
}

/**
 * 確認を終えていない人が `/cart/payment` や `/cart/complete` に直接来たときの画面。
 *
 * 同じ内容が2ページに書き写されていて、片方だけ直る事故が起きやすかったので1つにまとめた。
 *
 * 出口が「ドメインを検索する」しか無いと、すでにアカウントを持っている人が
 * 「ログインすれば続きから進めるのでは」と気づけないまま行き止まる（Issue #70）。
 * ログイン後は、確定済みの申し込みがあれば支払い画面へ、無ければマイドメインへ戻る
 * （`login/_hooks/use-password-login.hook.ts` が行き先を決めている）。
 */
export function NoOrderNotice({ isLoggedIn }: NoOrderNoticeProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-lg border border-dashed border-border bg-white px-4 py-12 text-center">
          <Info className="mx-auto mb-3 size-8 text-gray-400" aria-hidden="true" />
          <h1 className="mb-1 text-xl font-bold text-gray-900">まだお申し込みはありません</h1>
          <p className="mb-6 text-sm leading-relaxed text-gray-600">
            このページは、お申し込み内容の確認を終えた方に表示されます。
            まずはドメインを選んで、確認画面で設定を決めてください。
            {!isLoggedIn && "すでにアカウントをお持ちの場合は、ログインすると続きから進めます。"}
          </p>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
            <Button
              className="h-11 px-5 text-white"
              style={{ background: "var(--brand)" }}
              nativeButton={false}
              render={<Link href="/" />}
            >
              ドメインを検索する
            </Button>
            <Button
              variant="outline"
              className="h-11 px-5"
              nativeButton={false}
              render={<Link href={isLoggedIn ? "/dashboard" : "/login"} />}
            >
              {isLoggedIn ? "マイドメイン" : "ログイン"}
            </Button>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
