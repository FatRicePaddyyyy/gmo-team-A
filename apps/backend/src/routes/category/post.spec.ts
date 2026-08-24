/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createCategoryRouteHandler } from "./post";
import { ProductRepository } from "./repository";

describe("createCategoryRouteHandler", () => {
  const mockEnv = {} as CloudflareBindings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("[正常系] 正常なリクエストでカテゴリとプロダクトが作成される", async () => {
    const mockData = {
      category: {
        id: "cat-123",
        name: "家電",
      },
      products: [
        {
          id: "prod-123",
          name: "スマートスピーカー",
          categoryId: "cat-123",
        },
      ],
    };

    vi.spyOn(ProductRepository, "createCategoryAndProduct").mockResolvedValue({
      success: true,
      data: mockData,
      error: null,
    });

    const res = await createCategoryRouteHandler.request(
      "/api/v1/secret/category",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: { name: "家電" },
          products: [{ name: "スマートスピーカー" }],
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      data: mockData,
      error: null,
    });
  });

  test("[異常系] バリデーションエラー（category.nameが空文字列の場合）", async () => {
    const createSpy = vi.spyOn(ProductRepository, "createCategoryAndProduct");

    const res = await createCategoryRouteHandler.request(
      "/api/v1/secret/category",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: { name: "" },
          products: [{ name: "スマートスピーカー" }],
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("[異常系] バリデーションエラー（productsが空配列の場合）", async () => {
    const createSpy = vi.spyOn(ProductRepository, "createCategoryAndProduct");

    const res = await createCategoryRouteHandler.request(
      "/api/v1/secret/category",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: { name: "家電" },
          products: [],
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("[異常系] Repositoryがエラーを返した場合", async () => {
    vi.spyOn(ProductRepository, "createCategoryAndProduct").mockResolvedValue({
      success: false,
      data: null,
      error: "データベースエラーが発生しました",
    });

    const res = await createCategoryRouteHandler.request(
      "/api/v1/secret/category",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: { name: "家電" },
          products: [{ name: "スマートスピーカー" }],
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      data: null,
      error: "データベースエラーが発生しました",
    });
  });

  test("[異常系] Repositoryが例外を投げた場合", async () => {
    vi.spyOn(ProductRepository, "createCategoryAndProduct").mockRejectedValue(
      new Error("予期しないエラーが発生しました"),
    );

    const res = await createCategoryRouteHandler.request(
      "/api/v1/secret/category",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category: { name: "家電" },
          products: [{ name: "スマートスピーカー" }],
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      data: null,
      error: "プロダクトの作成中にエラーが発生しました",
    });
  });
});
