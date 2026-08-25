# Step 2: BRIDGE 層

## 目的

Kitaqsign / Kitaqnic へのレジストリ呼び出しを1クラスに集約する。
レジストリごとのホスト・Poll/Ack パスの差分をここで吸収し、上位層（service）はレジストリを意識しない。

---

## 作業ファイル

- `apps/backend/src/lib/bridge/types.ts` — レジストリ API の型定義（新規作成）
- `apps/backend/src/lib/bridge/index.ts` — `RegistryBridge` 静的クラス（新規作成）

---

## types.ts

```ts
export type Registry = "kitaqsign" | "kitaqnic";

export type EppResult = { code: number; message: string };
export type TrId = { clTRID?: string; svTRID: string };

export type EppEnvelope<T> = {
  result: EppResult;
  resData: T;
  trID: TrId;
};

// delete / restore / approve / reject / cancel のように resData が空の操作に使う
export type EmptyResData = Record<string, never>;

export type DomainCheckResult = { name: string; avail: boolean; reason?: string };
export type DomainCheckResponse = { results: DomainCheckResult[] };

export type DomainCreateResponse = { domain: string; crDate: string; exDate: string };

export type DomainResponse = {
  domain: string;
  status: string[];
  registrant: string;
  contacts: Record<string, string>;
  nameservers: string[];
  period?: { unit: string; value: number };
  crDate: string;
  upDate?: string | null;
  exDate: string;
  trDate?: string | null;
  rgpStatus: string[];
};

export type DomainRenewResponse = { domain: string; exDate: string };

export type DomainTransferResponse = {
  domain: string;
  status: string;
  gainingRegistrar: string;
  losingRegistrar: string;
};

// content は status / domain を含む可能性あり。型安全に取り出せるよう具体化
export type PollMessage = {
  id: string;
  type: string;
  content: {
    domain?: string;
    status?: string;
    [key: string]: unknown;
  };
};
```

---

## index.ts — RegistryBridge

### ベースURL・認証ヘッダ

```ts
private static baseUrl(registry: Registry, env: CloudflareBindings): string {
  return registry === "kitaqsign" ? env.KITAQSIGN_BASE_URL : env.KITAQNIC_BASE_URL;
}

// レジストリごとに認証情報が異なる。X-Cl-TRID は毎リクエストで自動生成する
private static authHeaders(registry: Registry, env: CloudflareBindings): HeadersInit {
  const user = registry === "kitaqsign" ? env.KITAQSIGN_BASIC_USER : env.KITAQNIC_BASIC_USER;
  const pass = registry === "kitaqsign" ? env.KITAQSIGN_BASIC_PASS : env.KITAQNIC_BASIC_PASS;
  const registrarId = registry === "kitaqsign" ? env.KITAQSIGN_REGISTRAR_ID : env.KITAQNIC_REGISTRAR_ID;
  const apiKey = registry === "kitaqsign" ? env.KITAQSIGN_API_KEY : env.KITAQNIC_API_KEY;
  return {
    "Authorization": `Basic ${btoa(`${user}:${pass}`)}`,
    "X-Registrar-Id": registrarId,
    "X-Api-Key": apiKey,
    "X-Cl-TRID": `CLI-${crypto.randomUUID()}`,  // 毎リクエストでユニーク生成
    "Content-Type": "application/json",
  };
}
```

### メソッド一覧と戻り値型

全メソッドの引数はオブジェクト形式（後から引数を追加しやすくするため）。

