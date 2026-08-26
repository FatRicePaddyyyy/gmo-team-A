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

/**
 * 申し込み時の設定。取り消しにくい選択なので、選んだ値をローカル状態で終わらせず
 * ここに保存して確認画面・完了画面から同じ値を読む。
 */
export interface CartSettings {
  /** Whois 情報公開代行を使うか（既定はオン＝安全側） */
  whoisProxy: boolean;
  /** 自動更新をオンにするか（既定はオン＝安全側） */
  autoRenew: boolean;
}

export const DEFAULT_CART_SETTINGS: CartSettings = {
  whoisProxy: true,
  autoRenew: true,
};

const STORAGE_KEY = "manabi-domain:cart";
const SETTINGS_KEY = "manabi-domain:cart-settings";

/** SSR と初回レンダリングで同じ参照を返すための空配列 */
const EMPTY: CartItem[] = [];

let items: CartItem[] = EMPTY;
let settings: CartSettings = DEFAULT_CART_SETTINGS;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persistSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error("設定の保存に失敗しました:", error);
  }
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
  getSettings(): CartSettings {
    return settings;
  },

  getServerSettings(): CartSettings {
    return DEFAULT_CART_SETTINGS;
  },

  setSettings(patch: Partial<CartSettings>): void {
    const next = { ...settings, ...patch };
    if (next.whoisProxy === settings.whoisProxy && next.autoRenew === settings.autoRenew) return;
    settings = next;
    persistSettings();
    emit();
  },

  hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    try {
      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        const parsedSettings: unknown = JSON.parse(rawSettings);
        if (typeof parsedSettings === "object" && parsedSettings !== null) {
          const candidate = parsedSettings as Record<string, unknown>;
          settings = {
            whoisProxy: candidate.whoisProxy !== false,
            autoRenew: candidate.autoRenew !== false,
          };
        }
      }
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
