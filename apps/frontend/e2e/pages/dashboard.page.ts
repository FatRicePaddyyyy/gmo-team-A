import { type Page, type Locator } from "@playwright/test";

export class DashboardPage {
  /** ログイン済みのときの見出し。未ログインだと loginPrompt のほうが出る */
  readonly signedInHeading: Locator;
  readonly loginPrompt: Locator;
  readonly domainSection: Locator;

  constructor(private page: Page) {
    this.signedInHeading = page.getByRole("heading", {
      name: "マイドメイン",
      level: 1,
    });
    this.loginPrompt = page.getByRole("heading", { name: "ログインが必要です" });
    this.domainSection = page.getByRole("heading", { name: "取得済みのドメイン" });
  }

  async goto() {
    await this.page.goto("/dashboard");
    await this.page.waitForLoadState("networkidle");
  }
}
