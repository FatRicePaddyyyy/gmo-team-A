"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  cartStore,
  keyOf,
  type CartItem,
  type CartSettings,
} from "@/shared/lib/cart-store";

/**
 * カートの読み書き。検索結果・カート画面・ヘッダーから共通で使う。
 * 保存先の差し替えは `shared/lib/cart-store.ts` 側で行う。
 */
export function useCart() {
  const items = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getServerSnapshot,
  );

  const settings = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSettings,
    cartStore.getServerSettings,
  );

  // localStorage はクライアントにしか無いので、ハイドレーション後に復元する
  useEffect(() => {
    cartStore.hydrate();
  }, []);

  const add = useCallback((item: CartItem) => cartStore.add(item), []);
  const remove = useCallback((item: CartItem) => cartStore.remove(item), []);
  const clear = useCallback(() => cartStore.clear(), []);
  const has = useCallback(
    (item: CartItem) => items.some((existing) => keyOf(existing) === keyOf(item)),
    [items],
  );

  const setSettings = useCallback(
    (patch: Partial<CartSettings>) => cartStore.setSettings(patch),
    [],
  );

  return { items, count: items.length, add, remove, clear, has, settings, setSettings };
}

export type { CartItem, CartSettings };
