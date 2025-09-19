// /api/generate.js (認証・レートリミット・管理者除外 機能付き完成版)

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@vercel/kv";
import * as jose from 'jose';

// Vercel KVクライアントを初期化
const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // --- 1. 認証トークンの検証 ---
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: '認証トークンが必要です。' });
    }

    const jwks = jose.createRemoteJWKSet(new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`));
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      audience: process.env.AUTH0_AUDIENCE,
    });
    
    const userId = payload.sub; // ユーザー固有のIDを取得
    if (!userId) {
      return res.status(401).json({ error: '無効なトークンです。' });
    }

    // --- 2. 管理者判定 ---
    const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
    const isAdmin = ADMIN_USER_ID && userId === ADMIN_USER_ID;

    // --- 3. 利用回数制限 (管理者でない場合のみ) ---
    if (!isAdmin) {
      const key = `ratelimit_${userId}`;
      const limit = 5; // 1日の上限回数
      const duration = 60 * 60 * 24; // 24時間

      const currentUsage = await kv.get(key);
      if (currentUsage && currentUsage >= limit) {
        return res.status(429).json({ error: `利用回数の上限に達しました。24時間後に再試行してください。` });
      }
      await kv.incr(key);
      if (!currentUsage) {
        await kv.expire(key, duration);
      }
    }

    // --- 4. Gemini API 呼び出し ---
    const { chatHistory, systemPrompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("APIキーが設定されていません。");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro-latest", // Proモデルを推奨
      systemInstruction: { parts: [{ text: systemPrompt }] },
    });
    const result = await model.generateContent({ contents: chatHistory });
    const response = result.response;
    const modelResponseText = response.text();
    
    res.status(200).json({ text: modelResponseText });

  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
        return res.status(401).json({ error: '認証トークンが期限切れです。再度ログインしてください。' });
    }
    console.error('Error in API route:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}
