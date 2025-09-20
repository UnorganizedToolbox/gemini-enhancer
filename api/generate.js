import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@vercel/kv";
import * as jose from 'jose';

const kv = createClient({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '認証トークンが必要です。' });
    
    const jwks = jose.createRemoteJWKSet(new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`));
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      audience: process.env.AUTH0_AUDIENCE,
    });
    const userId = payload.sub;
    if (!userId) return res.status(401).json({ error: '無効なトークンです。' });

    const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
    const isAdmin = ADMIN_USER_ID && userId === ADMIN_USER_ID;

    if (!isAdmin) {
      const key = `ratelimit_${userId}`;
      const limit = 5;
      const duration = 60 * 60 * 24;
      const currentUsage = await kv.get(key);
      if (currentUsage && currentUsage >= limit) {
        return res.status(429).json({ error: `利用回数の上限に達しました。24時間後に再試行してください。` });
      }
      await kv.incr(key);
      if (!currentUsage) {
        await kv.expire(key, duration);
      }
    }

    const { chatHistory, systemPrompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("APIキーが設定されていません。");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro-latest",
      systemInstruction: { parts: [{ text: systemPrompt }] },
    });
    const result = await model.generateContent({ contents: chatHistory });
    const modelResponseText = result.response.text();
    
    res.status(200).json({ text: modelResponseText });
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
        return res.status(401).json({ error: '認証トークンが期限切れです。再度ログインしてください。' });
    }
    console.error('Error in API route:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}
