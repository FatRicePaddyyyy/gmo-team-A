import { request } from "@playwright/test";

/**
 * E2E テスト用のシードユーザー作成ヘルパ。
 *
 * どのテストからも `createSeedUser()` を呼ぶだけで、都度一意な
 * メールアドレス・パスワード・名前を持ったユーザーを作れる。
 *
 * 前提の env（frontend/e2e 全体の前提と同じ）:
 *  - NEXT_PUBLIC_BACKEND_URL: バックエンドの baseURL（例: http://localhost:8787）
 *  - SECRET_KEY: /api/v1/secret/create-seed-user を叩くための Bearer トークン
 *
 * 呼び出し側はテスト内で `test.skip(!hasSeedEnv(), "...")` などのガードを
 * 入れておくと、env 未設定のときに落ちずにスキップできる。
 */

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8787";

export interface SeededUser {
  email: string;
  password: string;
  name: string;
}

export interface CreateSeedUserOptions {
  /** email の @ より前に足すラベル。テストごとにファイル名など識別しやすい値を渡す */
  label?: string;
}

/** シード API を呼ぶのに必要な env が揃っているか。テストの skip 判定用 */
export function hasSeedEnv(): boolean {
  return Boolean(process.env.SECRET_KEY);
}

/** ミリ秒 + 6桁ランダム。並列・連続実行での衝突を避ける */
function uniqueSuffix(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

/**
 * シード API を直接叩いてテストユーザーを作る。呼び出し側は返り値でログインする。
 *
 * ユーザーの後片付けはしない（テストの独立性を優先）。CI では D1 が都度作り直され、
 * ローカル開発の DB は開発者責任で掃除する。E2E 由来のユーザーが増える程度は許容。
 */
export async function createSeedUser(
  options: CreateSeedUserOptions = {},
): Promise<SeededUser> {
  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "SECRET_KEY が未設定です。frontend/e2e はシードユーザー作成に SECRET_KEY を要求します。",
    );
  }

  const label = options.label ?? "e2e";
  const user: SeededUser = {
    email: `${label}-${uniqueSuffix()}@example.com`,
    // better-auth のパスワード下限（8）とフロント Zod の下限（6）の両方を満たす
    password: "e2e-passw0rd",
    // レジストリの postalInfo.name は "特定の許可名のみ" で、そうでないと
    // createContact が 400 で弾かれてドメイン取得まで通らない
    // （apps/backend/src/lib/bridge/index.ts の createContact 参照）。
    // Swagger 制約のコメントで例示されている許可名 "Taro Test" を使う
    name: "Taro Test",
  };

  const api = await request.newContext();
  try {
    const response = await api.post(
      `${BACKEND_URL}/api/v1/secret/create-seed-user`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        data: user,
      },
    );
    const body = await response.json();
    if (!response.ok() || body?.success !== true) {
      throw new Error(
        `シードユーザー作成に失敗しました (status=${response.status()}): ${JSON.stringify(body)}`,
      );
    }
    return user;
  } finally {
    await api.dispose();
  }
}
