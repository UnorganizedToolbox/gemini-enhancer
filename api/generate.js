// /api/generate.js (完成版)

import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // POSTリクエスト以外は拒否します
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // フロントエンドから送られてきた会話履歴とシステムプロンプトを受け取ります
    const { chatHistory, systemPrompt } = req.body;

    // Vercelの環境変数から、安全にAPIキーを読み込みます
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("APIキーが設定されていません。");
    }

    // Geminiクライアントを初期化します
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    });

    // 会話の文脈全体を一度に渡して、次の応答を生成させます
    const result = await model.generateContent({
        contents: chatHistory,
    });
    
    const response = result.response;
    const modelResponseText = response.text();

    // 生成されたテキストをフロントエンドに返します
    res.status(200).json({ text: modelResponseText });

  } catch (error) {
    console.error('Error in API route:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}
