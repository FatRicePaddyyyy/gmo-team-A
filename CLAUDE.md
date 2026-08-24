# アーキテクチャ

pnpm workspace。アプリは `apps/frontend`（Web）と `apps/backend`（Hono API / Cloudflare Workers）の 2 つ。

フロントは Hono RPC でバックエンドを呼ぶ。DB アクセスはバックエンドだけが行う。

ディレクトリ名はケバブケース。テストは対象の隣に `*.spec.ts` を置く。

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
├── hello/
│   ├── post.ts
│   └── post.spec.ts
└── category/
    ├── get.ts                # GET /api/v1/secure/category
    ├── post.ts               # POST /api/v1/secret/category
    ├── delete.ts
    ├── repository.ts
    ├── get.spec.ts
    ├── post.spec.ts
    └── delete.spec.ts
```

ネストしたリソースの例:

```
src/routes/category/
├── get.ts
├── post.ts
├── repository.ts
└── [category-id]/
    ├── delete.ts
    ├── service.ts
    ├── repository.ts         # この階層専用。親の repository は import しない
    └── delete.spec.ts
```

| ファイル | 役割 |
|---------|------|
| `get.ts` / `post.ts` / `patch.ts` / `delete.ts` | ハンドラ。Zod + OpenAPI。Service を呼んで `ctx.json` するだけ |
| `service.ts` | ユースケース。複数の repository 呼び出しと `domains/` の判定を並べる。Drizzle は書かない |
| `mapper.ts` | DB 行 → API レスポンス形の変換（必要なときだけ） |
| `repository.ts` | Drizzle の insert / select / update / delete / count だけ |
| `*.spec.ts` | ハンドラへの `request()` による流しテスト。Repository / Service はモック |

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
└── schema/
    ├── index.ts              # 全スキーマをまとめて export
    ├── auth-schema.ts
    └── general-schema.ts
```

外部サービス（認証・オブジェクトストレージなど）のクライアントはここにラッパを置く。Drizzle のテーブル定義は `schema/` のみ。

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
