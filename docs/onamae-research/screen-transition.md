# 疑似レジストラアプリ 画面遷移図

作成日: 2026-08-24  
参考: お名前.comスクリーンショット調査（同ディレクトリ内）

---

```mermaid
flowchart TD
    %% ===== 未ログインエリア =====
    TOP["🏠 トップページ\n──────────────\n・ドメイン検索窓（中央）\n・ドメイン取得 / 移管 / 更新 リンク\n参考: 01_top.png"]

    LOGIN["🔑 ログイン画面\n──────────────\n・お名前ID（会員ID）入力\n・パスワード入力\n・ID/PW忘れリンク\n参考: 07_navi_login.png"]

    REGISTER["📝 新規会員登録画面\n──────────────\n・メールアドレス入力\n・パスワード設定\n・会員情報入力"]

    %% ===== ドメイン登録フロー =====
    SEARCH["🔍 ドメイン検索画面\n──────────────\n・文字列入力\n・TLD選択（.com/.net等）\n・「検索」ボタン\nAPI: check\n参考: 03_domain_search.png"]

    SEARCH_RESULT["📋 検索結果画面\n──────────────\n・空き/取得済みバッジ\n・TLD別一覧表示\n・価格表示\n・「カートに追加」ボタン\n参考: 04_domain_search_result.png"]

    REGIST_CONFIRM["✅ 登録確認・支払い画面\n──────────────\n・選択ドメイン確認\n・登録年数選択\n・支払い方法入力\n・「申込む」ボタン\nAPI: create"]

    REGIST_DONE["🎉 登録完了画面\n──────────────\n・登録ドメイン名\n・有効期限\n・完了メール送信済み通知"]

    %% ===== 認証後メイン =====
    DASHBOARD["📦 ダッシュボード\n（ドメイン一覧）\n──────────────\n・保有ドメイン一覧\n・ステータスバッジ\n（ok / pendingDelete\n / pendingTransfer）\n・各操作へのリンク\nAPI: info\n参考: 11_navi_domain_guide.png"]

    %% ===== ドメイン詳細 =====
    DETAIL["📄 ドメイン詳細画面\n──────────────\n・ドメイン名 / 登録日\n・有効期限 / 更新期限\n・ステータス\n・AuthCode\n・ネームサーバー情報\n・変更履歴\n操作ボタン:\n[NS変更][Whois変更]\n[廃止][移管OUT]\nAPI: info\n参考: 15_domain_detail.png"]

    %% ===== 更新フロー =====
    RENEW_LIST["📅 更新リスト画面\n──────────────\n・更新対象ドメイン一覧\n・有効期限表示\n・ドメイン選択チェックボックス\n参考: 06_renewal.png"]

    RENEW_CONFIRM["💳 更新確認・支払い画面\n──────────────\n・選択ドメイン確認\n・更新年数・金額\n・支払い方法確認\n・「申込む」ボタン\nAPI: renew"]

    %% ===== 情報修正フロー =====
    UPDATE_NS["🖊 NS変更画面\n──────────────\n・現在のNS表示\n・新しいNS入力\n・「保存」ボタン\nAPI: update\n参考: 09_navi_ns_change.png"]

    UPDATE_CONTACT["👤 Whois情報変更画面\n──────────────\n・登録者情報（Registrant）\n・TECHコンタクト\n・「保存」ボタン\nAPI: update"]

    %% ===== 廃止フロー =====
    DELETE_CONFIRM["⚠️ 廃止確認画面\n──────────────\n・廃止対象ドメイン名\n・「廃止後は復旧に費用が発生」警告\n・「廃止する」ボタン\nAPI: delete\n参考: 12_delete.png"]

    PENDING_DELETE["🔴 廃止済み（pendingDelete）\n──────────────\n・ステータス: pendingDelete\n・Grace Period残り期間表示\n・「復旧する」ボタン（期間中のみ）"]

    %% ===== 復旧フロー =====
    RESTORE_CONFIRM["🔄 復旧確認画面\n──────────────\n・復旧対象ドメイン名\n・⚠️ 復旧手数料が発生する旨の警告\n・「復旧する」ボタン\nAPI: restore（RGP）\n参考: 13_restore.png"]

    %% ===== 移管INフロー =====
    TRANSFER_IN_CHECK["🔎 移管IN：ドメイン名入力\n──────────────\n・移管したいドメイン名入力\n・「移管可否を確認する」ボタン\n参考: 05_transfer_in.png"]

    TRANSFER_IN_AUTH["🔐 移管IN：AuthCode入力\n──────────────\n・移管可否: ✅ 確認済み\n・AuthCode（移管パスフレーズ）入力\n・「移管申請する」ボタン\nAPI: transfer request"]

    TRANSFER_PENDING["🟡 移管申請中（pendingTransfer）\n──────────────\n・ステータス: pendingTransfer\n・losing側の承認待ち\n・自動承認まで20分\n・「申請取消」ボタン\nAPI: transfer cancel"]

    %% ===== 移管承認通知（losing側）=====
    TRANSFER_APPROVE["📨 移管承認・拒否画面\n──────────────\n・移管申請通知（Pollより）\n・申請元レジストラ名\n・「承認する」ボタン\n・「拒否する」ボタン\nAPI: transfer approve / reject"]

    %% ===== 移管OUTフロー =====
    TRANSFER_OUT["📤 移管OUT画面\n──────────────\n・AuthCode表示\n・「AuthCodeを再生成」ボタン\n・移管ロック設定"]

    %% ===== 遷移定義 =====

    %% 未ログイン → 認証
    TOP -->|"ログインボタン"| LOGIN
    TOP -->|"新規登録"| REGISTER
    TOP -->|"ドメイン検索"| SEARCH
    LOGIN --> DASHBOARD
    REGISTER --> DASHBOARD

    %% 登録フロー（未ログイン経由）
    SEARCH --> SEARCH_RESULT
    SEARCH_RESULT -->|"空きドメイン選択"| LOGIN
    LOGIN -->|"ログイン後継続"| REGIST_CONFIRM
    REGIST_CONFIRM --> REGIST_DONE
    REGIST_DONE --> DASHBOARD

    %% 登録フロー（ログイン済み経由）
    DASHBOARD -->|"ドメイン登録"| SEARCH
    SEARCH_RESULT -->|"ログイン済み"| REGIST_CONFIRM

    %% ダッシュボード → 各画面
    DASHBOARD -->|"ドメイン選択"| DETAIL
    DASHBOARD -->|"更新メニュー"| RENEW_LIST
    DASHBOARD -->|"移管IN"| TRANSFER_IN_CHECK
    DASHBOARD -->|"Poll通知バッジ"| TRANSFER_APPROVE

    %% 詳細 → 各操作
    DETAIL -->|"NS変更"| UPDATE_NS
    DETAIL -->|"Whois変更"| UPDATE_CONTACT
    DETAIL -->|"廃止"| DELETE_CONFIRM
    DETAIL -->|"移管OUT"| TRANSFER_OUT
    DETAIL -->|"更新"| RENEW_LIST

    %% 更新フロー
    RENEW_LIST -->|"ドメイン選択・次へ"| RENEW_CONFIRM
    RENEW_CONFIRM -->|"申込み完了"| DASHBOARD

    %% 情報修正
    UPDATE_NS -->|"保存"| DETAIL
    UPDATE_CONTACT -->|"保存"| DETAIL

    %% 廃止フロー
    DELETE_CONFIRM -->|"廃止実行"| PENDING_DELETE
    PENDING_DELETE -->|"Grace Period中\n復旧ボタン表示"| RESTORE_CONFIRM
    PENDING_DELETE -->|"Grace Period終了"| GONE(["🗑 完全削除"])
    RESTORE_CONFIRM -->|"復旧成功"| DETAIL

    %% 移管INフロー
    TRANSFER_IN_CHECK -->|"移管可能"| TRANSFER_IN_AUTH
    TRANSFER_IN_AUTH -->|"申請送信"| TRANSFER_PENDING
    TRANSFER_PENDING -->|"承認 or 自動承認20分"| DASHBOARD
    TRANSFER_PENDING -->|"取消"| DASHBOARD

    %% 移管承認（losing側）
    TRANSFER_APPROVE -->|"承認 or 拒否"| DASHBOARD

    %% スタイル
    classDef auth fill:#fde68a,stroke:#d97706,color:#1c1917
    classDef hub fill:#bbf7d0,stroke:#16a34a,color:#14532d
    classDef action fill:#bfdbfe,stroke:#2563eb,color:#1e3a8a
    classDef danger fill:#fecaca,stroke:#dc2626,color:#7f1d1d
    classDef pending fill:#fed7aa,stroke:#ea580c,color:#7c2d12

    class LOGIN,REGISTER auth
    class DASHBOARD,DETAIL hub
    class SEARCH,SEARCH_RESULT,REGIST_CONFIRM,REGIST_DONE,RENEW_LIST,RENEW_CONFIRM,UPDATE_NS,UPDATE_CONTACT,TRANSFER_IN_CHECK,TRANSFER_IN_AUTH,TRANSFER_OUT,TRANSFER_APPROVE action
    class DELETE_CONFIRM,RESTORE_CONFIRM danger
    class PENDING_DELETE,TRANSFER_PENDING pending
```

