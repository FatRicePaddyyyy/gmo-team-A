# authInfo ライフサイクル

authInfo（移管パスフレーズ）はドメインに紐づくパスワード的な値。
レジストリ側で管理され、移管申請時の本人確認に使われる。

---

## ライフサイクル全体図

```mermaid
sequenceDiagram
    actor Owner as ドメイン保有者（losing）
    actor Gainer as 移管希望者（gaining）
    participant API as 自社API
    participant DB as 自社DB
    participant Bridge as RegistryBridge
    participant Reg as レジストリ

    Note over Owner,Reg: 1. ドメイン登録時（authInfo を生成・設定）
    Owner->>API: POST /v1/domains { name, period }
    Note right of API: BRIDGEが authInfo = crypto.randomUUID() を生成
    API->>Bridge: create({ ..., authInfo: "生成した値" })
    Bridge->>Reg: POST /epp/domains { domain, period, registrant, authInfo: "生成した値" }
    Reg-->>Bridge: 201 OK
    Bridge-->>API: 成功
    API->>DB: domains に保存（authInfo も一緒に保存）
    API-->>Owner: 201 Domain
    Note right of DB: 自社DBに authInfo をキャッシュ
    Note right of Reg: レジストリにも authInfo が保存される

    Note over Owner,Reg: 2. authInfo の変更（任意）
    Owner->>API: PUT /v1/domains/{id} { authInfo: "new-pass" }
    API->>Bridge: update({ chg: { authInfo: "new-pass" } })
    Bridge->>Reg: PUT /epp/domains/{name} { chg: { authInfo: "new-pass" } }
    Reg-->>Bridge: 200 OK
    Bridge-->>API: 成功
    API->>DB: domains.authInfo を "new-pass" に更新
    API-->>Owner: 200 Domain

    Note over Owner,Gainer: 3. 移管のために authInfo を共有（帯域外）
    Owner->>API: GET /v1/domains/{id}（自分の authInfo を確認）
    API-->>Owner: Domain { authInfo: "new-pass" }
    Owner-->>Gainer: authInfo を別途伝える（メール・口頭など）

    Note over Gainer,Reg: 4. 移管申請時（authInfo を提示）
    Gainer->>API: POST /v1/transfers { name, authInfo: "new-pass" }
    API->>Bridge: transferRequest({ authInfo: "new-pass" })
    Bridge->>Reg: POST /epp/domains/{name}/transfer/request { op: "request", authInfo: "new-pass" }
    alt authInfo 一致
        Reg-->>Bridge: 202（pendingTransfer）
        Bridge-->>API: 成功
        API-->>Gainer: 202 Transfer
    else authInfo 不一致
        Reg-->>Bridge: result.code 2202 (Kitaqsign) / HTTP 401 (Kitaqnic)
        Bridge-->>API: 失敗
        API-->>Gainer: 409
    end
```

---

## ポイント

| 項目 | 内容 |
|------|------|
| 保管場所 | **レジストリ + 自社DB**（自社DBにキャッシュして会員が確認・変更できるようにする） |
| 設定タイミング | ドメイン登録（create）時に必須 |
| 変更 | update の `chg.authInfo` でいつでも変更可能 |
| 使用タイミング | 移管申請（transfer request）時に gaining 側が提示 |
| 検証者 | レジストリ（自社APIは検証しない） |
| 共有方法 | 帯域外（losing → gaining へ別途連絡） |
| 不一致時 | Kitaqsign: `result.code 2202` / Kitaqnic: `HTTP 401` → どちらも会員APIに `409` で返す |
