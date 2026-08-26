import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// 親：カテゴリ（id, name のみ）
export const categories = sqliteTable("categories", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
    .notNull(),
  name: text("name").notNull(),
});

// 子：商品（id, name, categoryId のみ）
export const products = sqliteTable("products", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
    .notNull(),
  name: text("name").notNull(),
  categoryId: text("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "no action" }),
});

// リレーション（型安全な with 用）
export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));
export const productsRelations = relations(products, ({ one }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
}));

// ドメイン
export const domains = sqliteTable("domains", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("ok"),
  // ok / pendingDelete / pendingTransfer
  // clientDeleteProhibited 等はレジストリ側で管理。info で都度取得するため DB には持たない
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  authInfo: text("auth_info").notNull(),
  // Issue #24: 自動更新設定。true なら期限切れ前に自動 renew する（今回はフラグのみ、自動実行は別途 Cron で実装予定）
  autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(false),
  ownerUserId: text("owner_user_id").notNull()
    .references(() => user.id, { onDelete: "cascade" }),
}, (table) => [
  index("domains_owner_user_id_idx").on(table.ownerUserId),
]);

// 移管レコード
//
// gaining の表現が 2 系統ある:
//   (1) 自 backend の gaining ユーザーが /transfers を叩いて発生した pending
//        → gainingUserId が入る (user テーブルへの FK)
//   (2) 別レジストラ (cron poll で検知した外部 request) から発生した pending
//        → gainingUserId は null / gainingRegistrar にレジストラ ID 文字列が入る
// どちらか片方は必ず入る。両方入る or 両方 null は不整合。
export const transfers = sqliteTable("transfers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  domainId: text("domain_id").notNull()
    .references(() => domains.id, { onDelete: "restrict" }),
  // restrict: pendingTransfer 中のドメインは削除不可（cascade だと Queue consumer が参照できなくなる）
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("pendingTransfer"),
  // 取り得る値:
  //   - pendingTransfer: 申請直後・poll 待ち
  //   - clientApproved:  losing 側が承認 (approve エンドポイント経由)
  //   - clientRejected:  losing 側が拒否 (reject エンドポイント経由)
  //   - clientCancelled: gaining 側が取消 (cancel エンドポイント経由)
  //   - serverApproved:  レジストリが自動承認
  //   - expired:         poll 試行が上限超過して backend が諦めた (NB-10 対応)
  // 自 backend 発の pending の場合のみセット。cron 検知の外部 pending の場合は null。
  gainingUserId: text("gaining_user_id")
    .references(() => user.id),
  // cron が別レジストラから来た pending を保存するときのレジストラ ID (例: "teama-2")。
  // 自 backend 発の pending では null。
  gainingRegistrar: text("gaining_registrar"),
  // losingUserId は持たない。domains.ownerUserId が losing 相当
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
}, (table) => [
  index("transfers_domain_id_idx").on(table.domainId),
  index("transfers_gaining_user_id_idx").on(table.gainingUserId),
  // 同一ドメインに対して pendingTransfer が同時に 2 つ以上存在しないよう部分 UNIQUE 制約を張る。
  // SQLite の partial index で status='pendingTransfer' の行だけを対象にする。
  uniqueIndex("transfers_pending_domain_unique_idx")
    .on(table.domainId)
    .where(sql`${table.status} = 'pendingTransfer'`),
  // gainingUserId / gainingRegistrar のどちらか片方は必ず入る、という制約は
  // application 側 (service / repository) で担保する。DB CHECK 制約にしていた過去バージョンでは
  // drizzle-kit が SQLite 用に rebuild ("__new_transfers" 経由) を吐き、フレッシュ DB の
  // migration が「新列を旧テーブルから SELECT できない」で落ちる問題があったため。
]);

// 外部レジストラのドメインを自 backend の user が「取りに行く」申請。
//
// 既存 `transfers` テーブルは「自 backend の domains 行に対して発生した移管」用で、
// domainId (→ domains.id) を FK として必須にしている。
// 「別レジストラのドメインを取りに行く」ケースは、backend DB に domain 行が無いため
// このテーブルには入れられない (FK 違反)。そこで別テーブルとして分離する。
//
// フロー:
//   1. gaining user が /secure/transfers を叩く (対象は backend DB に無い外部ドメイン)
//   2. TransferService.request が本テーブルに status=pendingTransfer で INSERT
//      + registry に transferRequest(authInfo) を投げる
//   3. losing 側 (別レジストラ) が approve/reject する
//   4. cron が poll で承認/拒否メッセージを検知
//   5. 承認なら: domains 行を owner=gaining_user_id で新規 INSERT
//      + 本テーブル行を clientApproved / serverApproved に更新
//      拒否なら: 本テーブル行を clientRejected に更新 (domains は作らない)
export const outboundTransferRequests = sqliteTable("outbound_transfer_requests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  // 対象ドメイン名 (FQDN)。自 backend の domains テーブルには存在しないので domainId は持たない。
  domainName: text("domain_name").notNull(),
  registry: text("registry", { enum: ["kitaqsign", "kitaqnic"] }).notNull(),
  status: text("status").notNull().default("pendingTransfer"),
  // 取り得る値: pendingTransfer / clientApproved / serverApproved / clientRejected /
  //             clientCancelled / expired
  gainingUserId: text("gaining_user_id").notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // ユーザーが入力した authInfo。承認処理中の参照用に保存 (再送/デバッグ)。
  // 認証情報として使うのは registry.transferRequest 呼び出しの一回のみ。
  authInfo: text("auth_info").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
}, (table) => [
  index("outbound_transfer_requests_gaining_user_id_idx").on(table.gainingUserId),
  index("outbound_transfer_requests_domain_name_idx").on(table.domainName),
  // 同じドメインに対して同時に 2 つの pendingTransfer が存在しないよう partial UNIQUE 制約。
  uniqueIndex("outbound_transfer_requests_pending_unique_idx")
    .on(table.domainName, table.registry)
    .where(sql`${table.status} = 'pendingTransfer'`),
]);

export const domainsRelations = relations(domains, ({ one, many }) => ({
  owner: one(user, { fields: [domains.ownerUserId], references: [user.id] }),
  transfers: many(transfers),
}));

export const transfersRelations = relations(transfers, ({ one }) => ({
  domain: one(domains, { fields: [transfers.domainId], references: [domains.id] }),
  gainingUser: one(user, { fields: [transfers.gainingUserId], references: [user.id] }),
}));

export const outboundTransferRequestsRelations = relations(outboundTransferRequests, ({ one }) => ({
  gainingUser: one(user, { fields: [outboundTransferRequests.gainingUserId], references: [user.id] }),
}));
