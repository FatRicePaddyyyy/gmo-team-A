import { request } from "@playwright/test";

/**
 * 移管フロー e2e で teama-2 (相手事業者) の操作をレジストリ直叩きで行うヘルパ。
 * apps/backend/scripts/transfer/*.sh の TypeScript 版に相当する。
 *
 * 必要な env:
 *   T2_KITAQSIGN_BASIC_USER / _BASIC_PASS / _REGISTRAR_ID / _API_KEY
 *   T2_KITAQNIC_*
 *   BACKEND_URL (デフォルト http://localhost:8787)
 *   TRANSFER_D1_SQLITE   (デフォルト apps/backend/.wrangler/state/... を試みる。CI では未設定でも動く)
 */

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8787";

const REGISTRY_URL = {
  kitaqsign: "https://epp.kitaqsign.com",
  kitaqnic: "https://epp.kitaqnic.com",
} as const;

export type Registry = keyof typeof REGISTRY_URL;

export function tldOf(registry: Registry): string {
  return registry === "kitaqsign" ? "com" : "xyz";
}

function creds(registry: Registry) {
  const prefix = registry === "kitaqsign" ? "T2_KITAQSIGN" : "T2_KITAQNIC";
  const user = process.env[`${prefix}_BASIC_USER`];
  const pass = process.env[`${prefix}_BASIC_PASS`];
  const reg = process.env[`${prefix}_REGISTRAR_ID`];
  const key = process.env[`${prefix}_API_KEY`];
  if (!user || !pass || !reg || !key) {
    throw new Error(
      `teama-2 credentials が未設定 (${prefix}_*)。.env.teama2 の内容を T2_ prefix で export してから実行してください`,
    );
  }
  return { user, pass, reg, key };
}

async function callRegistry(
  registry: Registry,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const { user, pass, reg, key } = creds(registry);
  const api = await request.newContext();
  try {
    const url = `${REGISTRY_URL[registry]}${path}`;
    const opts: Parameters<typeof api.post>[1] = {
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
        "X-Registrar-Id": reg,
        "X-Api-Key": key,
        "Content-Type": "application/json",
      },
      timeout: 20_000,
    };
    if (body !== undefined) opts.data = body as never;
    const response =
      method === "GET" ? await api.get(url, opts) : await api.post(url, opts);
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      /* ignore */
    }
    return { status: response.status(), body: parsed };
  } finally {
    await api.dispose();
  }
}

// ─── teama-2 側の操作 ───────────────────────────────────────

