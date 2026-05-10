import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import fs from 'fs';
import 'dotenv/config'; 
import { rateLimit } from 'express-rate-limit'; 

const SECRET_DIR = process.env.SECRET_DIR || '/etc/secrets';

let PLAYBOOKS;
let INTERVENTION_TEMPLATE;
let CONTROL_TEMPLATE;

try {
  PLAYBOOKS = JSON.parse(
    fs.readFileSync(`${SECRET_DIR}/experiment-playbooks.json`, 'utf8')
  );

  INTERVENTION_TEMPLATE = fs.readFileSync(
    `${SECRET_DIR}/intervention-prompt.txt`,
    'utf8'
  );

  CONTROL_TEMPLATE = fs.readFileSync(
    `${SECRET_DIR}/control-prompt.txt`,
    'utf8'
  );

  console.log('[config] Secret files loaded');
} catch (error) {
  console.error('[config] Secret files load failed:', error);
  process.exit(1);
}

const BLOCK_TO_KEY = {
  "1": "bee",
  "2": "car",
  "3": "fall",
  "4": "hs",
  "5": "caught",
  "6": "shocked"
};

const TRAIT_TO_PLAYBOOK_KEY = {
  "社会的内向性": "INTV",
  "内省性": "REFL",
  "独自性": "UNIQ",
  "敏感性": "SENS"
};

function normalizeClientMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((m) => m && ['user', 'assistant'].includes(m.role))
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? '').slice(0, 4000)
    }))
    .slice(-12);
}

function getPreparedMessage({ block, group, primaryTrait }) {
  const scenarioKey = BLOCK_TO_KEY[String(block)];
  if (!scenarioKey) {
    throw new Error(`invalid block: ${block}`);
  }

  const playbook = PLAYBOOKS[scenarioKey];
  if (!playbook) {
    throw new Error(`playbook not found: ${scenarioKey}`);
  }

  const isPersonalized = String(group || '').trim() === 'A';
  const traitName = String(primaryTrait || '').trim();

  let preparedMessage = '';

  if (isPersonalized) {
    const playbookKey = TRAIT_TO_PLAYBOOK_KEY[traitName];
    if (playbookKey) {
      preparedMessage = playbook.SP?.[playbookKey]?.short || '';
    }
  }

  if (!preparedMessage) {
    preparedMessage = playbook.SG?.EDU?.short || '';
  }

  if (!preparedMessage) {
    throw new Error(`prepared message not found: ${scenarioKey}`);
  }

  return preparedMessage;
}

function buildBaseMessagesOnServer({ block, group, primaryTrait, scenarioText }) {
  const isPersonalized = String(group || '').trim() === 'A';

  const preparedMessage = getPreparedMessage({
    block,
    group,
    primaryTrait
  });

  const systemTemplate = isPersonalized
    ? INTERVENTION_TEMPLATE
    : CONTROL_TEMPLATE;

  if (!systemTemplate) {
    throw new Error('system template not found');
  }

  const personalityTrait = String(primaryTrait || '').trim();

  const systemContent = systemTemplate
    .replace(/\{\{PERSONALITY_TRAIT\}\}/g, personalityTrait)
    .replace(/\{\{PREPARED_MESSAGE\}\}/g, preparedMessage);

  return [
    { role: 'system', content: systemContent },
    { role: 'developer', content: String(scenarioText || '') }
  ];
}

const app = express();
const port = process.env.PORT || 3001; 

app.set('trust proxy', 1);

const ALLOWED_ORIGINS = new Set([
  'https://survey.syd1.qualtrics.com',
]);

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      return callback(new Error('CORS blocked: missing Origin'), false);
    }

    if (ALLOWED_ORIGINS.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked: ${origin}`), false);
  },
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-custom-secret'],
  exposedHeaders: ['X-TTS-Request-Id', 'X-TTS-Text-Hash'],
  maxAge: 86400,
};

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
app.use('/api', cors(corsOptions));

app.use(express.json());

// /healthz にも同じCORSオプションを適用
app.get('/healthz', cors({ origin: '*' }), (req, res) => {
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

    const { messages, block, group, primaryTrait, scenarioText } = req.body || {};
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error('[chat-stream] APIキーが設定されていません');
        return res.status(500).json({ error: 'API key missing' });
    }

    let openAiMessages;

    try {
        const baseMessages = buildBaseMessagesOnServer({
            block,
            group,
            primaryTrait,
            scenarioText
        });
        const normalizedClientMessages = normalizeClientMessages(messages);
        openAiMessages = [
            ...baseMessages,
            ...normalizedClientMessages
        ];
    } catch (error) {
        console.error('[chat-stream] Invalid experiment configuration:', error);
        return res.status(400).json({ error: 'Invalid experiment configuration' });
    }

    console.log(`[chat-stream] messages prepared: ${openAiMessages.length}`);

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
                messages: openAiMessages,
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

        // ストリームを直接流さず、一度バッファに受け取る
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
