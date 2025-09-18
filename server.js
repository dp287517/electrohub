import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import atexRoutes from './server_atex.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(helmet());
app.use(express.json());
app.use(cookieParser());

// ATEX routes
app.use('/api/atex', atexRoutes);

// OpenAI Chat endpoint
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/openai/chat', async (req, res) => {
  try {
    const { messages, context } = req.body;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an ATEX compliance assistant.' },
        ...(context ? [{ role: 'system', content: 'Context: ' + JSON.stringify(context) }] : []),
        ...messages
      ]
    });
    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'OpenAI request failed' });
  }
});

// Serve frontend
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (_, res) => res.sendFile(path.join(distPath, 'index.html')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ElectroHub server listening on :${port}`));
