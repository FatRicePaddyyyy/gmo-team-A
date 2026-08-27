"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";
import { FeedbackBanner } from "@/components/feedback-banner";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";

/** バックエンド (PUT /secure/domains/:id) の chg.authInfo は 1〜64 文字 */
const AUTH_INFO_MAX = 64;

/** 移管ページからこのカードへ直接飛ぶためのアンカー ID */
export const TRANSFER_OUT_ANCHOR = "transfer-out";
const AUTH_INFO_MIN = 8;

interface TransferOutCardProps {
  locked: boolean;
  disabled: boolean;
  runningAuthInfo: boolean;
  runningLock: boolean;
  /** それぞれの操作の結果。押したブロックの中に出す */
  authInfoFeedback: DetailFeedback | null;
  lockFeedback: DetailFeedback | null;
  onUpdateAuthInfo: (authInfo: string) => Promise<boolean>;
  onSetLock: (locked: boolean) => Promise<boolean>;
}

/**
 * 他社へドメインを渡すための設定。
 *
 * 移管ロックと AuthCode は表裏の関係にある（ロック中は移管できないので
 * AuthCode を発行しても意味がない）ので、1 枚のカードにまとめて順序も揃えている。
 */
export function TransferOutCard({
  locked,
  disabled,
  runningAuthInfo,
  runningLock,
  authInfoFeedback,
  lockFeedback,
  onUpdateAuthInfo,
  onSetLock,
}: TransferOutCardProps) {
  const [authInfo, setAuthInfo] = useState("");
  const [showAuthInfo, setShowAuthInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingUnlock, setConfirmingUnlock] = useState(false);

  // 入力欄とヒント・エラーを aria で紐づける（ログイン画面と同じ書き方）
  const authInfoHintId = "auth-info-hint";
  const authInfoErrorId = "auth-info-error";

  const handleAuthInfo = async () => {
    const value = authInfo.trim();
    if (value.length < AUTH_INFO_MIN) {
      setError(`認証コードは ${AUTH_INFO_MIN} 文字以上にしてください。`);
      return;
    }
    if (value.length > AUTH_INFO_MAX) {
      setError(`認証コードは ${AUTH_INFO_MAX} 文字以内にしてください。`);
      return;
    }
    setError(null);
    const okResult = await onUpdateAuthInfo(value);
    if (okResult) setAuthInfo("");
  };

  return (
    // 移管ページの「渡す手続きへ」から直接ここへ飛ばすためのアンカー。
    // scroll-mt はヘッダーに隠れないための余白。
    <Card id={TRANSFER_OUT_ANCHOR} className="scroll-mt-20">
      <CardContent className="space-y-5">
        <div>
          <h2 className="font-heading text-lg font-bold text-gray-900">
            このドメインを他社へ渡す
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            このドメインを他の事業者に引っ越すための設定です。移管には「ロックの解除」と「認証コードの受け渡し」の2つが必要です。
          </p>
        </div>

        {/* --- 移管ロック --- */}
        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {locked ? (
                <Lock className="size-4 text-gray-700" aria-hidden="true" />
              ) : (
                <LockOpen className="size-4 text-amber-700" aria-hidden="true" />
              )}
              <span className="text-sm font-medium text-gray-900">
                移管ロック: {locked ? "オン" : "オフ"}
              </span>
            </div>
            {locked ? (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => setConfirmingUnlock(true)}
              >
                {runningLock ? "解除中..." : "ロックを解除"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="brand"
                disabled={disabled}
                onClick={() => void onSetLock(true)}
              >
                {runningLock ? "設定中..." : "ロックをかける"}
              </Button>
            )}
          </div>

          <p className="text-xs text-gray-600">
            {locked
              ? "他社への移管が止められています。身に覚えのない移管を防ぐため、普段はオンのままにしておくのが安全です。"
              : "他社への移管ができる状態です。移管の予定がなければ、ロックをかけておくことをおすすめします。"}
          </p>

          {lockFeedback && (
            <FeedbackBanner
              tone={lockFeedback.tone}
              message={lockFeedback.message}
              unauthorized={lockFeedback.unauthorized}
            />
          )}

          {confirmingUnlock && (
            <ConfirmAction
              question="移管ロックを解除しますか？"
              detail="解除している間は、認証コードを知っている人がこのドメインを他社へ移せます。移管が終わったら、もう一度ロックをかけてください。"
              confirmLabel="解除する"
              running={runningLock}
              onConfirm={async () => {
                await onSetLock(false);
                setConfirmingUnlock(false);
              }}
              onCancel={() => setConfirmingUnlock(false)}
            />
          )}
        </div>

        {/* --- AuthCode --- */}
        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-gray-700" aria-hidden="true" />
            <span className="text-sm font-medium text-gray-900">
              認証コード（AuthCode）
            </span>
          </div>
          <p className="text-xs text-gray-600">
            移管先の事業者に伝えるパスワードです。現在の値は表示できない仕様なので、移管するときは新しく設定し直してから伝えてください。
          </p>

          <div className="space-y-1.5">
            <label htmlFor="auth-info" className="sr-only">
              新しい認証コード
            </label>
            <div className="relative">
              <Input
                id="auth-info"
                type={showAuthInfo ? "text" : "password"}
                value={authInfo}
                placeholder="新しい認証コードを入力"
                // password 型にするとブラウザがログインパスワードを補完してくる。
                // new-password なら「新しく作る資格情報」と伝わり、既存の値を入れてこない。
                autoComplete="new-password"
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? authInfoErrorId : authInfoHintId}
                onChange={(event) => setAuthInfo(event.target.value)}
                className="h-11 pr-12"
              />
              <button
                type="button"
                onClick={() => setShowAuthInfo((v) => !v)}
                aria-label={
                  showAuthInfo ? "認証コードを隠す" : "認証コードを表示する"
                }
                aria-pressed={showAuthInfo}
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-900"
              >
                {showAuthInfo ? (
                  <EyeOff className="size-5" aria-hidden="true" />
                ) : (
                  <Eye className="size-5" aria-hidden="true" />
                )}
              </button>
            </div>
            <p id={authInfoHintId} className="text-xs text-gray-500">
              {AUTH_INFO_MIN}〜{AUTH_INFO_MAX} 文字。推測されにくい文字列にしてください。
            </p>
            {error && (
              <p id={authInfoErrorId} role="alert" className="text-xs text-red-700">
                {error}
              </p>
            )}
          </div>

          {authInfoFeedback && (
            <FeedbackBanner
              tone={authInfoFeedback.tone}
              message={authInfoFeedback.message}
              unauthorized={authInfoFeedback.unauthorized}
            />
          )}

          <Button
            size="sm"
            variant="brand"
            disabled={disabled || authInfo.trim().length === 0}
            onClick={() => void handleAuthInfo()}
          >
            {runningAuthInfo ? "設定中..." : "認証コードを設定する"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
