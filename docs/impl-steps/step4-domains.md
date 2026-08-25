# Step 3: domains エンドポイント

## 目的

check / create / info / renew / update / delete / restore / 一覧 の8操作を実装する。
全エンドポイントは `/api/v1/secure/*`（セッション認証）。

---

## 作業ファイル（新規作成）

```
apps/backend/src/routes/domains/
├── repository.ts               # DB操作（domains テーブル）
├── service.ts                  # ユースケース層
├── mapper.ts                   # DB行 → APIレスポンス変換
├── check/
│   └── post.ts                 # POST /api/v1/secure/domains/check
├── post.ts                     # POST /api/v1/secure/domains（create）
├── get.ts                      # GET  /api/v1/secure/domains（一覧）
├── [domain-id]/
│   ├── get.ts                  # GET  /api/v1/secure/domains/{id}
│   ├── renew/
│   │   └── post.ts             # POST /api/v1/secure/domains/{id}/renew
│   ├── put.ts                  # PUT  /api/v1/secure/domains/{id}
│   ├── delete.ts               # DELETE /api/v1/secure/domains/{id}
│   └── restore/
│       └── post.ts             # POST /api/v1/secure/domains/{id}/restore
```

---

## repository.ts

```ts
type Domain = typeof domains.$inferSelect;
type NewDomain = typeof domains.$inferInsert;

export class DomainRepository {
  static async findById(params: {
    id: string;
    env: CloudflareBindings;
  }): Promise<Result<Domain | null>>

  static async findByName(params: {
    name: string;
    env: CloudflareBindings;
  }): Promise<Result<Domain | null>>

  static async create(params: {
    data: NewDomain;  // authInfo を含む（service で crypto.randomUUID() 生成）
    env: CloudflareBindings;
  }): Promise<Result<Domain>>

  static async updateStatus(params: {
    id: string;
    status: string;
    env: CloudflareBindings;
  }): Promise<Result<void>>

  static async updateExpiresAt(params: {
    id: string;
    expiresAt: number;  // timestamp_ms
    env: CloudflareBindings;
  }): Promise<Result<void>>

  static async updateAuthInfo(params: {
    id: string;
    authInfo: string;
    env: CloudflareBindings;
  }): Promise<Result<void>>

  static async updateOwner(params: {
    id: string;
    newOwnerUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>>

  static async listByUserId(params: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<Domain[]>>
}
```

---

## service.ts

```ts
export class DomainService {
  static async check(input: {
    name: string;
    registry: Registry;
    env: CloudflareBindings;
  }): Promise<Result<{ avail: boolean }>>

  static async create(input: {
    name: string;
    registry: Registry;             // 必須（省略不可）
    period: { unit: "Y" | "M"; value: number };
    nameServers?: string[];
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>>
  // フロー:
  // 1. RegistryBridge.createContact({ registry, env }) → contactId
  // 2. authInfo = crypto.randomUUID()（service で生成）
  // 3. RegistryBridge.create({ domain: name, period, registrant: contactId, authInfo, nameservers, registry, env })
  // 4. result.code 1000 → DomainRepository.create({ name, registry, status: "ok", expiresAt: new Date(exDate).getTime(), createdAt: Date.now(), authInfo, ownerUserId: userId })
  // 5. DomainMapper.toResponse() で返却

  static async list(input: {
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse[]>>
  // フロー:
  // 1. DomainRepository.listByUserId({ userId, env })
  // 2. DomainMapper.toResponse() で各行を変換して返却

  static async info(input: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>>
  // フロー:
  // 1. DomainRepository.findById({ id: domainId, env })
  // 2. domain.ownerUserId !== userId → { success: false, error: "not_found" }
  // 3. RegistryBridge.info({ name: domain.name, registry: domain.registry, env })
  // 4. DB差分同期:
  //    - exDate（文字列）→ new Date(exDate).getTime()（timestamp_ms）に変換して updateExpiresAt
  //    - status[] の最初の値を updateStatus（レジストリ側が最新）
  // 5. 更新後の row を DomainMapper.toResponse() で返却

  static async renew(input: {
    domainId: string;
    period: { unit: "Y" | "M"; value: number };
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>>
  // フロー:
  // 1. DomainRepository.findById({ id: domainId, env })
  // 2. domain.ownerUserId !== userId → not_found
  // 3. domain.status === "pendingTransfer" → { success: false, error: "domain_pending_transfer" }
  // 4. curExpDate = new Date(domain.expiresAt).toISOString().split("T")[0]（timestamp_ms → "YYYY-MM-DD"）
  // 5. RegistryBridge.renew({ name: domain.name, curExpDate, period, registry: domain.registry, env })
  // 6. exDate（文字列）→ new Date(exDate).getTime() で updateExpiresAt
  // 7. DomainMapper.toResponse() で返却

  static async update(input: {
    domainId: string;
    nameServers?: string[];
    addStatuses?: string[];
    remStatuses?: string[];
    chg?: { registrant?: string; authInfo?: string };  // authInfo変更を含む
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>>
  // フロー:
  // 1. DomainRepository.findById
  // 2. ownerUserId !== userId → not_found
  // 3. domain.status === "pendingTransfer" → domain_pending_transfer
  // 4. add / rem / chg オブジェクトに変換:
  //    add = { nameservers: nameServers, statuses: addStatuses }
  //    rem = { statuses: remStatuses }
  //    chg = { ...chg }
  // 5. RegistryBridge.update({ name, add, rem, chg, registry, env })
  // 6. chg.authInfo があれば DomainRepository.updateAuthInfo で DB 同期
  // 7. DomainMapper.toResponse() で返却

  static async delete(input: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>>
  // フロー:
  // 1. DomainRepository.findById
  // 2. ownerUserId !== userId → not_found
  // 3. domain.status === "pendingTransfer" → domain_pending_transfer
  // 4. RegistryBridge.delete({ name: domain.name, registry: domain.registry, env })
  //    - "operation_prohibited"（2304）→ そのまま失敗 Result
  // 5. 成功 → DomainRepository.updateStatus({ id, status: "pendingDelete", env })
  // 6. DomainMapper.toResponse() で返却

  static async restore(input: {
    domainId: string;
    userId: string;
    env: CloudflareBindings;
  }): Promise<Result<DomainResponse>>
  // フロー:
  // 1. DomainRepository.findById
  // 2. ownerUserId !== userId → not_found
  // 3. RegistryBridge.restore({ name: domain.name, registry: domain.registry, env })
  //    - "operation_prohibited"（2304）→ 409
  //    - "forbidden"（403）→ 403
  // 4. 成功 → DomainRepository.updateStatus({ id, status: "ok", env })
  // 5. DomainMapper.toResponse() で返却
}
```

