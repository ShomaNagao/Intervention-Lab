import express from 'express';
import fetch from 'node-fetch'; // サーバー環境によっては組み込みのfetchを使う場合もあります
import cors from 'cors';
import 'dotenv/config'; 
import { rateLimit } from 'express-rate-limit'; 

const app = express();
const port = process.env.PORT || 3001; 

app.set('trust proxy', 1);

// レート制限設定
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: { error: "リクエスト回数が多すぎます。" },
  standardHeaders: true, 
  legacyHeaders: false, 
});
app.use('/api/', limiter);

// CORS設定
app.use(cors({
  origin: function (origin, callback) {
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());

app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

// ==========================================
// 1. チャットストリーミングAPI (新規追加)
// AIの応答を1文字ずつリアルタイムにフロントエンドへ流し込みます
// ==========================================
app.post('/api/chat-stream', async (req, res) => {
    const secretKey = req.headers['x-custom-secret']; 
    const MY_SECRET = process.env.CHAT_AUTH_PASSWORD;

    if (!MY_SECRET || secretKey !== MY_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { messages } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) return res.status(500).json({ error: 'API key missing' });

    // ストリーミング用のヘッダーを設定
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o', // 速度を重視するためgpt-4oを推奨します
                messages: messages,
                stream: true // ここでストリーミングを有効化
            })
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json(error);
        }

        // OpenAIからのストリームをそのままクライアントへ転送（パイプ）
        response.body.pipe(res);
    } catch (error) {
        console.error('Chat Stream Error:', error);
        res.status(500).end();
    }
});

// ==========================================
// 2. TTS (音声合成) API (新規追加)
// 1文ごとのテキストを受け取り、軽量なOpus音声にして返します
// ==========================================
app.post('/api/tts', async (req, res) => {
    const secretKey = req.headers['x-custom-secret']; 
    const MY_SECRET = process.env.CHAT_AUTH_PASSWORD;
    if (!MY_SECRET || secretKey !== MY_SECRET) return res.status(403).json({ error: 'Forbidden' });

    const { text, voice = 'nova' } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;

    try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'tts-1', // 最速モデル
                input: text,
                voice: voice,
                response_format: 'opus' // 低遅延・軽量フォーマット
            })
        });

        if (!response.ok) return res.status(response.status).json(await response.json());

        res.setHeader('Content-Type', 'audio/ogg');
        response.body.pipe(res);
    } catch (error) {
        console.error('TTS Error:', error);
        res.status(500).json({ error: '音声生成失敗' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
