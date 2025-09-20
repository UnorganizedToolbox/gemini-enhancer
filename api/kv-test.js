import { createClient } from "@vercel/kv";

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
