import type { Context, Next } from "hono";
import { auth } from "../lib/better-auth";
import { toUserMessage } from "../lib/error-messages";
import type { Variables } from "../types";

// 認証ミドルウェア。すべての /api/v1/secure/* に前段で挟まる。
// レスポンス形状はアプリ全体の ErrorSchema と揃える:
//   { success: false, data: null, error: "<日本語メッセージ>" }
// これにより frontend は認証エラーも一般のエラーと同じパーサで扱える。
export const authMiddleware = async (
  ctx: Context<{ Bindings: CloudflareBindings; Variables: Variables }>,
  next: Next,
) => {
  try {
    const sessionRes = await auth(ctx.env).api.getSession({
      headers: ctx.req.raw.headers,
    });

    if (!sessionRes?.user) {
      return ctx.json(
        { success: false as const, data: null, error: toUserMessage("session_expired") },
        401,
      );
    }

    ctx.set("userId", sessionRes.user.id);
    await next();
  } catch (e) {
    console.error("auth middleware error:", e);
    return ctx.json(
      { success: false as const, data: null, error: toUserMessage("auth_error") },
      401,
    );
  }
};
