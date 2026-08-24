---
name: gmo-domain
description: >
  GMOハッカソン用・疑似レジストラ開発スキル。
  EPP-over-REST API（Kitaqsign / Kitaqnic）を使った
  ドメインの廃止・復旧・移管の実装、APIエンドポイントの確認、
  フロー設計、エラーハンドリングに関する作業で必ず参照すること。
  「delete」「restore」「transfer」「移管」「廃止」「復旧」「RGP」「EPP」
  「Kitaqsign」「Kitaqnic」「レジストリ」などのキーワードが出たら積極的に使用する。
---

# GMO ハッカソン：疑似レジストラ開発スキル

このプロジェクトは、2つの疑似レジストリ（Kitaqsign / Kitaqnic）の
EPP-over-REST API を呼び出す疑似レジストラサービスを開発するハッカソン。

---

## レジストリ情報

| レジストリ | 対応TLD | Swagger UI |
|-----------|---------|------------|
| Kitaqsign | .com .net .org .info | https://docs.kitaqsign.com/swagger-ui/index.html |
| Kitaqnic  | （Swagger参照） | https://docs.kitaqnic.com/swagger-ui/index.html |

---

## 共通認証ヘッダ（全リクエスト必須）

| ヘッダ | 必須 | 説明 |
|--------|------|------|
| `Authorization` | 必須 | Basic 認証（共通ゲート） |
| `X-Registrar-Id` | 必須 | レジストラID |
| `X-Api-Key` | 必須 | APIキー |
| `X-Cl-TRID` | 任意 | クライアントトランザクションID（リクエストごとに一意推奨。障害調査時の突合キー） |

---

## EPP エンドポイント一覧

### ドメイン廃止 (domain:delete)

```
DELETE /api/v1/epp/domains/{name}
```

- 実行後、ドメインは `pendingDelete` ステータスへ移行
- Grace Period 中は `restore` で復旧可能
- `clientDeleteProhibited` が付いている場合は `result.code: 2304` が返る

### ドメイン復旧 (domain:restore / RGP)

```
POST /api/v1/epp/domains/{name}/restore
```

- `pendingDelete` 状態のドメインのみ復旧可能（それ以外は `2304`）
- sponsoring registrar のみ実行可能（それ以外は `403`）
- 復旧後のステータスは `ok`

### 移管申請 (domain:transfer request)

```
POST /api/v1/epp/domains/{name}/transfer/request
```

- gaining registrar（移管先）が実行
- リクエストボディに `authInfo`（移管パスフレーズ）が必須
- 申請後、ドメインは `pendingTransfer` へ移行
- authInfo 不一致の場合は `result.code: 2202`

### 移管承認 (domain:transfer approve)

```
POST /api/v1/epp/domains/{name}/transfer/approve
```

- losing registrar（移管元）のみ実行可能（それ以外は `403`）
- 承認後、スポンサーレジストラが gaining に切り替わる

### 移管拒否 (domain:transfer reject)

```
POST /api/v1/epp/domains/{name}/transfer/reject
```

- losing registrar のみ実行可能
- 拒否後、ドメインは元の状態に戻る

### 移管取消 (domain:transfer cancel)

```
POST /api/v1/epp/domains/{name}/transfer/cancel
```

- gaining registrar のみ実行可能（承認前のみ）

---

## Poll（非同期通知）エンドポイント

**⚠️ Kitaqsign と Kitaqnic でエンドポイントが異なる**

| 操作 | Kitaqsign | Kitaqnic |
|------|-----------|----------|
| Poll取得 | `GET /api/v1/epp/messages/poll` | `GET /api/v1/epp/messages` |
| Ack（消し込み） | `POST /api/v1/epp/messages/{id}/ack` | `POST /api/v1/epp/messages/{id}` |

- Poll は FIFO。常に最古の未 ack メッセージを1件返す
- **ack しないと次のメッセージを受け取れない**
- 移管申請の通知は losing 側の Poll に積まれる

---

## result.code 一覧

| code | 意味 |
|------|------|
| 1000 | 成功 |
| 1001 | 成功（非同期処理中） |
| 2202 | authInfo 不一致 |
| 2303 | ドメイン/オブジェクト不在 |
| 2304 | ステータスにより操作不可 |
| 2306 | ポリシー違反 |

---

## ドメインステータス

| ステータス | 意味 |
|-----------|------|
| `ok` | 正常稼働中 |
| `pendingDelete` | 廃止済み・Grace Period 中（restore 可能） |
| `pendingTransfer` | 移管申請中（losing の承認待ち） |
| `clientDeleteProhibited` | 廃止禁止（update で設定） |
| `clientTransferProhibited` | 移管禁止（update で設定） |

---

## 移管の重要ルール

- 移管は**非同期**処理。通知は Poll で受け取り ack で消し込む
- losing が **20分以内に無応答** の場合、サーバが自動承認（本来は5日間、ハッカソン短縮）
- authInfo（移管パスフレーズ）による本人確認が必須
- ハッカソンでは「登録後60日以内の移管禁止」はレジストラ側対応不要

---

## レスポンス共通形式

```json
{
  "result": { "code": 1000, "message": "Command completed successfully" },
  "resData": {},
  "trID": {
    "clTRID": "CLI-20260824-0001",
    "svTRID": "SVR-abc123"
  }
}
```