---

## 画面一覧

| # | 画面名 | 対応API | 参考スクショ |
|---|--------|---------|------------|
| 1 | トップページ | — | 01_top.png |
| 2 | ログイン画面 | — | 07_navi_login.png |
| 3 | 新規会員登録画面 | — | — |
| 4 | ドメイン検索画面 | check | 03_domain_search.png |
| 5 | 検索結果画面 | check | 04_domain_search_result.png |
| 6 | 登録確認・支払い画面 | create | — |
| 7 | 登録完了画面 | — | — |
| 8 | ダッシュボード（ドメイン一覧） | info | 11_navi_domain_guide.png |
| 9 | ドメイン詳細画面 | info | 15_domain_detail.png |
| 10 | 更新リスト画面 | — | 06_renewal.png |
| 11 | 更新確認・支払い画面 | renew | — |
| 12 | NS変更画面 | update | 09_navi_ns_change.png |
| 13 | Whois情報変更画面 | update | — |
| 14 | 廃止確認画面 | delete | 12_delete.png |
| 15 | 廃止済み表示（pendingDelete） | — | — |
| 16 | 復旧確認画面 | restore | 13_restore.png |
| 17 | 移管IN：ドメイン名入力・可否確認 | — | 05_transfer_in.png |
| 18 | 移管IN：AuthCode入力 | transfer request | — |
| 19 | 移管申請中（pendingTransfer） | transfer cancel | — |
| 20 | 移管承認・拒否画面 | transfer approve/reject | — |
| 21 | 移管OUT画面 | rotate-auth-info | — |

---

## 色の意味

| 色 | 意味 |
|---|------|
| 🟡 黄 | 認証画面（ログイン・登録） |
| 🟢 緑 | ハブ画面（ダッシュボード・詳細）— 全操作の起点 |
| 🔵 青 | 通常操作画面（検索・更新・修正・移管） |
| 🔴 赤 | 危険操作画面（廃止・復旧 — 費用/不可逆） |
| 🟠 橙 | 保留中ステータス画面（pendingDelete・pendingTransfer） |

---

## お名前.comとの主な設計差分

| 項目 | お名前.com | 本アプリ |
|------|-----------|---------|
| 廃止方法 | 自動更新OFFで期限切れ廃止 | EPP準拠で廃止ボタンを直接実装 |
| 復旧 | 追加費用あり・数日かかる | Grace Period中即時復旧（費用警告は表示） |
| 移管完了時間 | 10日前後 | 20分で自動承認（ハッカソン短縮） |
| 移管IN手順 | 移管可否確認 → authCode入力 | 同じ順番で実装 |
| 更新画面 | ダッシュボードとは独立した更新リスト画面 | 同じ構成で実装 |
| ドメイン詳細 | AuthCode・変更履歴・公開代行設定等も表示 | 同じ構成で実装 |
