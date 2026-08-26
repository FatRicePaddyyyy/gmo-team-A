/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getAllCategoriesAndProductsRouteHandler } from "./get";
import { ProductRepository } from "./repository";

describe("getAllCategoriesAndProductsRouteHandler", () => {
  const mockEnv = {} as CloudflareBindings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("[正常系] カテゴリとプロダクト一覧が取得される", async () => {
    const mockData = {
      categories: [
        {
          id: "cat-123",
          name: "家電",
          products: [
            {
              id: "prod-123",
              name: "スマートスピーカー",
              categoryId: "cat-123",
            },
          ],
        },
      ],
    };

    vi.spyOn(
      ProductRepository,
      "getAllCategoriesAndProducts",
    ).mockResolvedValue({
      success: true,
      data: mockData,
      error: null,
    });

    const res = await getAllCategoriesAndProductsRouteHandler.request(
      "/api/v1/secure/category",
      {
        method: "GET",
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: mockData,
      error: null,
    });
  });

  test("[正常系] カテゴリが0件でも成功する", async () => {
    vi.spyOn(
      ProductRepository,
      "getAllCategoriesAndProducts",
    ).mockResolvedValue({
      success: true,
      data: { categories: [] },
      error: null,
    });

    const res = await getAllCategoriesAndProductsRouteHandler.request(
      "/api/v1/secure/category",
      {
        method: "GET",
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: { categories: [] },
      error: null,
    });
  });

  test("[異常系] Repositoryがエラーを返した場合", async () => {
    // B-A: repository は分類 code (db_error / unique_violation / fk_violation) を返し、
    // ハンドラ側 toUserMessage で日本語文言に変換する。spec もそれに追随する。
    vi.spyOn(
      ProductRepository,
      "getAllCategoriesAndProducts",
    ).mockResolvedValue({
      success: false,
      data: null,
      error: "db_error",
    });

    const res = await getAllCategoriesAndProductsRouteHandler.request(
      "/api/v1/secure/category",
      {
        method: "GET",
      },
      mockEnv,
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      data: null,
      error: "データの取得または保存に失敗しました。しばらく待ってから再試行してください。",
    });
  });

  test("[異常系] Repositoryが例外を投げた場合", async () => {
    vi.spyOn(
      ProductRepository,
      "getAllCategoriesAndProducts",
    ).mockRejectedValue(new Error("予期しないエラーが発生しました"));

    const res = await getAllCategoriesAndProductsRouteHandler.request(
      "/api/v1/secure/category",
      {
        method: "GET",
      },
      mockEnv,
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      data: null,
      error: "カテゴリ・プロダクトの取得中にエラーが発生しました",
    });
  });
});
