// /api/generate.js (最終完成・修正版)

import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from "@google/generative-ai";
import { createClient } from "@vercel/kv";
import * as jose from 'jose';

// Vercel KVクライアントを初期化
const kv = createClient({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. 認証トークンの検証
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '認証トークンが必要です。' });
    
    const jwks = jose.createRemoteJWKSet(new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`));
    const { payload } = await jose.jwtVerify(token, jwks, {
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      audience: process.env.AUTH0_AUDIENCE,
    });
    const userId = payload.sub;
    if (!userId) return res.status(401).json({ error: '無効なトークンです。' });

    // 2. 管理者判定
    const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
    const isAdmin = ADMIN_USER_ID && userId === ADMIN_USER_ID;

    // 3. 利用回数制限 (管理者でない場合のみ)
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

    // 4. Gemini API 呼び出し
    const { chatHistory, systemPrompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("APIキーが設定されていません。");

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const tools = [{ 
      functionDeclarations: [{
        name: "google_search",
        description: "最新の情報を得るためにWeb検索を実行する",
        parameters: {
          type: FunctionDeclarationSchemaType.OBJECT,
          properties: { query: { type: FunctionDeclarationSchemaType.STRING, description: "検索クエリ" } },
          required: ["query"],
        },
      }],
    }];
    
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro-latest",
      systemInstruction: { parts: [{ text: systemPrompt }] },
      tools: tools,
    });
    
    // ★★★ 変更点：startChatを使わず、generateContent に会話履歴を直接渡す ★★★
    const result = await model.generateContent({ contents: chatHistory });
    
    // ... (この後のTool Call処理は複雑なので、一旦シンプルな形に戻します) ...
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
