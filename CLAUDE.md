# アーキテクチャ

pnpm workspace。アプリは `apps/frontend`（Web）と `apps/backend`（Hono API / Cloudflare Workers）の 2 つ。

フロントは Hono RPC でバックエンドを呼ぶ。DB アクセスはバックエンドだけが行う。

ディレクトリ名はケバブケース。テストは対象の隣に `*.spec.ts` を置く。

---

## テストと CI の扱い（暫定運用）

**E2E テスト（Playwright）と CI の結果は、実装中は無視してよい。** 別途まとめて検証する体制があるため、個々の作業でここを追わない。

やらないこと:

- E2E テスト（`apps/frontend/e2e/**`）を新しく書く・既存のものを文言変更に追従させる
- ローカルで `pnpm exec playwright test` を回す
- PR を出したあと CI の完了を待つ、赤くなった CI を追いかけて直す

理由: E2E はレジストリ実機に繋ぐ都合で1回が重く、文言を1語変えるたびに追従コミットが増えて手戻りの主因になっていた。CI も同様に待ち時間が長い。

やること（これは引き続き必須）:

| コマンド | 対象 | なぜ残すか |
|---|---|---|
| `pnpm exec tsc --noEmit` | frontend / backend 各パッケージ | 数秒で終わり、型の壊れをその場で拾える |
| `pnpm lint` | ルート | 同上 |
| `pnpm test:run` | backend のユニットテスト | 対象スライスに関係する分だけ。全体が赤くても自分の変更起因でなければ追わない |

つまり **「型・Lint は通す。E2E と CI は見ない」** が現在の運用。この節は暫定なので、一括検証の体制が変わったら消すこと。

---

## 全体

```
apps/
├── backend/     # Hono + Cloudflare Workers + D1
└── frontend/    # Next.js App Router（vinext）
```

---

## バックエンド（`apps/backend`）

バーティカルスライス。URL のセグメントが `src/routes/` のディレクトリになる。1 スライスにハンドラ・ユースケース・DB 操作・テストをまとめる。

```
apps/backend/
├── src/
│   ├── index.ts              # ルート登録・OpenAPI
│   ├── types.ts              # Hono Variables など
│   ├── types/                # Result など共有型
│   │   └── result.ts
│   ├── routes/               # エンドポイント別スライス
│   ├── middlewares/          # 認証・CORS・API キー
│   ├── lib/                  # 外部ライブラリのラッパとスキーマ
│   ├── domains/              # 複数ルートから使う横断ロジック
│   └── scheduled/            # Cron（routes と同じ置き方）
├── drizzle/                  # マイグレーション SQL
├── better-auth.config.ts
├── drizzle.config.ts
├── vitest.config.ts
└── wrangler.jsonc
```

### `src/routes/` — エンドポイント

HTTP メソッドファイルがコントローラ（リクエスト／レスポンスだけ）。パスパラメータは `[param]` ディレクトリ。サブ機能は子ディレクトリに切る。

```
src/routes/
├── add-seed-user/
│   └── post.ts               # POST /api/v1/secret/create-seed-user
└── transfers/
    ├── get.ts                # GET  /api/v1/secure/transfers
    ├── post.ts               # POST /api/v1/secure/transfers
    ├── service.ts
    ├── repository.ts
    ├── transfers.spec.ts
    └── transfers.integration.spec.ts
```

ネストしたリソースの例:

```
src/routes/domains/
├── get.ts                    # GET  /api/v1/secure/domains
├── post.ts                   # POST /api/v1/secure/domains
├── service.ts
├── repository.ts
├── mapper.ts
├── check/
│   └── post.ts               # POST /api/v1/public/domains/check
└── [domain-id]/
    ├── get.ts
    ├── put.ts
    ├── delete.ts
    ├── renew/
    │   └── post.ts           # POST /api/v1/secure/domains/:domain-id/renew
    └── transfer/
        ├── approve/post.ts
        └── reject/post.ts
```

