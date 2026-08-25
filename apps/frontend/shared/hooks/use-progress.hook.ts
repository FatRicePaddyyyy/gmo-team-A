"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { progressStore, type ProgressState } from "@/shared/lib/progress-store";
import type { Purpose } from "@/shared/lib/purpose";

/**
 * ページをまたいで覚えておく入力（用途・直前に検索した名前）。
 *
 * 「いま何ステップ目か」はここでは持たない。開いているページから
 * `buildFlowSteps` で組み立てる（保存値から推測すると古い値でズレるため）。
 * 保存先の差し替えは `shared/lib/progress-store.ts` 側で行う。
 */
export function useProgress(): {
  state: ProgressState;
  setPurpose: (purpose: Purpose | null) => void;
  update: (patch: Partial<ProgressState>) => void;
  reset: () => void;
} {
  const state = useSyncExternalStore(
    progressStore.subscribe,
    progressStore.getSnapshot,
    progressStore.getServerSnapshot,
  );

  // localStorage はクライアントにしか無いので、ハイドレーション後に復元する
  useEffect(() => {
    progressStore.hydrate();
  }, []);

  const setPurpose = useCallback((purpose: Purpose | null) => {
    progressStore.update({ purpose });
  }, []);

  const update = useCallback((patch: Partial<ProgressState>) => {
    progressStore.update(patch);
  }, []);

  const reset = useCallback(() => progressStore.reset(), []);

  return { state, setPurpose, update, reset };
}
