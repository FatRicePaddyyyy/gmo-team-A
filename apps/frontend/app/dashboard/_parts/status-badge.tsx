import { Badge } from "@/components/ui/badge";
import { statusLabelOf, statusToneOf } from "../_lib/domain-status";

const TONE_CLASS: Record<string, string> = {
  ok: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-800",
  neutral: "bg-gray-100 text-gray-700",
};

interface StatusBadgeProps {
  status: string;
}

/** ドメインの状態を一目で分かる色付きラベルにする */
export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <Badge variant="secondary" className={TONE_CLASS[statusToneOf(status)]}>
      {statusLabelOf(status)}
    </Badge>
  );
}
