// /api/generate.js の try {...} ブロックの中身を以下に置き換え

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
      model: "gemini-1.5-flash-latest",
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
    });

    // ☆☆☆ 変更点：startChatを使わず、毎回コンテンツ全体を渡す ☆☆☆
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