| ファイル | 役割 |
|---------|------|
| `get.ts` / `post.ts` / `patch.ts` / `delete.ts` | ハンドラ。Zod + OpenAPI。Service を呼んで `ctx.json` するだけ |
| `service.ts` | ユースケース。複数の repository 呼び出しと `domains/` の判定を並べる。Drizzle は書かない |
| `mapper.ts` | DB 行 → API レスポンス形の変換（必要なときだけ） |
| `repository.ts` | Drizzle の insert / select / update / delete / count だけ |
| `*.spec.ts` | ハンドラへの `request()` による流しテスト。Repository / Service はモック |

以降のコード例に出てくる `Category` 系は書き方を示すための架空の題材で、実在するスライスではない。実物は `domains/` と `transfers/` を見ること。

呼び出しは **Handler → Service → Repository**。ハンドラから repository を直接呼らない。同じスライスの `service` / `repository` だけを `./` から import する。親ディレクトリのそれを使うなら、その階層に専用ファイルを置く。複数スライスで共有するものは `domains/` へ出す。

クラスは状態を持たないネームスペース。メソッドはすべて `static`。`new` しない。クラス内の別メソッドは `this.methodName()` で呼ぶ。

`src/index.ts` でハンドラを `.route("/", handler)` する。ミドルウェアはパスプレフィックスで掛ける（`/api/v1/secret/*` は API キー、`/api/v1/secure/*` はセッション）。

#### Result 型

service / repository の戻り値は例外を投げず、必ずこの形にする。定義は `src/types/result.ts`。

```ts
export type Result<T, E = string> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: E };

export type SimpleResult<E = string> =
  | { success: true; error: null }
  | { success: false; error: E };
```

成功は `{ success: true, data, error: null }`。失敗は `{ success: false, data: null, error: "メッセージ" }`。削除のように data が無い操作は `SimpleResult`。

#### repository.ts

DB に触る層。1 メソッド = 1 クエリ（または `db.batch` でまとめた一連の SQL）。ビジネス判断（上限、権限、作成してよいか）は書かない。

中身の決まり:

- `createDBClient(env)` でクライアントを取る
- テーブルは `src/lib/schema/` から import
- 行の型は `$inferSelect` / `$inferInsert` を使う
- `try / catch` で囲み、catch では `console.error` して `Result` の失敗を返す。例外は外へ出さない
- `env` は引数で受け取る。`ctx` は受け取らない

```ts
import { count } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { categories } from "../../lib/schema/general-schema";
import type { Result } from "../../types/result";

type Category = typeof categories.$inferSelect;
type NewCategory = typeof categories.$inferInsert;

export class CategoryRepository {
  static async create(
    params: NewCategory,
    env: CloudflareBindings,
  ): Promise<Result<Category>> {
    try {
      const db = createDBClient(env);
      const rows = await db.insert(categories).values(params).returning();
      const created = rows[0];
      if (!created) {
        return { success: false, data: null, error: "カテゴリの作成に失敗しました" };
      }
      return { success: true, data: created, error: null };
    } catch (error) {
      console.error("Create category error:", error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "予期しないエラーが発生しました",
      };
    }
  }

  static async countAll(env: CloudflareBindings): Promise<Result<number>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select({ count: count() }).from(categories);
      return { success: true, data: rows[0]?.count ?? 0, error: null };
    } catch (error) {
      console.error("Count category error:", error);
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "予期しないエラーが発生しました",
      };
    }
  }
}
```

置いてよいもの: SQL、`returning()`、`where`、`batch`、行が 0 件だったときの失敗 Result。

置いてはいけないもの: HTTP ステータス、`ctx.get`、上限判定、複数操作の順序制御（それは service）、レスポンス用の形への整形（それは mapper）。

#### service.ts

ユースケースを並べる層。Drizzle も `createDBClient` も書かない。repository の Result を見て次の手を決める。ドメイン判定は `domains/` の純粋関数に任せる。

中身の決まり:

- 同階層の `./repository` だけを呼ぶ（親の repository は import しない）
- ハンドラが取り出した値（body、`userId`、`env`）を引数で受け取る
- repository が失敗したら、その `error` をそのまま失敗 Result で返す
- 成功データだけを次の処理やレスポンスに渡す

