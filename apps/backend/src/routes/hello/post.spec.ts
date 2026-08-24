/// <reference types="../../../worker-configuration" />
import { beforeEach, describe, expect, test, vi } from "vitest";
import { helloRouteHandler } from "./post";

describe("helloRouteHandler", () => {
  const mockEnv = {} as CloudflareBindings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("[正常系] テキストを返す", async () => {
    const res = await helloRouteHandler.request(
      "/api/v1/secure/hello",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "こんにちは",
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      message: "あなたはこんにちはと言いましたよ。\n ユーザーID: undefined",
    });
  });

  test("[異常系] バリデーションエラー（textが空文字列の場合）", async () => {
    const res = await helloRouteHandler.request(
      "/api/v1/secure/hello",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "",
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });

  test("[異常系] バリデーションエラー（textが長すぎる場合）", async () => {
    const res = await helloRouteHandler.request(
      "/api/v1/secure/hello",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "あ".repeat(251),
        }),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
  });
});
