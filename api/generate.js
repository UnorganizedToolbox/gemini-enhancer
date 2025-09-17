// /api/generate.js

// Gemini APIと通信するためのクライアントをインポートします
// ※事前に `npm install @google/generative-ai` を実行するか、Vercelの機能で追加してください
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  // POSTリクエスト以外は拒否します
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // フロントエンド(index.html)から送られてきた会話履歴とシステムプロンプトを受け取ります
    const { chatHistory, systemPrompt } = req.body;

    // Vercelの環境変数から、安全にAPIキーを読み込みます
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("APIキーが設定されていません。");
    }

    // Geminiクライアントを初期化します
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest", // モデル名を指定
      systemInstruction: systemPrompt,
    });

    // 会話履歴を使ってチャットセッションを開始します
    const chat = model.startChat({
      history: chatHistory.slice(0, -1), // 最後のユーザーメッセージは使わない
    });

    // 最後のユーザーメッセージを送信します
    const lastUserMessage = chatHistory[chatHistory.length - 1].parts[0].text;
    const result = await chat.sendMessage(lastUserMessage);
    const response = result.response;
    const modelResponseText = response.text();

    // 生成されたテキストをフロントエンドに返します
    res.status(200).json({ text: modelResponseText });

  } catch (error) {
    console.error('Error in API route:', error);
    res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
  }
}
