import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <Compass className="mx-auto mb-4 size-10 text-gray-400" aria-hidden="true" />
          <h1 className="mb-2 text-2xl font-bold text-gray-900">
            お探しのページは見つかりませんでした
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-gray-600">
            URL が変わったか、まだ準備中のページかもしれません。
            次のどちらかから続けられます。
          </p>
          {/* 以前は「ドメインを検索する」と「トップページへ戻る」を並べていたが、
              検索トップ＝トップページなので、どちらを押しても同じ場所に着いた。
              選択肢が 2 つあると「違いは何か」を考えさせてしまうので、
              行き先が実際に違うものだけを残す。 */}
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button
              className="h-11 px-5"
              variant="brand"
              nativeButton={false}
              render={<Link href="/" />}
            >
              ドメインを探す
            </Button>
            <Button
              variant="outline"
              className="h-11 px-5"
              nativeButton={false}
              render={<Link href="/learn" />}
            >
              ドメインについて学ぶ
            </Button>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
