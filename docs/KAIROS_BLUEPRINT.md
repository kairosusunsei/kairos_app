# エンタメカイロス（get-kairos.online）統合ブループリント — 最新版

**文書版:** 2026-05-26（成長フェーズ・Phase 1 反映）  
**ステータス:** リポジトリ実装・本番デプロイに同期した単一正本（Single Source of Truth）  
**旧版からの整理:** 月額価格の二重表記（2,000円 / 3,000円）、ジオブロック国リストの食い違い、Next.js 前提、未実装 DB ペイウォールの「完成済み」表現を削除・統合した。

---

## 0. プロジェクトの本質

| 項目 | 定義 |
|---|---|
| 名称 | KAIROS / エンタメカイロス |
| 本番 URL | https://get-kairos.online |
| 位置づけ | AI 自己認知テック SaaS（エンタメ心理分析コンテンツ）。意思決定支援・行動プロファイリング。 |
| 収益 | マイクロ決済（都度 300 円）＋ 5 回セット（1,000 円）＋ 月額サブスク（2,000 円/月） |
| 運用 | 個人極小運用。外部有料ツールへの先行投資は行わない方針 |

**Stripe 審査・表現:** 「占い (Fortune Telling)」関連語は UI・コード・API・決済メタデータで使用禁止。`.cursor/rules/branding.mdc` を参照。

**UI 用語（正）:** 占い/鑑定 → 行動分析　占断/開始 → 解析解禁　占い結果/運勢 → 予兆（レポート見出しは「深層心理レポート」）　宿命/偶然 → 運命

---

## 1. 物理構成（2026-05-24 時点・実装済み）

### 1-1. 技術スタック

| 層 | 実装 |
|---|---|
| フロント | `public/index.html` + Tailwind CSS（`src/input.css` → `public/styles.css`） |
| バックエンド | Node.js Express — **`api/index.js`**（Vercel Serverless エントリ） |
| ローカル開発 | `server.js` → `api/index.js` を listen |
| インフラ | Vercel（Production エイリアス: get-kairos.online） |
| AI | `@google/genai` — **解析・SSE とも `gemini-3.1-flash-lite`**（`api/index.js` の `modelId`） |
| 決済 | Stripe Checkout（303 リダイレクト）＋ レガシー PaymentIntents API |

**注意:** 本リポジトリは Next.js プロジェクトではない。ブループリント旧版の Next.js / Route Handlers 記述は本件には該当しない。

### 1-2. API ルート一覧（`api/index.js`）

| メソッド | パス | 役割 |
|---|---|---|
| POST | `/webhook` | Stripe Webhook（署名検証・べき等性・クレジット付与） |
| GET | `/legal/tokushoho` | 特定商取引法に基づく表記（HTML） |
| GET | `/api/status` | サービス設定診断（Gemini/Stripe/Webhook 有無） |
| GET | `/api/checkout-health` | **Stripe Price ID 実体診断**（`unit_amount` 含む） |
| POST | `/api/checkout/prepare` | Checkout 直前の入力テキスト保持（`prepareId`） |
| GET | `/api/checkout` | Stripe Checkout セッション → 303 リダイレクト |
| GET | `/api/credits` | `kairos_user_id` の残クレジット照会 |
| GET | `/api/unseal` | 決済セッション検証（`session_id`） |
| POST | `/api/analyze` | テキスト解析 → JSON（Gemini / フォールバック分岐） |
| GET | `/api/gemini-stream` | SSE デモストリーム |
| POST | `/api/payment-intent` | PaymentIntents（human / agent x402） |
| GET | `/api/share-card` | 紹介用シェアカード SVG（`score`, `teaser`, `locale`, `ref`） |
| GET | `/api/share-card.png` | シェアカード PNG（1080×1080、`@resvg/resvg-js`） |
| GET | `/api/og` | Open Graph 用 SVG（1200×630） |
| GET | `/api/og.png` | OG 用 PNG（**`og:image` 推奨**） |
| GET | `/api/og/meta` | OG メタ JSON（デバッグ・将来 SSR 用） |
| GET | `/invite` | 紹介ランディング HTML（クローラ向け OG 完備） |
| GET | `/api/share-card/fixtures` | プレビュー用フィクスチャ JSON |
| POST | `/api/referral/visit` | `?ref=` 着地の訪問記録 |
| GET | `/api/admin/metrics` | 紹介集計＋Stripe 概要（`X-KAIROS-Admin-Key` 要） |

