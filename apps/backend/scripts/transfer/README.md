# scripts

`apps/backend/scripts/` の e2e スクリプト集。ローカルの backend + 実レジストリ (kitaqsign / kitaqnic) を組み合わせて、移管フロー全体を叩く。

---

## 前提

- backend が localhost:8787 で起動していること
  - `pnpm dev` が `wrangler dev --test-scheduled` を叩くようになっている。
  - `--test-scheduled` を付けないと cron 発火用の `/__scheduled` が有効にならない。
- `apps/backend/.env` に teama 用の credentials + `SECRET_KEY` がある
- `apps/backend/.env.teama2` に teama-2 用の credentials がある (git 管理外)
- D1 の local sqlite が最新 migration まで適用済み
  - 特に `0005_transfers_add_gaining_registrar.sql` / `0006_add_outbound_transfer_requests.sql`

---

## スクリプト一覧

### 移管系 (12 本)

移管の主体・方向・レジストリの組み合わせで **6 シナリオ × 2 レジストリ = 12 本**。

| 方向 | 決着 | kitaqsign (.com) | kitaqnic (.xyz) |
|---|---|---|---|
| inbound (teama-2 losing / teama gaining, backend 経由) | approve  | `transfer-inbound-approve-e2e-kitaqsign.sh` | `transfer-inbound-approve-e2e-kitaqnic.sh` |
| inbound  | reject   | `transfer-inbound-reject-e2e-kitaqsign.sh`  | `transfer-inbound-reject-e2e-kitaqnic.sh`  |
| inbound  | cancel (gaining の自主取消) | `transfer-inbound-cancel-e2e-kitaqsign.sh`  | `transfer-inbound-cancel-e2e-kitaqnic.sh`  |
| outbound (teama losing / teama-2 gaining, backend 経由の losing 側は teama-2) ※テストコード上は逆向き = teama が gaining、teama-2 が losing の申請元、backend 経由で teama から申請する | approve  | `transfer-outbound-approve-e2e-kitaqsign.sh` | `transfer-outbound-approve-e2e-kitaqnic.sh` |
| outbound | reject   | `transfer-outbound-reject-e2e-kitaqsign.sh`  | `transfer-outbound-reject-e2e-kitaqnic.sh`  |
| outbound | cancel   | `transfer-outbound-cancel-e2e-kitaqsign.sh`  | `transfer-outbound-cancel-e2e-kitaqnic.sh`  |

方向の定義は「**backend (teama) にとって inbound / outbound**」で読む:
- **inbound** = 他社 (teama-2) が保有しているドメインを teama が受け取る側 …と思いきや、実装史上、この e2e では **teama がドメインを新規作成 (owner) → teama-2 が registry 直で request → teama backend が受け取ってから approve/reject** という順。「teama backend にとって approve/reject の意思決定が入ってくる」= inbound。
- **outbound** = teama-2 が registry で先にドメインを作り authInfo を発行 → teama が backend API で移管申請 (backend 経由で registry に投げる) → 結果 (approve/reject/cancel) が backend cron に返ってくる。「backend から見て申請が飛び出していく」= outbound。

「6 本 (inbound だけ) で足りるか」への答え: **足りない**。inbound と outbound では backend 内部の処理経路 (transfers vs outbound_transfer_requests、cron の handleMessage / handleOwnMessage の分岐) が完全に別なので、両方を通す必要がある。

### 補助スクリプト (既存)

- `create-domain-e2e.sh`, `info-domain-e2e.sh` — ドメイン作成 / info 取得の単発 e2e
- `transfer-e2e.sh`, `transfer-backend-e2e.sh` — 旧世代の移管 e2e (単体で backend を叩くだけ)
- `transfer-registry-e2e.sh`, `transfer-registry-e2e-reverse.sh` — レジストリ直叩き検証

---

## 実行方法

env-file は必ず引数で渡す (スクリプト内で自動読み込みしない):

```bash
cd apps/backend
# 別ターミナルで backend を起動
pnpm dev

# シナリオを 1 本ずつ実行
./scripts/transfer/transfer-inbound-approve-e2e-kitaqsign.sh \
  --env .env \
  --env-teama2 .env.teama2

./scripts/transfer/transfer-inbound-approve-e2e-kitaqnic.sh \
  --env .env \
  --env-teama2 .env.teama2
# ...
```

環境変数でも渡せる (引数のほうが優先):

```bash
ENV_FILE=.env ENV_FILE_TEAMA2=.env.teama2 \
  ./scripts/transfer/transfer-inbound-approve-e2e-kitaqsign.sh
```

### env-file の中身

- `--env` で指定するファイル (teama 用) に必要なキー:
  - `SECRET_KEY`
  - `KITAQSIGN_REGISTRAR_ID`, `KITAQSIGN_BASIC_USER`, `KITAQSIGN_BASIC_PASS`, `KITAQSIGN_API_KEY`
  - `KITAQNIC_REGISTRAR_ID`, `KITAQNIC_BASIC_USER`, `KITAQNIC_BASIC_PASS`, `KITAQNIC_API_KEY`
