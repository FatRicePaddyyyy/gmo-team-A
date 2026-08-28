import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmActionProps {
  /** 「本当に○○しますか？」の見出し */
  question: string;
  /** 取り返しがつくのか・何が起きるのかの補足 */
  /** 用語解説（GlossaryTerm）を混ぜられるよう ReactNode にしている */
  detail: React.ReactNode;
  confirmLabel: string;
  running: boolean;
  /** 非同期でよい。完了を待ってから閉じられるよう Promise を返せる */
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * 取り返しのつきにくい操作（廃止・移管の却下）の直前に挟む確認ステップ。
 * ダイアログではなくその場に開く帯にして、どのドメインの話なのかを見失わないようにする。
 */
export function ConfirmAction({
  question,
  detail,
  confirmLabel,
  running,
  onConfirm,
  onCancel,
}: ConfirmActionProps) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-amber-700"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">{question}</p>
          <p className="mt-1 text-xs text-amber-800">{detail}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={running}
              onClick={() => void onConfirm()}
            >
              {running ? "処理中..." : confirmLabel}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={running}
              onClick={onCancel}
            >
              やめる
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
