"use client";

import { useState } from "react";
import { KeyRound, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmAction } from "@/components/confirm-action";

/** バックエンド (PUT /secure/domains/:id) の chg.authInfo は 1〜64 文字 */
const AUTH_INFO_MAX = 64;
const AUTH_INFO_MIN = 8;

interface TransferOutCardProps {
  locked: boolean;
  disabled: boolean;
  runningAuthInfo: boolean;
  runningLock: boolean;
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
  onUpdateAuthInfo,
  onSetLock,
}: TransferOutCardProps) {
  const [authInfo, setAuthInfo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingUnlock, setConfirmingUnlock] = useState(false);

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
    <Card>
      <CardContent className="space-y-5">
        <div>
          <h2 className="font-heading text-lg font-bold text-gray-900">
            他社へ移管する
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
            <Input
              id="auth-info"
              value={authInfo}
              placeholder="新しい認証コードを入力"
              autoComplete="off"
              disabled={disabled}
              aria-invalid={Boolean(error)}
              onChange={(event) => setAuthInfo(event.target.value)}
              className="h-11"
            />
            <p className="text-xs text-gray-500">
              {AUTH_INFO_MIN}〜{AUTH_INFO_MAX} 文字。推測されにくい文字列にしてください。
            </p>
            {error && <p className="text-xs text-red-700">{error}</p>}
          </div>

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
