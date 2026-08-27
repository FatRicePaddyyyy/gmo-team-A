"use client";

/**
 * 申し込み確認まで進んだ内容のスナップショット。
 *
 * 検索結果で「このドメインで進む」を押した時点で1件書き込み、
 * 内容確認・お支払い・完了の各画面はここを読む。
 * これが無いときは「まだ申し込みはありません」と扱い、完了を名乗らせない。
 *
 * items は現状 1 件だが、将来「複数を同時に取得」機能が入る余地は残しておく。
 */

import type { Purpose } from "@/shared/lib/purpose";

export interface OrderItem {
  /** ドメイン名の部分（例: manabi-blog） */
  name: string;
  /** TLD（例: .com） */
  tld: string;
}

export interface ConfirmedOrder {
  items: OrderItem[];
  purpose: Purpose | null;
  /** ISO 文字列 */
  confirmedAt: string;
}

const STORAGE_KEY = "manabi-domain:confirmed-order";

export function saveConfirmedOrder(order: ConfirmedOrder): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch (error) {
    console.error("申し込み内容の保存に失敗しました:", error);
  }
}

export function clearConfirmedOrder(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("申し込み内容の削除に失敗しました:", error);
  }
}

export function loadConfirmedOrder(): ConfirmedOrder | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.items) || candidate.items.length === 0) return null;

    const items = candidate.items.filter((item): item is OrderItem => {
      if (typeof item !== "object" || item === null) return false;
      const row = item as Record<string, unknown>;
      return typeof row.name === "string" && typeof row.tld === "string";
    });
    if (items.length === 0) return null;

    const purpose = candidate.purpose;
    return {
      items,
      purpose:
        purpose === "personal" || purpose === "sole" || purpose === "corporate"
          ? purpose
          : null,
      confirmedAt:
        typeof candidate.confirmedAt === "string"
          ? candidate.confirmedAt
          : new Date().toISOString(),
    };
  } catch (error) {
    console.error("申し込み内容の読み込みに失敗しました:", error);
    return null;
  }
}
