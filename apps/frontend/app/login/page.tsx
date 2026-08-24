"use client";
import { usePasswordLogin } from "./_hooks/use-password-login.hook";

export default function LoginPage() {
  const { register, handleSubmit, errors, onSubmit, isLoading, error } =
    usePasswordLogin();

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-slate-200 bg-white p-8">
          <h1 className="text-2xl font-semibold text-slate-950 mb-6">Login</h1>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Email
              </label>
              <input
                {...register("email")}
                type="email"
                id="email"
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              {errors.email && (
                <p className="text-red-600 text-sm mt-1">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Password
              </label>
              <input
                {...register("password")}
                type="password"
                id="password"
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              {errors.password && (
                <p className="text-red-600 text-sm mt-1">{errors.password.message}</p>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-slate-400 font-medium transition-colors"
            >
              {isLoading ? "Logging in..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