`vercel.json` で `/api/*`, `/webhook`, `/legal/tokushoho` を `api/index.js` に rewrite。

### 1-3. 静的アセット

| パス | 内容 |
|---|---|
| `public/index.html` | メイン UI・プラン選択・スカラベオーバーレイ・法的モーダル |
| `public/scarab-anchor.png` | **ビジュアル・アンカー**（解析中オーバーレイ・レポート内マーク） |
| `public/scarab.svg` | ヘッダー簡易マーク |
| `public/success/index.html` | 決済成功 → `/?checkout=success&session_id=...` |
| `public/canceled/index.html` | 決済キャンセル |
| `public/locales/{ja,en,es,fr,de,it,pt}.json` | UI 文言 |
| `public/share-card-preview.html` | シェアカード TC1–TC5 ビジュアルプレビュー |
| `public/admin/dashboard.html` | 紹介・決済メトリクス（管理者） |
| `lib/share-card.js` | 1080×1080 SVG 生成 |
| `lib/og-card.js` | 1200×630 OG SVG + `/invite` HTML |
| `lib/social-image.js` | 画像クエリ正規化・公開 URL ビルダ |
| `lib/rasterize-svg.js` | SVG→PNG（`@resvg/resvg-js`） |
| `lib/referral-attribution.js` | 紹介 visit / conversion 集計（インメモリ） |
| `docs/VIRAL_SHARE_OG_DESIGN.md` | OG / PNG / Web Share 設計正本 |
| `components/PricingPlanSelector.tsx` | React コンポーネント（現フロント未組込・参照用） |

### 1-4. スカラベ・ビジュアル・アンカー（2026-05-24 実装）

| 要素 | 実装 |
|---|---|
| コンセプト | 解析解禁時の動的ビジュアル・アンカー（琥珀クリスタル＋発光）。心理的トリガー兼待機 UI |
| アセット | `public/scarab-anchor.png`（添付正本を配置） |
| 解析中 | 全画面オーバーレイ `#scarab-analyze-overlay` ＋ CSS `scarab-anchor-pulse` / `scarab-anchor-glow` |
| レポート | `#report-scarab` 内でも同一 PNG。解禁時 `playScarabUnseal()` |
| 未実装 | 内部回路の独立脈動（動画/Lottie レベル）。現状は PNG 全体への CSS 発光 |

**将来拡張:** ループ WebM（3〜5 秒）または Lottie で「バイオルミネッセンス回路」表現を段階導入可。

---

## 2. 決済・景品表示法（完全適合設計）

### 2-1. 料金体系（正）

| プラン ID | 価格（税込） | Stripe 環境変数 | Checkout mode | 付与クレジット |
|---|---|---|---|---|
| `single` | 300 円 | `STRIPE_PRICE_SINGLE` | `payment` | **1 回** |
| `bundle` | **1,000 円**（5 回セット） | `STRIPE_PRICE_BUNDLE` | `payment` | **5 回** |
| `subscription` | **2,000 円/月** | `STRIPE_PRICE_SUBSCRIPTION` | `subscription` | （利用期限ロジック未実装） |

**旧版削除事項:** 月額 3,000 円表記は廃止。コード・特商法・UI はすべて **2,000 円/月** で統一。

**Stripe 本番 Price ID 診断（必須運用）:**

```
GET https://get-kairos.online/api/checkout-health
```

| フィールド | 意味 |
|---|---|
| `plans.bundle.ok` | `true` なら 5 回セット Checkout 可能 |
| `plans.bundle.unit_amount` | 本番請求額（JPY）。**1000** が正 |
| `plans.bundle.priceId` | Vercel `STRIPE_PRICE_BUNDLE` と一致する実 ID |

