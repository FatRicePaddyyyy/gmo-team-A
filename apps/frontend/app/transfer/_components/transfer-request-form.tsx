"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  FQDN_INPUT_MESSAGE,
  FQDN_MAX_LENGTH,
  FQDN_REGEX,
} from "@/shared/lib/domain-name";

// バックエンド (POST /api/v1/secure/transfers) の Zod スキーマに合わせる。
// name は小文字化した FQDN、authInfo は 1〜64 文字。
// regex とメッセージは backend の registry-policy を単一の出どころにしている
// （ここに写しを置くと画面ごとに強度がずれる。Issue #76）。
const transferRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "ドメイン名を入力してください")
    .max(FQDN_MAX_LENGTH, "ドメイン名が長すぎます")
    .regex(FQDN_REGEX, FQDN_INPUT_MESSAGE),
  authInfo: z
    .string()
    .trim()
    .min(1, "認証コード（AuthCode）を入力してください")
    .max(64, "認証コードは64文字以内で入力してください"),
});

type TransferRequestFormData = z.infer<typeof transferRequestSchema>;

interface TransferRequestFormProps {
  submitting: boolean;
  /**
   * すでにここで管理しているドメイン名。
   *
   * 「どれを移管できるのか」は持っているものを見ないと判断できないので並べて出す。
   * あわせて、持っているドメインを打ってしまったときは送信前に止める
   * （レジストリに投げても必ず失敗する上、理由が分かりにくいため）。
   */
  ownedNames: readonly string[];
  /** 成功したら true を返す。true のときだけ入力を消す */
  onSubmitRequest: (input: {
    name: string;
    authInfo: string;
  }) => Promise<boolean>;
}

export function TransferRequestForm({
  submitting,
  onSubmitRequest,
  ownedNames,
}: TransferRequestFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<TransferRequestFormData>({
    resolver: zodResolver(transferRequestSchema),
  });

  const nameErrorId = "transfer-name-error";
  const ownedHintId = "transfer-owned-hint";
  const authInfoHintId = "transfer-auth-info-hint";
  const authInfoErrorId = "transfer-auth-info-error";

  const onSubmit = async (data: TransferRequestFormData) => {
    if (ownedNames.includes(data.name)) {
      setError("name", {
        message:
          "このドメインはすでにここにあるので、引き取る必要はありません。他社へ渡したい場合は、下の「自分のドメインを他社へ渡す」から進んでください。",
      });
      return;
    }
    const ok = await onSubmitRequest(data);
    if (ok) reset({ name: "", authInfo: "" });
  };

  return (
    <Card>
      <CardContent>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <label
              htmlFor="transfer-name"
              className="block text-sm font-medium text-gray-800"
            >
              移管したいドメイン名
            </label>
            <Input
              id="transfer-name"
              placeholder="example.com"
              autoComplete="off"
              disabled={submitting}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={
                errors.name
                  ? nameErrorId
                  : ownedNames.length > 0
                    ? ownedHintId
                    : undefined
              }
              className="h-11"
              {...register("name")}
            />
            {ownedNames.length > 0 && (
              <p id={ownedHintId} className="text-xs text-gray-500">
                いま持っているドメイン:{" "}
                <span className="break-all">{ownedNames.join(" / ")}</span>
                <br />
                これらはすでにここにあるので、引き取る必要はありません。
              </p>
            )}
            {errors.name && (
              <p id={nameErrorId} role="alert" className="text-xs text-red-700">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="transfer-auth-info"
              className="block text-sm font-medium text-gray-800"
            >
              認証コード（AuthCode）
            </label>
            <Input
              id="transfer-auth-info"
              placeholder="移管元から受け取ったコード"
              autoComplete="off"
              disabled={submitting}
              aria-invalid={errors.authInfo ? true : undefined}
              aria-describedby={
                errors.authInfo ? authInfoErrorId : authInfoHintId
              }
              className="h-11"
              {...register("authInfo")}
            />
            <p id={authInfoHintId} className="text-xs text-gray-500">
              いま契約している事業者の管理画面で発行できます。ドメインごとに違うコードです。
            </p>
            {errors.authInfo && (
              <p
                id={authInfoErrorId}
                role="alert"
                className="text-xs text-red-700"
              >
                {errors.authInfo.message}
              </p>
            )}
          </div>

          <Button type="submit" size="lg" variant="brand" disabled={submitting}>
            {submitting ? "申請中..." : "移管を申請する"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
