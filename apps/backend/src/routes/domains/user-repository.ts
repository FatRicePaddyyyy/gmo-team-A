import { eq } from "drizzle-orm";
import type { DBClient } from "../../lib/db";
import { classifyDbError } from "../../lib/db-error";
import { user } from "../../lib/schema/auth-schema";
import type { Result } from "../../types/result";

type User = typeof user.$inferSelect;

// domains スライスからレジストリコンタクト作成用に user.name / user.email を引くための repository。
// 認証 (better-auth) の user テーブルを直接読むだけで書き込みはしない。
export class DomainUserRepository {
  static async findById({
    id,
    db,
  }: {
    id: string;
    db: DBClient;
  }): Promise<Result<User | null>> {
    try {
      const rows = await db.select().from(user).where(eq(user.id, id));
      return { success: true, data: rows[0] ?? null, error: null };
    } catch (error) {
      console.error("DomainUserRepository.findById error:", error);
      return { success: false, data: null, error: classifyDbError(error) };
    }
  }
}
