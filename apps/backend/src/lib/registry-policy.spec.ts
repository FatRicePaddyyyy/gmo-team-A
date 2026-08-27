import { describe, expect, test } from "vitest";
import { isValidDomainLabels, isValidFqdn } from "./registry-policy";

// Issue #76: 入力バリデーションの出どころをここ 1 箇所に揃えたので、
// 「何を通して何を弾くか」もここで固定する。
describe("isValidFqdn", () => {
  test.each([
    "example.com",
    "manabi-blog.com",
    "sub.example.co.jp",
    "a.io",
  ])("[正常系] %s を通す", (name) => {
    expect(isValidFqdn(name)).toBe(true);
  });

  test.each([
    ["日本語.com", "IDN は punycode 変換が無くレジストリも拒否するのでサポート外"],
    ["example.コム", "TLD が非 ASCII"],
    ["example", "TLD が無い"],
    ["example.com.", "末尾ドット (root) は許可しない"],
    ["-example.com", "ラベル先頭のハイフン"],
    ["example-.com", "ラベル末尾のハイフン"],
    ["example..com", "連続ドット"],
    ["example.c", "TLD が 1 文字"],
    ["exam ple.com", "空白"],
  ])("[異常系] %s を弾く (%s)", (name) => {
    expect(isValidFqdn(name)).toBe(false);
  });

  test("[異常系] 253 文字を超える名前を弾く", () => {
    const longName = `${"a".repeat(250)}.com`;
    expect(longName.length).toBeGreaterThan(253);
    expect(isValidFqdn(longName)).toBe(false);
  });
});

// 検索窓は末尾 (TLD) をプルダウンで選ぶので、検証対象は TLD を除いた名前の部分。
describe("isValidDomainLabels", () => {
  test.each(["manabi-blog", "example", "sub.example"])(
    "[正常系] %s を通す",
    (name) => {
      expect(isValidDomainLabels(name)).toBe(true);
    },
  );

  test.each(["日本語", "-manabi", "manabi-", "manabi blog", ""])(
    "[異常系] %s を弾く",
    (name) => {
      expect(isValidDomainLabels(name)).toBe(false);
    },
  );
});
