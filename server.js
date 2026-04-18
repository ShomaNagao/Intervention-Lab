import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import 'dotenv/config';
import { rateLimit } from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3001;

app.set('trust proxy', 1);

///////////////////////////////////////////////////////////////////////////
// レート制限
///////////////////////////////////////////////////////////////////////////
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 500,
  message: { error: "リクエスト回数が多すぎます。しばらく時間を置いてから再度お試しください。" },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

///////////////////////////////////////////////////////////////////////////
// CORS
///////////////////////////////////////////////////////////////////////////
app.use(cors({
  origin: function (origin, callback) {
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());

///////////////////////////////////////////////////////////////////////////
// ヘルスチェック
///////////////////////////////////////////////////////////////////////////
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});


///////////////////////////////////////////////////////////////////////////
// POST /api/chat  — ストリーミング SSE
//
// クライアントへの SSE フォーマット:
//   data: {"delta":"<chunk_text>"}\n\n   … テキストデルタ
//   data: [DONE]\n\n                      … 完了
//   data: {"error":"<msg>"}\n\n           … エラー
///////////////////////////////////////////////////////////////////////////
app.post('/api/chat', async (req, res) => {
  // 認証
  const secretKey = req.headers['x-custom-secret'];
  const MY_SECRET = process.env.CHAT_AUTH_PASSWORD;
  if (!MY_SECRET || secretKey !== MY_SECRET) {
    console.error('認証失敗');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { messages } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーがサーバー側で設定されていません。' });
  }

  // SSE ヘッダー
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // SSE ヘルパー
  const sendEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const sendDone = () => {
    res.write('data: [DONE]\n\n');
    res.end();
  };

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-2025-04-14',
        messages: messages,
        stream: true
      })
    });

    if (!openaiRes.ok) {
      const errData = await openaiRes.json().catch(() => ({}));
      sendEvent({ error: errData?.error?.message || `OpenAI error ${openaiRes.status}` });
      res.end();
      return;
    }

    // OpenAI SSE ストリームをそのままクライアントに転送
    const decoder = new TextDecoder();
    let buffer = '';

    openaiRes.body.on('data', (chunk) => {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 未完行を保持

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const raw = trimmed.slice(5).trim();
        if (raw === '[DONE]') {
          sendDone();
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) sendEvent({ delta });
        } catch (_) {
          // malformed chunk — skip
        }
      }
    });

    openaiRes.body.on('end', () => {
      sendDone();
    });

    openaiRes.body.on('error', (err) => {
      console.error('OpenAI stream error:', err);
      sendEvent({ error: 'ストリームエラーが発生しました。' });
      res.end();
    });

    // クライアント切断時のクリーンアップ
    req.on('close', () => {
      openaiRes.body.destroy();
    });

  } catch (error) {
    console.error('サーバーエラー:', error);
    sendEvent({ error: 'サーバー内部エラーが発生しました。' });
    res.end();
  }
});


///////////////////////////////////////////////////////////////////////////
// POST /api/tts  — テキストを Opus 音声にして返す
//
// Body: { text: string }
// Returns: audio/ogg (Opus)
///////////////////////////////////////////////////////////////////////////
app.post('/api/tts', async (req, res) => {
  // 認証
  const secretKey = req.headers['x-custom-secret'];
  const MY_SECRET = process.env.CHAT_AUTH_PASSWORD;
  if (!MY_SECRET || secretKey !== MY_SECRET) {
    console.error('TTS 認証失敗');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text は必須です。' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'APIキーがサーバー側で設定されていません。' });
  }

  try {
    const ttsRes = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.trim(),
        voice: 'nova',
        response_format: 'opus'
      })
    });

    if (!ttsRes.ok) {
      const errData = await ttsRes.json().catch(() => ({}));
      const msg = errData?.error?.message || `TTS error ${ttsRes.status}`;
      return res.status(ttsRes.status).json({ error: msg });
    }

    res.setHeader('Content-Type', 'audio/ogg');
    res.setHeader('Cache-Control', 'no-store');
    // OpenAI TTS レスポンスボディをそのままクライアントへ pipe
    ttsRes.body.pipe(res);

    ttsRes.body.on('error', (err) => {
      console.error('TTS pipe error:', err);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (error) {
    console.error('TTS サーバーエラー:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'TTS サーバー内部エラーが発生しました。' });
    }
  }
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
