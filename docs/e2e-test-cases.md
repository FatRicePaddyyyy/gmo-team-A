# ローカル e2e テストケース一覧

`apps/frontend/e2e/` 配下のテスト。ディレクトリ名がテスト時の前提条件（どのレジストリを本物にするか / 落とすか）を表す。

各ファイル冒頭で `SECRET_KEY` / `T2_*` などの seed 用環境変数を `test.skip` でガードしているため、環境変数なしで動くのは実質 `registry-none/` の 5 ケースだけ。

---

## `registry-none/` — レジストリに繋がない静的検証

| ファイル | ケース |
|---|---|
| `smoke.registry-none.spec.ts` | トップページが表示される |
| `no-cart-flow.registry-none.spec.ts` | ヘッダーにカートアイコンが無い |
| `domain-name-validation.registry-none.spec.ts` | ・検索フォームから不正入力 → 理由が出てレジストリへ問い合わせない<br>・`?q=` 直リンクの不正入力 → 理由が出てレジストリへ問い合わせない<br>・半角英数字とハイフンなら検索に進む |

---

## `kitaqsign-normal/` — kitaqsign（.com など）通常時

購入・移管・ドメイン詳細アップデート系が主。

### 購入 / カート系

- `no-cart-flow.kitaqsign-normal.spec.ts`
  - 検索結果に「このドメインで進む」があり、旧「カートに追加」は無い
  - 「このドメインで進む」で選んだドメインが確認画面に渡る
- `purchase-flow-com.kitaqsign-normal.spec.ts` — ログイン後、選んだ .com を取得してマイドメインに到達

### ドメイン詳細アップデート（S6〜S11）

- `domain-detail-update-basic.kitaqsign-normal.spec.ts` — .com で renew / autoRenew / nameServers / authInfo が期待どおり
- `domain-detail-update-locks.kitaqsign-normal.spec.ts`
  - S6: `clientTransferProhibited` を ON/OFF できる
  - S7: `clientRenewProhibited` を立てると renew タブ操作不可
  - S8: `clientDeleteProhibited` で廃止ボタンが消え、解除案内が出る
  - S9: `clientUpdateProhibited` は NS/AuthCode を止めるが Locks は自己解除できる
- `domain-detail-update-lifecycle.kitaqsign-normal.spec.ts` — S10/S11: 廃止 → 復旧の往復で状態と操作可否が切り替わる

### 移管 (inbound / outbound の正常系)

- `transfer-inbound-approve.kitaqsign-normal.spec.ts` — 承認するとマイドメインからドメインが消える
- `transfer-inbound-reject.kitaqsign-normal.spec.ts` — 却下するとドメインが手元に残る
- `transfer-inbound-cancel.kitaqsign-normal.spec.ts` — teama-2 が取消するとカードが消え、ドメインは手元に残る
- `transfer-outbound-approve.kitaqsign-normal.spec.ts` — teama-2 approve でドメインがマイドメインに載る
- `transfer-outbound-reject.kitaqsign-normal.spec.ts` — teama-2 reject でドメインは載らず、却下ステータスになる
- `transfer-outbound-cancel.kitaqsign-normal.spec.ts` — teama が自分で取消するとドメインは載らず、取消ステータスになる

### 移管の異常系（申請時に弾かれる）

- `transfer-already-pending.kitaqsign-normal.spec.ts` — 既に pendingTransfer → 409 + 「既に処理中」
- `transfer-authinfo-mismatch.kitaqsign-normal.spec.ts` — authInfo 不一致 → 409 + 「認証コード」
- `transfer-not-transferable.kitaqsign-normal.spec.ts`
  - (a) redemptionPeriod → 409 + 「現在の状態では移管できません」
  - (b) inactive (NS 未設定) → 409 + 「現在の状態では移管できません」
- `transfer-prohibited.kitaqsign-normal.spec.ts` — 保護タブで移管禁止 ON → 別ユーザーの申請が 409 + 「移管が禁止」
- `transfer-self.kitaqsign-normal.spec.ts` — 自分が持つドメインへの申請はフロントで「すでにここにある」

---

## `kitaqsign-outage/` — kitaqsign 側だけ落ちた前提

- `kitaqsign-outage.kitaqsign-outage.spec.ts` — .com を含む検索で kitaqsign 側 TLD が失敗表示になる

---

## `kitaqnic-normal/` — kitaqnic（.xyz など）通常時

### 購入

- `purchase-flow-xyz.kitaqnic-normal.spec.ts` — ログイン後、選んだ .xyz を取得してマイドメインに到達

### 移管

- `transfer-inbound-approve.kitaqnic-normal.spec.ts` — 承認するとマイドメインからドメインが消える
- `transfer-inbound-reject.kitaqnic-normal.spec.ts` — 却下するとドメインが手元に残る
- `transfer-inbound-cancel.kitaqnic-normal.spec.ts` — teama-2 が取消するとカードが消え、ドメインは手元に残る
- `transfer-outbound-approve.kitaqnic-normal.spec.ts` — teama-2 approve でドメインがマイドメインに載る
- `transfer-outbound-reject.kitaqnic-normal.spec.ts` — teama-2 reject でドメインは載らず、却下ステータスになる
- `transfer-outbound-cancel.kitaqnic-normal.spec.ts` — teama が自分で取消するとドメインは載らず、取消ステータスになる

---

## `kitaqnic-outage/` — kitaqnic 側だけ落ちた前提

- `kitaqnic-outage.kitaqnic-outage.spec.ts` — .xyz を含む検索で kitaqnic 側 TLD が失敗表示になる
- `transfer-inbound-approve.kitaqnic-outage.spec.ts` — .xyz の「このドメインで進む」ボタンが出ず、失敗枠に載る
- `transfer-inbound-reject.kitaqnic-outage.spec.ts` — .xyz が失敗枠に出て「このドメインで進む」ボタンが出ない
- `transfer-inbound-cancel.kitaqnic-outage.spec.ts` — .xyz が失敗枠に出て「このドメインで進む」ボタンが出ない
- `transfer-outbound-approve.kitaqnic-outage.spec.ts` — .xyz 申請でエラー帯が出て「申請中の移管」に載らない
- `transfer-outbound-reject.kitaqnic-outage.spec.ts` — .xyz 申請で「申請中の移管」に載らない
- `transfer-outbound-cancel.kitaqnic-outage.spec.ts` — .xyz 申請で「申請中の移管」に載らない