```ts
import { Category } from "../../domains/category";
import { CATEGORY_MAX_COUNT, CATEGORY_MAX_COUNT_MESSAGE } from "../../lib/constants";
import { CategoryRepository } from "./repository";
import type { Result } from "../../types/result";

export class CategoryService {
  static async create(input: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<NonNullable<Awaited<ReturnType<typeof CategoryRepository.create>>["data"]>>> {
    const countRes = await CategoryRepository.countAll(input.env);
    if (!countRes.success) {
      return { success: false, data: null, error: countRes.error };
    }

    const canCreate = Category.canCreate({
      currentCount: countRes.data,
      maxCount: CATEGORY_MAX_COUNT,
    });
    if (!canCreate) {
      return { success: false, data: null, error: CATEGORY_MAX_COUNT_MESSAGE };
    }

    return CategoryRepository.create({ name: input.name }, input.env);
  }
}
```

ユースケースが「repository を 1 回呼ぶだけ」でも service は置く。ハンドラが repository を直接呼ばないため。

```ts
export class CategoryService {
  static async getAll(env: CloudflareBindings) {
    return CategoryRepository.getAll(env);
  }
}
```

置いてよいもの: 複数 repository の順序、`if (!result.success)` での打ち切り、`domains/` の判定、mapper への受け渡し、定数メッセージ。

置いてはいけないもの: `eq` / `insert` / `select`、`createDBClient`、`ctx.json`、Zod スキーマ。

#### ハンドラ側（メソッドファイル）

`ctx.req.valid(...)` と `ctx.get(...)` で入力を取り、Service に渡す。失敗はステータスを付けて JSON にする。

```ts
const payload = ctx.req.valid("json");
const result = await CategoryService.create({
  name: payload.category.name,
  env: ctx.env,
});

if (!result.success) {
  return ctx.json({ success: false as const, data: null, error: result.error }, 500);
}
return ctx.json({ success: true as const, data: result.data, error: null }, 201);
```

#### mapper.ts（必要なときだけ）

DB の行（Date、内部カラム）を API の JSON 形（ISO 文字列、公開フィールドだけ）に変える。SQL も判定も書かない。

```ts
export class CategoryMapper {
  static toResponse(row: Category) {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
```

### `src/lib/` — 横断インフラ

```
src/lib/
├── db.ts
├── better-auth/
├── bridge/                   # 外部 API (レジストリ) との通信レイヤ
│   ├── client.ts             # openapi-fetch クライアント + 認証 middleware
│   ├── index.ts              # RegistryBridge の各メソッド
│   ├── types.ts              # 生成型の再エクスポートと narrowing
│   └── generated/            # Swagger から生成した .d.ts (触らない)
└── schema/
    ├── index.ts              # 全スキーマをまとめて export
    ├── auth-schema.ts
    └── general-schema.ts
```

外部サービス（認証・オブジェクトストレージなど）のクライアントはここにラッパを置く。Drizzle のテーブル定義は `schema/` のみ。

### `src/lib/bridge/` — 外部 API 通信

**方針: 外部 REST API を叩く場合は必ず openapi-typescript で型生成 + openapi-fetch でクライアント化する。生の `fetch()` は書かない。**

理由:

- Swagger からリクエスト/レスポンスの型が自動で入る。手書きの型定義や `as` キャストが不要になる
- パス変更やフィールド追加が Swagger 更新 → 型生成のワンステップで検知できる
- 認証ヘッダなどの共通処理を middleware で 1 箇所にまとめられる

#### 型の生成

`package.json` に生成コマンドを 1 本置き、Swagger YAML から `.d.ts` を出す。

```json
"openapi:gen": "openapi-typescript https://docs.example.com/v3/api-docs.yaml -o ./src/lib/bridge/generated/<name>.d.ts"
```

`src/lib/bridge/generated/` 配下は生成物。**直接編集しない**。Swagger が変わったら `pnpm openapi:gen` で再生成する。

#### クライアントの組み立て (`bridge/client.ts`)

`openapi-fetch` の `createClient` に生成型 `paths` を渡してクライアントを作る。認証ヘッダやトランザクション ID は `Middleware` で毎リクエスト自動注入する（呼び出し側で手書きしない）。

