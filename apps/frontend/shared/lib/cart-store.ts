"use client";

/**
 * カートの状態。
 *
 * バックエンドにカートAPIが無いため、まずはブラウザ内（localStorage）だけで完結させる。
 * ページをまたいで同じ状態を見せる必要があるので、モジュールレベルのストアにして
 * `useSyncExternalStore` から購読する。
 *
 * TODO: バックエンドにカートAPIが入ったら、このファイルの中身だけを差し替える
 * （呼び出し側は `use-cart.hook.ts` だけを見ているため変更不要）。
 */

export interface CartItem {
  /** ドメイン名の部分（例: manabi-blog） */
  name: string;
  /** TLD（例: .com） */
  tld: string;
}

const STORAGE_KEY = "manabi-domain:cart";

/** SSR と初回レンダリングで同じ参照を返すための空配列 */
const EMPTY: CartItem[] = [];

let items: CartItem[] = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    // プライベートブラウジング等で書けないことがある。状態はメモリ上に残すので続行する
    console.error("カートの保存に失敗しました:", error);
  }
}

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string" && typeof candidate.tld === "string";
}

export function keyOf(item: CartItem): string {
  return `${item.name}${item.tld}`;
}

export const cartStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): CartItem[] {
    return items;
  },

  /** SSR 側は常に空。実データはハイドレーション後に読み込む */
  getServerSnapshot(): CartItem[] {
    return EMPTY;
  },

  /** クライアントで一度だけ localStorage から復元する */
  hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        emit();
        return;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const restored = parsed.filter(isCartItem);
      if (restored.length === 0) return;
      items = restored;
      emit();
    } catch (error) {
      console.error("カートの読み込みに失敗しました:", error);
    }
  },

  add(item: CartItem): void {
    if (items.some((existing) => keyOf(existing) === keyOf(item))) return;
    items = [...items, item];
    persist();
    emit();
  },

  remove(item: CartItem): void {
    items = items.filter((existing) => keyOf(existing) !== keyOf(item));
    persist();
    emit();
  },

  clear(): void {
    items = EMPTY;
    persist();
    emit();
  },
};
