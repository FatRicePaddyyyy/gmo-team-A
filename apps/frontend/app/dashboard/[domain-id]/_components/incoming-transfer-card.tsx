"use client";

import { useState } from "react";
import { ArrowLeftRight, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/confirm-action";
import { FeedbackBanner } from "@/components/feedback-banner";
import { GlossaryTerm } from "@/components/glossary-term";
import { GLOSSARY } from "@/shared/lib/glossary";
import { formatDate } from "@/shared/lib/format-date";
import type {
  DomainFeedback,
  InboundTransfer,
  RunningTransferAction,
} from "../../_hooks/use-inbound-transfers.hook";

interface IncomingTransferCardProps {
  transfer: InboundTransfer;
  running: RunningTransferAction | null;
  feedback: DomainFeedback | null;
  /**
   * 承認処理。呼び出し側 (親 page) は成否を bool で返してよいので `unknown` を許容する。
   * この props では返り値を使わない (単に「押されたら呼ぶ」だけ)。
   */
  onApprove: (transfer: InboundTransfer) => Promise<unknown> | void;
  onReject: (transfer: InboundTransfer) => Promise<unknown> | void;
}

/**
 * 「このドメインを他のレジストラへ渡してよいか」を決めるカード。
 *
 * これまで一覧にしか無く、詳細ページを開いた人は
 * 「手続き中のため設定を変更できません」としか見えなかった。
 * 何が起きているのか分からないまま、放置すると自動で承認される。
 *
 * 詳細ページは「そのドメインについて何でもできる場所」なので、ここでも決められるようにする。
 */
export function IncomingTransferCard({
  transfer,
  running,
  feedback,
  onApprove,
  onReject,
}: IncomingTransferCardProps) {
  const [confirmingReject, setConfirmingReject] = useState(false);
  const busy = running !== null;

  return (
    <Card className="ring-2 ring-amber-300">
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2">
          <ArrowLeftRight
            className="mt-0.5 size-5 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-heading text-lg font-bold text-gray-900">
              他の
              <GlossaryTerm
                description={GLOSSARY.registrar.description}
              >
                {GLOSSARY.registrar.term}
              </GlossaryTerm>
              への引き渡しを求められています
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              このドメインを他の事業者へ移したい、という申請が {formatDate(transfer.requestedAt)} に届きました。
              あなたが承認すると、このドメインはあなたのものではなくなります。
            </p>
          </div>
        </div>

        {/* 自動承認は知らないと事故になるので、目立つ場所に置く */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <p className="text-xs text-amber-900">
            <span className="font-semibold">放置すると自動で承認されます。</span>
            心当たりが無い申請なら、早めに却下してください。心当たりがある場合だけ承認してください。
          </p>
        </div>

        {feedback && (
          <FeedbackBanner
              context="transferDecision"
            tone={feedback.tone}
            message={feedback.message}
            unauthorized={feedback.unauthorized}
          />
        )}

        {confirmingReject ? (
          <ConfirmAction
            question={`${transfer.domainName} の引き渡しを却下しますか？`}
            detail="却下すると、申請した相手にはドメインが渡りません。あなたが移管を依頼した相手からの申請だった場合は、もう一度申請してもらう必要があります。"
            confirmLabel="却下する"
            running={running?.kind === "reject"}
            onConfirm={async () => {
              await onReject(transfer);
              setConfirmingReject(false);
            }}
            onCancel={() => setConfirmingReject(false)}
          />
        ) : (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            <Button
              variant="brand"
              disabled={busy}
              onClick={() => void onApprove(transfer)}
            >
              {running?.kind === "approve" ? "承認中..." : "承認して引き渡す"}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => setConfirmingReject(true)}
            >
              却下して手元に残す
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
