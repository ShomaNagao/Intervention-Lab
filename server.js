import express from 'express';

import fetch from 'node-fetch';

import cors from 'cors';

import 'dotenv/config'; 



const app = express();

const port = process.env.PORT || 3001; 





app.use(cors({

  origin: function (origin, callback) {


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

                model: 'gpt-4.1-2025-04-14', // または gpt-3.5-turbo など

                messages: messages

            })

        });

        

        const data = await response.json();

        if (!response.ok) {

          console.error('OpenAI API Error:', JSON.stringify(data, null, 2));

            return res.status(response.status).json(data);

        }

        res.json(data);

    } catch (error) {

        console.error('サーバーエラー:', error);

        res.status(500).json({ error: 'サーバー内部エラーが発生しました。' });

    }

});




// --- サーバー起動 ---

app.listen(port, () => {

    console.log(`Server is running on port ${port}`);

});
