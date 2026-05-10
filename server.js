import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';
import 'dotenv/config'; 
import { rateLimit } from 'express-rate-limit'; 

const SECRET_DIR = process.env.SECRET_DIR || '/etc/secrets';
const PROMPT_DEBUG = process.env.PROMPT_DEBUG === 'true';
const PROMPT_DEBUG_FULL = process.env.PROMPT_DEBUG_FULL === 'true';

function debugLog(...args) {
  if (PROMPT_DEBUG) console.log(...args);
}

function hashText(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || ''))
    .digest('hex')
    .slice(0, 12);
}

function oneLinePreview(text, n = 120) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .slice(0, n);
}

function logTextSummary(label, text, requestId = 'startup') {
  if (!PROMPT_DEBUG) return;

  const s = String(text || '');
  const head = oneLinePreview(s.slice(0, 200));
  const tail = oneLinePreview(s.slice(-200));

  console.log(`[prompt-debug:${requestId}] ${label}`, {
    length: s.length,
    hash: hashText(s),
    head,
    tail
  });
}

function looksUnresolvedPipedText(value) {
  return String(value || '').includes('${e://Field/');
}

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
  console.log(`[config] SECRET_DIR=${SECRET_DIR}`);

  logTextSummary('intervention-prompt.txt', INTERVENTION_TEMPLATE);
  logTextSummary('control-prompt.txt', CONTROL_TEMPLATE);

  if (PROMPT_DEBUG) {
    console.log('[config] PLAYBOOK scenario keys:', Object.keys(PLAYBOOKS || {}));
    console.log('[config] intervention placeholders:', {
      PERSONALITY_TRAIT: INTERVENTION_TEMPLATE.includes('{{PERSONALITY_TRAIT}}'),
      PREPARED_MESSAGE: INTERVENTION_TEMPLATE.includes('{{PREPARED_MESSAGE}}')
    });
    console.log('[config] control placeholders:', {
      PERSONALITY_TRAIT: CONTROL_TEMPLATE.includes('{{PERSONALITY_TRAIT}}'),
      PREPARED_MESSAGE: CONTROL_TEMPLATE.includes('{{PREPARED_MESSAGE}}')
    });
  }
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

function logPlaybookSummary() {
  if (!PROMPT_DEBUG) return;

  console.log('[config] playbook summary start');

  for (const [block, scenarioKey] of Object.entries(BLOCK_TO_KEY)) {
    const playbook = PLAYBOOKS?.[scenarioKey];

    console.log(`[config] block=${block} scenarioKey=${scenarioKey}`, {
      exists: !!playbook,
      SP_KEYS: playbook?.SP ? Object.keys(playbook.SP) : [],
      SG_KEYS: playbook?.SG ? Object.keys(playbook.SG) : []
    });

    for (const key of ['INTV', 'REFL', 'UNIQ', 'SENS']) {
      const entry = playbook?.SP?.[key];
      console.log(`[config] ${scenarioKey}.SP.${key}`, {
        exists: !!entry,
        code: entry?.code || '',
        name: entry?.name || '',
        shortLength: String(entry?.short || '').length,
        shortHash: hashText(entry?.short || '')
      });
    }

    const edu = playbook?.SG?.EDU;
    console.log(`[config] ${scenarioKey}.SG.EDU`, {
      exists: !!edu,
      code: edu?.code || '',
      name: edu?.name || '',
      shortLength: String(edu?.short || '').length,
      shortHash: hashText(edu?.short || '')
    });
  }

  console.log('[config] playbook summary end');
}

logPlaybookSummary();

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