| メソッド | 呼び出し先 | 戻り値型 |
|---------|-----------|---------|
| `check({ name, registry, env })` | `POST /api/v1/epp/domains/check` | `Result<DomainCheckResponse>` |
| `createContact({ registry, env })` | `POST /api/v1/epp/contacts` | `Result<{ contactId: string }>` |
| `create({ domain, period, registrant, authInfo, nameservers?, registry, env })` | `POST /api/v1/epp/domains` | `Result<DomainCreateResponse>` |
| `info({ name, registry, env })` | `GET /api/v1/epp/domains/{name}` | `Result<DomainResponse>` |
| `renew({ name, curExpDate, period, registry, env })` | `POST /api/v1/epp/domains/{name}/renew` | `Result<DomainRenewResponse>` |
| `update({ name, add?, rem?, chg?, registry, env })` | `PUT /api/v1/epp/domains/{name}` | `Result<EmptyResData>` |
| `delete({ name, registry, env })` | `DELETE /api/v1/epp/domains/{name}` | `Result<EmptyResData>` |
| `restore({ name, registry, env })` | `POST /api/v1/epp/domains/{name}/restore` | `Result<EmptyResData>` |
| `transferRequest({ name, authInfo, registry, env })` | `POST /api/v1/epp/domains/{name}/transfer/request` | `Result<DomainTransferResponse>` |
| `transferApprove({ name, registry, env })` | `POST /api/v1/epp/domains/{name}/transfer/approve` | `Result<EmptyResData>` |
| `transferReject({ name, registry, env })` | `POST /api/v1/epp/domains/{name}/transfer/reject` | `Result<EmptyResData>` |
| `transferCancel({ name, registry, env })` | `POST /api/v1/epp/domains/{name}/transfer/cancel` | `Result<EmptyResData>` |
| `pollAndAck({ registry, env })` | Poll取得 + Ack | `Result<PollMessage \| null>` |

### Poll/Ack パス差分

```ts
// kitaqsign
GET  /api/v1/epp/messages/poll
POST /api/v1/epp/messages/{id}/ack

// kitaqnic
GET    /api/v1/epp/messages
DELETE /api/v1/epp/messages/{id}
```

### createContact のダミー情報

レジストリが contact 作成に必要とする最低限のダミー値をハードコードする。
レスポンスから `contactId`（または `contact.id`）を取り出して返す。
HTTP 200 / 201 どちらも成功とみなす（Kitaqsign=201 / Kitaqnic=200）。

```ts
// リクエストボディ例
{
  name: "System Contact",
  email: "noreply@example.com",
}
```

---

### エラーハンドリング方針

- `fetch` を `try/catch` で囲み、ネットワークエラーは `Result` 失敗で返す
- 原則: **HTTP ステータスと result.code の二段判定**
- `HTTP 200` でも `result.code !== 1000`（かつ非同期の 1001 でもない）なら失敗 Result を返す

#### 操作別エラーマッピング

| 操作 | HTTPステータス | 意味 | BRIDGEの返し方 |
|------|--------------|------|--------------|
| create | 201 + code 1000 | 成功 | `{ success: true, data: DomainCreateResponse }` |
| create | 409 | ドメイン既存 | `{ success: false, error: "domain_exists" }` |
| create | 422 | TLD/IDN違反 | `{ success: false, error: "invalid_tld" }` |
| create | 404 | contact不在 | `{ success: false, error: "contact_not_found" }` |
| transfer request | 202 + code 1001 | 非同期受付 | `{ success: true, data: DomainTransferResponse }` |
| transfer request | 200 + code 2202 (KS) / 401 (KN) | authInfo不一致 | `{ success: false, error: "authInfo_mismatch" }` |
| delete / restore | 200 + code 2304 | 操作不可 | `{ success: false, error: "operation_prohibited" }` |
| 全操作 | 404 + code 2303 | ドメイン不在 | `{ success: false, error: "domain_not_found" }` |
| 全操作 | ネットワークエラー | fetch失敗 | `{ success: false, error: "network_error" }` |

#### pollAndAck の動作

1. `GET /messages/poll`（KS）または `GET /messages`（KN）でメッセージを取得
2. メッセージなし（空レスポンス）の場合は `{ success: true, data: null }` を返す
3. メッセージあり → `POST /messages/{id}/ack`（KS）または `DELETE /messages/{id}`（KN）で消し込む
4. Ack 成功後に `{ success: true, data: PollMessage }` を返す
5. Ack 失敗した場合はメッセージをそのまま返さず `{ success: false, error: "ack_failed" }` にする（次回 consumer でリトライ可能）

---

## 完了条件

- [ ] `src/lib/bridge/types.ts` 作成済み
- [ ] `src/lib/bridge/index.ts` の `RegistryBridge` クラス全メソッド実装済み
- [ ] `pnpm tsc --noEmit` がエラーなし
