import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs from "sql.js";
import { schema } from "./src/lib/schema"

const SQL = await initSqlJs();
const sqlite = new SQL.Database();
const db = drizzle(sqlite, { schema });

export const auth = betterAuth({
    basePath: "/api/v1/auth",
    emailAndPassword: {
      enabled: true,
    },
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    plugins: [admin()],
  });