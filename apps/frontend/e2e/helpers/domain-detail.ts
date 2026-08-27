import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { randomHex } from "./transfer";

/**
 * ドメイン詳細画面 (`/dashboard/[domain-id]`) の e2e 用ヘルパ。
 * kitaqsign / kitaqnic 実物レジストリを叩く前提。
 *
 * 「ドメインを 1 個 買う」「詳細画面を開く」「保護タブを保存する」だけを
 * まとめる。個別のフォーム操作 (ns 保存・renew 実行など) は spec 内に置く。
 */

/**
 * kitaqsign (.com) で新規ドメインを 1 個購入して、その名前を返す。
 * 既存の setupOutboundPending / kitaqsign-normal spec と同じ流れを踏襲する。
 */
export async function purchaseKitaqsignDomain(
  page: Page,
  labelPrefix: string,
): Promise<{ fullDomain: string }> {
  // 衝突回避のため 8 bytes (16 hex) を後ろに付ける。既存 helper と同じ。
  const domainName = `${labelPrefix}-${Date.now()}-${randomHex(8)}`;
  const fullDomain = `${domainName}.com`;

  await page.goto(`/?q=${fullDomain}`);
  await expect(
    page.getByRole("region", { name: "検索結果", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`このドメインで進む.*${domainName}\\.com`),
    })
    .click();
  await expect(page).toHaveURL(/\/cart\/complete/);
  await page.getByText("お支払い内容の確認に進む").click();
  await expect(page).toHaveURL(/\/cart\/payment/);
  await page.getByRole("button", { name: /この内容で確定する/ }).click();
  // レジストリ側 create が遅いことがあるので広めに待つ
  await expect(page).toHaveURL(/\/cart\/done/, { timeout: 30_000 });

  return { fullDomain };
}

/**
 * マイドメイン一覧から指定ドメインをクリックして詳細画面を開く。
 * 呼び出す前に少なくとも 1 回 `/dashboard` を開いた状態でなくても、
 * この関数の中で goto するので単独で呼べる。
 */
export async function openDomainDetail(
  page: Page,
  fullDomain: string,
): Promise<void> {
  await page.goto("/dashboard");
  await page
    .getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) })
    .click();
  await expect(
    page.getByRole("heading", { name: fullDomain, level: 1 }),
  ).toBeVisible();
}

/**
 * 詳細画面で「保護」タブを開き、指定した 5 種ロックの ON/OFF を target 通りに
 * 揃えてから「保護設定を保存する」を押す。成功バナーの表示まで待つ。
 *
 * target の中で checkbox の現在状態と一致するものは触らない（余計な dirty を作らない）。
 * すべて一致していたら「保存」ボタンは disabled のまま = 何も送らない。
 */
export type LockKey =
  | "clientHold"
  | "clientTransferProhibited"
  | "clientUpdateProhibited"
  | "clientDeleteProhibited"
  | "clientRenewProhibited";

const LOCK_LABEL: Record<LockKey, RegExp> = {
  clientTransferProhibited: /^他のレジストラへの移管を禁止する/,
  clientDeleteProhibited: /^廃止を禁止する/,
  clientUpdateProhibited: /^設定変更を禁止する/,
  clientRenewProhibited: /^更新を禁止する/,
  clientHold: /^サイト掲載を止める/,
};

/**
 * 「保護」タブで target 通りにチェック状態を揃え、保存が必要なら押す。
 * 保存後、成功バナー (feedback context=locks) の表示を確認する。
 * 変更が無ければ何もしないで返る。
 */
export async function setLocks(
  page: Page,
  target: Partial<Record<LockKey, boolean>>,
): Promise<void> {
  await page.getByRole("tab", { name: "保護" }).click();

  let changed = false;
  for (const [key, desired] of Object.entries(target) as [LockKey, boolean][]) {
    const label = LOCK_LABEL[key];
    const checkbox = page.getByRole("checkbox", { name: label });
    const current = await checkbox.isChecked();
    if (current === desired) continue;
    // Base UI の Checkbox は input を hover 経由でクリックする必要がある
    await checkbox.click();
    changed = true;
  }
  if (!changed) return;

  const saveButton = page.getByRole("button", { name: "保護設定を保存する" });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  // 成功バナーの文言 (use-domain-detail.hook.ts より)
  await expect(
    page.getByText("保護設定を更新しました").first(),
  ).toBeVisible({ timeout: 20_000 });
}
