# エンタメカイロス（get-kairos.online）統合ブループリント — 最新版

**文書版:** 2026-05-24  
**ステータス:** リポジトリ実装・本番デプロイに同期した単一正本（Single Source of Truth）  
**旧版からの整理:** 月額価格の二重表記（2,000円 / 3,000円）、ジオブロック国リストの食い違い、Next.js 前提、未実装 DB ペイウォールの「完成済み」表現を削除・統合した。

---

## 0. プロジェクトの本質

| 項目 | 定義 |
|---|---|
| 名称 | KAIROS / エンタメカイロス |
| 本番 URL | https://get-kairos.online |
| 位置づけ | AI 自己認知テック SaaS（エンタメ心理分析コンテンツ）。意思決定支援・行動プロファイリング。 |
| 収益 | マイクロ決済（都度 300 円）＋ 5 回セット ＋ 月額サブスク |
| 運用 | 個人極小運用。外部有料ツールへの先行投資は行わない方針 |

**Stripe 審査・表現:** 「占い (Fortune Telling)」関連語は UI・コード・API・決済メタデータで使用禁止。`.cursor/rules/branding.mdc` を参照。

---

## 1. 物理構成（2026-05-24 時点・実装済み）

### 1-1. 技術スタック

| 層 | 実装 |
|---|---|
| フロント | `public/index.html` + Tailwind CSS（`src/input.css` → `public/styles.css`） |
| バックエンド | Node.js Express — **`api/index.js`**（Vercel Serverless エントリ） |
| ローカル開発 | `server.js` → `api/index.js` を listen |
| インフラ | Vercel（Production エイリアス: get-kairos.online） |
| AI | `@google/genai` — 解析: `gemini-2.5-flash`、SSE デモ: `gemini-3.1-flash-lite` |
| 決済 | Stripe Checkout（303 リダイレクト）＋ レガシー PaymentIntents API |

**注意:** 本リポジトリは Next.js プロジェクトではない。ブループリント旧版の Next.js / Route Handlers 記述は本件には該当しない。

### 1-2. API ルート一覧（`api/index.js`）

| メソッド | パス | 役割 |
|---|---|---|
| POST | `/webhook` | Stripe Webhook（署名検証・べき等性） |
| GET | `/legal/tokushoho` | 特定商取引法に基づく表記（HTML） |
| GET | `/api/gemini-stream` | SSE デモストリーム |
| POST | `/api/analyze` | テキスト解析 → JSON（`synchronicityScore` 等） |
| GET | `/api/checkout` | Stripe Checkout セッション作成 → 303 リダイレクト |
| POST | `/api/payment-intent` | PaymentIntents（human / agent x402） |

`vercel.json` で `/api/*`, `/webhook`, `/legal/tokushoho` を `api/index.js` に rewrite。

### 1-3. 静的アセット

| パス | 内容 |
|---|---|
| `public/index.html` | メイン UI・プラン選択・法的モーダル |
| `public/success/index.html` | 決済成功 → `/?checkout=success` |
| `public/canceled/index.html` | 決済キャンセル |
| `public/locales/{ja,en,es,fr,de}.json` | UI 文言 |
| `components/PricingPlanSelector.tsx` | React コンポーネント（現フロント未組込・参照用） |

---

## 2. 決済・景品表示法（完全適合設計）

### 2-1. 料金体系（正）

| プラン ID | 価格（税込） | Stripe 環境変数 | Checkout mode |
|---|---|---|---|
| `single` | 300 円 | `STRIPE_PRICE_SINGLE` | `payment` |
| `bundle` | 1,000 円（5 回セット） | `STRIPE_PRICE_BUNDLE` | `payment` |
| `subscription` | **2,000 円/月** | `STRIPE_PRICE_SUBSCRIPTION` | `subscription` |

**旧版削除事項:** 月額 3,000 円表記は廃止。コード・特商法・UI はすべて **2,000 円/月** で統一。

### 2-2. 景表法 UI ルール

- **都度 300 円** を基準単価として提示。
- **5 回セット 1,000 円** には必ず次の客観比較を併記:  
  「1 回都度決済（300 円）× 5 回（1,500 円）と比べ、500 円お得」
- **月額 2,000 円** は独立プランとして提示（他プランとの不当な二重価格表示をしない）。
- 初日から「通常価格 1,500 円のところ…」等の **8 週間ルール違反表現は禁止**。

### 2-3. 決済フロー（現行）

1. ユーザーが `public/index.html` でテキスト入力・プラン選択
2. 「行動分析を実行」→ 入力を `sessionStorage` に保存 → **`GET /api/checkout?plan=...&locale=...`**
3. Stripe Checkout 完了 → `https://get-kairos.online/success` → `/?checkout=success`
4. トップで `sessionStorage` のテキストを使い **`POST /api/analyze`** → 深層心理レポート描画

### 2-4. 必須環境変数（Vercel Production）

| 変数 | 用途 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API |
| `STRIPE_PUBLISHABLE_KEY` | PaymentIntents UI 用 |
| `STRIPE_PRICE_SINGLE` | Checkout 都度 |
| `STRIPE_PRICE_BUNDLE` | Checkout セット |
| `STRIPE_PRICE_SUBSCRIPTION` | Checkout 月額 |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名（未設定時 Webhook は 503）— **Production に要追加** |
| `GEMINI_API_KEY` | AI 解析 |

ローカルは `.env`（`dotenv` — `api/index.js` 1 行目）。**`.env` は Vercel に自動同期されない。** 本番追加後は `vercel deploy --prod --force` が必要。

---

## 3. 解析 API・UI 用語（現行）

### 3-1. `/api/analyze` レスポンス JSON

