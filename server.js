import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3001;

// --- 設定値の読み込み ---
// Renderの環境変数で設定する「あなたのサイトのURL」
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3000';
// Renderの環境変数で設定する「独自の合言葉」
const APP_SECRET_TOKEN = process.env.APP_SECRET_TOKEN;

// --- 1. CORS設定 (場所の制限) ---
app.use(cors({
  origin: function (origin, callback) {
    // originがない場合(Postmanやサーバー間通信)は許可したい場合のみ通す
    if (!origin) return callback(null, true);
    
    // 設定したドメインと一致するかチェック
    if (origin === ALLOWED_ORIGIN) {
      return callback(null, true);
    } else {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
  },
  credentials: true
}));

app.use(express.json());

// --- 2. 認証ミドルウェア (合言葉の制限) ---
const verifyToken = (req, res, next) => {
  // フロントエンドから送られてくるはずのカスタムヘッダーをチェック
  const token = req.headers['x-app-token'];

  // 環境変数が設定されていない場合はエラーにする（安全のため）
  if (!APP_SECRET_TOKEN) {
    console.error('SERVER ERROR: APP_SECRET_TOKEN is not set.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // 合言葉が一致するか確認
  if (token === APP_SECRET_TOKEN) {
    next(); // 正しければ次の処理へ
  } else {
    // 不正なアクセス
    console.warn(`Unauthorized access attempt from IP: ${req.ip}`);
    res.status(403).json({ error: 'Forbidden: Invalid Token' });
  }
};

// --- Health Check ---
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});
app.get('/', (req, res) => {
  res.status(200).send('Service is running');
});

// --- ChatGPT API (/api/chat) ---
// ★ここに verifyToken を追加してガード
app.post('/api/chat', verifyToken, async (req, res) => {
    const { messages } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
        return res.status(500).json({ error: 'API Key missing on server.' });
    }

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-5.1', // 
                messages: messages
            })
        });
        
        const data = await response.json();
        if (!response.ok) {
            console.error('OpenAI API Error:', data);
            return res.status(response.status).json(data);
        }
        res.json(data);
    } catch (error) {
        console.error('Server Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- TTS API (/api/tts) ---
// ★ここにも verifyToken を追加
app.post('/api/tts', verifyToken, async (req, res) => {
  const { text, voice = 'alloy', format = 'mp3' } = req.body || {};
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'API Key missing' });

  try {
      const rsp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1', // ★修正: TTSの正しいモデル名は tts-1 または tts-1-hd
          input: text,
          voice: voice, // alloy, echo, fable, onyx, nova, shimmer
          response_format: format,
        }),
      });

      if (!rsp.ok) {
        const err = await rsp.text();
        return res.status(500).json({ error: err });
      }

      // 音声データをバッファとして取得してクライアントに返す
      const arrayBuffer = await rsp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.set('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
      res.send(buffer);
  } catch (e) {
      console.error(e);
      res.status(500).send(e.message);
  }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
