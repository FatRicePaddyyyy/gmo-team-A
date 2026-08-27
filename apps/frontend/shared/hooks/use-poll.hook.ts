"use client";

import { useEffect, useRef } from "react";

/** 既定のポーリング間隔（ミリ秒） */
export const DEFAULT_POLL_INTERVAL_MS = 20_000;

interface UsePollOptions {
  /** ポーリングする理由があるか。false の間は一切叩かない */
  enabled: boolean;
  /** 実行する処理。通常は一覧の再取得 */
  onTick: () => void | Promise<void>;
  /** 間隔（ミリ秒） */
  intervalMs?: number;
}

/**
 * 一定間隔で処理を呼ぶ。ただし「見られていないとき」は止める。
 *
 * 移管はレジストリ側で非同期に進む（cron が毎分ポーリングして状態を更新する）。
 * フロントが取り直さないと、利用者は「最新にする」を手で押すまで変化に気づけない。
 * 承認・却下・自動承認はドメインの所有権が動く操作なので、気づけないのは危険。
 *
 * 一方で、常に叩き続けるのは無駄が大きい。次の2つで抑える。
 *
 * - `enabled` が false（＝待っている移管が無い）なら動かさない
 * - タブが背面にある間は止め、戻ってきたら即座に 1 回叩いてから再開する
 *   （背面で 30 分放置されたぶんを取り戻すため、復帰時の 1 回が要る）
 *
 * 画面を離れた（アンマウントされた）あとは `onTick` を呼ばない。飛行中の通信が
 * 返ってきても、すでに無いコンポーネントの状態を触らないようにするため。
 *
 * ## 手で確かめるとき
 *
 * Playwright では背面タブでも `document.hidden` が false のままになり、
 * タブを切り替えるだけでは停止を再現できない（実測 2026-08-27）。
 * ブラウザの DevTools コンソールで次を実行すると、実際の背面状態を作れる。
 *
 * ```js
 * let hidden = false;
 * Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
 * Object.defineProperty(document, "visibilityState", {
 *   configurable: true,
 *   get: () => (hidden ? "hidden" : "visible"),
 * });
 * const setHidden = (v) => {
 *   hidden = v;
 *   document.dispatchEvent(new Event("visibilitychange"));
 * };
 * setHidden(true);   // 背面へ → 通信が止まる
 * setHidden(false);  // 復帰   → 即座に 1 回、以降 20 秒ごと
 * ```
 */
export function usePoll({
  enabled,
  onTick,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UsePollOptions): void {
  // onTick は毎レンダリング作り直される想定。依存に入れるとタイマーが張り直されて
  // 一度も発火しなくなるので、ref 経由で最新版を読む。
  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    // 片付けたあとに発火した分を無視する。setInterval を止めても、
    // すでに走り出した onTick の非同期処理までは止められない。
    let disposed = false;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (disposed) return;
        void onTickRef.current();
      }, intervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      // 背面にいた間の変化を拾うため、復帰した時点で 1 回取り直す
      if (disposed) return;
      void onTickRef.current();
      start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
