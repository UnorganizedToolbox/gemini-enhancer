// /api/generate.js (検索ツール対応版)

import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from "@google/generative-ai";
import { createClient } from "@vercel/kv";
import * as jose from 'jose';

// Vercel KVクライアントを初期化
const kv = createClient({
  url: process.env.UPSTASH_URL,
  token: process.env.UPSTASH_TOKEN,
});

// Google Searchを実行するヘルパー関数
async function executeGoogleSearch(query) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Search API error! status: ${response.status}`);
    }
    const data = await response.json();
    // 検索結果のタイトルとスニペットを要約して返す
    const summary = data.items?.map(item => `Title: ${item.title}\nURL: ${item.link}\nSnippet: ${item.snippet}`).join('\n\n');
    console.log(summary || "検索結果が見つかりませんでした。");
    return summary || "検索結果が見つかりませんでした。";
  } catch (error) {
    console.error("Google Search failed:", error);
    return "検索中にエラーが発生しました。";
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. 認証とレートリミット (以前のコードと同じ)
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '認証トークンが必要です。' });
    
    const jwks = jose.createRemoteJWKSet(new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`));
    const { payload } = await jose.jwtVerify(token, jwks, { /* ... */ });
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

    // 2. Gemini API との会話ループ
    const { chatHistory, systemPrompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("APIキーが設定されていません。");

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Geminiにツールの存在を教える
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

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(req.body.userPrompt); // userPromptをbodyに追加する必要がある
    const response = result.response;

    // AIがツールを使おうとしたかチェック
    const functionCalls = response.functionCalls();
    if (functionCalls) {
      const call = functionCalls[0];
      if (call.name === 'google_search') {
        const query = call.args.query;
        // 実際に検索を実行
        const searchResult = await executeGoogleSearch(query);
        // 検索結果をAIに送り返す
        const finalResult = await chat.sendMessage([{
          functionResponse: {
            name: "google_search",
            response: { content: searchResult },
          }
        }]);
        // 最終的な回答を返す
        res.status(200).json({ text: finalResult.response.text() });
      }
    } else {
      // ツールを使わなかった場合は、そのまま回答を返す
      res.status(200).json({ text: response.text() });
    }

  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
        return res.status(401).json({ error: '認証トークンが期限切れです。再度ログインしてください。' });
    }
    console.error('Error in API route:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}
