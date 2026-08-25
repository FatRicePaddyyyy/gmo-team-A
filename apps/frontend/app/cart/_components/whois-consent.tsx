"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { WHOIS_LESSON } from "@/shared/lib/tld-catalog";
import type { Purpose } from "@/shared/lib/purpose";

interface WhoisConsentProps {
  proxyEnabled: boolean;
  onProxyChange: (value: boolean) => void;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  /** 未確認のまま進もうとしたときに理由を出す */
  showError?: boolean;
  errorId: string;
  /** 用途。法人は代行なしが一般的なので推奨を反転する */
  purpose?: Purpose | null;
}

/**
 * Whois 情報公開の説明と確認。
 *
 * 取り消しにくい行為なので、申し込みの直前に必ず読ませる。
 * ただし**安全側を選んだ人と危険側を選んだ人に同じ文言を出さない**。
 * 代行オン（安全側）は確認文だけ、代行オフ（危険側）だけ明示的なチェックを求める。
 */
export function WhoisConsent({
  proxyEnabled,
  onProxyChange,
  acknowledged,
  onAcknowledgedChange,
  showError = false,
  errorId,
  purpose = null,
}: WhoisConsentProps) {
  const corporate = purpose === "corporate";

  return (
    <section
      aria-labelledby="whois-heading"
      className={`rounded-lg border px-4 py-4 ${
        proxyEnabled ? "border-border bg-white" : "border-amber-300 bg-amber-50"
      }`}
    >
      <h2
        id="whois-heading"
        className={`mb-2 flex items-center gap-2 text-base font-bold ${
          proxyEnabled ? "text-gray-900" : "text-amber-950"
        }`}
      >
        {proxyEnabled ? (
          <ShieldCheck className="size-4 shrink-0 text-green-600" aria-hidden="true" />
        ) : (
          <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
        )}
        {WHOIS_LESSON.title}
      </h2>

      <p
        className={`text-sm leading-relaxed ${proxyEnabled ? "text-gray-700" : "text-amber-950"}`}
      >
        {WHOIS_LESSON.body}
      </p>

      {corporate && (
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          法人の場合は、会社の所在地や電話番号はもともと公開情報であることが多いため、代行を使わないのが一般的です。
        </p>
      )}

      <div className="mt-4 space-y-3 rounded-lg bg-white px-4 py-3">
        <label className="flex items-start gap-3 text-sm text-gray-900">
          <input
            type="checkbox"
            checked={proxyEnabled}
            onChange={(e) => onProxyChange(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
          />
          <span>
            <span className="font-semibold">
              {corporate
                ? "Whois 情報公開代行を利用する（法人の方は使わないのが一般的です）"
                : WHOIS_LESSON.option}
            </span>
            <span className="mt-1 block text-gray-600">
              オフにすると、あなたが入力した氏名・住所・電話番号がそのまま公開されます。
            </span>
          </span>
        </label>

        {/* 選んだ内容と食い違う確認文を出さない。安全側は確認だけ、危険側だけ摩擦を上げる */}
        {proxyEnabled ? (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm leading-relaxed text-green-900">
            この設定なら、Whois には当社（ドメインを登録する事業者）の情報が表示されます。
            あなたの氏名・住所・電話番号は公開されません。
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold leading-relaxed text-amber-950">
              {WHOIS_LESSON.caution}
            </p>
            <label className="flex items-start gap-3 text-sm text-gray-900">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => onAcknowledgedChange(e.target.checked)}
                aria-describedby={showError ? errorId : undefined}
                aria-invalid={showError || undefined}
                className="mt-0.5 size-5 shrink-0 accent-[var(--brand)]"
              />
              <span className="font-semibold">
                代行を使わないため、私の氏名・住所・電話番号が公開されることを理解しました
              </span>
            </label>

            {showError && (
              <p id={errorId} role="alert" className="text-sm font-medium text-red-700">
                代行を使わない場合は、情報が公開されることの確認にチェックしてください。代行を使う設定に戻すこともできます。
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
