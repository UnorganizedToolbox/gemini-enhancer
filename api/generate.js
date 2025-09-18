// /api/generate.js (レートリミット機能付き完成版)

import { GoogleGenerativeAI } from "@google/generative-ai";
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  // POSTリクエスト以外は拒否
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ★★★ レートリミット処理 ここから ★★★
  const ip = req.headers['x-forwarded-for'] || '127.0.0.1';
  const limit = 5; // 1日の上限回数
  const duration = 60 * 60 * 24; // 24時間

  const key = `ratelimit_${ip}`;
  const current = await kv.get(key);

  if (current && current >= limit) {
    return res.status(429).json({ error: `レートリミットを超えました。24時間後に再試行してください。` });
  }
  // ★★★ レートリミット処理 ここまで ★★★

  try {
    // データベースのカウントを1増やす
    await kv.incr(key);
    // 有効期限をセット (初回のみ)
    if (!current) {
      await kv.expire(key, duration);
    }
    
    // フロントエンドからのデータ受け取り
    const { chatHistory, systemPrompt } = req.body;

    // APIキーの読み込み
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("APIキーが設定されていません。");

    // Gemini APIの呼び出し
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: { parts: [{ text: systemPrompt }] },
    });
    const result = await model.generateContent({ contents: chatHistory });
    const response = result.response;
    const modelResponseText = response.text();

    // フロントエンドに結果を返す
    res.status(200).json({ text: modelResponseText });

  } catch (error) {
    console.error('Error in API route:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}
