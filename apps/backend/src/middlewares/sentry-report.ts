import * as Sentry from "@sentry/cloudflare";
import type { MiddlewareHandler } from "hono";
import { captureExceptionWithTag } from "../lib/sentry";

// 500 応答および未捕捉例外を横断で Sentry に送るミドルウェア。
// - ハンドラが throw した場合 (未捕捉例外) はそのまま Sentry へ送って re-throw する。
//   (再スローしないと 500 レスポンス生成が消える)
// - ハンドラが c.json(..., 500) など 5xx で応答した場合も検知して Sentry に送る。
//   Service 層で Result 失敗を JSON 化しているケース (例外が飛ばないパス) を拾うため。
// flush は waitUntil に載せてレスポンス返却をブロックしない。
export const sentryReportMiddleware: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;

  try {
    await next();
  } catch (error) {
    captureExceptionWithTag(error, {
      kind: "unhandled_exception",
      method,
      path,
      userAgent: c.req.header("user-agent") ?? "",
      ip:
        c.req.header("cf-connecting-ip") ??
        c.req.header("x-forwarded-for") ??
        "",
    });
    c.executionCtx.waitUntil(Sentry.flush(2000));
    throw error;
  }

  if (c.res.status >= 500) {
    captureExceptionWithTag(
      new Error(`HTTP ${c.res.status} ${method} ${path}`),
      {
        kind: "http_5xx",
        status: String(c.res.status),
        method,
        path,
        userAgent: c.req.header("user-agent") ?? "",
        ip:
          c.req.header("cf-connecting-ip") ??
          c.req.header("x-forwarded-for") ??
          "",
      },
    );
    c.executionCtx.waitUntil(Sentry.flush(2000));
  }
};