**障害事例（2026-05-24 解消済）:** `STRIPE_PRICE_BUNDLE` の 1 文字誤り（`pI0` と `pl0` — 大文字 **I** と小文字 **l**）。商品カタログに商品があっても Price ID が不一致だと `No such price` となる。**Stripe ダッシュボードから API ID をコピーし、Vercel Production を更新 → `vercel deploy --prod --force`。**

### 2-2. 景表法 UI ルール

- **都度 300 円** を基準単価として提示。
- **5 回セット 1,000 円** には必ず次の客観比較を併記:  
  「1 回都度決済（300 円）× 5 回（1,500 円）と比べ、500 円お得」
- **月額 2,000 円** は独立プランとして提示。
- 初日から「通常価格 1,500 円のところ…」等の **8 週間ルール違反表現は禁止**。
- 利用不可プランは `checkout-health` で検知し UI 上グレーアウト（`checkoutPlanHealth`）。

### 2-3. 決済・解析フロー（現行）

#### A. クレジットあり（都度購入済み / 5 回セット残あり）

1. テキスト入力 → 「行動分析を実行」
2. `GET /api/credits` で残回数確認
3. **`POST /api/analyze`**（`inputText`, `kairosUserId`, `analyzeRequestId`）  
   - 解析中: スカラベ全画面オーバーレイ表示  
   - 成功: クレジット 1 消費、`generatedBy: "gemini"`

#### B. クレジットなし（初回・使い切り後）

1. テキスト入力 → プラン選択
2. `sessionStorage.kairos_pending_input` に保存
3. `POST /api/checkout/prepare`（任意）または `GET /api/checkout?plan=...&locale=...`
4. Stripe Checkout 完了 → `/success` → `/?checkout=success&session_id=cs_...`
5. 自動 **`POST /api/analyze`**（`checkoutSessionId` + 入力復元）  
   - 入力優先順: **画面上のテキストエリア** ＞ `sessionStorage` ＞ Stripe Session `metadata.inputText`
6. サーバー: Stripe `checkout.sessions.retrieve` で `paid` 確認 → プランに応じクレジット付与 → Gemini 解析

#### C. 複数回決済（5 回セット）

| イベント | 動作 |
|---|---|
| `bundle` 決済完了 | `lib/kairos-credits.js` が **+5 クレジット**（同一 `session.id` は 1 回のみ付与） |
| 解析成功ごと | **-1 クレジット**（`analyzeRequestId` 単位で冪等消費） |
| 残 0 | `purchaseRequired` / ティザー or 再購入 UI |

**台帳キー:** ブラウザ `localStorage.kairos_user_id`（`kairos_` プレフィックス）

### 2-4. 必須環境変数（Vercel Production）

| 変数 | 用途 |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API（本番 Live） |
| `STRIPE_PUBLISHABLE_KEY` | PaymentIntents UI 用 |
| `STRIPE_PRICE_SINGLE` | Checkout 都度（例: `price_1TIZ93...`） |
| `STRIPE_PRICE_BUNDLE` | Checkout 5 回（例: `price_1TZbLw...p**I**0BMRhX` — **I/l 要注意**） |
| `STRIPE_PRICE_SUBSCRIPTION` | Checkout 月額 |
| `STRIPE_WEBHOOK_SECRET` | Webhook 署名（未設定時 503） |
| `GEMINI_API_KEY` | AI 解析 |

ローカルは `.env`（`dotenv`）。**`.env` は Vercel に自動同期されない。** 本番変更後は `vercel deploy --prod --force`。

---

## 3. 解析 API・品質（2026-05-24 修正反映）

### 3-1. `/api/analyze` レスポンス JSON

| フィールド | UI ラベル / 意味 |
|---|---|
| `success` | リクエスト処理成功 |
| `generatedBy` | **`"gemini"`** = 個別生成 / **`"fallback"`** = 定型プレビュー（無料ティザーのみ想定） |
| `accessTier` | `"full"` / `"teaser"` |
| `locked` | 未解禁時 `true` |
| `synchronicityScore` | シンクロニシティ・スコア（77–99） |
| `thoughtResonanceVector` | 思考共鳴ベクトル |
| `mindTuning` | マインド・チューニング |
| `deepSynchronicity` | 深層シンクロニシティ |
| `creditsRemaining` | 残解析回数 |
| `inputEcho` | サーバーが解釈した入力先頭（デバッグ・検証用、最大 120 文字） |
| `checkoutSessionId` | 決済連携時 |

