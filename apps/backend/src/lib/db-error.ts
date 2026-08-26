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
  const msg = error.message.toLowerCase();
  if (msg.includes("unique constraint")) {return "unique_violation";}
  if (msg.includes("foreign key constraint")) {return "fk_violation";}
  return "db_error";
}
