"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { signOut } from "@/auth-client";
import { Button } from "@/components/ui/button";

interface AccountMenuProps {
  /** 表示名。名前が未設定ならメールアドレスが入る */
  name: string;
  /** メニュー内の見出しに表示するメールアドレス。name と同じ（＝名前未設定）なら省略する */
  email?: string | null;
}

/**
 * ヘッダー右上のアカウントメニュー。
 *
 * ログアウトはダッシュボードにしか無く、他の画面からは一度戻る必要があった。
 * どの画面からでも辿れるよう、ヘッダーに畳んで置く。
 *
 * shadcn の dropdown-menu は未導入なので、既存の依存である Base UI の Menu を
 * 直接使う（キーボード操作・Escape・フォーカス管理が入っている）。
 */
export function AccountMenu({ name, email }: AccountMenuProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      router.push("/login");
    } catch (caught) {
      console.error("ログアウトエラー:", caught);
      setSigningOut(false);
    }
  };

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button variant="ghost" className="h-11 min-w-0">
            <UserRound aria-hidden="true" />
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="max-w-full truncate">{name}</span>
              {email && email !== name && (
                <span className="max-w-full truncate text-xs font-normal text-gray-500">
                  {email}
                </span>
              )}
            </span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end">
          <Menu.Popup className="min-w-44 rounded-lg border border-border bg-white p-1 shadow-lg outline-none">
            <Menu.Item
              className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-gray-700 outline-none select-none data-[highlighted]:bg-gray-100"
              render={<Link href="/dashboard" />}
            >
              <UserRound className="size-4" aria-hidden="true" />
              マイドメイン
            </Menu.Item>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item
              className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm text-gray-700 outline-none select-none data-[highlighted]:bg-gray-100"
              onClick={() => void handleLogout()}
              disabled={signingOut}
            >
              <LogOut className="size-4" aria-hidden="true" />
              {signingOut ? "ログアウト中..." : "ログアウト"}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
