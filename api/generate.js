// /api/generate.js (2エージェント構成・修正版)

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
        // --- 認証とレートリミットのロジック (変更なし) ---
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: '認証トークンが必要です。' });
        const jwks = jose.createRemoteJWKSet(new URL(`https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`));
        const { payload } = await jose.jwtVerify(token, jwks, { issuer: `https://${process.env.AUTH0_DOMAIN}/`, audience: process.env.AUTH0_AUDIENCE });
        const userId = payload.sub;
        if (!userId) return res.status(401).json({ error: '無効なトークンです。' });
        const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
        const isAdmin = ADMIN_USER_ID && userId === ADMIN_USER_ID;
        if (!isAdmin) {
            const key = `ratelimit_${userId}`;
            const limit = 5;
            const duration = 24 * 60 * 24;
            const currentUsage = await kv.get(key);
            if (currentUsage && currentUsage >= limit) {
                return res.status(429).json({ error: `利用回数の上限に達しました。24時間後に再試行してください。` });
            }
            await kv.incr(key);
            if (!currentUsage) {
                await kv.expire(key, duration);
            }
        }

        const { chatHistory } = req.body;
        if (!Array.isArray(chatHistory)) throw new Error("chatHistory must be an array.");

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("APIキーが設定されていません。");

        const genAI = new GoogleGenerativeAI(apiKey);
        
        // --- 1. エージェント1 (調査担当) の実行 ---
        const researcherSystemPrompt = `## あなたの役割\nあなたは「リサーチャー」です。ユーザーからの要求に基づき、Google検索ツールを徹底的に活用して、正確で包括的な情報を収集・整理することが唯一の任務です。\n\n## 行動原則\n- ユーザーの要求に関連する情報を、信頼できる情報源から複数収集します。\n- 収集した情報を、次の担当者が記事を執筆しやすいように、構造化された箇条書き形式で客観的に要約してください。\n- あなた自身が記事の本文を執筆したり、解説を加えたりする必要はありません。事実のリストアップに徹してください。\n- 図や表の作成は行いません。\n\n## 出力形式\n必ず以下のMarkdown形式で出力してください。\n\`\`\`markdown\n## 調査結果サマリ\n### トピック1\n- 重要な事実A\n- 重要な事実B\n### トピック2\n- 重要な事実C\n- 関連データD\n\`\`\``;
        
        const researcherModel = genAI.getGenerativeModel({
            model: "gemini-1.5-pro-latest",
            systemInstruction: { parts: [{ text: researcherSystemPrompt }] },
        });

        console.log("エージェント1 (調査担当) を実行中...");
        const researcherResult = await researcherModel.generateContent({
            contents: chatHistory,
            tools: [{ googleSearchRetrieval: {} }]
        });
        const researchSummary = researcherResult.response.text();
        console.log("エージェント1 完了。調査結果:\n", researchSummary);

        // --- 2. エージェント2 (記事化担当) の実行 ---
        const originalUserPrompt = chatHistory[chatHistory.length - 1].parts[0].text;
        const writerSystemPrompt = `## あなたの役割\nあなたは「テクニカルライター兼イラストレーター」です。リサーチャーから提供された「調査結果サマリ」を元に、読者にとって最も理解しやすい解説記事を完成させることが唯一の任務です。\n\n## 行動原則\n- **与えられた「調査結果サマリ」の情報のみを信頼できる情報源とし、それ以外の知識やGoogle検索は絶対に使用しないでください。**\n- 文章による説明だけでは不十分だと判断した箇所では、**Mermaidを用いてフローチャートなどの図を積極的に作成してください。**\n- 数式や科学的表記が必要な場合は、**LaTeXを必ず使用してください。**\n- 最終的な出力は、一つの完成された記事として構成してください。\n\n## 出力に関する指示\n(ここに参考文献などの指示を記述)`;

        const writerModel = genAI.getGenerativeModel({
            model: "gemini-1.5-pro-latest",
            systemInstruction: { parts: [{ text: writerSystemPrompt }] },
        });
        
        const writerPrompt = `以下の【元の依頼】と【調査結果サマリ】に基づいて、指示通りに図表を多用した完成された解説記事を作成してください。\n\n【元の依頼】\n${originalUserPrompt}\n\n【調査結果サマリ】\n${researchSummary}`;

        console.log("エージェント2 (記事化担当) を実行中...");
        const writerResult = await writerModel.generateContent(writerPrompt);
        
        const finalArticle = writerResult.response.text();
        res.status(200).json({ text: finalArticle });

    } catch (error) {
        console.error('Error in API route:', error);
        res.status(500).json({ error: error.message || 'サーバーでエラーが発生しました。' });
    }
}
