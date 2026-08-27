import { describe, expect, test } from "vitest";
import { classifyDbError } from "./db-error";

describe("classifyDbError", () => {
  test("非 Error は db_error", () => {
    expect(classifyDbError("string")).toBe("db_error");
    expect(classifyDbError(null)).toBe("db_error");
    expect(classifyDbError({ message: "unique constraint" })).toBe("db_error");
  });

  test("message に UNIQUE constraint が含まれれば unique_violation", () => {
    const e = new Error("UNIQUE constraint failed: transfers_pending_domain_unique_idx");
    expect(classifyDbError(e)).toBe("unique_violation");
  });

  test("message に FOREIGN KEY constraint が含まれれば fk_violation", () => {
    const e = new Error("FOREIGN KEY constraint failed");
    expect(classifyDbError(e)).toBe("fk_violation");
  });

  test("D1 が実際に返す 'D1_ERROR' + cause に生 SQL エラー を持つケース → unique_violation", () => {
    // 実測 (Cloudflare D1 経由 Drizzle): Error.message は "D1_ERROR" までしか入っておらず、
    // 実際の SQL エラー ("UNIQUE constraint failed: ...") は cause 側に入っている。
    // これを拾えないと重複 insert が db_error 扱いになり、409 相当ではなく 500 になる。
    const cause = new Error("UNIQUE constraint failed: outbound_transfer_requests_pending_unique_idx");
    const wrapped = new Error("D1_ERROR", { cause });
    expect(classifyDbError(wrapped)).toBe("unique_violation");
  });

  test("cause がさらにネストしていても最大 3 段まで辿る", () => {
    const inner = new Error("UNIQUE constraint failed: foo");
    const mid = new Error("wrapped", { cause: inner });
    const outer = new Error("D1_ERROR", { cause: mid });
    expect(classifyDbError(outer)).toBe("unique_violation");
  });

  test("該当なしのメッセージは db_error", () => {
    expect(classifyDbError(new Error("something else"))).toBe("db_error");
  });
});
