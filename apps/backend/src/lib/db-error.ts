// DB (D1 / Drizzle) の catch ブロックで、raw error.message を service 層に漏らさず
// 安定したエラーコードに正規化するためのヘルパー。
//
// エラーコードは lib/error-messages.ts の map と対応させる。
//   - "unique_violation": UNIQUE 制約違反 (Drizzle D1 で "UNIQUE constraint failed" を含む)
//   - "fk_violation":     FK 制約違反 ("FOREIGN KEY constraint failed" を含む)
//   - "db_error":         その他の DB エラー
//
// 呼び出し側は返された code を Result.error にそのまま入れて service 層に返し、
// service 側で必要ならより意味のあるコードに再マップする (例: UNIQUE → transfer_already_pending)。

export type DbErrorCode = "unique_violation" | "fk_violation" | "db_error";

export function classifyDbError(error: unknown): DbErrorCode {
  if (!(error instanceof Error)) {return "db_error";}
  // D1 は生 SQL エラーを `.cause.message` (D1_ERROR: UNIQUE constraint failed: ...) に
  // 入れることがある。message だけ見ると "D1_ERROR" しか拾えず db_error に丸まってしまうので、
  // cause の chain も含めて文字列化してから判定する。
  const causeMsg = extractCauseMessage(error);
  const msg = `${error.message} ${causeMsg}`.toLowerCase();
  if (msg.includes("unique constraint")) {return "unique_violation";}
  if (msg.includes("foreign key constraint")) {return "fk_violation";}
  return "db_error";
}

// Error の cause は再帰的に Error のことがある。深追いしすぎないよう最大 3 段まで文字列化する。
function extractCauseMessage(error: unknown, depth = 0): string {
  if (depth > 3) {return "";}
  if (!(error instanceof Error)) {return "";}
  const cause: unknown = (error as Error & { cause?: unknown }).cause;
  if (cause === undefined || cause === null) {return "";}
  if (cause instanceof Error) {
    return `${cause.message} ${extractCauseMessage(cause, depth + 1)}`;
  }
  // 非 Error は string / number / boolean だけ拾う。オブジェクトを String() すると
  // "[object Object]" になって classifyDbError の判定に使えない。
  if (typeof cause === "string" || typeof cause === "number" || typeof cause === "boolean") {
    return String(cause);
  }
  return "";
}
