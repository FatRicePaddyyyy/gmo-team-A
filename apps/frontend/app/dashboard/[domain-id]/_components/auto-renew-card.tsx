"use client";

import { RotateCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FeedbackBanner } from "@/components/feedback-banner";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";

interface AutoRenewCardProps {
  autoRenew: boolean;
  disabled: boolean;
  running: boolean;
  feedback: DetailFeedback | null;
  onChange: (autoRenew: boolean) => Promise<boolean>;
}

/**
 * 自動更新のON/OFF。
 *
 * issue #104: 設定の保存はできるが、期限前に実際に延長を実行する仕組み（cron）は
 * このデモにまだ無い。学習コンテンツで自動更新を勧めている手前、設定できないままにせず、
 * 「保存できるが自動実行はまだ無い」という実態を隠さずに書く。
 */
export function AutoRenewCard({
  autoRenew,
  disabled,
  running,
  feedback,
  onChange,
}: AutoRenewCardProps) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-gray-900">
              <RotateCw className="size-4 text-gray-400" aria-hidden="true" />
              自動更新
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              オンにすると、期限前に自動で延長する設定として保存されます。
            </p>
          </div>
          <Switch
            aria-label="自動更新"
            checked={autoRenew}
            disabled={disabled || running}
            onCheckedChange={(checked) => void onChange(checked)}
            className="data-checked:bg-green-600 data-unchecked:bg-red-400"
          />
        </div>

        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          いまはこの設定を保存する機能だけが動いています。期限前に実際へ自動延長を実行する仕組みは、このデモではまだ用意できていません。
        </p>

        {feedback && (
          <FeedbackBanner
            context="autoRenew"
            tone={feedback.tone}
            message={feedback.message}
            unauthorized={feedback.unauthorized}
          />
        )}
      </CardContent>
    </Card>
  );
}
