/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { deleteCategoryRouteHandler } from "./delete";
import { ProductRepository } from "./repository";

describe("deleteCategoryRouteHandler", () => {
  const mockEnv = {} as CloudflareBindings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("[正常系] 正常なリクエストでカテゴリが削除される", async () => {
    vi.spyOn(ProductRepository, "deleteCategory").mockResolvedValue({
      success: true,
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

  test("[異常系] Repositoryがエラーを返した場合", async () => {
    vi.spyOn(ProductRepository, "deleteCategory").mockResolvedValue({
      success: false,
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
      error: "カテゴリの削除に失敗しました",
    });
  });

  test("[異常系] Repositoryが例外を投げた場合", async () => {
    vi.spyOn(ProductRepository, "deleteCategory").mockRejectedValue(
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