```ts
import createClient from "openapi-fetch";
import type { Client, Middleware } from "openapi-fetch";
import type { paths } from "./generated/registry-a";

export function getClient(env: CloudflareBindings): Client<paths> {
  const client = createClient<paths>({ baseUrl: env.REGISTRY_A_BASE_URL });
  client.use({
    onRequest({ request }) {
      request.headers.set("Authorization", `Basic ${btoa(`${env.REGISTRY_A_USER}:${env.REGISTRY_A_PASS}`)}`);
      request.headers.set("X-Api-Key", env.REGISTRY_A_API_KEY);
      // リクエストごとに一意な ID (トレーシング用)
      if (!request.headers.has("X-Cl-TRID")) {
        request.headers.set("X-Cl-TRID", `CLI-${crypto.randomUUID()}`);
      }
      return request;
    },
  } satisfies Middleware);
  return client;
}
```

同じ Swagger の API が複数ある場合（本プロジェクトでは Kitaqsign / Kitaqnic のように "path はほぼ同じで一部だけ違う" 系）は、共通スキーマ側を代表として扱い、差異があるエンドポイントだけレジストリ別のクライアントを追加で作る。

#### 呼び出しの書き方 (`bridge/index.ts`)

各メソッドは `client.GET("/path")` / `client.POST("/path", { body, params })` の 1 行で叩き、返り値 `{ data, error, response }` を分解して業務層に返す。**戻り値の Result 契約は自前で持ち、data/error/response をそのまま外に出さない**（openapi-fetch の型に呼び出し側を結合させない）。

```ts
static async check({
  name,
  env,
}: {
  name: string;
  env: CloudflareBindings;
}): Promise<Result<DomainCheckResponse>> {
  try {
    const { data, error, response } = await getClient(env).POST("/api/v1/domains/check", {
      body: { names: [name] },
    });
    // HTTP ステータスで分岐 (Swagger の 4xx を意味のあるエラーコードにマップ)
    if (response.status === 422) {return { success: false, data: null, error: "invalid_tld" };}
    if (error) {return { success: false, data: null, error: "invalid_registry_response" };}
    // API 独自のエラーコードを判定
    if (data.result.code !== 1000) {
      return { success: false, data: null, error: data.result.message || "registry_error" };
    }
    if (!data.resData) {return { success: false, data: null, error: "invalid_registry_response" };}
    return { success: true, data: data.resData, error: null };
  } catch (e) {
    console.error("RegistryBridge.check error:", e);
    return { success: false, data: null, error: "network_error" };
  }
}
```

書き方の決まり:

- **返り値は必ず `Result<T>`**。`data.result.code` や `response.status` などプロトコル固有の値を service 層に漏らさない
- **HTTP ステータス → 意味のあるエラーコード** に必ずマップする（`404` → `"domain_not_found"` など）。呼び出し側は「HTTP のことは知らない」で書ける
- **API 独自の `result.code` も同じ層で判定する**（EPP の 2202 など）
- **`try/catch` で `console.error` + `network_error`**。例外を外に出さない
- **`res.json()` や手書きの JSON パースは絶対に書かない**。openapi-fetch の返り値をそのまま使う

#### 型の narrowing (`bridge/types.ts`)

生成型は Swagger の契約そのまま（optional が緩い）。呼び出し側で毎回 `if (data.exDate)` を書きたくないので、bridge 内で「必ず存在する」ことを検証してから、**narrowing した型**で返す。

```ts
import type { components } from "./generated/registry-a";

type Schemas = components["schemas"];

// Swagger 上 exDate は optional だが、成功レスポンスでは必ず返る。
// bridge 側で欠落を invalid_registry_response として弾くので、返り値型は string に絞る。
type WithRequiredExDate<T extends { exDate?: string }> = Omit<T, "exDate"> & { exDate: string };

export type DomainResponse = WithRequiredExDate<Schemas["DomainResponse"]>;

// 逆に、Swagger は required でも実装によって欠落しうるフィールドは optional に緩める。
// マッパー側で `?? []` などフォールバックを書けるようにする。
type WithOptionalFields<T> = Omit<T, "contacts" | "nameservers"> & {
  contacts?: Record<string, string>;
  nameservers?: string[];
};
```

