# X DM Scout — 毎日5人候補の抽出（手動DM用）

**自動DM送信はしません。** 候補リストを生成し、ファイル保存・メール通知のみ。

---

## できること

| 機能 | 状態 |
|------|------|
| X 検索から候補スコアリング | `lib/x-dm-scout.js` |
| 日次レポート保存 | `reports/x-dm-scout-YYYY-MM-DD.md` |
| メール通知（任意） | Resend API（DM文例つきレポート） |
| Vercel Cron（任意） | `GET /api/cron/dm-scout` |
| Cursor `/loop` から実行 | `node scripts/x-dm-scout.js` |

---

## 必要な準備

### 1. X API Bearer Token（検索を自動化する場合）

1. [developer.x.com](https://developer.x.com) で Project / App 作成
2. **Bearer Token** を発行
3. **Recent Search** には **Basic プラン（有料）以上** が必要な場合があります
4. Vercel Production に `X_BEARER_TOKEN` を設定

トークンがない場合: スクリプトは **手動検索URL** だけ出力します。

### 2. メール通知（Resend・毎朝DM文例つき）

1. [resend.com](https://resend.com) で無料アカウント作成
2. API Keys → `RESEND_API_KEY` を発行
3. Vercel Production に以下を設定:

| 変数 | 内容 |
|------|------|
| `RESEND_API_KEY` | Resend の API キー（`re_...`） |
| `KAIROS_SCOUT_NOTIFY_EMAIL` | **あなたの受信メール** |
| `KAIROS_SCOUT_EMAIL_FROM` | 送信元。未設定時は `KAIROS Scout <onboarding@resend.dev>`（Resend テスト用・自分宛のみ） |
| `KAIROS_OWNER_REF` | 任意。`kairos_xxx` 形式の紹介コード → DM文例②に `/invite?ref=` が入る |

**メール本文に含まれるもの:**
- 候補5人（Xトークンあり時）または 手動検索URL3本（トークンなし時）
- **DM文例3種（日本語）+ 英語2種** — コピペして手動送信
- 自動DM送信はしません

### 3. Vercel Cron（任意・サーバーで毎日実行）

| 変数 | 内容 |
|------|------|
| `CRON_SECRET` | Cron エンドポイント保護用ランダム文字列 |

`vercel.json` に crons 登録済み。デプロイ後、Vercel ダッシュボードで Cron が有効か確認。

手動テスト:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://get-kairos.online/api/cron/dm-scout
```

---

## ローカル実行

```bash
node scripts/x-dm-scout.js
```

出力: `reports/x-dm-scout-latest.md`

---

## Cursor で毎朝通知する

`/loop` スキルで例:

```
毎朝9時 JST: node scripts/x-dm-scout.js を実行し、reports/x-dm-scout-latest.md の内容を要約して表示
```

※ Cursor はメール送信しません。メールは Resend 設定時のみサーバー/Cron 側で送信。

---

## スコアリング方針

**加点:** ジャーナリング・心理学・自己理解・認知・ライティング系の bio / 投稿

**除外:** 占い・鑑定・霊視・MLM・儲かる系の bio（KAIROS ブランド保護）

---

## 運用ルール（必須）

- **1日 5〜15 フォロー / 2〜3 通の手動DM** まで
- テンプレ一括送信禁止
- 製品URLは最初は控えめ、会話後に `https://get-kairos.online/invite?ref=...`

---

*KAIROS Blueprint §6: 自動スパム・シェア強制は禁止。本ツールは「候補抽出」まで。*
