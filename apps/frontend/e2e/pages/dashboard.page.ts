import { type Page, type Locator } from "@playwright/test";

export class DashboardPage {
  readonly heading: Locator;
  readonly logoutButton: Locator;
  /** ログイン済みだけに出る見出し。未ログインだと「ログインが必要です」になる */
  readonly signedInHeading: Locator;
  readonly loginPrompt: Locator;
  readonly domainSection: Locator;
  readonly emptyState: Locator;

  constructor(private page: Page) {
    this.heading = page.getByRole("heading", { name: "マイドメイン", level: 1 });
    this.logoutButton = page.getByRole("button", { name: "ログアウト" });
    this.signedInHeading = this.heading;
    this.loginPrompt = page.getByRole("heading", { name: "ログインが必要です" });
    this.domainSection = page.getByRole("heading", { name: "取得済みのドメイン" });
    this.emptyState = page.getByText("まだドメインを取得していません。");
  }

  async goto() {
    await this.page.goto("/dashboard");
    await this.page.waitForLoadState("networkidle");
  }
}
