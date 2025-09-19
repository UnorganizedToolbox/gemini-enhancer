// /api/kv-test.js

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  try {
    const key = 'test-key';
    const value = new Date().toISOString();

    // データを書き込む
    await kv.set(key, value);

    // データを読み込む
    const readValue = await kv.get(key);

    // 成功したことをJSONで返す
    res.status(200).json({ 
      status: 'OK', 
      message: 'Vercel KV connection is successful!',
      written: value,
      read: readValue 
    });
  } catch (error) {
    console.error('KV Test Error:', error);
    res.status(500).json({ 
      status: 'Error',
      message: 'Failed to connect to Vercel KV.',
      error: error.message 
    });
  }
}
