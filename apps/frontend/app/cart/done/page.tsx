"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Info, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import {
  clearConfirmedOrder,
  loadConfirmedOrder,
  type ConfirmedOrder,
} from "@/shared/lib/order-store";

/**
 * ドメイン取得完了ページ（issue #74）。
 *
 * 直前まで payment ページから直接 /dashboard に飛んでいたので、
 * 「取得した」実感が消えていた。取得直後の 1 画面だけ、達成を伝えるための場所として挟む。
 *
 * 保存済みの ConfirmedOrder を見て「何が取れたか」を出す。
 * 直リンで来た（ConfirmedOrder 無し）人には「完了」を名乗らない
 * — /cart/complete と同じフォールバック文言。
 */
export default function CartDonePage() {
  const router = useRouter();
  const [order, setOrder] = useState<ConfirmedOrder | null>(null);
  const [checked, setChecked] = useState(false);

  // ハイドレーション後に、確定した内容を読み出してから ConfirmedOrder を空にする。
  // 読み出し前に消すと表示が空になり、消さないと戻る→再訪で完了ページを繰り返し
  // 見せてしまうため、この順番が要る。
  useEffect(() => {
    const loaded = loadConfirmedOrder();
    setOrder(loaded);
    setChecked(true);
    if (loaded) clearConfirmedOrder();
  }, []);

  // 表示のたびに紙吹雪の粒子を作り直すと SSR/クライアントで乱数がズレるので、
  // マウント後にだけ生成する。粒子は固定シード相当（インデックス依存）
  const [confetti, setConfetti] = useState<
    { left: number; delay: number; hue: number; duration: number }[]
  >([]);
  useEffect(() => {
    // 40 粒。少なすぎると寂しく、多すぎると重くなる
    const particles = Array.from({ length: 40 }, (_, i) => ({
      left: (i * 97) % 100, // 0-99 に均す。乱数を避けて hydration mismatch を回避
      delay: (i % 10) * 0.15, // 0〜1.5秒の遅延で波を作る
      hue: (i * 47) % 360,
      duration: 2.5 + ((i * 13) % 15) / 10, // 2.5〜4.0秒
    }));
    setConfetti(particles);
  }, []);

  // 完了扱いすると同時にキー1個で表示するために domainNames を1回だけ組み立てる
  const domainNames = useMemo(
    () => order?.items.map((it) => ({ name: it.name, tld: it.tld })) ?? [],
    [order],
  );

  if (checked && !order) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SiteHeader />
        <main className="mx-auto max-w-3xl px-4 py-10">
          <div className="rounded-lg border border-dashed border-border bg-white px-4 py-12 text-center">
            <Info className="mx-auto mb-3 size-8 text-gray-400" aria-hidden="true" />
            <h1 className="mb-1 text-xl font-bold text-gray-900">まだお申し込みはありません</h1>
            <p className="mb-6 text-sm leading-relaxed text-gray-600">
              このページは、ドメインを取得した方に表示されます。
              まずはドメインを検索してみてください。
            </p>
            <Button
              className="h-11 px-5 text-white"
              style={{ background: "var(--brand)" }}
              onClick={() => router.push("/")}
            >
              ドメインを検索する
            </Button>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader />

      <main className="relative mx-auto max-w-3xl px-4 py-10">
        {/* 紙吹雪。装飾なので支援技術には見せない。position:fixed で本文の上をふわっと落ちる */}
        <div
          className="pointer-events-none fixed inset-0 -z-0 overflow-hidden motion-reduce:hidden"
          aria-hidden="true"
        >
          {confetti.map((p, i) => (
            <span
              key={i}
              className="brand-confetti-piece absolute -top-4 block size-2 rounded-sm"
              style={{
                left: `${p.left}%`,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                background: `hsl(${p.hue} 85% 60%)`,
              }}
            />
          ))}
        </div>

        <div className="relative rounded-2xl border border-border bg-white px-6 py-10 text-center shadow-sm">
          {/* 大きめのチェックマーク。pop-in で「決まった」感を出す */}
          <div className="brand-check-pop mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="size-10 text-green-600" aria-hidden="true" />
          </div>

          <h1 className="mb-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            ドメインを取得しました
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-gray-600">
            おめでとうございます。あなたのドメインとして登録されました。
          </p>

          {domainNames.length > 0 && (
            <ul
              aria-label="取得したドメイン"
              className="mb-8 flex flex-col items-center gap-2"
            >
              {domainNames.map((d) => (
                <li
                  key={`${d.name}${d.tld}`}
                  className="brand-domain-highlight inline-flex flex-wrap items-baseline justify-center gap-0 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand-light)] px-4 py-3 text-xl font-bold text-gray-900 sm:text-2xl"
                >
                  <span className="break-all">{d.name}</span>
                  <span style={{ color: "var(--brand)" }}>{d.tld}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-4 flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
            <Button
              className="h-11 px-6 text-white"
              style={{ background: "var(--brand)" }}
              nativeButton={false}
              render={<Link href="/dashboard" />}
            >
              マイドメインで管理する
              <ArrowRight className="ml-1 size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              className="h-11 px-5"
              nativeButton={false}
              render={<Link href="/" />}
            >
              別のドメインを探す
            </Button>
          </div>

          <p className="text-xs text-gray-500">
            設定変更・有効期限の延長・ネームサーバーの登録はマイドメインから行えます。
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