---

## 各エンドポイントの実装要点

### POST /api/v1/secure/domains/check
- リクエスト: `{ name: string, registry: "kitaqsign" | "kitaqnic" }`
- `DomainService.check()` → `{ name, avail }`
- HTTP 200（avail が false でも 200）

### POST /api/v1/secure/domains（create）
- リクエスト:
  ```ts
  {
    name: string,
    registry: z.enum(["kitaqsign", "kitaqnic"]),  // 必須
    period: { unit: z.enum(["Y", "M"]), value: z.number().min(1).max(10) },
    nameServers?: string[]
  }
  ```
- `DomainService.create()` → `201 Domain`
- エラー: 409（既存）/ 422（TLD違反）/ 404（contact不在）

### GET /api/v1/secure/domains（一覧）
- `DomainService.list()` → `200 Domain[]`

### GET /api/v1/secure/domains/{id}
- `DomainService.info()` → `200 Domain`
- レジストリ最新情報を都度 fetch して差分同期

### POST /api/v1/secure/domains/{id}/renew
- リクエスト: `{ period: { unit: z.enum(["Y", "M"]), value: z.number().min(1).max(10) } }`
- `DomainService.renew()` → `200 Domain`

### PUT /api/v1/secure/domains/{id}
- リクエスト:
  ```ts
  {
    nameServers?: string[],
    addStatuses?: string[],
    remStatuses?: string[],
    chg?: { registrant?: string; authInfo?: string }
  }
  ```
- **バリデーション**: addStatuses と remStatuses に同じ値が含まれていたら 400
- `DomainService.update()` → `200 Domain`

### DELETE /api/v1/secure/domains/{id}
- `DomainService.delete()` → `200 Domain`
- エラー: 409（clientDeleteProhibited / pendingTransfer）

### POST /api/v1/secure/domains/{id}/restore
- `DomainService.restore()` → `200 Domain`
- エラー: 409（Grace Period 終了）/ 403（権限なし）

---

## mapper.ts

```ts
type DomainRow = typeof domains.$inferSelect;

type DomainResponse = {
  id: string;
  name: string;
  registry: string;
  status: string;
  expiresAt: string;  // ISO 文字列
  createdAt: string;  // ISO 文字列
  ownerUserId: string;
  // authInfo はレスポンスに含めない
};

export class DomainMapper {
  static toResponse(row: DomainRow): DomainResponse {
    return {
      id: row.id,
      name: row.name,
      registry: row.registry,
      status: row.status,
      expiresAt: new Date(row.expiresAt).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
      ownerUserId: row.ownerUserId,
    };
  }
}
```

---

## `src/index.ts` への追加（このステップの最後）

```ts
import { checkDomainRouteHandler } from "./routes/domains/check/post";
import { createDomainRouteHandler } from "./routes/domains/post";
import { listDomainsRouteHandler } from "./routes/domains/get";
import { getDomainRouteHandler } from "./routes/domains/[domain-id]/get";
import { renewDomainRouteHandler } from "./routes/domains/[domain-id]/renew/post";
import { updateDomainRouteHandler } from "./routes/domains/[domain-id]/put";
import { deleteDomainRouteHandler } from "./routes/domains/[domain-id]/delete";
import { restoreDomainRouteHandler } from "./routes/domains/[domain-id]/restore/post";

export const routes = app
  // ... 既存
  .route("/", checkDomainRouteHandler)
  .route("/", createDomainRouteHandler)
  .route("/", listDomainsRouteHandler)
  .route("/", getDomainRouteHandler)
  .route("/", renewDomainRouteHandler)
  .route("/", updateDomainRouteHandler)
  .route("/", deleteDomainRouteHandler)
  .route("/", restoreDomainRouteHandler);
```

---

## 完了条件

- [ ] 8エンドポイント全て実装済み
- [ ] `pnpm tsc --noEmit` がエラーなし
- [ ] `wrangler dev` で check / create / info が curl で動作確認できる
