# Stripe — 支払い失敗・Checkout 放棄の回収（手放し設定）

**所要時間:** 約10分（コード不要・Stripe ダッシュボードのみ）

---

## 1. 支払い失敗メール（カード拒否・3DS失敗後）

1. [dashboard.stripe.com](https://dashboard.stripe.com) にログイン  
2. **設定（Settings）** → **ビジネス設定** → **顧客メール**  
   （英語UI: Settings → Business → Customer emails）  
3. **失敗した支払い** を **オン**  
4. 保存  

→ 再試行リンク付きメールが Stripe から自動送信されます。

---

## 2. Checkout 放棄リカバリ（カート離脱）

1. **設定** → **Checkout** → **メール** または **リカバリ**  
2. **放棄された Checkout のメール** を有効化  
3. 送信タイミング（例: 1時間後）を選ぶ  

※ 本番 URL（`get-kairos.online`）の Checkout のみが対象。

---

## 3. Smart Retries（推奨）

1. **設定** → **請求（Billing）** → **Retries**  
2. **Smart Retries** をオン  

---

## 確認

**支払い** → 失敗した決済に「メール送信済み」が付くか、テスト決済で確認。

---

*KAIROS 側のコード変更は不要。Webhook は既存の `checkout.session.completed` のまま。*