レポート見出し: **深層心理レポート**

### 3-2. 生成品質ルール（実装）

| ルール | 内容 |
|---|---|
| モデル | `gemini-3.1-flash-lite`（解析・SSE 統一） |
| 入力拘束 | プロンプトでユーザー入力の**具体語を必須引用** |
| 有料解析失敗時 | **HTTP 503** `generation_failed` — **クレジット未消費**、定型文を成功扱いで返さない |
| 定型フォールバック | `lib/kairos-locale.js` の `WARM_FALLBACK`（スコア 88 固定文）。**無料ティザー専用** |
| 検証目安 | スコアが入力ごとに変動（例: 89）、本文に入力トピックが現れること |

**障害事例（2026-05-24 解消済）:** Gemini 失敗時に `WARM_FALLBACK` を 200 で返していたため、入力が違っても同一 3 段落（スコア 88）が表示された。

### 3-3. 多言語

| ロケール | UI (`public/locales`) | `/api/analyze` 出力 | Stripe Checkout UI |
|---|---|---|---|
| `ja` | ✅ | 日本語 | `ja` |
| `en` | ✅ | English | `auto`（非 ja は auto） |
| `es` / `fr` / `de` / `it` / `pt` | ✅ | 各言語 | `auto` |

- 切替: ブラウザ言語 or ヘッダー言語セレクタ（`sessionStorage.kairos_locale`）
- 正本: `lib/kairos-locale.js`

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
| 旧版削除 | RU / KP ブロックは **現コードに未実装** |

---

## 6. 成長フェーズと規模の前提（2026-05-26）

### 6-1. 規模の位置づけ（明言）

| 指標 | 個人・無広告・無スパム（Phase 0–2） | Phase 3 以降（別組織・予算・チャネル） |
|---|---|---|
| 月間アクティブ相当 | 数百〜数千（現実レンジ） | **月 20 万人**（長期 aspirational 目標） |
| 月商 | 数十万〜数百万円規模 | **月商 3 億円**（長期 aspirational 目標） |

**「無理」ではないが、現体制のままでは到達不能に近い。** 長期目標としてブループリントに掲げ、Phase 3 以降で組織・予算・チャネル（提携・広告・代理店・B2B 等）を別途設計する。

旧 docx の「42 日 30 万人」「日給 3 億」等の数値は**採用しない**。上記はオーナー合意の長期 aspirational 目標のみ。

### 6-2. フェーズ定義

| Phase | 内容 | 状態 |
|---|---|---|
| **0** | 単一 URL・Stripe 3 プラン・解析解禁・スカラベ UI | **実装済** |
| **1** | シェアカード SVG + `?ref=` 紹介 + 訪問/コンバージョン集計 + 運用ダッシュボード | **実装済（2026-05-26）** |
| **2** | Postgres 永続台帳・紹介報酬（Promotion Code）・A/B 計測 | 未実装 |
| **3** | 組織拡張・チャネル投資・月 20 万人 / 月商 3 億へのスケール設計 | 計画のみ |

### 6-3. Phase 1 — シェアカード仕様

| 項目 | 値 |
|---|---|
| サイズ | 1080×1080 SVG |
| 背景 | `#0f0731`、金枠、中央グロー |
| 表示 | シンクロニシティ・スコア（77–99）、思考共鳴ベクトル抜粋（ja 約 72 字で省略） |
| フッター | `get-kairos.online`、`#エンタメカイロス`（en: `#EntertainKAIROS`） |
| 紹介 | `ref` クエリ付きランディング URL をカード内に埋め込み可 |

**テストケース（プレビュー）:** `GET /share-card-preview.html`

| ID | 内容 |
|---|---|
| TC1 | 日本語・スコア 89 |
| TC2 | 日本語・スコア 99 |
| TC3 | English・スコア 91 |
| TC4 | 長文省略確認 |
| TC5 | 最小入力（空 teaser） |

