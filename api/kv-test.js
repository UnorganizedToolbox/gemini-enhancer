// /api/kv-test.js (手動接続バージョン)

import { createClient } from "@vercel/kv";

// 環境変数を手動で指定してクライアントを初期化
const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
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
