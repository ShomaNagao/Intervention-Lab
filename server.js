import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import 'dotenv/config'; 
import { rateLimit } from 'express-rate-limit'; // 【追加】ライブラリのインポート

const app = express();
const port = process.env.PORT || 3001; 

app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分間
  max: 500, // 1分間に各IPから最大500リクエストまで
  message: { error: "リクエスト回数が多すぎます。しばらく時間を置いてから再度お試しください。" },
  standardHeaders: true, // `RateLimit-*` ヘッダーを返す
  legacyHeaders: false, // `X-RateLimit-*` ヘッダーを非表示にする
});

// 全てのルート、または特定のルートに適用
// 今回はAPIを守りたいので /api/ に適用
app.use('/api/', limiter);

app.use(cors({
  origin: function (origin, callback) {
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());

// --- 以下、既存のルート ---
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

app.post('/api/chat', async (req, res) => {
    // 認証チェック (合言葉)
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

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4.1-2025-04-14',
                messages: messages
            })
        });
        
        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json(data);
        }
        res.json(data);
    } catch (error) {
        console.error('サーバーエラー:', error);
        res.status(500).json({ error: 'サーバー内部エラーが発生しました。' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