**禁止（スパム・Stripe リスク回避）:** 自動 SNS 投稿、シェア強制、決済解除の条件付きシェア。

### 6-4. Phase 1 — 紹介フロー

1. ユーザー A の `localStorage.kairos_user_id` が `kairos_xxx` 形式の紹介コード。
2. 共有 URL（推奨）: `https://get-kairos.online/invite?ref=kairos_xxx`（OG プレビュー付き）。着地は `/?ref=` も可。
3. 着地時: `POST /api/referral/visit`、コードを `localStorage.kairos_referral_code` に保存。
4. 決済時: `POST /api/checkout/prepare` に `referralCode` → Stripe `metadata.referralCode` → Webhook で `recordConversion`。

集計は **インメモリ**（cold start でリセットの可能性）。本番運用は Phase 2 の DB 永続化を推奨。

### 6-5. 運用ダッシュボード

- URL: `/admin/dashboard.html`
- API: `GET /api/admin/metrics`（ヘッダ `X-KAIROS-Admin-Key: <KAIROS_ADMIN_SECRET>`）
- Vercel Production に `KAIROS_ADMIN_SECRET` を設定すること。

### 6-6. フロント統合（`public/index.html`）

- 解析完了（`accessTier: full`）後にシェアカードプレビュー・保存・X intent。
- フッター `#viral-loop-banner` に TC プレビューへのリンク。
- 手動 DM 100 円 OFF は引き続き運用オプション（自動化は Phase 2 以降）。

---

## 7. 実装状況マトリクス

| 要件 | 状態 |
|---|---|
| Stripe Checkout 3 プラン | **実装済**（Price ID は `checkout-health` で要監視） |
| Webhook + セッション照会 | **実装済**（race 対策） |
| 5 回セットクレジット | **実装済（最小）** — `lib/kairos-credits.js` |
| 都度 1 回クレジット | **実装済** |
| クレジット消費の冪等性 | **実装済** — `analyzeRequestId` / `checkoutSessionId` |
| teaser / full 分離 | **実装済（最小）** — 100 字 / 300 字 |
| 決済後 E2E | **実機確認済（2026-05-24）** — 入力連動の Gemini 生成 |
| スカラベ・オーバーレイ | **実装済（PNG + CSS）** |
| `/api/checkout-health` | **実装済** |
| `POST /api/checkout/prepare` | **実装済** — `lib/checkout-pending.js` |
| 解析 `generatedBy` フラグ | **実装済** |
| 有料解析の失敗時クレジット保護 | **実装済** |
| クレジット永続化（Stripe Customer metadata） | **実装済** — `lib/kairos-credits-ledger.js`（`DATABASE_URL` 時は Postgres） |
| Phase 1 シェアカード + 紹介 | **実装済** — `lib/share-card.js`, `lib/referral-attribution.js` |
| 紹介・メトリクス DB 永続化 | **未実装**（紹介集計はインメモリ） |
| DB / Postgres 永続化（全台帳） | **部分** — クレジットのみ Postgres 可。紹介は未 |
| 月額サブスク利用期限 | **未実装** |
| 画像マルチモーダル解析 | **未実装** |
| スカラベ動画/Lottie | **未実装** |
| Pay-Per-Crawl / `ai.txt` | **未実装** |
| Stripe Promotion Codes 自動 | **未実装** |
| Next.js | **未使用** |

### 決済検証に使うセッション情報

| 情報 | 用途 |
|---|---|
| `checkoutSessionId`（`cs_`） | フロント→API の決済証明 |
| Stripe `checkout.sessions.retrieve` | `payment_status === 'paid'` |
| Webhook `checkout.session.completed` | 台帳・クレジット付与（補助） |
| `metadata.inputText` | 入力復元（最大 500 文字） |
| `sessionStorage.kairos_pending_input` | 決済前後の入力保持（証明ではない） |
| `localStorage.kairos_user_id` | クレジット台帳のユーザーキー |

---

## 8. デプロイ・運用手順（正）

```bash
git push origin main          # GitHub 同期（任意）
vercel deploy --prod --force  # 本番反映（env 変更後は必須）
```

