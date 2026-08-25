import { type Page, type Locator } from "@playwright/test";

export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(private page: Page) {
    this.emailInput = page.getByLabel("メールアドレス");
    this.passwordInput = page.getByLabel("パスワード", { exact: true });
    this.submitButton = page.getByRole("button", { name: /^(ログインする|ログイン中)/ });
    this.errorMessage = page.locator("[class*='text-red']").first();
  }

  async goto() {
    await this.page.goto("/login");
    await this.page.waitForLoadState("networkidle");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
