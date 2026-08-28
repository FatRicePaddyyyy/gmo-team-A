"use client";

import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/confirm-action";
import { FeedbackBanner } from "@/components/feedback-banner";
import { GlossaryTerm } from "@/components/glossary-term";
import { GLOSSARY } from "@/shared/lib/glossary";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";

interface LifecycleCardProps {
  domainName: string;
  /** 廃止できるか。手続き中と廃止済みは不可 */
  canDelete: boolean;
  /** 復旧できるか。redemptionPeriod のときだけ */
  canRestore: boolean;
  disabled: boolean;
  runningDelete: boolean;
  runningRestore: boolean;
  feedback: DetailFeedback | null;
  onDelete: () => Promise<boolean>;
  onRestore: () => Promise<boolean>;
}

/**
 * 廃止と復旧。一覧にも同じ操作があるが、詳細ページは「そのドメインについて
 * 何でもできる場所」にしたいので、ここでも完結させる。
 *
 * 廃止は取り返しがつきにくいので、他の設定変更とは分けて最後に置く。
 */
export function LifecycleCard({
  domainName,
  canDelete,
  canRestore,
  disabled,
  runningDelete,
  runningRestore,
  feedback,
  onDelete,
  onRestore,
}: LifecycleCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // どちらもできない状態（pendingDelete など）ではカードごと出さない
  if (!canDelete && !canRestore) return null;

  return (
    <Card className={canRestore ? "ring-1 ring-amber-200" : undefined}>
      <CardContent className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-gray-900">
            {canRestore ? "廃止したドメインを戻す" : "このドメインを手放す"}
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {canRestore ? (
              <>
                <GlossaryTerm description={GLOSSARY.gracePeriod.description}>猶予期間</GlossaryTerm>
                のうちなら元に戻せます。期間を過ぎると他の人が取得できるようになります。
              </>
            ) : (
              <>
                使わなくなったドメインを廃止します。しばらくは復旧できますが、
                <GlossaryTerm description={GLOSSARY.gracePeriod.description}>猶予期間</GlossaryTerm>
                を過ぎると元に戻せません。
              </>
            )}
          </p>
        </div>

        {feedback && (
          <FeedbackBanner
              context="lifecycle"
            tone={feedback.tone}
            message={feedback.message}
            unauthorized={feedback.unauthorized}
          />
        )}

        {confirmingDelete ? (
          <ConfirmAction
            question={`${domainName} を廃止しますか？`}
            detail={
              <>
                廃止するとサイトやメールがすぐ使えなくなります。しばらくの間は復旧できますが、
                <GlossaryTerm description={GLOSSARY.gracePeriod.description}>猶予期間</GlossaryTerm>
                を過ぎると他の人が取得できるようになります。
              </>
            }
            confirmLabel="廃止する"
            running={runningDelete}
            onConfirm={async () => {
              await onDelete();
              setConfirmingDelete(false);
            }}
            onCancel={() => setConfirmingDelete(false)}
          />
        ) : (
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            {canRestore && (
              <Button
                variant="brand"
                disabled={disabled}
                onClick={() => void onRestore()}
              >
                <RotateCcw aria-hidden="true" />
                {runningRestore ? "復旧中..." : "復旧する"}
              </Button>
            )}
            {canDelete && (
              <Button
                variant="destructive"
                disabled={disabled}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                廃止する
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