生成型は「仕様の契約」、bridge の再エクスポート型は「ランタイムの現実」。この 2 段で守る。

#### やっていいこと・いけないこと

**やっていいこと:**

- `getClient(env).GET/POST/PUT/DELETE(...)` で叩く
- `response.status` で HTTP レベルの分岐
- `data.result.code` で API 独自コードの分岐
- Middleware で認証ヘッダ・トレース ID 注入
- 生成型を `WithRequired* / WithOptional*` で narrow / widen

**書いてはいけないこと:**

- 生の `fetch(url, { headers: { Authorization: ... } })`
- `await res.json() as SomeType`（キャスト前提のパース）
- 認証ヘッダを毎メソッドで書く（Middleware にまとめる）
- 生成物 `bridge/generated/*.d.ts` を手で書き換える
- `data.result.code` や `response.status` を service 層に露出させる

### `src/middlewares/`

認証・CORS・シークレットキーなど、リクエスト横断の処理。ルートのスライスには置かない。

### `src/domains/`

複数ルートの service から呼ばれる横断ロジック。IO を持たない純粋関数を基本にする（DB が必要な横断処理だけ `repository.ts` を添える）。

```ts
export class Category {
  static canCreate(params: { currentCount: number; maxCount: number }): boolean {
    return params.currentCount < params.maxCount;
  }
}
```

### `src/scheduled/`

Cron。`routes/` と同じく `index.ts` / `service.ts` / `repository.ts`。

---

## フロントエンド（`apps/frontend`）

App Router のディレクトリが画面構成の正。ページ固有のものはそのページの隣にアンダースコア付きで置く。複数画面で使うものだけ上げる。

```
apps/frontend/
├── app/                      # ページ・レイアウト
├── clients.ts                # Hono RPC の呼び出し（リソースが増えたら clients/ へ分割）
├── auth-client.ts            # better-auth のブラウザクライアント
├── components/               # 複数ページで使う UI
├── hooks/                    # 複数ページで使うフック
├── shared/                   # 定数・薄いライブラリラップ・横断型
└── tests/                    # 画面を横断するテスト
```

### `app/` — ページ単位のコロケーション

```
app/
├── layout.tsx
├── page.tsx
├── globals.css
├── login/
│   ├── page.tsx
│   └── _hooks/
│       └── use-password-login.hook.ts
└── dashboard/
    ├── layout.tsx
    ├── page.tsx
    ├── _hooks/
    ├── _components/
    └── category/             # 機能が増えたらページ配下に切る
        ├── page.tsx
        ├── _hooks/
        ├── _components/
        └── _parts/
```

| 置き場 | 使うもの |
|--------|---------|
| `page.tsx` / `layout.tsx` | ルートに対応するページとレイアウト |
| `_hooks/` | そのページ専用フック。ファイル名は `use-*.hook.ts` |
| `_components/` | そのページ専用コンポーネント |
| `_parts/` | ページを薄くするための局所 UI。他ページへ持ち出さない |
| `app/` 直下の `components/` `hooks/` | 使わない。上げるならパッケージ直下の `components/` `hooks/` |

ページをまたぐ API 呼び出しは `clients.ts`（または `clients/{resource}/client.ts`）に `$` 付きで置く。ページ専用の薄いラップが必要なら、そのページディレクトリに `client.ts` を置いて `clients` を再エクスポートする。

### `clients` — API

バックエンドの `ApiType` を `hono/client` で使う。エンドポイントごとに関数を切り出し、Request / Response 型もここで export する。コンポーネントから `hc` を直接呼ばない。

### `shared/`

```
shared/
├── auth/                     # セッション表示など認証まわりの共有
├── hooks/
└── lib/                      # 定数、外部ライブラリの薄いラップ
```

ライブラリはページから生で広げず、必要なら `shared/lib` で一度包む。

---

## プロジェクトスキル（`.agents/skills/`）

| スキル | 参照するタイミング |
|---|---|
| `shadcn/` | shadcn/ui コンポーネントの追加・使い方・スタイリング |
| `migrate-radix-to-base/` | Radix UI → Base UI への移行 |
| `ux-design/` | 画面設計・UX・UIコピー・エラーメッセージ・フォーム設計 |

