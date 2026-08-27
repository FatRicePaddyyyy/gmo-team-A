"use client";

/**
 * 取得フローの「いまどこ」と、ページをまたいで覚えておく入力。
 *
 * ここでは**あとで必ず読む値だけ**を保存する。以前は「用途・名前・末尾・設定確認・申込」の
 * 5項目を保存して完了率（％）を出していたが、カートから外しても・申込を終えても値が消えず、
 * 何もしていない再訪者に「5ステップ中3つ完了（60%）」と出てしまった。
 * 進み具合は保存値ではなく **いま開いているページ**（`buildFlowSteps`）と
 * **いまカートに入っているもの**（`use-cart.hook`）という、その場で確かめられる事実から出す。
 */

import type { Purpose } from "@/shared/lib/purpose";

export interface ProgressState {
  /** だれのドメインか（未選択は null）。取得可否・注意書きの出し分けに使う */
  purpose: Purpose | null;
  /** 直前に検索した名前。検索に戻る導線と /learn の戻り先に使う */
  searchedName: string | null;
}

export const INITIAL_PROGRESS: ProgressState = {
  purpose: null,
  searchedName: null,
};

/* ------------------------------------------------------------------ *
 * 申込みフローのステップ定義。分母（4）はここでしか決めない。
 * 画面ごとに配列を書かず、必ず `buildFlowSteps` を通す。
 * ------------------------------------------------------------------ */

export const FLOW_STEPS = [
  { key: "select", label: "ドメインを選ぶ" },
  { key: "review", label: "内容を確認" },
  { key: "login", label: "ログイン" },
  { key: "payment", label: "お支払い" },
] as const;

export type FlowStepKey = (typeof FLOW_STEPS)[number]["key"];

export interface FlowStep {
  key: FlowStepKey;
  label: string;
  status: "done" | "current" | "upcoming";
}

/**
 * いま開いているページに対応するステップを `current` にして、番号ステッパー用の配列を作る。
 * 「どこまで進んだか」を保存値から推測しないので、古い値が残っていても表示はズレない。
 */
export function buildFlowSteps(current: FlowStepKey): FlowStep[] {
  const currentIndex = FLOW_STEPS.findIndex((step) => step.key === current);
  return FLOW_STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    status: index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming",
  }));
}

/* ------------------------------------------------------------------ *
 * 保存（localStorage）
 * ------------------------------------------------------------------ */

const STORAGE_KEY = "manabi-domain:progress";

let state: ProgressState = INITIAL_PROGRESS;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // プライベートブラウジング等で書けないことがある。メモリ上には残るので続行する
    console.error("進捗の保存に失敗しました:", error);
  }
}

function isPurpose(value: unknown): value is Purpose {
  return value === "personal" || value === "sole" || value === "corporate";
}

/** 旧形式（chosenTld / settingsReviewed / submitted 付き）は読み飛ばす */
function restore(raw: string): ProgressState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    return {
      purpose: isPurpose(candidate.purpose) ? candidate.purpose : null,
      searchedName:
        typeof candidate.searchedName === "string" && candidate.searchedName
          ? candidate.searchedName
          : null,
    };
  } catch (error) {
    console.error("進捗の読み込みに失敗しました:", error);
    return null;
  }
}

export const progressStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  getSnapshot(): ProgressState {
    return state;
  },

  /** SSR 側は常に初期値。実データはハイドレーション後に読み込む */
  getServerSnapshot(): ProgressState {
    return INITIAL_PROGRESS;
  },

  hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const restored = restore(raw);
    if (!restored) return;
    state = restored;
    emit();
  },

  /** 実際に確定した情報だけを渡すこと */
  update(patch: Partial<ProgressState>): void {
    const next = { ...state, ...patch };
    const unchanged = (Object.keys(next) as (keyof ProgressState)[]).every(
      (key) => next[key] === state[key],
    );
    if (unchanged) return;
    state = next;
    persist();
    emit();
  },

  reset(): void {
    state = INITIAL_PROGRESS;
    persist();
    emit();
  },
};
