"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { usePasswordSignup } from "./_hooks/use-password-signup.hook";

export default function SignupPage() {
  const { register, handleSubmit, errors, onSubmit, isLoading, error } = usePasswordSignup();
  const [showPassword, setShowPassword] = useState(false);
  const nameErrorId = useId();
  const emailErrorId = useId();
  const passwordErrorId = useId();

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-border bg-white p-8 shadow-sm">
            <h1 className="mb-1 text-2xl font-bold text-gray-900">アカウントを作る</h1>
            <p className="mb-6 text-sm leading-relaxed text-gray-600">
              メールアドレスとパスワードだけで作れます。この時点では料金はかかりません。
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <div>
                <label htmlFor="name" className="mb-1 block text-sm font-semibold text-gray-900">
                  お名前
                </label>
                <Input
                  {...register("name")}
                  id="name"
                  autoComplete="name"
                  placeholder="学び 太郎"
                  disabled={isLoading}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? nameErrorId : undefined}
                  className="h-11"
                />
                {errors.name && (
                  <p id={nameErrorId} role="alert" className="mt-1 text-sm text-red-700">
                    {errors.name.message}
                  </p>
                )}
              </div>

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
                    autoComplete="new-password"
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
                <p className="mt-1 text-xs text-gray-600">8文字以上で設定してください。</p>
                {errors.password && (
                  <p id={passwordErrorId} role="alert" className="mt-1 text-sm text-red-700">
                    {errors.password.message}
                  </p>
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={isLoading}
                className="h-11 w-full"
                variant="brand"
              >
                {isLoading ? "作成中..." : "アカウントを作成する"}
              </Button>
            </form>

            <p className="mt-6 border-t border-border pt-6 text-sm text-gray-700">
              すでにアカウントをお持ちの方は{" "}
              <Link href="/login" className="font-semibold underline text-[var(--brand)]">
                ログイン
              </Link>
            </p>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