---

## UI コンポーネントライブラリ（`apps/frontend/components/`）

shadcn/ui（Base UI ベース、`style: "base-nova"`）を使う。プリミティブは `components/ui/` に、複合コンポーネントは `components/` 直下に置く。

### ブランドカラー

`app/globals.css` に CSS 変数として定義。コンポーネントで使うときは `style={{ color: "var(--brand)" }}` または Tailwind の `text-[var(--brand)]` で参照する。

```css
--brand: #e4001b;        /* メインカラー（赤） */
--brand-dark: #c0001a;   /* ホバー用 */
--brand-light: #fff0f0;  /* 背景薄赤 */
--brand-foreground: #fff;
```

### shadcn プリミティブ（`components/ui/`）

`pnpm dlx shadcn@latest add <name>` で追加する。現在インストール済みのもの:

| コンポーネント | 用途 |
|---|---|
| `button` | ボタン（Base UI `ButtonPrimitive` ベース。`asChild` は使えず、リンク化は `render={<Link href="..." />}` で行う） |
| `input` | テキスト入力 |
| `badge` | ラベル・タグ |
| `card` / `CardContent` | カードコンテナ |
| `separator` | 区切り線 |
| `tabs` | タブ切り替え |
| `accordion` / `AccordionItem` / `AccordionTrigger` / `AccordionContent` | 折りたたみ（Base UI ベース。`type="single"` や `collapsible` は不要） |
| `alert` | アラートボックス |
| `navigation-menu` | ナビゲーション |

### 複合コンポーネント（`components/`）

お名前.com ライクな UI を構成するための複合コンポーネント。新しいページを作るときはこれらを組み合わせて使う。

| ファイル | export | 主な props |
|---|---|---|
| `site-header.tsx` | `SiteHeader` | なし（ナビリンクは内部定義） |
| `site-footer.tsx` | `SiteFooter` | なし |
| `hero-search.tsx` | `HeroSearch` | `onSearch?: (query: string) => void` |
| `domain-search-result.tsx` | `DomainSearchResult`, `DomainResult` | `query`, `results: DomainResult[]`, `onAddCart?` |
| `feature-cards.tsx` | `FeatureCards` | なし（コンテンツ内部定義） |
| `domain-price-table.tsx` | `DomainPriceTable`, `TldPrice` | `prices: TldPrice[]`, `onSelect?` |
| `service-card-grid.tsx` | `ServiceCardGrid`, `ServiceItem` | `heading`, `items: ServiceItem[]` |
| `campaign-banner.tsx` | `CampaignBanner`, `CampaignBannerGrid` | `title`, `description`, `href`, `variant?: "red" \| "dark" \| "yellow"`, `badge?` |
| `faq-accordion.tsx` | `FaqAccordion`, `FaqItem` | `heading?`, `items: FaqItem[]` |
| `steps-guide.tsx` | `StepsGuide`, `Step` | `heading?`, `steps: Step[]` |
| `testimonial-cards.tsx` | `TestimonialCards`, `Testimonial` | `heading?`, `subheading?`, `items: Testimonial[]` |
| `news-list.tsx` | `NewsList`, `NewsItem` | `heading?`, `items: NewsItem[]`, `moreHref?` |
| `checkout-stepper.tsx` | `CheckoutStepper`, `CheckoutStep` | `steps?: CheckoutStep[]`（デフォルトは4ステップ。`status: "done" \| "current" \| "upcoming"`） |
| `option-add-card.tsx` | `OptionSection`, `OptionItem` | `heading?`, `items: OptionItem[]`（`onAdd?`, `onRemove?` コールバック付き） |
| `order-summary.tsx` | `OrderSummary`, `OrderDomain`, `OrderLineItem`, `UpsellItem` | `domains: OrderDomain[]`, `totalPrice`, `notes?`（upsellItems でアップセル枠も表示） |
| `checkout-auth-sidebar.tsx` | `CheckoutAuthSidebar` | `onRegister?`, `onLogin?`（初めての方/IDお持ちの方タブ切替付き） |

### コンポーネント設計の方針

