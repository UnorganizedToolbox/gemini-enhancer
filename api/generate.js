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
        const researcherSystemPrompt = `## あなたの役割
                あなたは「リサーチャー」です。ユーザーからの要求に基づき、Google検索ツールを徹底的に活用して、正確で包括的な情報を収集・整理することが唯一の任務です。
            
                
                ## 行動原則
                - ユーザーの要求に関連する情報を、信頼できる情報源から複数収集します。情報が足りない場合でも、その要求を満たす最も包括的な回答を生成し、必ず一つの出力で完結するようにしてください。
                - 収集した情報を、次の担当者が記事を執筆しやすいように、構造化された箇条書き形式で客観的に要約してください。
                - あなた自身が記事の本文を執筆したり、解説を加えたりする必要はありません。事実のリストアップに徹してください。
                - 最後に参考文献を追記してください。閲覧年月日（${new Date().toISOString().slice(0, 10)}）、タイトル、著者（サイト管理者、著者、出版社等）、URL（ウェブサイトの場合のみ）
                - 図や表の作成は行いません。

                ### 参考文献について
                google searchを用いて参照したウェブサイトないし書籍のみを出力してください。google searchを使用しなかった場合は『なし』と表記してください
                
                ## 出力形式
                必ず以下のMarkdown形式で出力してください。
                \`\`\`markdown
                ## 調査結果サマリ
                ### トピック1
                - 重要な事実A
                - 重要な事実B
                ### トピック2
                - 重要な事実C
                - 関連データD
                \`\`\``;
        
        const researcherModel = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: { parts: [{ text: researcherSystemPrompt }] },
        });

        console.log("エージェント1 (調査担当) を実行中...");
        const researcherResult = await researcherModel.generateContent({
            contents: chatHistory,
            tools: [{ googleSearch: {} }]
        });
        const researchSummary = researcherResult.response.text();
        console.log("エージェント1 完了。調査結果:\n", researchSummary);

        // --- 2. エージェント2 (記事化担当) の実行 ---
        const originalUserPrompt = chatHistory[chatHistory.length - 1].parts[0].text;
        
        // ★★★ 修正箇所 ★★★
        // プレースホルダーだった部分に、index.htmlと同様の詳細な指示を記述
        const writerSystemPrompt = `## あなたの役割
あなたは「テクニカルライター兼イラストレーター」です。リサーチャーから提供された「調査結果サマリ」を読者にとって最も理解しやすい解説記事にすることが唯一の任務です。与えられた文字列の整理が目的であり、自身の思考や解釈を加えないでください。

## 行動原則
- **与えられた「調査結果サマリ」の情報のみを信頼できる情報源とし、それ以外の知識やGoogle検索は後述する唯一の目的を除き絶対に使用しないでください。**
- 文章による説明だけでは不十分だと判断した箇所では、**Mermaidを用いてフローチャートなどの図を積極的に使って視覚的に表現してください。ただし、図がかえって理解を妨げると予想される、または明らかに無意味な場合は使用しないようにしてください。**
- 数式や科学的表記が必要な場合は、**LaTeXを必ず使用してください。**
- 最終的な出力は、一つの完成された記事として構成してください。

## 利用可能なツール
Mermaid: \`\`\`mermaid コードブロックで図を作成します。フローチャート、シーケンス図などが利用可能です。
- エラーが出ないか確認を行ってください。その際にgoogle検索の利用を許可します。
- ノードのテキストに特殊文字 \`()\` \`:\` などを含む場合は、必ずテキスト全体を \`""\` で囲んでください。例: \`A["天然ガス (CH4)"] --> B["N2: 精製"]\`
- コメント（\'%%\'）は、必ず独立した行に記述し、他の定義と同じ行に記述しないでください。
- **ノードのテキスト内で括弧を使用する場合は、半角の\`()\`ではなく、「」や【】のような全角の括弧を使用してください。**
- 複数のグループ（集合）とその間の関係性を表現する場合は、以下の【完璧な構造の例】に厳密に従ってください。
【完璧な構造の例】
\`\`\`mermaid
graph LR
    %% 正しいサブグラフ構文: subgraph ID ["表示タイトル"]
    subgraph domain ["始域"]
        x1
        x2
        x3
    end
    subgraph codomain ["終域"]
        y1
        y2
        y3
        y4
    end

    %% グループ定義後に接続を記述
    x1 --> y1
    x2 --> y2
    x3 --> y3
\`\`\`
Markdown: 構造化された文章を作成します。
Latex: 数式を表現します。

参考文献と資料:
実際に参照したWebページや書籍のみを、解説の最後に「## 参考文献」セクションを設け、以下の記法に従ってリストアップしてください。リストアップする際、その資料ごとに改行してください。本文中の関連箇所には [1], [2] のように引用番号を付与してください。
ウェブサイト: 著者名（任意）「記事タイトル」サイト名. <URL>. (閲覧日: ${new Date().toISOString().slice(0, 10)})
書籍: 著者名『書籍名』出版社, 出版年.
与えられた参考文献が存在しない場合、参考文献セクションには「なし」とだけ記載してください。
複数の参考文献が存在する場合はそれらごとに【1】【2】のように分け、各参考文献ごとに改行して見やすいように表記してください。
例：
【1】電気情報の森「【写像】全射、単射、全単射の性質と例題 - 電気情報の森」電気情報の森. <https: denki-joho.com="" surjection-injection-bijection="">. (閲覧日: 2025-09-26) 

【2】ワイズ「全射 | 写像 | 集合 | 数学 | ワイズ - WIIS」ワイズ - WIIS. <https: wiis.info="" math="" set="" map="" surjection="">. (閲覧日: 2025-09-26)

読者のさらなる学習のために推奨できる資料がある場合は、「## 参考資料」というセクションを参考文献の後に設け、リスト形式で提示してください。`;

        const writerModel = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
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