- `--env-teama2` で指定するファイル (teama-2 用) に必要なキー:
  - `KITAQSIGN_*` 4 種 + `KITAQNIC_*` 4 種 (teama と同名だが値は別)
  - スクリプト内では自動で `T2_KITAQSIGN_*` / `T2_KITAQNIC_*` に prefix されるので、teama 側と競合しない

---

## ⚠️ 並列実行は不可

**スクリプトを並列で走らせないこと**。理由:

1. **レジストリ側にメッセージキューが 1 本しかない** (registrar 単位)。並列で複数の request/approve を投げると、cron が poll した瞬間に **無関係なドメインのメッセージが先頭に居座り (HoL blocking)**、対象ドメインの検証が別テストのゴミを掴んで詰まる。
2. **backend 側の cron が 1 プロセス**。同時に走ると同じ pending 行を 2 度 INSERT しに来て、`outbound_transfer_requests_pending_unique_idx` 等の unique 制約で片方が落ちる。
3. **D1 の local sqlite が 1 ファイル**。書き込みが競合する。

順次実行が絶対原則。前のシナリオが終わってから次を起動する。

---

## 詰まりどころメモ (作る過程で踏んだやつ)

作業中にハマったポイント。以後の追加スクリプトで再発しないように残す。

### 1. `wrangler dev` の cron 案内が誤り

- wrangler が起動時に「`/cdn-cgi/local/scheduled` を叩け」と言うが、そこは 200 "ok" を返すだけで **scheduled ハンドラは呼ばれない**。
- 正解は起動を `wrangler dev --test-scheduled` にし、`GET /__scheduled` を叩く。
- `apps/backend/package.json` の `dev` は既にこれ。手で `wrangler dev` するときは注意。

### 2. ack のパスがレジストリごとに違う

- kitaqsign: `POST /api/v1/epp/messages/{id}/ack`
- kitaqnic:  `DELETE /api/v1/epp/messages/{id}`
- コードは `apps/backend/src/lib/bridge/index.ts` で吸収してあるが、スクリプトから直接叩くときは分岐が要る。
- 現行の inbound/outbound スクリプトは **backend の cron に ack を任せる** ので、スクリプト内での直接 ack はしていない。もし drain (キュー先頭ゴミ捨て) が必要になったらここを思い出す。

### 3. poll のパスもレジストリごとに違う

- kitaqsign: `GET /api/v1/epp/messages/poll`
- kitaqnic:  `GET /api/v1/epp/messages`

### 4. 前回テストの残骸メッセージが HoL blocking する

- キューは FIFO。前回失敗テストで ack し損ねた「別ドメインの request」が先頭にいると、cron が対象ドメインのメッセージまで辿り着けない。
- 症状: 「テストは pass する順にしか通らない」「backend を再起動しても直らない」。
- 対応: 該当ドメインが来るまで先頭を ack で drain するループ (現状スクリプトには入れていない。単発失敗時は手で drain する)。

### 5. authInfo の不一致レスポンスがレジストリごとに違う

- kitaqsign: `HTTP 202 + resData.result.code=2202` または `HTTP 403 + 2202`
- kitaqnic:  `HTTP 401`
- bridge 側で意味付きエラーに mapping 済み。

### 6. hello レスポンスの形が違う

- kitaqsign: `resData.supportedTlds` フラット
- kitaqnic:  `resData.info.supportedTlds` ネスト

### 7. subshell 内 return が効かない

- `return $(scenario_fail "...")` は subshell で return を呼ぶので何も返らない。
- 正解は `{ scenario_fail "..."; return 1; }`。

### 8. schema/service を書き換えた後は backend を再起動

- wrangler dev は HMR が完璧ではない。cron の service.ts を編集したときは `pnpm dev` を落として起動し直す。

### 9. kitaqsign が 503 メンテナンスに入ったら kitaqnic で代替

- 過去に kitaqsign 側が数時間メンテで `.com` テスト不可の期間があった。その間は `-kitaqnic.sh` 版 (`.xyz`) だけで検証を進めた。

### 10. 504 gateway timeout の fault injection

- レジストリが意図的に 504 を返してくる (fault injection シミュレーション)。
- スクリプトは 504 を fail 扱いしているので、単発失敗したら **同じスクリプトを 1〜2 回リトライ**。連続で落ちるなら本当の不具合。

---

## `.env.teama2` の扱い

- teama-2 は「別レジストラアカウント」なので、teama とは別の basic auth / registrar id / api key が要る。
- **絶対に `.env.teama2` の値を git 管理下のファイルにベタ書きしない**。README にも書かない。
- ハッカソン用に発行された使い捨てキー前提。他プロジェクトに転用するなら再発行推奨。
- `.gitignore` で除外済み。追跡状態でないことを `git status --ignored` で確認できる。
