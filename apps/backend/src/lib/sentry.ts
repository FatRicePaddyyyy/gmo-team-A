import * as Sentry from "@sentry/cloudflare";

// 例外に任意のタグ・コンテキストを添えて Sentry へ送る薄いラッパ。
// alert_policy=notify を必ず付けているのは、Sentry 側のアラートルールで
// "notify タグが付いた issue はメール通知する" 前提で運用しているため。
export function captureExceptionWithTag(
  error: unknown,
  properties: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    for (const [property, value] of Object.entries({
      ...properties,
      alert_policy: "notify",
    })) {
      if (typeof value === "string") {
        scope.setTag(property, value);
        continue;
      }
      scope.setContext(property, { value });
    }
    Sentry.captureException(error);
  });
}
