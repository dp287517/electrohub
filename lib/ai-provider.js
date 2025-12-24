/**
 * AI Provider with automatic fallback OpenAI → Gemini
 *
 * Usage:
 *   import { createAIProvider } from './lib/ai-provider.js';
 *   const ai = createAIProvider();
 *   const result = await ai.chat(messages, options);
 *   const result = await ai.vision(messages, options); // For image analysis
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configuration
const OPENAI_MODELS = {
  chat: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  vision: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
};

const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * Create an AI provider with automatic fallback
 */
export function createAIProvider(options = {}) {
  const openaiKey = options.openaiKey || process.env.OPENAI_API_KEY;
  const geminiKey = options.geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
  const gemini = geminiKey ? new GoogleGenerativeAI(geminiKey) : null;

  const providerName = options.name || 'AI';

  /**
   * Log helper
   */
  function log(message) {
    console.log(`[${providerName}] ${message}`);
  }

  /**
   * Check if we should fallback based on error
   */
  function shouldFallback(error) {
    const msg = error?.message || '';
    return (
      error?.status === 429 ||
      error?.code === 'insufficient_quota' ||
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('rate limit')
    );
  }

  /**
   * Convert OpenAI messages to Gemini format
   */
  function convertMessagesToGemini(messages) {
    let systemPrompt = '';
    const contents = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';

      // Handle content array (for vision)
      if (Array.isArray(msg.content)) {
        const parts = [];
        for (const item of msg.content) {
          if (item.type === 'text') {
            parts.push({ text: item.text });
          } else if (item.type === 'image_url') {
            // Extract base64 from data URL
            const url = item.image_url?.url || '';
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
        contents.push({ role, parts });
      } else {
        contents.push({ role, parts: [{ text: msg.content }] });
      }
    }

    return { systemPrompt, contents };
  }

  /**
   * Call Gemini API
   */
  async function callGemini(messages, options = {}) {
    if (!gemini) throw new Error('GEMINI_API_KEY not configured');

    const model = gemini.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.max_tokens ?? 4096,
      },
    });

    const { systemPrompt, contents } = convertMessagesToGemini(messages);

    // Add system prompt to first user message if present
    if (systemPrompt && contents.length > 0) {
      const firstUserIdx = contents.findIndex(c => c.role === 'user');
      if (firstUserIdx >= 0) {
        const firstPart = contents[firstUserIdx].parts[0];
        if (firstPart?.text) {
          firstPart.text = `${systemPrompt}\n\n---\n\n${firstPart.text}`;
        }
      }
    }

    const result = await model.generateContent({ contents });
    const text = result.response.text();

    // Parse JSON if requested
    if (options.response_format?.type === 'json_object') {
      try {
        let cleaned = text.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
        if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
        if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
        return { content: cleaned.trim(), parsed: JSON.parse(cleaned.trim()) };
      } catch {
        return { content: text, parsed: null };
      }
    }

    return { content: text };
  }

  /**
   * Call OpenAI API
   */
  async function callOpenAI(messages, options = {}) {
    if (!openai) throw new Error('OPENAI_API_KEY not configured');

    const model = options.vision ? OPENAI_MODELS.vision : OPENAI_MODELS.chat;

    const resp = await openai.chat.completions.create({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 4096,
      ...(options.response_format && { response_format: options.response_format }),
    });

    const content = resp.choices?.[0]?.message?.content || '';

    // Parse JSON if requested
    if (options.response_format?.type === 'json_object') {
      try {
        return { content, parsed: JSON.parse(content) };
      } catch {
        return { content, parsed: null };
      }
    }

    return { content };
  }

  /**
   * Main chat function with fallback
   */
  async function chat(messages, options = {}) {
    const hasOpenAI = !!openai;
    const hasGemini = !!gemini;

    log(`Providers: OpenAI=${hasOpenAI}, Gemini=${hasGemini}`);

    // Try OpenAI first
    if (hasOpenAI) {
      try {
        log(`Calling OpenAI (${options.vision ? OPENAI_MODELS.vision : OPENAI_MODELS.chat})...`);
        const result = await callOpenAI(messages, options);
        log(`OpenAI response received (${result.content.length} chars)`);
        return { ...result, provider: 'openai' };
      } catch (error) {
        log(`OpenAI failed: ${error.message}`);

        if (hasGemini && shouldFallback(error)) {
          log(`Fallback to Gemini...`);
          try {
            const result = await callGemini(messages, options);
            log(`Gemini response received (${result.content.length} chars)`);
            return { ...result, provider: 'gemini' };
          } catch (geminiError) {
            log(`Gemini also failed: ${geminiError.message}`);
            throw geminiError;
          }
        }

        throw error;
      }
    }

    // Only Gemini available
    if (hasGemini) {
      log(`Using Gemini (no OpenAI key)...`);
      const result = await callGemini(messages, options);
      log(`Gemini response received (${result.content.length} chars)`);
      return { ...result, provider: 'gemini' };
    }

    throw new Error('No AI provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
  }

  /**
   * Vision/image analysis function
   */
  async function vision(messages, options = {}) {
    return chat(messages, { ...options, vision: true });
  }

  /**
   * Simple text completion
   */
  async function complete(prompt, options = {}) {
    return chat([{ role: 'user', content: prompt }], options);
  }

  /**
   * JSON extraction
   */
  async function json(messages, options = {}) {
    return chat(messages, { ...options, response_format: { type: 'json_object' } });
  }

  return {
    chat,
    vision,
    complete,
    json,
    hasOpenAI: !!openai,
    hasGemini: !!gemini,
  };
}

// Default singleton instance
let defaultProvider = null;

export function getAIProvider(options = {}) {
  if (!defaultProvider) {
    defaultProvider = createAIProvider(options);
  }
  return defaultProvider;
}

export default { createAIProvider, getAIProvider };
