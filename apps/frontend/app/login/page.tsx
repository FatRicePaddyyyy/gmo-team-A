"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackBanner } from "@/components/feedback-banner";
import { Input } from "@/components/ui/input";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { usePasswordLogin } from "./_hooks/use-password-login.hook";

export default function LoginPage() {
  const { register, handleSubmit, errors, onSubmit, isLoading, error } = usePasswordLogin();
  const [showPassword, setShowPassword] = useState(false);
  const emailErrorId = useId();
  const passwordErrorId = useId();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-border bg-white p-8 shadow-sm">
            <h1 className="mb-1 text-2xl font-bold text-gray-900">ログイン</h1>
            <p className="mb-6 text-sm text-gray-600">
              マイドメインで、取得したドメインの状態を確認できます。
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-semibold text-gray-900">
                  メールアドレス
                </label>
                <Input
                  {...register("email")}
                  type="email"
                  id="email"
                  autoComplete="email"
                  placeholder="user@example.com"
                  disabled={isLoading}
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? emailErrorId : undefined}
                  className="h-11"
                />
                {errors.email && (
                  <p id={emailErrorId} role="alert" className="mt-1 text-sm text-red-700">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block text-sm font-semibold text-gray-900"
                >
                  パスワード
                </label>
                <div className="relative">
                  <Input
                    {...register("password")}
                    type={showPassword ? "text" : "password"}
                    id="password"
                    autoComplete="current-password"
                    disabled={isLoading}
                    aria-invalid={errors.password ? true : undefined}
                    aria-describedby={errors.password ? passwordErrorId : undefined}
                    className="h-11 pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示する"}
                    aria-pressed={showPassword}
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-gray-500 hover:text-gray-900"
                  >
                    {showPassword ? (
                      <EyeOff className="size-5" aria-hidden="true" />
                    ) : (
                      <Eye className="size-5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p id={passwordErrorId} role="alert" className="mt-1 text-sm text-red-700">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {error && <FeedbackBanner tone="error" message={error} />}

              <Button
                type="submit"
                disabled={isLoading}
                className="h-11 w-full"
                variant="brand"
              >
                {isLoading ? "ログイン中..." : "ログインする"}
              </Button>
            </form>

            <div className="mt-6 space-y-2 border-t border-border pt-6 text-sm">
              <p className="text-gray-600">
                パスワードをお忘れの場合は、サポートまでご連絡ください（再設定機能は準備中です）。
              </p>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
