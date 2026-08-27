import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc"; // ESLint の旧設定形式（.eslintrc）との互換性を提供
import typescriptParser from "@typescript-eslint/parser"; // TypeScript のコードを解析するためのパーサ
import unicorn from "eslint-plugin-unicorn"; // 便利な ESLint ルールを提供するプラグイン

// __filename と __dirname を ESM（ES Modules）で使用できるようにする
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FlatConfig を使って ESLint の設定を管理するための互換モジュールを初期化
const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Next.js の推奨 ESLint 設定を適用
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    files: ["**/*.ts", "**/*.tsx"], // TypeScript ファイルのみに適用する設定
    plugins: {
      unicorn: unicorn, // unicorn プラグイン（便利なコード規則を提供）
    },
    languageOptions: {
      parser: typescriptParser, // TypeScript のパーサを指定
      parserOptions: {
        projectService: {
          defaultProject: "./tsconfig.json", // frontendアプリのtsconfig.jsonを相対パスで指定
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // TypeScript の推奨ルールを適用（型チェックありの設定）
      // ...(typescript.configs?.["stylistic-type-checked"]?.rules ?? {}),
      "@typescript-eslint/no-explicit-any": "error",

      // TypeScript の追加ルール
      "@typescript-eslint/array-type": "off", // 配列の型の指定方法に関するルールを無効化
      // "@typescript-eslint/consistent-type-definitions": ["error", "type"], // 型定義を `interface` ではなく `type` に統一
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports", // 型の import は `import type { Foo } from "..."` に統一
          fixStyle: "inline-type-imports", // インラインの `type` import に統一
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ], // 未使用の変数を警告（ただし `_` で始まる変数は無視）
      "@typescript-eslint/require-await": "off", // `async` 関数に `await` がなくてもエラーにしない
      // "@typescript-eslint/no-misused-promises": [
      //   "error",
      //   {
      //     checksVoidReturn: { attributes: false }, // `void` の戻り値をチェックしない
      //   },
      // ],

      // JavaScript のコードスタイルに関するルール
      // "func-style": ["error", "declaration", { allowArrowFunctions: false }], // 関数は `function foo() {}` 形式に統一（`const foo = () => {}` を禁止）
      // "prefer-arrow-callback": ["error", { allowNamedFunctions: false }], // コールバック関数は `() => {}` を推奨し、名前付き関数は禁止
      "import/no-default-export": "error", // `export default` を禁止し、`export { foo }` の形式を推奨

      // ファイル名のkebab-case強制
      "unicorn/filename-case": [
        "error",
        {
          case: "kebabCase",
        },
      ],
    },
  },

  // 特定のファイルに対する ESLint のルールを変更
  {
    files: [
      "**/page.tsx", // Next.js の `page.tsx` ファイル
      "**/layout.tsx", // Next.js の `layout.tsx` ファイル
      "next.config.ts", // Next.js の設定ファイル
      "postcss.config.mjs", // PostCSS の設定ファイル
      "tailwind.config.ts", // Tailwind CSS の設定ファイル
      "**/global-error.tsx",
      "**/not-found.tsx", // Next.js の予約ファイル (default export 必須)
      "vite.config.ts",
    ],
    rules: {
      "import/no-default-export": "off", // 上記のファイルでは `export default` を許可
      "import/prefer-default-export": "error", // 逆に、デフォルトエクスポートを推奨
    },
  },

  // 無視するファイルやフォルダの設定
  {
    ignores: [
      "*.md", // Markdown ファイルも無視
      "**/.next/**", // より確実にNext.jsのビルドフォルダを無視
      "**/node_modules/**", // より確実にnode_modulesフォルダを無視
      "**/vitest.config.ts", // vitestの設定ファイルを無視
      "**/playwright.config*.ts", // playwrightの設定ファイルを無視
      "next.config.ts", // next.config.tsを無視
      "**/playwright-report/**",
      "**/.open-next/**",
      "**/.wrangler/**",
      "**/.vinext/**",
      "**/dist/**",
      "worker-configuration.d.ts",
    ],
  },
];

export default eslintConfig;
