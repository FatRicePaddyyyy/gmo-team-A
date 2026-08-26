/** ISO 文字列を「2026年8月26日」形式にする。壊れた値でも画面を落とさない */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "―";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
