import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/auth-client";
import { loadConfirmedOrder } from "@/shared/lib/order-store";

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .email("メールアドレスの形式が正しくありません（例: user@example.com）"),
  password: z.string().min(6, "パスワードは6文字以上で入力してください"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const LOGIN_FAILED_MESSAGE =
  "メールアドレスまたはパスワードが正しくありません。入力内容をご確認ください。";
const UNEXPECTED_MESSAGE =
  "ログインできませんでした。時間をおいてもう一度お試しください。";

export const usePasswordLogin = () => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      await signIn.email(
        {
          email: data.email,
          password: data.password,
        },
        {
          onSuccess: () => {
            setIsLoading(false);
            // 申し込み確定済みの内容があればお支払い内容の確認へ。
            // 無ければ（マイドメインの確認だけでログインした場合）ダッシュボードへ。
            const order = loadConfirmedOrder();
            router.push(order ? "/cart/payment" : "/dashboard");
          },
          onError: () => {
            setIsLoading(false);
            setError(LOGIN_FAILED_MESSAGE);
          },
        }
      );
    } catch {
      setIsLoading(false);
      setError(UNEXPECTED_MESSAGE);
    }
  };

  return {
    register,
    handleSubmit,
    errors,
    onSubmit,
    isLoading,
    error,
  };
};
