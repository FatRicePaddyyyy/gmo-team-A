"use client";

/**
 * 申し込み確認まで進んだ内容のスナップショット。
 *
 * カートは完了画面で空にするため、「あなたが選んだ設定」を完了画面で出すには
 * 確定した時点の中身をここに写しておく必要がある。
 * これが無いときは「まだ申し込みはありません」と扱い、完了を名乗らせない。
 */

import type { CartItem, CartSettings } from "@/shared/lib/cart-store";
import { DEFAULT_CART_SETTINGS } from "@/shared/lib/cart-store";
import type { Purpose } from "@/shared/lib/purpose";

export interface ConfirmedOrder {
  items: CartItem[];
  settings: CartSettings;
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

export function loadConfirmedOrder(): ConfirmedOrder | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.items) || candidate.items.length === 0) return null;

    const items = candidate.items.filter((item): item is CartItem => {
      if (typeof item !== "object" || item === null) return false;
      const row = item as Record<string, unknown>;
      return typeof row.name === "string" && typeof row.tld === "string";
    });
    if (items.length === 0) return null;

    const rawSettings = (candidate.settings ?? {}) as Record<string, unknown>;
    const settings: CartSettings = {
      whoisProxy: rawSettings.whoisProxy !== false,
      autoRenew: rawSettings.autoRenew !== false,
    };

    const purpose = candidate.purpose;
    return {
      items,
      settings,
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

export { DEFAULT_CART_SETTINGS };
