# Kitaqsign / Kitaqnic hello レスポンス shape 差異の検証

`GET /api/v1/epp/sessions/hello` のレスポンス shape が 2 レジストリで違うことを
生 curl で再現するためのメモ。`RegistryBridge.hello` が Kitaqnic の tlds を拾えず
`unsupported_tld` になる根本原因の確認用。

> ⚠️ 以下の curl はハッカソン用の共有クレデンシャル (`.env` と同値) をそのまま埋め込んでいる。
> 本番 secret を書いてはいけない。

## Kitaqsign 側 (期待される shape)

```sh
curl -sS \
  -u "gmointernet:app5days" \
  -H "X-Registrar-Id: teama" \
  -H "X-Api-Key: 84845397-21a1-418b-a9f4-9016af9eebfa" \
  -H "X-Cl-TRID: CLI-hello-ks-$(date +%s)" \
  https://epp.kitaqsign.com/api/v1/epp/sessions/hello | jq .
```

期待レスポンス (実測):

```json
{
  "result": { "code": 1000, "message": "Command completed successfully" },
  "resData": {
    "registryCode": "KQSGN",
    "tlds": ["com", "net", "org", "info"],
    "message": "Welcome to KQSGN EPP-over-REST registry"
  },
  "extension": null,
  "trID": { "clTRID": "CLI-hello-ks-...", "svTRID": "KQSGN-..." }
}
```

ポイント: `resData.tlds` が **平坦な string[]** で入っている。
`src/lib/bridge/generated/kitaqsign.d.ts` の `GreetingResponse` (`{registryCode,tlds,message}`) と一致する。

## Kitaqnic 側 (実際は別 shape)

```sh
curl -sS \
  -u "gmointernet:app5days" \
  -H "X-Registrar-Id: teama" \
  -H "X-Api-Key: cb44a5bca5444799be4813631f888a47" \
  -H "X-Cl-TRID: CLI-hello-kn-$(date +%s)" \
  https://epp.kitaqnic.com/api/v1/epp/sessions/hello | jq .
```

実測レスポンス:

```json
{
  "result": { "code": 1000, "message": "Command completed successfully" },
  "resData": {
    "svID": "KQNIC",
    "svDate": "2026-08-26T02:18:38Z",
    "svcMenu": {
      "version": "1.0",
      "lang": "en",
      "objURIs": ["domain", "contact", "host"],
      "extensions": ["premium", "launch", "fee"]
    },
    "info": {
      "registryCode": "KQNIC",
      "supportedTlds": [
        "xyz","online","site","tech","space","store","website","press",
        "host","fun","icu","cyou","sbs","bond","cfd","art","build","ceo"
      ],
      "allowIdn": true,
      "minPeriodYears": 1,
      "maxPeriodYears": 10,
      "gracePeriodDays": 45
    }
  }
}
```

ポイント:

- `resData.tlds` は **存在しない**。TLD は `resData.info.supportedTlds` にネスト。
- キー名も `tlds` ではなく `supportedTlds`。
- 生成型 `src/lib/bridge/generated/kitaqnic.d.ts` の hello レスポンスは
  `EppResponseMapStringObject` (中身の型情報なし) で、Swagger が定義していない。

## 差異が引き起こしている問題

1. `RegistryBridge.hello` は `extracted.data.tlds` を `Array.isArray` で narrow
   → Kitaqnic では `tlds` が undefined なので `invalid_registry_response` を返す。
2. `resolveRegistry` は `kn.success === false` になり、Kitaqsign の `["com","net","org","info"]`
   に含まれない `.xyz` が来ると `unsupported_tld` に落ちる。
3. 結果: **Kitaqnic に本来投げるべきドメインが全部 backend で弾かれる**。

## 検証用の 1 コマンド (差異を並べて出す)

```sh
echo "=== Kitaqsign ==="
curl -sS \
  -u "gmointernet:app5days" \
  -H "X-Registrar-Id: teama" \
  -H "X-Api-Key: 84845397-21a1-418b-a9f4-9016af9eebfa" \
  -H "X-Cl-TRID: CLI-hello-ks-$(date +%s)" \
  https://epp.kitaqsign.com/api/v1/epp/sessions/hello \
  | jq '.resData | {tlds, "info.supportedTlds": .info.supportedTlds}'

echo "=== Kitaqnic ==="
curl -sS \
  -u "gmointernet:app5days" \
  -H "X-Registrar-Id: teama" \
  -H "X-Api-Key: cb44a5bca5444799be4813631f888a47" \
  -H "X-Cl-TRID: CLI-hello-kn-$(date +%s)" \
  https://epp.kitaqnic.com/api/v1/epp/sessions/hello \
  | jq '.resData | {tlds, "info.supportedTlds": .info.supportedTlds}'
```

期待される出力:

```
=== Kitaqsign ===
{
  "tlds": ["com","net","org","info"],
  "info.supportedTlds": null
}
=== Kitaqnic ===
{
  "tlds": null,
  "info.supportedTlds": ["xyz","online","site","tech","space","store","website","press","host","fun","icu","cyou","sbs","bond","cfd","art","build","ceo"]
}
```

## 修正方針 (未着手)

- `RegistryBridge.hello` 内で両 shape を吸収し、外向きには `{ tlds: string[], registryCode: string }`
  に normalize する。呼び出し側 (`resolveRegistry`, `DomainService.create` の TLD 判定) は
  `data.tlds` を触るだけの前提を変えない。
- `GreetingResponse` の re-export 型も同じ shape に narrow。
- `.jp` のような**どちらのレジストリも扱わない TLD** は `resolveRegistry` が明示的に
  `unsupported_tld` を返すようにする (`detectRegistry` が無条件 kitaqnic を返す挙動は
  hello 修正後だと 422 → `invalid_tld` になり UX が悪くなる)。

nicは今落ちてるから、signで動作確認をしたい
e2eテストはさ、
1 teama: バックエンドapiでドメイン作成
2 teama-2: 移管リクエストを直でレジストリに投げる。1で作成したドメインを移行する。1で作成したauthinfoも必要になってくる
3 temaa: レジストリでレジストラーをポーリングしていると、approveリクエストが来ることがわかる。これをdbに保存しておく
4 teama: バックエンドAPIできたapproveを承認
5 teama: ドメインがないことを確認
6 taama-2: ドメインが追加されていることを確認
で実行をして


1 teama-2: バックエンドapiでドメイン作成
2 teama: 移管リクエストをバックエンド経由でレジストリに投げる。1で作成したドメインを移行する。1で作成したauthinfoも必要になってくる
3 temaa-2: レジストリでレジストラーをポーリングしていると、approveリクエストが来ることがわかる。これをdbに保存しておく。ポーリング相当のエンドポイントはswaggerに定義されている
4 teama-2: バックエンドAPIできたapproveを承認
5 teama-2: ドメインがないことを確認
6 taama: ポーリングしたら、承認されたことが確認できるから、ユーザーの所有するDBとして保存される