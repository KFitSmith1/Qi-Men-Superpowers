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
    'When chart data is provided below, it has ALREADY been computed for you — interpret it',
    'directly and answer the question. Do NOT tell the user to compute it themselves or refer',
    'them to another tab, and do NOT say you are unable to compute charts.',
    'Do NOT invent or guess numerical values that are not given; reason from what is provided.',
    'Only if NO chart data is provided and the question needs it, ask the user to enter their',
    'birth date and time in the left panel.',
    'When tools are available and the question is about wealth/career, romance, personality,',
    'remedies, array placement, auspicious timing, a specific event/situation, or divination,',
    'CALL the matching reading tool first to get the detailed Qi Men analysis, then explain its',
    'results in plain language. Be concrete and practical; avoid fatalism.',
    'Give thorough, well-structured answers. Walk through your reasoning step by step: name the',
    'specific chart factors you are using (pillars, day-master strength, the relevant ten-gods,',
    'the active luck pillar, the current-year pillar) and explain what each one means and why it',
    'matters for the question. Define any Chinese terms in plain language the first time you use',
    'them. Organize the response with short headed sections or bullet points, and finish with a',
    'short, practical "what this suggests" takeaway. Aim for depth and clarity over brevity, but',
    'stay on-topic and do not pad with filler.',
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

/* ---- Provider: OpenAI-compatible chat completions (with tool calling) ---- */

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

async function openaiStream({ messages, context, lang, onToken, onEvent, tools, executeTool, signal }) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!key) return stubStream({ messages, lang, onToken });

  const convo = buildMessages({ messages, context, lang });
  const useTools = Array.isArray(tools) && tools.length > 0;
  let full = '';

  // Multi-turn loop: the model may call tools (engine readings) before answering.
  for (let iter = 0; iter < 5; iter++) {
    const body = { model, stream: true, max_tokens: 5000, messages: convo };
    if (useTools) { body.tools = tools.map((t) => t.schema); body.tool_choice = 'auto'; }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`LLM provider error: ${errText.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    const toolCalls = {}; // index -> { id, name, args }

    let streamDone = false;
    while (!streamDone) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { streamDone = true; break; }
        let choice;
        try { choice = JSON.parse(data)?.choices?.[0]; } catch { continue; }
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.content) { content += delta.content; full += delta.content; onToken(delta.content); }
        for (const tc of delta.tool_calls || []) {
          const idx = tc.index ?? 0;
          const cur = toolCalls[idx] || (toolCalls[idx] = { id: '', name: '', args: '' });
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
        }
      }
    }

    const calls = Object.values(toolCalls).filter((c) => c.name);
    if (!calls.length) break; // model produced its final answer (already streamed)

    // Execute the requested tools and feed results back for the next turn.
    convo.push({
      role: 'assistant',
      content: content || null,
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })),
    });
    for (const c of calls) {
      if (onEvent) onEvent({ type: 'tool', name: c.name });
      let result;
      try { result = await executeTool(c.name, safeParse(c.args)); }
      catch (e) { result = `Tool error: ${e.message}`; }
      convo.push({ role: 'tool', tool_call_id: c.id, content: String(result).slice(0, 8000) });
    }
  }
  return full;
}

/* ---- Dispatch ----------------------------------------------------------- */

async function streamChat({ messages, context, lang, onToken, onEvent, tools, executeTool, signal }) {
  switch (PROVIDER) {
    case 'openai':
    case 'insforge': // InsForge gateway is assumed OpenAI-compatible until confirmed
      return openaiStream({ messages, context, lang, onToken, onEvent, tools, executeTool, signal });
    case 'stub':
    default:
      return stubStream({ messages, lang, onToken });
  }
}

/* ---- Batch translation (RAG reading fallback) --------------------------- */

/** Translate an array of short Chinese strings -> { src: english }.
 *  Returns {} for the stub provider or when no key is set (no-op fallback). */
async function translateBatch(texts, target = 'English') {
  if (!Array.isArray(texts) || !texts.length) return {};
  if (PROVIDER !== 'openai' && PROVIDER !== 'insforge') return {};
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (!key) return {};

  const sys = `You translate short Chinese phrases from a BaZi / Qi Men Dun Jia (Chinese metaphysics) reading into concise, natural ${target}. Translate technical terms sensibly and keep it readable. Return ONLY JSON of the form {"out":[...]} — an array of translated strings with the same length and order as the input array.`;
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(texts) }],
    }),
  });
  if (!res.ok) throw new Error(`translate error: HTTP ${res.status}`);
  const data = await res.json();
  let arr = null;
  try { arr = JSON.parse(data.choices?.[0]?.message?.content || '{}').out; } catch { /* ignore */ }
  const out = {};
  if (Array.isArray(arr)) texts.forEach((t, i) => { if (arr[i]) out[t] = String(arr[i]); });
  return out;
}

module.exports = { streamChat, translateBatch, PROVIDER };
