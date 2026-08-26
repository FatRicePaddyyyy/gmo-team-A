import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/auth-client";

const signupSchema = z.object({
  name: z.string().min(1, "お名前を入力してください"),
  email: z
    .string()
    .min(1, "メールアドレスを入力してください")
    .email("メールアドレスの形式が正しくありません（例: user@example.com）"),
  password: z.string().min(8, "パスワードは8文字以上で入力してください"),
});

type SignupFormData = z.infer<typeof signupSchema>;

const SIGNUP_FAILED_MESSAGE =
  "アカウントを作成できませんでした。このメールアドレスはすでに登録されているかもしれません。";
const UNEXPECTED_MESSAGE =
  "アカウントを作成できませんでした。時間をおいてもう一度お試しください。";

export const usePasswordSignup = () => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
  });

  const onSubmit = async (data: SignupFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      await signUp.email(
        {
          name: data.name,
          email: data.email,
          password: data.password,
        },
        {
          onSuccess: () => {
            router.push("/dashboard");
          },
          onError: () => {
            setError(SIGNUP_FAILED_MESSAGE);
          },
        },
      );
    } catch {
      setError(UNEXPECTED_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  };

  return { register, handleSubmit, errors, onSubmit, isLoading, error };
};
