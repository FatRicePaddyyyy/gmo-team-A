"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FeedbackBanner } from "@/components/feedback-banner";
import { GlossaryTerm } from "@/components/glossary-term";
import { GLOSSARY } from "@/shared/lib/glossary";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";

/** バックエンド (PUT /secure/domains/:id) の chg.authInfo は 1〜64 文字 */
const AUTH_INFO_MAX = 64;
const AUTH_INFO_MIN = 8;

interface TransferOutCardProps {
  disabled: boolean;
  runningAuthInfo: boolean;
  /** それぞれの操作の結果。押したブロックの中に出す */
  authInfoFeedback: DetailFeedback | null;
  onUpdateAuthInfo: (authInfo: string) => Promise<boolean>;
}

/**
 * 他のレジストラへドメインを渡すための設定。
 *
 * 以前は移管ロック（clientTransferProhibited）のトグルも置いていたが、
 * kitaqsign / kitaqnic のどちらも設定を成功と返すだけで保持しないため
 * （設定していないステータスの解除まで成功する）、押しても永久にオフのままだった。
 * 動かないものを見せないほうがよいので外している。Swagger には記載があるので、
 * レジストリ側が対応したら戻す。
 */
export function TransferOutCard({
  disabled,
  runningAuthInfo,
  authInfoFeedback,
  onUpdateAuthInfo,
}: TransferOutCardProps) {
  const [authInfo, setAuthInfo] = useState("");
  const [showAuthInfo, setShowAuthInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 直前に設定して成功した authInfo。ページを離れるまで表示し続ける。
  // EPP 仕様で読み取りができないので、この画面を閉じたら本人でも二度と確認できない。
  // 移管先の事業者に伝える機会をここで一度だけ確保する。
  const [issuedAuthInfo, setIssuedAuthInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    if (okResult) {
      setIssuedAuthInfo(value);
      setAuthInfo("");
      setCopied(false);
    }
  };

  const handleCopy = async () => {
    if (!issuedAuthInfo) return;
    try {
      await navigator.clipboard.writeText(issuedAuthInfo);
      setCopied(true);
      // コピーで「次に何をすればいいか」を右下トーストで伝える。
      // 認証コードを渡した後の相手側の申請 → 承認、という流れを事前に見せておく。
      toast.success("認証コードをコピーしました", {
        description:
          "移管先のレジストラに伝えて申請してもらうと、この画面に承認ボタンが出ます。",
        // 次の一手の案内はグローバルな 4 秒だと読み切る前に消える。
        // このトーストだけ長めに置く。
        duration: 15_000,
      });
      // 一定時間で「コピー済み」表示を戻す。UX 上「押した→反応」が伝われば良く、
      // 何秒もチェックのままにしておく必要はない
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("authInfo copy failed:", err);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-5">
        <div>
          <h2 className="font-heading text-lg font-bold text-gray-900">
            このドメインを他のレジストラへ渡す
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            このドメインを他の事業者に引っ越すための設定です。渡すには、ここで発行した
            <GlossaryTerm description={GLOSSARY.authCode.description}>
              {GLOSSARY.authCode.term}
            </GlossaryTerm>
            を移管先の事業者に伝えます。
          </p>
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
              context="authInfo"
              tone={authInfoFeedback.tone}
              message={authInfoFeedback.message}
              unauthorized={authInfoFeedback.unauthorized}
            />
          )}

          {issuedAuthInfo && (
            <div
              className="space-y-2 rounded-md border border-[var(--brand)]/40 bg-[var(--brand-light)] p-3"
              role="status"
              aria-live="polite"
            >
              <p className="text-xs font-semibold text-gray-900">
                いま設定した認証コード（移管先の事業者にこの値を伝えてください）
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm break-all text-gray-900">
                  {issuedAuthInfo}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopy()}
                  aria-label="認証コードをコピー"
                >
                  {copied ? (
                    <>
                      <Check className="size-4" aria-hidden="true" />
                      コピー済み
                    </>
                  ) : (
                    <>
                      <Copy className="size-4" aria-hidden="true" />
                      コピー
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-gray-700">
                この画面を離れると二度と表示できません（レジストリの仕様上、控えは残せません）。移管先に渡してから閉じてください。
              </p>
            </div>
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
