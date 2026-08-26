import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface FeedbackBannerProps {
  tone: "success" | "error";
  message: string;
  className?: string;
}

/**
 * 操作の結果（成功・失敗）を出す帯。
 * 失敗しても「何が起きたか」が必ず画面に残るように、消えるトーストではなく居座る帯にしている。
 */
export function FeedbackBanner({
  tone,
  message,
  className = "",
}: FeedbackBannerProps) {
  const isError = tone === "error";
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
      </AlertDescription>
    </Alert>
  );
}
