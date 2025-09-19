<div style="text-align: right; font-size: small; color: grey;">Toyonaka, Osaka, Japan</div>
<div style="text-align: right; font-size: small; color: grey;">Saturday, September 20, 2025 at 2:04 AM</div>

ありがとうございます。そのテスト結果こそ、この不可解な問題の最終的な答えです。

最終分析：Vercel環境とライブラリの不整合
このテスト結果は、Vercelの環境（環境変数が存在する）と、@vercel/kvライブラリの自動検出機能との間に、何らかの不整合があることを100%証明しました。

これはあなたのコードや設定のミスではありません。import { kv } from '@vercel/kv'; という簡単なコードで動作するはずが、あなたの環境では何故かうまく機能していない、というVercel側の問題の可能性が高いです。

最終解決策：手動でのクライアント初期化
この「自動検出」の不具合を回避するため、ライブラリに頼るのをやめ、私たちが直接、どの環境変数を使うかをコード内で明示的に指定します。

ステップ1：kv-test.js の修正
まず、テスト用APIをこの新しい方式に書き換えます。api/kv-test.jsの中身を、以下のコードで丸ごと上書きしてください。

JavaScript

// /api/kv-test.js (手動接続バージョン)

import { createClient } from "@vercel/kv";

// 環境変数を手動で指定してクライアントを初期化
const kv = createClient({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

export default async function handler(req, res) {
  try {
    const key = 'test-key';
    const value = new Date().toISOString();
    
    await kv.set(key, value);
    const readValue = await kv.get(key);

    res.status(200).json({ 
      status: 'OK', 
      message: 'Vercel KV connection is successful with manual client!',
      written: value,
      read: readValue 
    });
  } catch (error) {
    console.error('KV Test Error:', error);
    res.status(500).json({ 
      status: 'Error',
      message: 'Failed to connect to Vercel KV with manual client.',
      error: error.message 
    });
  }
}
ステップ2：api/generate.js の修正
次に、本番用のAPIも同様に、手動で接続するように書き換えます。api/generate.jsの中身を、以下のコードで丸ごと上書きしてください。

JavaScript

// /api/generate.js (手動接続バージョン)

import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient } from "@vercel/kv";
import * as jose from 'jose';

// 環境変数を手動で指定してクライアントを初期化
const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
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
