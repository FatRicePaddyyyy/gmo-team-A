import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: {
    default: "まなびドメイン | ドメインを学びながら取得する",
    template: "%s | まなびドメイン",
  },
  description:
    "ドメインの仕組みを解説しながら、あなたのドメイン取得をサポートします。TLDの違い・更新料・Whois情報公開まで、必要なタイミングで説明します。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={cn("font-sans", geist.variable)}>
      <body>
        {children}
        {/*
          画面遷移をまたぐお知らせ (例: 引き渡し承認直後の完了トースト) 用。
          位置は右下、控えめだが目に入る場所に置く。
        */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          duration={4000}
        />
      </body>
    </html>
  );
}
