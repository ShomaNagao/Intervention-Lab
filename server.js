import express from 'express';
import fetch from 'node-fetch';
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
// 1. チャットストリーミングAPI
// ==========================================
app.post('/api/chat-stream', async (req, res) => {
    const secretKey = req.headers['x-custom-secret']; 
    const MY_SECRET = process.env.CHAT_AUTH_PASSWORD;

    if (!MY_SECRET || secretKey !== MY_SECRET) {
        console.warn('[chat-stream] 403 Forbidden: 不正なsecretキー');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { messages } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error('[chat-stream] APIキーが設定されていません');
        return res.status(500).json({ error: 'API key missing' });
    }

    console.log(`[chat-stream] リクエスト受信 - メッセージ数: ${messages ? messages.length : 0}`);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const startTime = Date.now();

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-5.1-2025-11-13', 
                messages: messages,
                stream: true 
            })
        });

        if (!response.ok) {
            const error = await response.json();
            console.error(`[chat-stream] OpenAI APIエラー: HTTP ${response.status}`, error);
            return res.status(response.status).json(error);
        }

        console.log(`[chat-stream] OpenAI API接続成功 - 経過: ${Date.now() - startTime}ms`);

        response.body.on('end', () => {
            console.log(`[chat-stream] ストリーム完了 - 合計: ${Date.now() - startTime}ms`);
        });

        response.body.pipe(res);
    } catch (error) {
        console.error('[chat-stream] 予期しないエラー:', error);
        res.status(500).end();
    }
});

// ==========================================
// 2. TTS (音声合成) API
// ==========================================
app.post('/api/tts', async (req, res) => {
    const TTS_MODEL = 'gpt-4o-mini-tts';
    const secretKey = req.headers['x-custom-secret']; 
    const MY_SECRET = process.env.CHAT_AUTH_PASSWORD;
    if (!MY_SECRET || secretKey !== MY_SECRET) {
        console.warn('[tts] 403 Forbidden: 不正なsecretキー');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const {
        requestId = '',
        textHash = '',
        text,
        voice = 'nova',
        instructions = ''
    } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const safeText = String(text || '');

    const textLength = safeText.length;
    console.log(`[tts] requestId: ${requestId}`);
    console.log(`[tts] client textHash: ${textHash}`);
    console.log(`[tts] text length: ${safeText.length}`);
    console.log(`[tts] text head: ${JSON.stringify(safeText.slice(0, 80))}`);
    console.log(`[tts] text tail: ${JSON.stringify(safeText.slice(-80))}`);
    console.log(`[tts] リクエスト受信 - モデル: ${TTS_MODEL}, 声: ${voice}, 文字数: ${textLength}`);

    const startTime = Date.now();

    try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: TTS_MODEL,
                input: safeText,
                voice: voice,
                instructions: instructions,
                response_format: 'mp3'
            })
        });

        if (!response.ok) {
            const errBody = await response.json();
            console.error(`[tts] OpenAI APIエラー: HTTP ${response.status}`, errBody);
            return res.status(response.status).json(errBody);
        }

        console.log(`[tts] OpenAI API応答受信 - 経過: ${Date.now() - startTime}ms`);

        // ★ 修正点：ストリームを直接流さず、一度バッファに受け取る
        // これによりContent-Lengthヘッダーを付与でき、
        // ブラウザ側でaudio.durationがInfinityにならなくなる
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log(`[tts] 音声バッファ取得完了 - サイズ: ${buffer.length} bytes, 経過: ${Date.now() - startTime}ms`);

        // Content-Lengthを付与してレスポンス
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('X-TTS-Request-Id', requestId);
        res.setHeader('X-TTS-Text-Hash', textHash);
        // キャッシュ禁止（古い音声が再利用されないように）
        res.setHeader('Cache-Control', 'no-store');
        res.end(buffer);

        console.log(`[tts] レスポンス送信完了 - 合計: ${Date.now() - startTime}ms`);

    } catch (error) {
        console.error('[tts] 予期しないエラー:', error);
        res.status(500).json({ error: '音声生成失敗' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
