/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { deleteCategoryRouteHandler } from "./delete";
import { CategoryService } from "./service";

describe("deleteCategoryRouteHandler", () => {
  const mockEnv = {} as CloudflareBindings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("[正常系] 正常なリクエストでカテゴリが削除される", async () => {
    vi.spyOn(CategoryService, "delete").mockResolvedValue({
      success: true,
      error: null,
    });

    const res = await deleteCategoryRouteHandler.request(
      "/api/v1/secure/category/cat-123",
      {
        method: "DELETE",
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      error: null,
    });
  });

  test("[異常系] Serviceがエラーを返した場合", async () => {
    // B-A: repository は分類 code (db_error / unique_violation / fk_violation) を返し、
    // ハンドラ側 toUserMessage で日本語文言に変換する。spec もそれに追随する。
    vi.spyOn(CategoryService, "delete").mockResolvedValue({
      success: false,
      error: "db_error",
    });

    const res = await deleteCategoryRouteHandler.request(
      "/api/v1/secure/category/cat-999",
      {
        method: "DELETE",
      },
      mockEnv,
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      error: "データの取得または保存に失敗しました。しばらく待ってから再試行してください。",
    });
  });

  test("[異常系] Serviceが例外を投げた場合", async () => {
    vi.spyOn(CategoryService, "delete").mockRejectedValue(
      new Error("予期しないエラーが発生しました"),
    );

    const res = await deleteCategoryRouteHandler.request(
      "/api/v1/secure/category/cat-123",
      {
        method: "DELETE",
      },
      mockEnv,
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      error: "カテゴリの削除中にエラーが発生しました",
    });
  });
});
