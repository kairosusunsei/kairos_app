/**
 * Post-settlement behavioral analytics stream (解析解禁).
 * @param {import('@google/genai').GoogleGenAI} ai
 * @param {string} modelId
 * @param {string} userId
 */
async function logAnalysisDecouplingStream(ai, modelId, userId) {
  const result = await ai.models.generateContentStream({
    model: modelId,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `解析を完了せよ。固有識別子【${userId}】に紐づく観測対象へ、決済完了時点のコンテキストに基づく要約『真実』を提示せよ。`,
          },
        ],
      },
    ],
    config: {
      systemInstruction:
        "あなたは『KAIROS』のAI自己認知テック・コンパニオンです。決済完了により情報の封印が解かれた。ユーザーへ短時間で記憶に残る、温かく励まされるシンクロニシティ・メッセージを100文字以内で出力せよ。占い・予兆・運命の語彙は使わないこと。",
      thinkingConfig: {
        thinkingLevel: 'HIGH',
      },
      maxOutputTokens: 150,
      temperature: 1.0,
    },
  });

  process.stdout.write(' 解放されたインサイト: ');
  for await (const chunk of result) {
    if (chunk.text) process.stdout.write(chunk.text);
  }
  console.log(`\n--- 完了: ${userId} の行動分析出力が確定 ---\n`);
}

module.exports = { logAnalysisDecouplingStream };