| フィールド | UI ラベル |
|---|---|
| `synchronicityScore` | シンクロニシティ・スコア |
| `thoughtResonanceVector` | 思考共鳴ベクトル |
| `mindTuning` | マインド・チューニング |
| `deepSynchronicity` | 深層シンクロニシティ |

レポート見出し: **深層心理レポート**

### 3-2. 多言語

- クライアント: `navigator.languages` → `public/locales/*.json`
- 解析: リクエスト `locale` + `Accept-Language`（`getClientLocale`）
- Checkout: `locale=ja` → Stripe UI `ja`、それ以外 `auto`

---

## 4. 法的防御（実装済み）

| 項目 | 場所 |
|---|---|
| 特商法（3 プラン・事業者情報） | `/legal/tokushoho` + `index.html` フッターモーダル |
| 利用規約（エンタメ完全免責・返金不可） | 同上モーダル |
| 事業者 | KAIROS Behavioral Analytics 運営事務局 / 井伊聖二 / 銀座住所 / 050-1792-9036 / kairos.official.owner@gmail.com |

---

## 5. セキュリティ・地域制限（実装済み）

| 項目 | 実装 |
|---|---|
| ジオブロック | **`CN`, `HK`, `MO` のみ**（`lib/geo-block.js` + `api/index.js` middleware） |
| 旧版削除 | RU / KP ブロックは **現コードに未実装**。追加する場合は別タスク |

---

## 6. バイラル・ループ（現フェーズ）

| 項目 | 状態 |
|---|---|
| UI | `#エンタメカイロス` シェアボタン（URL 直リンクなし — X 課金回避） |
| 報酬 | 手動 DM で 100 円 OFF クーポン（自動検知・Promotion Codes API は **未実装**） |
| 検証 | 共有→再決済の CVR を手動計測してから自動化 |

---

## 7. 未実装 / 仮実装（将来要件）

| 要件 | 状態 |
|---|---|
| DB ペイウォール | **仮実装** — `lib/kairos-transactions.js`（インメモリ）+ Stripe Session 照会。Postgres 永続化は未実装 |
| `/api/unseal` | **実装済（最小）** — `GET /api/unseal?session_id=` で決済検証 |
| teaser/full 分離 | **実装済（最小）** — 未決済: 100 文字ティザー / 決済済み `checkoutSessionId`: 300 文字フル |
| 画像マルチモーダル解析 | 未実装 |
| 回数券・サブスク DB 連動 | 未実装（Webhook は `kairos_transactions` に記録のみ） |
| PostgreSQL 本番 | `DATABASE_URL` 未設定時は in-memory |
| Pay-Per-Crawl / Cloudflare AI Crawl | 未実装 |
| `ai.txt` / `llms.txt` | 未実装 |
| JSON-LD / AISEO | 未実装 |
| Stripe Promotion Codes 自動発行 | 未実装 |
| Next.js / middleware.ts | 未使用 |

### 多言語（2026-05-24 実装）

| ロケール | UI (`public/locales`) | `/api/analyze` 出力 | Stripe Checkout UI |
|---|---|---|---|
| `ja` | ✅ | 日本語 | `ja` |
| `en` | ✅ | English | `en` |
| `es` | ✅ | Español | `es` |
| `fr` | ✅ | Français | `fr` |
| `de` | ✅ | Deutsch | `de` |

- ブラウザ言語またはヘッダー右上の言語セレクタで切替（`sessionStorage.kairos_locale`）
- 正本ロジック: `lib/kairos-locale.js`


1. `analyze-btn` → `sessionStorage.kairos_pending_input` 保存 → `/api/checkout`
2. Stripe 成功 → `/success?session_id=cs_…` → `/?checkout=success&session_id=cs_…`
3. `POST /api/analyze` に `checkoutSessionId` を付与
4. サーバーは **Stripe API 照会**（Webhook 未到着 race 対策）+ インメモリ台帳で `accessTier: full` を返す

### 決済検証に使うセッション情報（最短方針）

| 情報 | 用途 |
|---|---|
| `checkoutSessionId`（`cs_` プレフィックス） | フロント→API の決済証明。success URL から取得 |
| Stripe `checkout.sessions.retrieve` | 権威ある `payment_status === 'paid'` 判定 |
| Webhook `checkout.session.completed` | インメモリ台帳への記録・ログ（補助） |
| `sessionStorage.kairos_pending_input` | 決済前後の同一入力テキスト保持（決済証明ではない） |

---

## 8. デプロイ手順（正）

```bash
git push origin main          # GitHub 同期
vercel deploy --prod --force  # キャッシュ無効・本番反映
```

GitHub push だけでは Vercel 自動デプロイが走らない場合がある（2026-05 実績）。本番確認は必ず URL を curl / ブラウザで検証。

---

## 9. 優先タスク（収益化順）

1. **決済後 E2E** — Checkout → success → analyze レポート表示の実機確認
2. **`STRIPE_WEBHOOK_SECRET`** — Vercel Production 設定
3. **解析品質** — `/api/analyze` プロンプトと入力ログ
4. **海外ロケール実機** — en 環境で UI + 解析 + Checkout
5. **DB ペイウォール** — ブループリント §7 の要件（設計→実装）
6. **バイラル自動化** — CVR 10% 超え後に Promotion Codes

---

## 10. 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-05-24 | Webhook ログ強化、ペイウォール仮実装（teaser/full）、E2E session_id 連携 |
| 旧版 | 複数 docx / 引継ぎ文書の統合前（参照禁止） |

---

*このファイルが DEEP リサーチ・Cursor・サーの三者で参照する唯一の仕様正本とする。旧 docx の記述と矛盾する場合は本ファイルおよび `git` 上のコードを優先する。*
