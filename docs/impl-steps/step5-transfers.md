# Step 4: transfers エンドポイント + Queue consumer

## 目的

移管IN申請（request）/ 承認（approve）/ 拒否（reject）/ 取消（cancel）の4操作と、
20分後に自動発火する Queue consumer を実装する。

---

## 作業ファイル（新規作成）

```
apps/backend/src/
├── routes/
│   ├── domains/
│   │   └── [domain-id]/
│   │       └── transfer/
│   │           ├── approve/
│   │           │   └── post.ts    # POST /api/v1/secure/domains/{id}/transfer/approve
│   │           └── reject/
│   │               └── post.ts    # POST /api/v1/secure/domains/{id}/transfer/reject
│   └── transfers/
│       ├── repository.ts
│       ├── service.ts
│       ├── post.ts                # POST /api/v1/secure/transfers（移管IN申請）
│       └── [transfer-id]/
│           └── cancel/
│               └── post.ts        # POST /api/v1/secure/transfers/{id}/cancel
├── types/
│   └── queue.ts                   # TransferPollMessage 型定義
└── scheduled/
    └── transfer-poll/
        ├── index.ts               # queue consumer エントリ
        ├── service.ts             # pollAndAck → DB更新
        └── repository.ts         # transfers / domains の status 更新
```

---

## types/queue.ts

```ts
export type TransferPollMessage = {
  transferId: string;
  // domainName / registry は transferId から DB JOIN で取得するため不要
};
```

---

## repository.ts（routes/transfers/）

```ts
type Transfer = typeof transfers.$inferSelect;
type NewTransfer = typeof transfers.$inferInsert;

export class TransferRepository {
  static async create(params: {
    data: NewTransfer;
    env: CloudflareBindings;
  }): Promise<Result<Transfer>>

  static async findById(params: {
    id: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer | null>>

  static async findByDomainId(params: {
    domainId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer | null>>

  static async updateStatus(params: {
    id: string;
    status: string;
    env: CloudflareBindings;
  }): Promise<Result<void>>
}
```

---

## service.ts（routes/transfers/）

```ts
export class TransferService {
  static async request(input: {
    name: string;            // ドメイン名（FQDN）
    authInfo: string;
    registry: Registry;
    gainingUserId: string;
    env: CloudflareBindings;
  }): Promise<Result<Transfer>>
  // フロー:
  // 1. DomainRepository.findByName({ name, env }) → domainId 取得
  //    → 不在なら { success: false, error: "domain_not_found" }
  // 2. RegistryBridge.transferRequest({ name, authInfo, registry, env })
  //    → authInfo_mismatch → 409
  //    → domain_not_found → 404
  // 3. 成功（code 1001）→ TransferRepository.create({ data: { domainId, registry, status: "pendingTransfer", gainingUserId }, env })
  // 4. DomainRepository.updateStatus({ id: domainId, status: "pendingTransfer", env })
  // 5. env.TRANSFER_QUEUE.send({ transferId: transfer.id }, { delaySeconds: 1200 })
  // 6. Transfer を返す

  static async approve(input: {
    domainId: string;
    userId: string;           // domains.ownerUserId と一致する必要あり（losing側）
    env: CloudflareBindings;
  }): Promise<Result<void>>
  // フロー:
  // 1. DomainRepository.findById({ id: domainId, env })
  //    → domain.ownerUserId !== userId → 403
  // 2. RegistryBridge.transferApprove({ name: domain.name, registry, env })
  //    → forbidden → 403 / transfer_not_found → 409
  // 3. 成功 → DB更新は Queue consumer が担当（approveのみ非同期）

  static async reject(input: {
    domainId: string;
    userId: string;           // domains.ownerUserId と一致する必要あり（losing側）
    env: CloudflareBindings;
  }): Promise<Result<void>>
  // フロー:
  // 1. DomainRepository.findById({ id: domainId, env })
  //    → domain.ownerUserId !== userId → 403
  // 2. RegistryBridge.transferReject({ name: domain.name, registry, env })
  //    → forbidden → 403 / transfer_not_found → 409
  // 3. 成功 → 同期的にDB更新（rejectは確定操作）
  //    TransferRepository.findByDomainId → updateStatus("clientRejected")
  //    DomainRepository.updateStatus({ status: "ok" })

  static async cancel(input: {
    transferId: string;
    userId: string;           // transfers.gainingUserId と一致する必要あり
    env: CloudflareBindings;
  }): Promise<Result<void>>
  // フロー:
  // 1. TransferRepository.findById({ id: transferId, env })
  //    → transfer.gainingUserId !== userId → 403
  //    → transfer.status !== "pendingTransfer" → 409
  // 2. DomainRepository.findById({ id: transfer.domainId, env }) → name / registry 取得
  // 3. RegistryBridge.transferCancel({ name, registry, env })
  //    → forbidden → 403 / transfer_not_found → 409
  // 4. TransferRepository.updateStatus({ id: transferId, status: "clientCancelled" })
  // 5. DomainRepository.updateStatus({ id: transfer.domainId, status: "ok" })
}
```

---

## Queue consumer（scheduled/transfer-poll/）

### index.ts（エントリポイント）

```ts
import type { TransferPollMessage } from "../../types/queue";

export async function handleTransferPollQueue(
  batch: MessageBatch<TransferPollMessage>,
  env: CloudflareBindings,
): Promise<void> {
  for (const message of batch.messages) {
    const result = await TransferPollService.process({ transferId: message.body.transferId, env });
    if (result.success) {
      message.ack();
    } else {
      message.retry();
    }
  }
}
```

### service.ts

