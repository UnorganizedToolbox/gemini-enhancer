// /api/generate.js (管理者除外ロジック修正版)

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@vercel/kv";

const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // フロントエンドから送られてくるキーを取得
  const { adminKey } = req.body;
  const ADMIN_KEY = process.env.ADMIN_KEY;
  const isAdmin = ADMIN_KEY && adminKey === ADMIN_KEY;

  // ★★★ 修正ポイント：管理者でない場合のみ、レートリミット処理を実行 ★★★
  if (!isAdmin) {
    const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
    const limit = 5;
    const duration = 60 * 60 * 24; // 24時間

    const key = `ratelimit_${ip}`;
    const current = await kv.get(key);

    // 上限チェック
    if (current && current >= limit) {
      return res.status(429).json({ error: `レートリミットを超えました。24時間後に再試行してください。` });
    }

    // 上限に達していなければ、カウントを1増やし、有効期限をセット
    await kv.incr(key);
    if (!current) {
      await kv.expire(key, duration);
    }
  }
  
  // --- ここから下は、管理者か、レートリミット内の一般ユーザーのみが実行 ---

  try {
    const { chatHistory, systemPrompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("APIキーが設定されていません。");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
      systemInstruction: { parts: [{ text: systemPrompt }] },
    });
    const result = await model.generateContent({ contents: chatHistory });
    const response = result.response;
    const modelResponseText = response.text();
    
    res.status(200).json({ text: modelResponseText });

  } catch (error) {
    console.error('Error in API route:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}