- **データは `items` 配列で渡す**。静的コンテンツはコンポーネント内に持ち、動的データは props で受け取る
- **ロジックはコールバックで外から渡す**（`onSearch`, `onAddCart`, `onSelect` など）
- **外観の切り替えは `variant` prop**で行う
- shadcn の Button を Link として使う場合は `render={<Link href="..." />}` を使う（`asChild` は Base UI では使えない）

---

## ローカルで移管フローを試すとき

移管の状態遷移は backend の cron (`transfer-cron-poll`) がレジストリ側をポーリングして進める。**ローカル (`wrangler dev --test-scheduled`) では cron が自動発火しない**。以下を手で叩く必要がある。

```bash
# teama-2 が approve/reject した後や、20 分の自動承認後の反映を確認したいとき
curl http://localhost:8787/__scheduled
```

- 「申請したのに `/transfer` の一覧の状態が変わらない」「マイドメインにドメインが載らない」ときは、まず `__scheduled` を1回叩く
- frontend の自動ポーリング (issue #82) を実装するときも、ローカルでは開発者が backend の `__scheduled` を叩き続けないと本物の cron 挙動を再現できない
- teama-2 側の操作 (approve/reject など) は `apps/backend/scripts/transfer/` の各シェルが手順化している

---

## issue を立てるとき

GitHub の `gh` CLI で作る。作る前に、既存の似た issue を `gh issue list --search "..."` で必ず確認する（重複を作らない）。

### 優先度ラベル（必ず1つ付ける）

| ラベル | 意味 | 対応時間の目安 | 色 |
|---|---|---|---|
| `P0: critical` | 本番障害・データ破損・セキュリティ事故。全部止めて対応 | 即時 | `#B60205` |
| `P1: high` | 主要フローが壊れている／多数のユーザーに影響。回避策がない | 数日以内 | `#D93F0B` |
| `P2: medium` | 一部のユーザー・一部の操作で困る。回避策はある | スプリント内 | `#FBCA04` |
| `P3: low` | 改善提案・軽微なUI崩れ・nice to have | いつか | `#C2E0C6` |

判断が迷ったときの切り分け:

- **P0 か P1 か**: 「今この瞬間、本番のユーザーが困っているか」。すでに壊れている＝P0
- **P1 か P2 か**: 「回避策があるか」。逃げ道がないなら P1
- **P2 か P3 か**: 「今困っている人がいるか」。あった方が良いだけなら P3

運用ルール:

- **1 issue に優先度ラベルは1つだけ**。複数付けない
- **未ラベルの issue は P2 として扱う**（デフォルト）
- **P0 を付けたら即着手**。他の作業を止める
- 状況が変わったら貼り替えてよい

詳細は issue #62 参照。

### 本文の書き方

`gh issue create --title "..." --body "$(cat <<'EOF' ... EOF)"` の HEREDOC で渡す（改行・記号のエスケープを避けるため）。

本文は次の見出しで揃える:

```markdown
## 背景
なぜこれを解決したいか。ユーザー影響・きっかけ・関連 issue へのリンク。

## やること
具体的に何を変えるか。ファイル・関数・画面の名前で書く。

## 完了条件
- [ ] チェックボックスで、達成できたか判定可能な粒度で書く
- [ ] 「XXX が動く」ではなく「XXX を押すと YYY が表示される」
```

粒度の目安:

- タイトルは動詞で始める（「〜を追加」「〜を修正」「〜をリファクタ」）
- 完了条件は3〜7個。多すぎるなら分割、少なすぎるなら親 issue として書き直す
- 実装方針まで固まっているときだけ「## 実装メモ」を追加。決まっていないなら書かない（先に議論する）

### コマンド例

```bash
# 既存 issue の確認（重複防止）
gh issue list --search "検索 空き状況"

# 作成
gh issue create --title "検索結果に更新料の警告を出す" --label "P2: medium" --body "$(cat <<'EOF'
## 背景
...
## やること
...
## 完了条件
- [ ] ...
EOF
)"
```

- ラベルは `--label` で指定（作成後に `gh issue edit <n> --add-label` でも可）
- アサインは基本しない（拾える人が拾う）。特定の人に頼むときだけ `--assignee`