function getPreparedMessage({ block, group, primaryTrait, requestId = 'no-reqid' }) {
  const scenarioKey = BLOCK_TO_KEY[String(block)];

  debugLog(`[prompt-input:${requestId}] raw input`, {
    block,
    scenarioKey,
    group,
    primaryTrait
  });

  if (looksUnresolvedPipedText(group) || looksUnresolvedPipedText(primaryTrait)) {
    console.warn(`[prompt-input:${requestId}] Qualtrics piped text may be unresolved`, {
      group,
      primaryTrait
    });
  }

  if (!scenarioKey) {
    throw new Error(`invalid block: ${block}`);
  }

  const playbook = PLAYBOOKS[scenarioKey];
  if (!playbook) {
    throw new Error(`playbook not found: ${scenarioKey}`);
  }

  const isPersonalized = String(group || '').trim() === 'A';
  const traitName = String(primaryTrait || '').trim();
  const playbookKey = isPersonalized ? TRAIT_TO_PLAYBOOK_KEY[traitName] : undefined;

  let selectedEntry = null;
  let selectedPath = '';

  if (isPersonalized && playbookKey) {
    selectedEntry = playbook.SP?.[playbookKey] || null;
    selectedPath = `${scenarioKey}.SP.${playbookKey}`;
  }

  if (!selectedEntry || !selectedEntry.short) {
    selectedEntry = playbook.SG?.EDU || null;
    selectedPath = `${scenarioKey}.SG.EDU`;
  }

  if (!selectedEntry || !selectedEntry.short) {
    throw new Error(`prepared message not found: ${scenarioKey}`);
  }

  debugLog(`[prompt-select:${requestId}] selected prepared message`, {
    block,
    scenarioKey,
    group,
    isPersonalized,
    primaryTrait: traitName,
    playbookKey: playbookKey || '',
    selectedPath,
    code: selectedEntry.code || '',
    name: selectedEntry.name || '',
    shortLength: String(selectedEntry.short || '').length,
    shortHash: hashText(selectedEntry.short || '')
  });

  logTextSummary(`preparedMessage ${selectedPath}`, selectedEntry.short, requestId);

  if (PROMPT_DEBUG_FULL) {
    console.log(`[prompt-full:${requestId}] preparedMessage ${selectedPath}\n${selectedEntry.short}`);
  }

  return selectedEntry.short;
}

function buildBaseMessagesOnServer({ block, group, primaryTrait, scenarioText, requestId = 'no-reqid' }) {
  const isPersonalized = String(group || '').trim() === 'A';

  const preparedMessage = getPreparedMessage({
    block,
    group,
    primaryTrait,
    requestId
  });

  const systemTemplate = isPersonalized
    ? INTERVENTION_TEMPLATE
    : CONTROL_TEMPLATE;
  const systemTemplateName = isPersonalized
    ? 'intervention-prompt.txt'
    : 'control-prompt.txt';

  debugLog(`[prompt-template:${requestId}] selected system template`, {
    systemTemplateName,
    isPersonalized,
    templateLength: String(systemTemplate || '').length,
    templateHash: hashText(systemTemplate)
  });

  if (!systemTemplate) {
    throw new Error('system template not found');
  }

  const personalityTrait = String(primaryTrait || '').trim();

  const systemContent = systemTemplate
    .replace(/\{\{PERSONALITY_TRAIT\}\}/g, personalityTrait)
    .replace(/\{\{PREPARED_MESSAGE\}\}/g, preparedMessage);

  const placeholderRemaining = {
    PERSONALITY_TRAIT: systemContent.includes('{{PERSONALITY_TRAIT}}'),
    PREPARED_MESSAGE: systemContent.includes('{{PREPARED_MESSAGE}}')
  };

  debugLog(`[prompt-final:${requestId}] final system content`, {
    systemLength: systemContent.length,
    systemHash: hashText(systemContent),
    scenarioTextLength: String(scenarioText || '').length,
    scenarioTextHash: hashText(scenarioText || ''),
    placeholderRemaining
  });

  logTextSummary('final systemContent', systemContent, requestId);
  logTextSummary('scenarioText', scenarioText, requestId);

  if (PROMPT_DEBUG_FULL) {
    console.log(`[prompt-full:${requestId}] systemContent\n${systemContent}`);
    console.log(`[prompt-full:${requestId}] scenarioText\n${String(scenarioText || '')}`);
  }

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
    const requestId = crypto.randomUUID();
    const secretKey = req.headers['x-custom-secret']; 
    const MY_SECRET = process.env.CHAT_AUTH_PASSWORD;

    if (!MY_SECRET || secretKey !== MY_SECRET) {
        console.warn('[chat-stream] 403 Forbidden: 不正なsecretキー');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { messages, block, group, primaryTrait, scenarioText } = req.body || {};
    debugLog(`[chat-stream:${requestId}] request body summary`, {
        block,
        group,
        primaryTrait,
        scenarioTextLength: String(scenarioText || '').length,
        messagesLength: Array.isArray(messages) ? messages.length : null,
        lastMessageRole: Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1].role : null,
        lastMessageLength: Array.isArray(messages) && messages.length > 0 ? String(messages[messages.length - 1].content || '').length : null
    });

    if (looksUnresolvedPipedText(group) || looksUnresolvedPipedText(primaryTrait)) {
        console.warn(`[chat-stream:${requestId}] unresolved Qualtrics piped text detected`, {
            group,
            primaryTrait
        });
    }

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
            scenarioText,
            requestId
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
    debugLog(`[chat-stream:${requestId}] openAiMessages summary`, {
        count: openAiMessages.length,
        roles: openAiMessages.map((m) => m.role),
        systemLength: String(openAiMessages[0]?.content || '').length,
        developerLength: String(openAiMessages[1]?.content || '').length
    });

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
