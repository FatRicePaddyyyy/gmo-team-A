"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// バックエンド (POST /api/v1/secure/transfers) の Zod スキーマに合わせる。
// name は小文字化した FQDN、authInfo は 1〜64 文字。
const FQDN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const transferRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "ドメイン名を入力してください")
    .max(253, "ドメイン名が長すぎます")
    .regex(FQDN_REGEX, "末尾（.com など）まで含めて入力してください"),
  authInfo: z
    .string()
    .trim()
    .min(1, "認証コード（AuthCode）を入力してください")
    .max(64, "認証コードは64文字以内で入力してください"),
});

type TransferRequestFormData = z.infer<typeof transferRequestSchema>;

interface TransferRequestFormProps {
  submitting: boolean;
  /** 成功したら true を返す。true のときだけ入力を消す */
  onSubmitRequest: (input: {
    name: string;
    authInfo: string;
  }) => Promise<boolean>;
}

export function TransferRequestForm({
  submitting,
  onSubmitRequest,
}: TransferRequestFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TransferRequestFormData>({
    resolver: zodResolver(transferRequestSchema),
  });

  const onSubmit = async (data: TransferRequestFormData) => {
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
              aria-invalid={Boolean(errors.name)}
              className="h-11"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-xs text-red-700">{errors.name.message}</p>
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
              aria-invalid={Boolean(errors.authInfo)}
              className="h-11"
              {...register("authInfo")}
            />
            <p className="text-xs text-gray-500">
              いま契約している事業者の管理画面で発行できます。ドメインごとに違うコードです。
            </p>
            {errors.authInfo && (
              <p className="text-xs text-red-700">{errors.authInfo.message}</p>
            )}
          </div>

          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "申請中..." : "移管を申請する"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
