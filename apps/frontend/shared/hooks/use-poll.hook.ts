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

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => void onTickRef.current(), intervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stop();
        return;
      }
      // 背面にいた間の変化を拾うため、復帰した時点で 1 回取り直す
      void onTickRef.current();
      start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
