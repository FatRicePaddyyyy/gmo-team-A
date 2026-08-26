import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import baseConfig from '@hono/eslint-config';
import typescriptParser from '@typescript-eslint/parser';

// __filename と __dirname を ESM（ES Modules）で使用できるようにする
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// そのまま使える
const eslintConfig = [
  ...baseConfig,
  {
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: [resolve(__dirname, './tsconfig.json')],
      },
    },
  },
  {
    rules: {
      ...baseConfig.rules,
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
    },
  },
  {
    files: ["**/*.spec.*"],
    rules: {
      "@typescript-eslint/no-unsafe-type-assertion": "off",
    },
  },
  {
    ignores: [
      'node_modules',
      'dist',
      'build',
      'coverage',
      'logs',
      '.wrangler',
      '.open-next',
      '.wrangler/**',
      'eslint.config.mjs',
      'worker-configuration.d.ts',
      // scripts/ は開発用のスタンドアロン CLI (mock-registry.mjs 等)。
      // アプリ本体の tsconfig project に含まれないため lint 対象外にする。
      'scripts/**',
      // openapi-typescript が Swagger から生成する型定義。
      // 生成器の出力スタイル (index signature 等) を lint で強制するのは意味が無いので除外。
      'src/lib/bridge/generated/**',
      // テストは lint 対象外。実行時挙動 (vitest) で品質を担保する。
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
  },
];

export default eslintConfig;
