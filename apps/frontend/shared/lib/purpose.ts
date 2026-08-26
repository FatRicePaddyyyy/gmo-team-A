/**
 * 「だれのドメイン？」＝用途。
 *
 * このサービスは用途によって答えがほぼ全部変わる（取れる TLD、Whois 代行の推奨、
 * .jp の適性）。一般論の陳列を「あなたはこれを選ぶべき」に変換するための軸なので、
 * 1回だけ聞いて以降の表示・警告に効かせる。
 */

export type Purpose = "personal" | "sole" | "corporate";

export interface PurposeOption {
  value: Purpose;
  /** チップに出す短いラベル */
  label: string;
  /** 選んだあとに出す1行の言い換え */
  description: string;
}

export const PURPOSE_OPTIONS: PurposeOption[] = [
  {
    value: "personal",
    label: "個人のサイト",
    description: "ブログ・ポートフォリオなど、会社ではなくあなた個人のためのドメイン",
  },
  {
    value: "sole",
    label: "お店・個人事業",
    description: "登記していないお店や個人事業（フリーランス含む）のためのドメイン",
  },
  {
    value: "corporate",
    label: "会社（登記済み）",
    description: "法務局で登記された法人のためのドメイン",
  },
];

export function purposeLabel(purpose: Purpose | null): string {
  return PURPOSE_OPTIONS.find((option) => option.value === purpose)?.label ?? "未選択";
}
