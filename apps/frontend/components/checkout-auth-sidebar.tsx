"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tab = "new" | "existing";

interface CheckoutAuthSidebarProps {
  onRegister?: (email: string, password: string) => void;
  onLogin?: (id: string, password: string) => void;
}

export function CheckoutAuthSidebar({ onRegister, onLogin }: CheckoutAuthSidebarProps) {
  const [tab, setTab] = useState<Tab>("new");
  const [email, setEmail] = useState("");
  const [memberId, setMemberId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <aside className="rounded-xl border border-border bg-white p-5 shadow-sm">
      {/* tabs */}
      <div className="mb-4 flex rounded-lg border border-border overflow-hidden">
        <button
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            tab === "new"
              ? "text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
          style={tab === "new" ? { background: "var(--brand)" } : {}}
          onClick={() => setTab("new")}
        >
          初めてご利用の方
        </button>
        <button
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            tab === "existing"
              ? "text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
          style={tab === "existing" ? { background: "var(--brand)" } : {}}
          onClick={() => setTab("existing")}
        >
          お名前IDをお持ちの方
        </button>
      </div>

      {tab === "new" ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="flex items-center gap-1 text-xs font-medium text-gray-600">
              <span className="text-base">✉</span> メールアドレス登録
            </label>
            <Input
              type="email"
              placeholder="mail@onamae.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-1 text-xs font-medium text-gray-600">
              <span className="text-base">🔒</span> 新規パスワード設定
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="8文字以上18文字以内"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-9 text-sm"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button
            className="w-full text-base font-bold text-white"
            style={{ background: "#22c55e" }}
            onClick={() => onRegister?.(email, password)}
          >
            次へ
          </Button>
          <p className="text-center text-xs leading-relaxed text-gray-400">
            利用規約・プライバシーポリシーに同意の上、「次へ」ボタンを押してください。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">
              お名前ID（会員ID）
            </label>
            <Input
              type="text"
              placeholder="1234567"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">パスワード</label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-9 text-sm"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button
            className="w-full text-base font-bold text-white"
            style={{ background: "#22c55e" }}
            onClick={() => onLogin?.(memberId, password)}
          >
            次へ
          </Button>
        </div>
      )}
    </aside>
  );
}
