'use strict';

/*
 * Pluggable LLM provider adapter for the chat feature.
 *
 * No SDK, zero npm dependencies — uses Node's global fetch (Node >= 18).
 * The provider is chosen at runtime via env vars so the LLM vendor can be
 * swapped without code changes:
 *
 *   LLM_PROVIDER = stub      (default — offline canned stream, no keys needed)
 *                | openai    (any OpenAI-compatible /chat/completions gateway:
 *                             OpenAI, OpenRouter, Together, Groq, or InsForge
 *                             if it exposes an OpenAI-compatible endpoint)
 *                | insforge  (InsForge native gateway — endpoints TBD; see note)
 *
 * OpenAI-compatible config:
 *   OPENAI_BASE_URL  (default https://api.openai.com/v1)
 *   OPENAI_API_KEY
 *   OPENAI_MODEL     (default gpt-4o-mini)
 *
 * InsForge config (to be filled in once the API surface is confirmed):
 *   INSFORGE_BASE_URL, INSFORGE_API_KEY, INSFORGE_MODEL
 */

const PROVIDER = (process.env.LLM_PROVIDER || 'stub').toLowerCase();

/* ---- System persona ----------------------------------------------------- */

function personaSystem(lang, context) {
  const chart = formatContext(context);
  const langRule = lang === 'zh'
    ? '请只用中文回答。'
    : lang === 'en'
      ? 'Reply only in English.'
      : 'Reply in the user’s language; if unclear, use English with key Chinese terms in parentheses.';

  return [
    'You are a knowledgeable, careful interpreter of BaZi (Four Pillars) and Qi Men Dun Jia.',
    'Ground every interpretation in the chart data and retrieved references provided below.',
    'Do NOT invent or guess numerical chart calculations (pillars, plates, palaces, luck pillars).',
    'If a calculation you need is not in the provided context, say the chart must be computed first',
    'and point the user to the relevant tab. Be concrete and practical; avoid fatalism.',
    'Add a brief reminder that this is for cultural study and entertainment, not professional advice,',
    'only when giving health, legal, or financial-sounding guidance.',
    langRule,
    chart ? `\n--- Provided context ---\n${chart}` : '',
  ].filter(Boolean).join(' ');
}

function formatContext(context = {}) {
  const lines = [];
  if (context.birth) lines.push(`Birth: ${context.birth}${context.gender ? ` (${context.gender})` : ''}`);
  if (context.eventTime) lines.push(`Event time: ${context.eventTime}`);
  if (context.tab) lines.push(`Current tab: ${context.tab}`);
  if (context.chartText) lines.push(`Computed chart / reading:\n${String(context.chartText).slice(0, 6000)}`);
  if (Array.isArray(context.retrieved) && context.retrieved.length) {
    lines.push('Retrieved references:\n' + context.retrieved.map((r, i) => `[${i + 1}] ${r}`).join('\n').slice(0, 8000));
  }
  return lines.join('\n');
}

function buildMessages({ messages, context, lang }) {
  return [
    { role: 'system', content: personaSystem(lang, context) },
    ...(messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') })),
  ];
}

/* ---- Provider: stub (offline, no keys) ---------------------------------- */

async function stubStream({ messages, lang, onToken }) {
  const last = [...(messages || [])].reverse().find((m) => m.role === 'user');
  const q = last ? String(last.content).trim() : '';
  const zh = lang === 'zh';
  const text = (zh
    ? `（演示模式）你问：「${q || '…'}」。\n聊天后端已就绪并以流式返回，但尚未连接真实的语言模型。在服务器环境变量中设置 LLM_PROVIDER（openai 或 insforge）及对应的密钥即可启用真实问答与 RAG 检索。`
    : `(Demo mode) You asked: "${q || '…'}".\nThe chat backend is live and streaming, but no real language model is connected yet. Set LLM_PROVIDER (openai or insforge) plus its keys in the server environment to enable real answers and RAG retrieval.`);
  const tokens = text.split(/(\s+)/);
  for (const t of tokens) {
    onToken(t);
    await new Promise((r) => setTimeout(r, 18));
  }
  return text;
}

/* ---- Provider: OpenAI-compatible chat completions ------------------------ */

async function openaiStream({ messages, context, lang, onToken, signal }) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!key) return stubStream({ messages, lang, onToken });

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, stream: true, max_tokens: 1024, messages: buildMessages({ messages, context, lang }) }),
    signal,
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`LLM provider error: ${errText.slice(0, 300)}`);
  }

  // Parse the SSE stream of an OpenAI-compatible endpoint.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onToken(delta); }
      } catch { /* ignore keep-alive / partial */ }
    }
  }
  return full;
}

/* ---- Dispatch ----------------------------------------------------------- */

async function streamChat({ messages, context, lang, onToken, signal }) {
  switch (PROVIDER) {
    case 'openai':
    case 'insforge': // InsForge gateway is assumed OpenAI-compatible until confirmed
      return openaiStream({ messages, context, lang, onToken, signal });
    case 'stub':
    default:
      return stubStream({ messages, lang, onToken });
  }
}

module.exports = { streamChat, PROVIDER };
