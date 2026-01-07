import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import 'dotenv/config'; 

const app = express();
const port = process.env.PORT || 3001; 


app.use(cors({
  origin: function (origin, callback) {
    // originがない場合(サーバー間通信など)や、許可したいドメインなら通す
    // ★今はテストのため、一旦すべてのアクセスを通す設定にします
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());

// --- Wake/Health check (NO OpenAI call) ---
app.get('/healthz', (req, res) => {
  res.status(200).send('ok');
});

// （任意）トップもOKにしておくと便利
app.get('/', (req, res) => {
  res.status(200).send('ok');
});


// --- ChatGPT API (/api/chat) ---
app.post('/api/chat', async (req, res) => {
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
                model: 'gpt-5.1', // または gpt-3.5-turbo など
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

// --- TTS API (/api/tts) ---
app.post('/api/tts', async (req, res) => {
  const { text, voice = 'echo', format = 'mp3', instructions } = req.body || {};
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
          model: 'gpt-4o-mini-tts', // または tts-1-hd
          input: text,
          voice,
          response_format: format,
        }),
      });

      if (!rsp.ok) {
        const err = await rsp.text();
        return res.status(500).json({ error: err });
      }

      const buf = Buffer.from(await rsp.arrayBuffer());
      res.set('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
      res.send(buf);
  } catch (e) {
      console.error(e);
      res.status(500).send(e.message);
  }
});

// --- サーバー起動 ---
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