```ts
export class TransferPollService {
  static async process({ transferId, env }: {
    transferId: string;
    env: CloudflareBindings;
  }): Promise<Result<void>> {
    // 1. transferId → transfer → domain 取得
    const transferResult = await TransferPollRepository.findTransferById({ id: transferId, env });
    if (!transferResult.success || !transferResult.data) {
      return { success: false, data: null, error: "transfer_not_found" };
    }
    const transfer = transferResult.data;

    const domainResult = await TransferPollRepository.findDomainById({ id: transfer.domainId, env });
    if (!domainResult.success || !domainResult.data) {
      return { success: false, data: null, error: "domain_not_found" };
    }
    const domain = domainResult.data;

    // 2. RegistryBridge.pollAndAck でメッセージ取得
    const pollResult = await RegistryBridge.pollAndAck({
      registry: transfer.registry as Registry,
      env,
    });
    if (!pollResult.success) return pollResult;
    if (!pollResult.data) {
      // メッセージなし（20分後に自動承認済みか、まだ未処理）→ 正常終了
      return { success: true, data: undefined, error: null };
    }

    const pollMessage = pollResult.data;

    // 3. PollMessage の domain 名で「このtransferのメッセージか」判定
    if (pollMessage.content.domain && pollMessage.content.domain !== domain.name) {
      // 別のtransferのメッセージが来た → ack済みなので再投入はできないがログを残す
      console.warn(`Poll message domain mismatch: expected ${domain.name}, got ${pollMessage.content.domain}`);
      return { success: true, data: undefined, error: null };
    }

    // 4. status に応じてDB更新
    const status = pollMessage.content.status;

    if (status === "serverApproved" || status === "clientApproved") {
      await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
      await TransferPollRepository.updateDomainOwner({
        id: transfer.domainId,
        newOwnerUserId: transfer.gainingUserId,
        env,
      });
      await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
    } else if (status === "clientRejected" || status === "clientCancelled") {
      await TransferPollRepository.updateTransferStatus({ id: transferId, status, env });
      await TransferPollRepository.updateDomainStatus({ id: transfer.domainId, status: "ok", env });
    }

    return { success: true, data: undefined, error: null };
  }
}
```

### repository.ts（scheduled/transfer-poll/）

```ts
export class TransferPollRepository {
  static async findTransferById(params: { id: string; env: CloudflareBindings }): Promise<Result<Transfer | null>>
  static async findDomainById(params: { id: string; env: CloudflareBindings }): Promise<Result<Domain | null>>
  static async updateTransferStatus(params: { id: string; status: string; env: CloudflareBindings }): Promise<Result<void>>
  static async updateDomainOwner(params: { id: string; newOwnerUserId: string; env: CloudflareBindings }): Promise<Result<void>>
  static async updateDomainStatus(params: { id: string; status: string; env: CloudflareBindings }): Promise<Result<void>>
}
```

---

## wrangler.jsonc への追加

```jsonc
{
  // ...既存設定...
  "queues": {
    "producers": [
      { "binding": "TRANSFER_QUEUE", "queue": "transfer-poll" }
    ],
    "consumers": [
      {
        "queue": "transfer-poll",
        "max_retries": 3,
        "dead_letter_queue": "transfer-poll-dlq"
      }
    ]
  }
}
```

追加後に必ず実行:
```bash
npx wrangler types --env-interface CloudflareBindings
```

→ `TRANSFER_QUEUE: Queue<unknown>` が `CloudflareBindings` に自動追加される。

---

## src/index.ts の変更

Queue consumer を使うために `export default` を変更する:

```ts
import { handleTransferPollQueue } from "./scheduled/transfer-poll";
import type { TransferPollMessage } from "./types/queue";

// export default routes; を以下に変更
export default {
  fetch: routes.fetch,
  async queue(batch: MessageBatch<TransferPollMessage>, env: CloudflareBindings): Promise<void> {
    await handleTransferPollQueue(batch, env);
  },
};
```

---

## src/index.ts へのルート追加

```ts
import { requestTransferRouteHandler } from "./routes/transfers/post";
import { cancelTransferRouteHandler } from "./routes/transfers/[transfer-id]/cancel/post";
import { approveTransferRouteHandler } from "./routes/domains/[domain-id]/transfer/approve/post";
import { rejectTransferRouteHandler } from "./routes/domains/[domain-id]/transfer/reject/post";

export const routes = app
  // ...既存...
  .route("/", requestTransferRouteHandler)
  .route("/", cancelTransferRouteHandler)
  .route("/", approveTransferRouteHandler)
  .route("/", rejectTransferRouteHandler);
```

---

## Cloudflare に Queue を作成（MCP）

```
mcp__cloudflare__queue_create("transfer-poll")
mcp__cloudflare__queue_create("transfer-poll-dlq")
```

---

## 完了条件

- [ ] `types/queue.ts` に `TransferPollMessage` 定義済み
- [ ] `routes/transfers/` の4ファイル実装済み
- [ ] `routes/domains/[domain-id]/transfer/approve|reject/post.ts` 実装済み
- [ ] `scheduled/transfer-poll/` の3ファイル実装済み
- [ ] `wrangler.jsonc` に `queues` 設定追加済み
- [ ] `npx wrangler types` を実行して `TRANSFER_QUEUE` が `CloudflareBindings` に追加済み
- [ ] `src/index.ts` の `export default` を `{ fetch, queue }` 形式に変更済み
- [ ] Cloudflare に `transfer-poll` / `transfer-poll-dlq` Queue を作成済み
- [ ] `pnpm tsc --noEmit` がエラーなし
