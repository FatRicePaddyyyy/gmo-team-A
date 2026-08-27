import Link from "next/link";
import { AlertCircle, CheckCircle2, Wrench } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  isMaintenanceError,
  MAINTENANCE_TITLE,
  maintenanceNoticeOf,
} from "@/shared/lib/maintenance";

interface FeedbackBannerProps {
  tone: "success" | "error";
  message: string;
  /**
   * セッション切れのとき true。ログインページへの導線を添える。
   * 文言だけ出しても、どうすれば復帰できるのか分からないため。
   */
  unauthorized?: boolean;
  /**
   * この帯が出ている画面・操作の名前（`shared/lib/maintenance` のキー）。
   * メンテナンス中と判定されたとき、その場で何ができないのかを添えるために使う。
   */
  context?: string;
  className?: string;
}

/**
 * 操作の結果（成功・失敗）を出す帯。
 * 失敗しても「何が起きたか」が必ず画面に残るように、消えるトーストではなく居座る帯にしている。
 */
export function FeedbackBanner({
  tone,
  message,
  unauthorized = false,
  context,
  className = "",
}: FeedbackBannerProps) {
  const isError = tone === "error";
  // メンテナンスは不具合ではなく想定内の状態。赤い「エラー」で出すと
  // 利用者は自分の操作を疑って何度もやり直してしまうので、見た目から分ける。
  const isMaintenance = isError && isMaintenanceError(message);

  if (isMaintenance) {
    return (
      <Alert className={`border-amber-300 bg-amber-50 ${className}`}>
        <Wrench aria-hidden="true" className="text-amber-700" />
        <AlertDescription className="text-amber-900">
          <span className="block font-semibold">{MAINTENANCE_TITLE}</span>
          <span className="mt-1 block">
            {context
              ? maintenanceNoticeOf(context)
              : "この操作はいま行えません。メンテナンス終了後にお試しください。"}
          </span>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert
      variant={isError ? "destructive" : "default"}
      className={`${isError ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"} ${className}`}
    >
      {isError ? (
        <AlertCircle aria-hidden="true" />
      ) : (
        <CheckCircle2 aria-hidden="true" className="text-green-700" />
      )}
      <AlertDescription
        className={isError ? "text-red-800" : "text-green-800"}
      >
        {message}
        {unauthorized && (
          <span className="mt-2 block">
            <Button
              size="sm"
              variant="brand"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              ログインページへ
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
