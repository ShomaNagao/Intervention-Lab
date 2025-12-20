import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import 'dotenv/config'; 
const app = express();
// Renderなどのホスティングサービスでは環境変数 PORT が割り当てられます
const port = process.env.PORT || 3001;

// --- CORS設定 ---
// Qualtricsやローカル環境からのアクセスを許可する必要があります。
// 開発中は origin: '*' で全て許可するか、特定のQualtricsドメインを指定します。
const allowedOrigins = [
  'http://127.0.0.1:3000', 
  'http://localhost:3000',
  'null',
  // 必要に応じてQualtricsのドメインを追加 (例: https://yourbrand.qualtrics.com)
];

app.use(cors({
  origin: function (origin, callback) {
    // originがない場合(サーバー同士など)や許可リストにある場合は通す
    if (!origin || allowedOrigins.includes(origin) || true) { // ★テスト用に一旦 true (全許可) にしていますが、本番は調整推奨
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true // クッキー等が必要な場合
}));

// --- ChatGPT API を呼び出すエンドポイント定義 (/api/chat) ---
app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'サーバー側でAPIキーが設定されていません。' });
    }
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-5.1-2025-11-13', // 使用するモデルを指定
                messages: messages // 受け取った会話履歴をそのまま渡す
            })
        });
        const data = await response.json();
        if (!response.ok) {
            // OpenAIからのエラーをそのままクライアントに返す
            return res.status(response.status).json(data);
        }
        res.json(data);
    } catch (error) {
        console.error('サーバーエラー:', error);
        res.status(500).json({ error: 'サーバーでエラーが発生しました。' });
    }
});

// --- テキストを音声に変換するエンドポイント定義 (/api/tts) ---
app.post('/api/tts', async (req, res) => {
  const { text, voice = 'echo', format = 'mp3', instructions } = req.body || {};

  console.log('[TTS API] request', {
    head: text && text.slice(0, 30),
    length: text && text.length,
    voice,
    format
  });

  const rsp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      input: text,
      voice,
      format,
      instructions
    }),
  });

  console.log('[TTS API] OpenAI status =', rsp.status);

  if (!rsp.ok) {
    const err = await rsp.text();
    console.error('[TTS API] error body =', err);
    return res.status(500).json({ error: err });
  }

  const buf = Buffer.from(await rsp.arrayBuffer());
  console.log('[TTS API] response bytes =', buf.length);

  res.set('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
  res.set('Cache-Control', 'no-store');
  res.send(buf);
});


// --- 指定ポートでサーバーを起動 ---
app.listen(port, () => {
    console.log(`サーバーが http://localhost:${port} で起動しました`);
});