**本番確認チェックリスト:**

1. `GET /api/status` → `geminiConfigured`, `stripeConfigured` が true  
2. `GET /api/checkout-health` → 3 プラン `ok: true`、`bundle.unit_amount: 1000`  
3. `GET /scarab-anchor.png` → 200  
4. 実決済 or 残クレジットで解析 → 入力内容がレポートに反映、`generatedBy: gemini`

GitHub push のみでは Vercel 自動デプロイが走らない場合がある。URL 実機確認を必須とする。

---

## 9. 優先タスク（収益化順・2026-05-24 更新）

| 優先 | タスク | 状態 |
|---|---|---|
| P0 | 都度 300 円・解析生成・スカラベ UI | **完了（実機確認済）** |
| P0 | `STRIPE_PRICE_BUNDLE` 本番整合 | **完了** |
| P1 | 5 回セット実決済 E2E（残回数 5→4→…→0） | **要再検証** |
| P1 | Webhook 本番ログ・クレジット付与の長期安定 | 運用監視 |
| P2 | 月額サブスク利用期限ロジック | 未実装 |
| P2 | Postgres 永続化（クレジット・決済台帳） | 未実装 |
| P3 | スカラベ WebM/Lottie | 未実装 |
| P1 | Phase 1 シェア・紹介・ダッシュボード | **完了（2026-05-26）** |
| P2 | 紹介 Postgres 永続化 + Promotion Codes | 未実装 |
| P3 | バイラル Promotion Codes 自動化 | CVR 計測後 |
| P3+ | 月 20 万人 / 月商 3 億スケール（組織・チャネル） | 長期目標・Phase 3 |

---

## 10. 変更履歴

| 日付 | 内容 |
|---|---|
| 2026-05-24 午前 | Webhook ログ強化、ペイウォール仮実装（teaser/full）、E2E `session_id` 連携、多言語 7 ロケール |
| 2026-05-24 午後 | **5 回クレジット**（`kairos-credits.js`）、`checkout-health`、プラン UI グレーアウト |
| 2026-05-24 午後 | **`STRIPE_PRICE_BUNDLE` 修正**（`pI0` / `pl0` 取り違え）、本番 `bundle.ok: true`・`unit_amount: 1000` 確認 |
| 2026-05-24 午後 | **スカラベ・ビジュアル・アンカー** — `scarab-anchor.png`、解析中全画面オーバーレイ、CSS 脈動 |
| 2026-05-24 夕方 | **解析品質修正** — Gemini モデル統一、入力拘束プロンプト、有料失敗時 503・クレジット未消費、`generatedBy`、決済戻り入力優先順 |
| 2026-05-24 夕方 | **実機検証** — UAP/トランプ入力 → 決済後レポートが入力連動（スコア 89 等）。定型 88 フォールバック解消を確認 |
| 2026-05-26 | **成長章** — Phase 0–3、長期目標（月 20 万人・月商 3 億）の明記 |
| 2026-05-26 | **Phase 1** — シェアカード API、紹介 visit/conversion、admin metrics、フロント統合、プレビュー HTML |

---

## 11. 関連ファイル索引（実装正本）

| 領域 | ファイル |
|---|---|
| API 全体 | `api/index.js` |
| クレジット | `lib/kairos-credits.js` |
| 決済台帳（インメモリ） | `lib/kairos-transactions.js` |
| Checkout 入力保持 | `lib/checkout-pending.js` |
| クレジット永続（Stripe/Postgres） | `lib/kairos-credits-ledger.js` |
| シェアカード | `lib/share-card.js` |
| 紹介集計 | `lib/referral-attribution.js` |
| ロケール・フォールバック文 | `lib/kairos-locale.js` |
| UI | `public/index.html` |
| Tailwind アニメ | `tailwind.config.js` |
| DEEP 日次命令 | `docs/DEEP_RESEARCH_START_COMMAND.md` |

---

*このファイルが DEEP リサーチ・Cursor・オーナーの三者で参照する唯一の仕様正本とする。旧 docx の記述と矛盾する場合は本ファイルおよび `git` 上のコードを優先する。*
