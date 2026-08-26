/**
 * ISO 文字列を「2026年8月26日」形式にする。壊れた値でも画面を落とさない。
 *
 * タイムゾーンは日本時間に固定する。バックエンドは UTC の ISO を返すため、
 * 閲覧者の端末設定に任せると有効期限が 1 日ずれて見えることがある
 * （例: 2026-08-26T23:00:00Z を UTC 環境で見ると 8月26日、JST では 8月27日）。
 */

const FORMATTER = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "―";
  return FORMATTER.format(date);
}
