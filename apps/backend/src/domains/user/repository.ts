import { eq } from "drizzle-orm";
import { createDBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { user } from "../../lib/schema/auth-schema";
import type { Result } from "../../types/result";

// S-H: transfer-poll と transfer-poll-dlq で重複していた userExists を集約する共通 repository。
// CLAUDE.md ルールに従い、複数スライスで参照される横断ロジックは src/domains/ 配下に置く。
export class UserRepository {
  static async exists({
    id,
    env,
  }: {
    id: string;
    env: CloudflareBindings;
  }): Promise<Result<boolean>> {
    try {
      const db = createDBClient(env);
      const rows = await db.select({ id: user.id }).from(user).where(eq(user.id, id));
      return { success: true, data: rows.length > 0, error: null };
    } catch (error) {
      console.error("UserRepository.exists error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
