import { defineConfig, devices } from "@playwright/test";

// E2E テスト時はローカルバックエンドを使う。
// Node 24 の undici は "localhost" を IPv6 (::1) 優先で解決するが、wrangler dev は
// IPv4 (127.0.0.1) にしかバインドしないため、CI で ECONNREFUSED になる。
// 明示的に IPv4 を指す 127.0.0.1 に固定する（CI からの env 上書きも尊重する）。
process.env.NEXT_PUBLIC_BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8787";

/**
 * project はレジストリの稼働状態に対する期待動作で分けている。
 *
 * secret はどの project にも常に渡す。CI で意図的に片方を落とす操作はしない。
 * 「その状態のときだけ緑になる」テストを、そのままの現実に対して実行する。
 *
 * - registry-none:    レジストリ疎通が無くても動くべき UI テスト。常時緑。
 * - kitaqsign-normal: kitaqsign 稼働時にだけ緑になる正常系 (.com 検索・購入)
 * - kitaqsign-outage: kitaqsign 障害時にだけ緑になる異常系 (.com が「確認できませんでした」枠)
 * - kitaqnic-normal:  kitaqnic 稼働時にだけ緑になる正常系 (.xyz 検索・購入)
 * - kitaqnic-outage:  kitaqnic 障害時にだけ緑になる異常系 (.xyz が「確認できませんでした」枠)
 *
 * よって「両方稼働時」は normal 系 2 つが緑・outage 系 2 つが赤。
 *     「kitaqsign だけ落ちてる時」は kitaqsign-normal 赤 / kitaqsign-outage 緑 / kitaqnic-normal 緑 / kitaqnic-outage 赤。
 * どの project が緑かで、いま何が起きているかを CI 側で読み取る。
 */
export default defineConfig({
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "html",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    headless: true,
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "registry-none",
      testDir: "./e2e/registry-none",
    },
    {
      name: "kitaqsign-normal",
      testDir: "./e2e/kitaqsign-normal",
    },
    {
      name: "kitaqsign-outage",
      testDir: "./e2e/kitaqsign-outage",
    },
    {
      name: "kitaqnic-normal",
      testDir: "./e2e/kitaqnic-normal",
    },
    {
      name: "kitaqnic-outage",
      testDir: "./e2e/kitaqnic-outage",
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
