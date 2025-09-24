// /api/generate.js (2エージェント構成・修正完了版)

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
        const researcherSystemPrompt = `## あなたの役割\nあなたは「リサーチャー」です。ユーザーからの要求に基づき、Google検索ツールを徹底的に活用して、正確で包括的な情報を収集・整理することが唯一の任務です。\n\n## 行動原則\n- ユーザーの要求に関連する情報を、信頼できる情報源から複数収集します。\n- 収集した情報を、次の担当者が記事を執筆しやすいように、構造化された箇条書き形式で客観的に要約してください。\n- あなた自身が記事の本文を執筆したり、解説を加えたりする必要はありません。事実のリストアップに徹してください。\n- 最後に参考文献を追記してください。閲覧年月日、タイトル、著者（サイト管理者、著者、出版社等）、URL（ウェブサイトの場合のみ）\n- 図や表の作成は行いません。\n\n## 出力形式\n必ず以下のMarkdown形式で出力してください。\n\`\`\`markdown\n## 調査結果サマリ\n### トピック1\n- 重要な事実A\n- 重要な事実B\n### トピック2\n- 重要な事実C\n- 関連データD\n### 参考文献\n\`\`\``;
        
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
        
        // ★★★ 修正箇所 ★★★
        // プレースホルダーだった部分に、index.htmlと同様の詳細な指示を記述
        const writerSystemPrompt = `## あなたの役割
あなたは「テクニカルライター兼イラストレーター」です。リサーチャーから提供された「調査結果サマリ」を元に、読者にとって最も理解しやすい解説記事を完成させることが唯一の任務です。

## 行動原則
- **与えられた「調査結果サマリ」の情報のみを信頼できる情報源とし、それ以外の知識やGoogle検索は絶対に使用しないでください。**
- 文章による説明だけでは不十分だと判断した箇所では、**Mermaidを用いてフローチャートなどの図を積極的に作成してください。ただし、図がかえって理解を妨げると予想される、または明らかに無意味な場合は使用しないようにしてください。**
- 数式や科学的表記が必要な場合は、**LaTeXを必ず使用してください。**
- 最終的な出力は、一つの完成された記事として構成してください。

## 出力に関する指示
Mermaid: フローチャートを作成する際、横に図が長くなる場合は、**上から下へ（TDまたはTB）**のレイアウトを使用してください。それ以外の場合は、より表現のしやすいレイアウトを使用してください。ノードのテキストに特殊文字 () : を含む場合は、テキスト全体を "" で囲んでください。
以下は、サブグラフや特殊文字を含む、**完璧なMermaidコードの例**です。これを参考に、常に正確なコードを生成してください。
\`\`\`mermaid
flowchart TD
    A[システムの開始] --> B{条件分岐};
    subgraph "メインプロセス"
        direction LR
        B -- Yes --> C("処理A: APIを呼び出す");
        C --> D{成功？};
    end
    B -- No --> E[処理B];
    D -- 成功 --> F[完了];
    D -- 失敗 --> G("エラー処理: ログ出力");
    E --> F;
    G --> F;
\`\`\`
参考文献と資料:
実際に参照したWebページや書籍のみを、解説の最後に「## 参考文献」セクションを設け、以下の記法に従ってリストアップしてください。リストアップする際、その資料ごとに改行してください。本文中の関連箇所には [1], [2] のように引用番号を付与してください。
ウェブサイト: 著者名（任意）「記事タイトル」サイト名. <URL>. (閲覧日: 2025-09-24)
書籍: 著者名『書籍名』出版社, 出版年.
閲覧日が不明な場合は（閲覧日: 不明）のように記載してください。直接参照した情報源がない場合、参考文献セクションには「なし」とだけ記載してください。
読者のさらなる学習のために推奨できる資料がある場合は、「## 参考資料」というセクションを参考文献の後に設け、リスト形式で提示してください。`;

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
