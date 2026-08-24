import { type Page, type Locator } from "@playwright/test";

export class DashboardPage {
  readonly heading: Locator;
  readonly logoutButton: Locator;
  readonly loginStatusText: Locator;

  constructor(private page: Page) {
    this.heading = page.getByRole("heading", { name: "ダッシュボード" });
    this.logoutButton = page.getByRole("button", { name: "ログアウト" });
    this.loginStatusText = page.getByText("ログインしています");
  }

  async goto() {
    await this.page.goto("/dashboard");
    await this.page.waitForLoadState("networkidle");
  }
}
