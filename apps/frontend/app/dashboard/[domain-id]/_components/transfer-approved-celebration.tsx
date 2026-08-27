"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 移管の承認が完了した直後に出す「完了しました！」画面。
 *
 * IncomingTransferCard は refresh 後にアンマウントされるので、承認の余韻を
 * その中で出しても一瞬で消える。呼び出し側 (親 page) が完了状態を持って
 * この画面を出し続ける想定。
 *
 * 演出は /cart/done と同じ CSS (globals.css の brand-* keyframes) を使う。
 */
interface TransferApprovedCelebrationProps {
  /** 完了した対象ドメイン (承認して手放した側) */
  domainName: string;
  /** 「マイドメインに戻る」を押したとき呼ばれる。親側で完了状態をクリアする */
  onDismiss: () => void;
}

export function TransferApprovedCelebration({
  domainName,
  onDismiss,
}: TransferApprovedCelebrationProps) {
  // ハイドレーション後にだけ紙吹雪を生成する (SSR/CSR の乱数ズレ回避)
  const [confetti, setConfetti] = useState<
    { left: number; delay: number; hue: number; duration: number }[]
  >([]);
  useEffect(() => {
    const particles = Array.from({ length: 30 }, (_, i) => ({
      left: (i * 97) % 100,
      delay: (i % 10) * 0.15,
      hue: (i * 47) % 360,
      duration: 2.5 + ((i * 13) % 15) / 10,
    }));
    setConfetti(particles);
  }, []);

  return (
    <>
      {/*
        紙吹雪は本文と別レイヤ。装飾なので支援技術には見せない。
        SiteHeader (sticky z-50) より下に来るよう z-0。カード全体を覆う
        親の TabsContent は position: static なので、fixed で画面全体に散る。
      */}
      <div
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden motion-reduce:hidden"
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

      <Card className="relative z-10 ring-2 ring-green-300">
        <CardContent className="space-y-4 py-8 text-center">
          <div className="brand-check-pop mx-auto flex size-16 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="size-10 text-green-600" aria-hidden="true" />
          </div>

          <div>
            <h2 className="font-heading text-2xl font-bold text-gray-900">
              完了しました！
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              引き渡しを承認しました。まもなくレジストリで反映され、
              このドメインは相手のレジストラで管理されます。
            </p>
          </div>

          <p className="brand-domain-highlight inline-block rounded-lg border border-[var(--brand)]/40 bg-[var(--brand-light)] px-4 py-2 text-lg font-bold break-all text-gray-900">
            {domainName}
          </p>

          <div className="pt-2">
            <Button
              variant="brand"
              nativeButton={false}
              render={<Link href="/dashboard" />}
              onClick={onDismiss}
            >
              マイドメインに戻る
              <ArrowRight className="ml-1 size-4" aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
