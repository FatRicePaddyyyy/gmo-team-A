"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FeedbackBanner } from "@/components/feedback-banner";
import type { DetailFeedback } from "../_hooks/use-domain-detail.hook";
import { CLIENT_LOCK_STATUSES, type ClientLockStatus } from "../_hooks/use-domain-detail.hook";

/**
 * ロック (client*Prohibited / clientHold) の管理カード。
 *
 * Swagger の DomainChangeSet.statuses に列挙されている 5 種類を、
 * ユーザーには「何ができなくなるか」で書き直して 5 個のトグルで見せる。
 * 現状の statuses から ON/OFF を復元し、保存時に diff を hook に投げる。
 *
 * Issue #107 (2): 以前は「レジストリが受理してもフラグが反映されない」ため UI を外していたが、
 * 2026-08-27 のレジストリ側修正で反映されるようになったので復活させた。
 */

interface LockOption {
  key: ClientLockStatus;
  label: string;
  hint: string;
}

// 表示順は「効果が強いものから」。移管禁止は攻撃者にドメインを奪われないための一次防御なので
// 最上段に置く。掲載保留 (clientHold) は「サイトが即座に見えなくなる」ので警告色で扱いたい。
const LOCK_OPTIONS: readonly LockOption[] = [
  {
    key: "clientTransferProhibited",
    label: "他のレジストラへの移管を禁止する",
    hint: "第三者が勝手にドメインを他のレジストラへ移せなくなります。乗っ取り対策として推奨。",
  },
  {
    key: "clientDeleteProhibited",
    label: "廃止を禁止する",
    hint: "誤って自分で廃止手続きを進めても、この画面から廃止できなくなります。",
  },
  {
    key: "clientUpdateProhibited",
    label: "設定変更を禁止する",
    hint: "ネームサーバー・認証コードなどの変更を禁止します。自分で解除するまで変更できません。",
  },
  {
    key: "clientRenewProhibited",
    label: "更新を禁止する",
    hint: "有効期限の延長 (renew) を禁止します。長期的に手放す予定のドメインに使います。",
  },
  {
    key: "clientHold",
    label: "サイト掲載を止める",
    hint: "名前解決を止めます。サイト・メールが即座に使えなくなります。復活は解除するだけです。",
  },
] as const;

interface LocksCardProps {
  currentStatuses: readonly string[];
  disabled: boolean;
  running: boolean;
  feedback: DetailFeedback | null;
  onSave: (target: readonly ClientLockStatus[]) => Promise<boolean>;
}

export function LocksCard({
  currentStatuses,
  disabled,
  running,
  feedback,
  onSave,
}: LocksCardProps) {
  // 現状のロック集合。切り替え可能な 5 種類だけを抽出して初期値にする。
  const initial = useMemo<ReadonlySet<ClientLockStatus>>(
    () =>
      new Set(
        currentStatuses.filter((s): s is ClientLockStatus =>
          (CLIENT_LOCK_STATUSES as readonly string[]).includes(s),
        ),
      ),
    [currentStatuses],
  );
  const [selection, setSelection] = useState<ReadonlySet<ClientLockStatus>>(initial);

  // 親から currentStatuses が更新されたら (info の取り直し後) 選択も追従する。
  // 保存 → refresh の完了まではボタン disabled なので、間にユーザー操作が挟まらない。
  useEffect(() => {
    setSelection(initial);
  }, [initial]);

  const toggle = (key: ClientLockStatus, checked: boolean) => {
    const next = new Set(selection);
    if (checked) next.add(key);
    else next.delete(key);
    setSelection(next);
  };

  const dirty = useMemo(() => {
    if (selection.size !== initial.size) return true;
    for (const s of selection) if (!initial.has(s)) return true;
    return false;
  }, [initial, selection]);

  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-gray-900">
            <ShieldCheck aria-hidden="true" className="mr-1 inline size-5" />
            このドメインを保護する
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            誤操作・乗っ取り対策のため、操作の一部を禁止できます。
            解除は同じ画面からいつでも自分で行えます。
          </p>
        </div>

        {feedback && (
          <FeedbackBanner
            context="locks"
            tone={feedback.tone}
            message={feedback.message}
            unauthorized={feedback.unauthorized}
          />
        )}

        <div className="space-y-2 border-t border-gray-100 pt-3">
          {LOCK_OPTIONS.map((opt) => {
            const checked = selection.has(opt.key);
            const inputId = `lock-${opt.key}`;
            return (
              <label
                key={opt.key}
                htmlFor={inputId}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-3 hover:bg-gray-50"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggle(opt.key, e.target.checked)}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900">{opt.label}</div>
                  <div className="mt-0.5 text-xs text-gray-600">{opt.hint}</div>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-gray-100 pt-3">
          <Button
            variant="brand"
            disabled={disabled || !dirty}
            onClick={() => void onSave([...selection])}
          >
            {running ? "保存中..." : "保護設定を保存する"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

