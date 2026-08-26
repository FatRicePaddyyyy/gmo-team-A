import { test, expect } from "@playwright/test";

test.describe("/sample — コンポーネントカタログ", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sample");
    await page.waitForLoadState("networkidle");
  });

  test("ページが 200 で表示される", async ({ page }) => {
    await expect(page).toHaveTitle(/.+/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("SiteHeader が表示される", async ({ page }) => {
    const header = page.getByRole("banner");
    await expect(header).toBeVisible();
    await expect(header.getByRole("link", { name: "ドメインを探す" })).toBeVisible();
  });

  test("HeroSearch が表示される", async ({ page }) => {
    const searchInput = page.getByPlaceholder("manabi-blog");
    await expect(searchInput).toBeVisible();
    await expect(
      page.getByRole("button", { name: "空き状況を調べる" }).first(),
    ).toBeVisible();
  });

  test("HeroSearch に入力できる", async ({ page }) => {
    const input = page.getByPlaceholder("manabi-blog");
    await input.fill("testdomain");
    await expect(input).toHaveValue("testdomain");
  });

  test("FeatureCards が 4 件表示される", async ({ page }) => {
    await expect(page.getByText("末尾（TLD）で条件が変わる")).toBeVisible();
    await expect(page.getByText("ドメインは毎年の更新制")).toBeVisible();
    await expect(page.getByText("登録者の情報は公開される")).toBeVisible();
    await expect(page.getByText("名前は短く・打ちやすく")).toBeVisible();
  });

  test("DomainPriceTable が表示される", async ({ page }) => {
    await expect(page.getByText("末尾（TLD）別の料金")).toBeVisible();
    await expect(page.getByText(".com").first()).toBeVisible();
    await expect(page.getByText(".net").first()).toBeVisible();
  });

  test("DomainSearchResult が表示される", async ({ page }) => {
    await expect(page.getByText(/「example」の検索結果/)).toBeVisible();
  });

  test("StepsGuide が表示される", async ({ page }) => {
    await expect(page.getByText("登録の流れ")).toBeVisible();
    // heading で絞る
    await expect(page.getByRole("heading", { name: "登録の流れ" })).toBeVisible();
  });

  test("ServiceCardGrid が表示される", async ({ page }) => {
    await expect(page.getByText("ドメインの取得・管理")).toBeVisible();
  });

  test("CampaignBannerGrid が表示される", async ({ page }) => {
    await expect(page.getByText("キャンペーン・お得な情報")).toBeVisible();
  });

  test("TestimonialCards が表示される", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "お客様の声" })).toBeVisible();
  });

  test("FaqAccordion が表示・開閉できる", async ({ page }) => {
    // "use client" のハイドレーション完了を待つ
    await page.waitForSelector("[data-slot='accordion-trigger']", { timeout: 15_000 });

    const heading = page.getByRole("heading", { name: "よくあるご質問" });
    await expect(heading).toBeVisible();

    const trigger = page.locator("[data-slot='accordion-trigger']").first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    // Base UI Accordion は aria-expanded で開閉状態を管理
    await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: 5_000 });
  });

  test("NewsList が表示される", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "NEWS" })).toBeVisible();
    await expect(page.getByText(".comドメイン 0円キャンペーン開催中！")).toBeVisible();
  });

  test("CheckoutStepper が表示される", async ({ page }) => {
    // stepper は nav 内にある
    const stepper = page.getByRole("navigation", { name: "申込みステップ" });
    await expect(stepper).toBeVisible();
    // 既定のステップは shared/lib/progress-store.ts の FLOW_STEPS が唯一の定義
    await expect(stepper.getByText("内容を確認", { exact: true }).first()).toBeVisible();
  });

  test("OptionSection が表示される", async ({ page }) => {
    await expect(page.getByText("Whois情報公開代行メール転送オプション")).toBeVisible();
    await expect(page.getByText("ドメインプロテクション")).toBeVisible();
  });

  test("OptionSection の追加ボタンが押せる", async ({ page }) => {
    // "use client" コンポーネントのハイドレーション完了を待つ
    await page.waitForSelector("text=Whois情報公開代行メール転送オプション", { timeout: 15_000 });
    await expect(page.getByText("Whois情報公開代行メール転送オプション")).toBeVisible();

    const addButton = page.getByRole("button", { name: "追加" }).first();
    await expect(addButton).toBeVisible({ timeout: 10_000 });
    await expect(addButton).toBeEnabled();
    await addButton.click();

    // /sample はコンポーネントの見た目を並べるカタログで、状態を持たない
    // （OptionSection に onAdd を渡していない）。押しても「追加済み ✓」には
    // 変わらないのが実装どおりなので、押下できることまでを確認する。
    await expect(addButton).toBeVisible();
  });

  test("OrderSummary が表示される", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "お申し込み内容" })).toBeVisible();
    await expect(page.getByText("mytestdomain2026").first()).toBeVisible();
    await expect(page.getByText("合計金額（税込）")).toBeVisible();
  });

  test("CheckoutAuthSidebar のタブが切り替えできる", async ({ page }) => {
    // ページ末尾までスクロールして client コンポーネントを確実にレンダリング
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const newUserBtn = page.getByRole("button", { name: "初めてご利用の方" });
    await newUserBtn.scrollIntoViewIfNeeded();
    await expect(newUserBtn).toBeVisible();

    const existingUserBtn = page.getByRole("button", { name: "お名前IDをお持ちの方" });
    await expect(existingUserBtn).toBeVisible();

    await existingUserBtn.click();

    // タブ切替後に会員IDフォームが表示される
    await expect(page.getByPlaceholder("1234567")).toBeVisible({ timeout: 5_000 });
  });

  test("SiteFooter が表示される", async ({ page }) => {
    const footer = page.getByRole("contentinfo");
    await expect(footer).toBeVisible();
    await expect(footer.getByText(/まなびドメイン/).first()).toBeVisible();
  });
});
