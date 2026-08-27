import { test, expect, type Page } from "@playwright/test";

/**
 * @registry-none — 入力バリデーション（issue #76）。レジストリ疎通は要らない。
 *
 * 日本語ドメインは現状サポート外。以前はそのままバックエンドへ送られ、レジストリの 422 が
 * 「空き状況を確認できませんでした」（＝通信やレジストリ側の一時的な問題）に化けていたため、
 * ユーザーには原因が伝わらなかった。
 *
 * ここで固定するのは 2 点。
 *   1. 理由が入力欄のそばに出ること
 *   2. レジストリへ問い合わせ自体が飛ばないこと（飛ぶと障害表示に化ける）
 */

const RULE_MESSAGE =
  "ドメイン名は半角の英数字とハイフンで入力してください。日本語や記号は使えません。";

/**
 * ハイドレーション完了を待つ。
 *
 * 待たずに送信すると、JS がまだ載っていないフォームがネイティブ送信され、
 * `handleSubmit` を通らないまま画面がリロードされてしまう（値も消える）。
 * React はハイドレーション時に DOM ノードへ `__react*` プロパティを生やすので、
 * それを検知に使う。
 */
async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('input[name="domain"]');
    return !!el && Object.keys(el).some((key) => key.startsWith("__react"));
  });
}

async function searchFor(page: Page, value: string) {
  await waitForHydration(page);
  await page.getByLabel("取得したいドメイン名").fill(value);
  await page.getByRole("button", { name: "空き状況を調べる" }).click();
}

/** 空き確認 API が呼ばれたら記録する。呼ばれないことをテストで断言するため。 */
function watchCheckRequests(page: Page): string[] {
  const called: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/domains/check")) {
      called.push(request.url());
    }
  });
  return called;
}

test.describe(
  "日本語ドメインの入力",
  { tag: "@registry-none" },
  () => {
    test("検索フォームから入れると、理由が出てレジストリへ問い合わせない", async ({ page }) => {
      const checkRequests = watchCheckRequests(page);
      await page.goto("/");

      await searchFor(page, "日本語ドメイン");

      await expect(page.getByRole("alert").filter({ hasText: RULE_MESSAGE })).toBeVisible();
      // 障害表示に化けていないこと
      await expect(page.getByText("空き状況を確認できませんでした")).toHaveCount(0);
      expect(checkRequests).toEqual([]);
    });

    test("?q= の直リンクで来ても、理由が出てレジストリへ問い合わせない", async ({ page }) => {
      const checkRequests = watchCheckRequests(page);
      // 検索フォームを通らない経路。ここを塞がないと素通りする。
      await page.goto(`/?q=${encodeURIComponent("日本語ドメイン")}`);

      await expect(page.getByRole("alert").filter({ hasText: RULE_MESSAGE })).toBeVisible();
      await expect(page.getByText("空き状況を確認できませんでした")).toHaveCount(0);
      expect(checkRequests).toEqual([]);
    });

    test("半角英数字とハイフンなら、これまでどおり検索に進む", async ({ page }) => {
      const checkRequests = watchCheckRequests(page);
      await page.goto("/");

      await searchFor(page, "manabi-blog");

      // 入力エラーは出ない（空き状況そのものはレジストリ次第なので見ない）
      await expect(page.getByText(RULE_MESSAGE)).toHaveCount(0);
      await expect.poll(() => checkRequests.length).toBeGreaterThan(0);
    });
  },
);