/** teama-2 で許可名のコンタクトを作る。504 は「反映済みの可能性」なので info で確認して retry */
export async function t2CreateContact(registry: Registry): Promise<string> {
  const id = `C-${Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("").toUpperCase()}`;
  const authInfo = randomHex(16);
  const body = {
    id,
    postalInfo: {
      name: "Taro Test",
      addr: { street: "N/A", city: "N/A", cc: "JP" },
    },
    email: "taro.test@example.com",
    authInfo,
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await callRegistry(registry, "POST", "/api/v1/epp/contacts", body);
    if (res.status === 200 || res.status === 201 || res.status === 202) return id;
    if (res.status === 409) return id; // 既に作られていた
    if (res.status === 504 && attempt < 3) {
      const infoRes = await callRegistry(
        registry,
        "GET",
        `/api/v1/epp/contacts/${encodeURIComponent(id)}`,
      );
      if (infoRes.status === 200) return id;
      continue;
    }
    throw new Error(
      `t2CreateContact failed ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
    );
  }
  throw new Error("t2CreateContact: 3回試行しても成功せず");
}

/** teama-2 でドメインを作る。504 は「反映済みの可能性」なので info で確認 + 存在すれば OK */
export async function t2CreateDomain(
  registry: Registry,
  args: { domain: string; contactId: string; authInfo: string },
): Promise<void> {
  const body = {
    domain: args.domain,
    period: { unit: "Y", value: 1 },
    registrant: args.contactId,
    contacts: {
      ADMIN: args.contactId,
      TECH: args.contactId,
      BILLING: args.contactId,
    },
    authInfo: args.authInfo,
  };
  // 最大 3 回まで、504 timeout は「べき等な再実行で確認」の指示に従う。
  // 既に作成済みなら 2 回目以降で 409 になる可能性がある = その場合も成功扱い。
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await callRegistry(registry, "POST", "/api/v1/epp/domains", body);
    if (res.status === 200 || res.status === 201 || res.status === 202) return;
    if (res.status === 409) return; // すでに作成済みだった
    if (res.status === 504 && attempt < 3) {
      // info で存在確認。存在すれば成功扱い
      const infoRes = await callRegistry(
        registry,
        "GET",
        `/api/v1/epp/domains/${encodeURIComponent(args.domain)}`,
      );
      if (infoRes.status === 200) return;
      // 存在しない場合はもう一度 POST を試す
      continue;
    }
    throw new Error(
      `t2CreateDomain failed ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  throw new Error(`t2CreateDomain: 3回試行しても成功せず`);
}

/** teama-2 で transfer/request を投げる (inbound シナリオ用: teama が新規作成したドメインを取りに行く) */
export async function t2TransferRequest(
  registry: Registry,
  domain: string,
  authInfo: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await callRegistry(
      registry,
      "POST",
      `/api/v1/epp/domains/${encodeURIComponent(domain)}/transfer/request`,
      { op: "request", authInfo },
    );
    if (res.status === 200 || res.status === 201 || res.status === 202) return;
    // 409 = 既に pendingTransfer 状態。504 リトライ後に発生することがある
    if (res.status === 409) return;
    if (res.status === 504 && attempt < 3) {
      // pending 状態確認
      const infoRes = await callRegistry(
        registry,
        "GET",
        `/api/v1/epp/domains/${encodeURIComponent(domain)}`,
      );
      const infoBody = infoRes.body as { resData?: { status?: string | string[] } } | null;
      const status = infoBody?.resData?.status;
      const asArray = Array.isArray(status) ? status : status ? [status] : [];
      if (asArray.includes("pendingTransfer")) return;
      continue;
    }
    throw new Error(
      `t2TransferRequest failed ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  throw new Error("t2TransferRequest: 3回試行しても成功せず");
}

/** teama-2 で transfer/approve/reject/cancel を投げる */
export async function t2TransferOp(
  registry: Registry,
  domain: string,
  op: "approve" | "reject" | "cancel",
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await callRegistry(
      registry,
      "POST",
      `/api/v1/epp/domains/${encodeURIComponent(domain)}/transfer/${op}`,
      {},
    );
    if (res.status === 200 || res.status === 201 || res.status === 202) return;
    // 409 = 既に処理済み (前回 504 → べき等再送で確定していた場合)
    if (res.status === 409) return;
    if (res.status === 504 && attempt < 3) continue;
    throw new Error(
      `t2Transfer${op} failed ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  throw new Error(`t2Transfer${op}: 3回試行しても成功せず`);
}

/** teama-2 で poll を叩いてメッセージキューを空にする (ack しないと同じ通知が繰り返される) */
export async function t2PollAndDrain(registry: Registry, maxRounds = 5): Promise<void> {
  for (let i = 0; i < maxRounds; i++) {
    const res = await callRegistry(registry, "GET", "/api/v1/epp/messages/poll");
    if (res.status !== 200) return;
    const bodyObj = res.body as {
      resData?: { count?: number; message?: { id?: number } };
    } | null;
    const msgId = bodyObj?.resData?.message?.id;
    const count = bodyObj?.resData?.count ?? 0;
    if (!msgId) return;
    await callRegistry(registry, "POST", `/api/v1/epp/messages/${msgId}/ack`, {});
    if (count <= 1) return;
  }
}

// ─── teama backend cron 発火 ───────────────────────────────

/** backend の /__scheduled を叩いて cron 相当の処理を回す */
export async function fireCron(): Promise<void> {
  const api = await request.newContext();
  try {
    const res = await api.get(`${BACKEND_URL}/__scheduled`, { timeout: 60_000 });
    if (!res.ok()) {
      throw new Error(`fireCron failed status=${res.status()}`);
    }
  } finally {
    await api.dispose();
  }
}

// ─── ユニーク名 & 乱数 ───────────────────────────────────

/** 十中八九空いているランダムなドメイン名 (プレフィックスをテストシナリオごとに変える) */
export function uniqueDomainName(prefix: string, registry: Registry): string {
  const stamp = Date.now();
  // randomHex は 3 bytes = 4096 通りだと、同時期に複数 CI run が回ると
  // 衝突して「このドメインはすでに登録されています」で購入が失敗する
  // ケースが出た。8 bytes = 約 1.8 * 10^19 通りに強化する。
  const rand = randomHex(8);
  return `${prefix}-${stamp}-${rand}.${tldOf(registry)}`;
}

/** 16 進のランダム文字列 (authInfo などに使う) */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── frontend 上での操作をまとめたヘルパ ─────────────────

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * teama frontend で「ドメインを購入 → 詳細ページの「他のレジストラへ渡す」タブで authInfo を設定
 * → teama-2 registry で transfer/request を投げる → backend cron 発火」まで運ぶ。
 *
 * inbound 系 3 ケース (approve / reject / cancel) の前半で共通なのでまとめる。
 * registry で `.com` / `.xyz` を切り替えられる。
 * 返り値 fullDomain と authInfo は呼び出し側で使う。
 */
export async function setupInboundPending(
  page: Page,
  registry: Registry,
  labelPrefix: string,
): Promise<{ fullDomain: string; authInfo: string }> {
  const tld = tldOf(registry);
  // randomHex は 3 bytes = 4096 通りだと、CI matrix や rerun のタイミングで
  // 衝突して「このドメインはすでに登録されています」で購入が失敗する
  // ケースが出たので 8 bytes に強化。uniqueDomainName と同じ理由。
  const domainName = `${labelPrefix}-${Date.now()}-${randomHex(8)}`;
  const fullDomain = `${domainName}.${tld}`;

  // 検索は「name + .tld」を丸ごと入れる (`/?q=name.tld` の形)
  await page.goto(`/?q=${fullDomain}`);
  await expect(page.getByRole("region", { name: "検索結果", exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: new RegExp(`このドメインで進む.*${domainName}\\.${tld}`),
    })
    .click();
  await expect(page).toHaveURL(/\/cart\/complete/);
  await page.getByText("お支払い方法の選択に進む").click();
  await expect(page).toHaveURL(/\/cart\/payment/);
  await page.getByRole("button", { name: /この内容で確定する/ }).click();
  await expect(page).toHaveURL(/\/cart\/done/, { timeout: 15_000 });

  await page.goto("/dashboard");
  await page
    .getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) })
    .click();
  await page.getByRole("tab", { name: "他のレジストラへ渡す" }).click();
  const authInfo = `e2e-${randomHex(8)}`;
  await page.getByPlaceholder("新しい認証コードを入力").fill(authInfo);
  await page.getByRole("button", { name: "認証コードを設定する" }).click();
  await expect(
    page.getByText("認証コード（AuthCode）を再発行しました"),
  ).toBeVisible({ timeout: 10_000 });

  await t2TransferRequest(registry, fullDomain, authInfo);
  // cron 1 回では、レジストリの transfer message が poll → DB 反映 → inbound 一覧
  // 更新までの 1 cycle に収まらないことがある (レジストリ側の通知が数拍遅れる)。
  // 2 回発火 + 短い間隔を挟むことで実際の反映を待つ。
  await fireCron();
  await page.waitForTimeout(1_000);
  await fireCron();

  // 再度詳細ページを開いて、「他のレジストラへ渡す」タブに incoming transfer カードが出るのを待つ
  await page.goto("/dashboard");
  await page
    .getByRole("link", { name: new RegExp(fullDomain.replace(".", "\\.")) })
    .click();
  await page.getByRole("tab", { name: "他のレジストラへ渡す" }).click();

  return { fullDomain, authInfo };
}

/**
 * outbound 系: teama-2 registry で先にドメイン作成 → teama frontend の /transfer で申請 → teama-2 poll (op=request をack)。
 * 呼び出し側は返り値 fullDomain を使って ・完了確認 (approve) ・却下 (reject) ・取消 (cancel) を続ける。
 */
export async function setupOutboundPending(
  page: Page,
  registry: Registry,
  labelPrefix: string,
): Promise<{ fullDomain: string; authInfo: string }> {
  const fullDomain = uniqueDomainName(labelPrefix, registry);
  const contactId = await t2CreateContact(registry);
  const authInfo = randomHex(12);
  await t2CreateDomain(registry, { domain: fullDomain, contactId, authInfo });

  // teama frontend で /transfer フォームから申請
  await page.goto("/transfer");
  await page.locator("#transfer-name").fill(fullDomain);
  await page.locator("#transfer-auth-info").fill(authInfo);
  await page.getByRole("button", { name: "移管を申請する" }).click();
  await expect(
    page.getByText(`${fullDomain} の移管を申請しました`),
  ).toBeVisible({ timeout: 10_000 });

  // teama-2 側で op=request が届いているはずなので poll (ack) しておく
  await t2PollAndDrain(registry);

  return { fullDomain, authInfo };
}
