/**
 * ローカル開発用エントリ（`npm start`）。
 * Vercel 本番は api/index.js の default export のみを使用し、listen は行いません。
 */
require('dotenv').config();
const app = require('./api/index');

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`
 ==================================================
   KAIROS 自律履行エンジン（ローカル）
   Port: ${port}
   Gemini 3.1 Flash-Lite: ${process.env.GEMINI_API_KEY ? 'キー設定済' : 'GEMINI_API_KEY 未設定'}
   Status: DYNAMIC_OMEN_ENABLED_V2 (2026.05.12)
 ==================================================
  `);
});
