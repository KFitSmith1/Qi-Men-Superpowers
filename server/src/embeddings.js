'use strict';

/*
 * Embeddings adapter for RAG. Zero dependencies (Node global fetch).
 * Provider chosen by EMBEDDINGS_PROVIDER:
 *   openai : OpenAI /embeddings (text-embedding-3-small by default, 1536-dim)
 *   hash   : offline deterministic hashing vectorizer (default) — no keys, no
 *            network; cosine similarity reflects word overlap. Used for local
 *            dev/tests and as a zero-cost fallback.
 *
 * OpenAI config (reuses the chat key):
 *   OPENAI_API_KEY, OPENAI_BASE_URL (default https://api.openai.com/v1),
 *   EMBEDDINGS_MODEL (default text-embedding-3-small)
 */

const PROVIDER = (process.env.EMBEDDINGS_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'hash')).toLowerCase();
const HASH_DIM = 256;

/* ---- Offline hashing vectorizer ---------------------------------------- */

function hashEmbed(text) {
  const v = new Float64Array(HASH_DIM);
  const tokens = String(text).toLowerCase().match(/[a-z0-9一-鿿]+/gi) || [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[(h >>> 0) % HASH_DIM] += 1;
  }
  let norm = 0;
  for (let i = 0; i < HASH_DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}

/* ---- OpenAI embeddings ------------------------------------------------- */

async function openaiEmbed(texts) {
  // OpenRouter has NO embeddings endpoint, so embeddings get their own config:
  // EMBEDDINGS_API_KEY / EMBEDDINGS_BASE_URL (fall back to the OPENAI_* values,
  // except that an OpenRouter base URL is replaced with api.openai.com).
  let base = process.env.EMBEDDINGS_BASE_URL
    || (String(process.env.OPENAI_BASE_URL || '').includes('openrouter')
      ? 'https://api.openai.com/v1'
      : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  base = base.replace(/\/+$/, '');
  const key = process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';
  if (!key) return texts.map(hashEmbed);
  const out = [];
  // Batch to keep request sizes sane.
  for (let i = 0; i < texts.length; i += 96) {
    const batch = texts.slice(i, i + 96);
    const res = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: batch }),
    });
    if (!res.ok) throw new Error(`Embeddings error: ${(await res.text().catch(() => res.status)).slice(0, 200)}`);
    const data = await res.json();
    for (const row of data.data) out[i + row.index] = row.embedding;
  }
  return out;
}

/** Embed an array of strings -> array of vectors (same order). */
async function embed(texts) {
  const arr = Array.isArray(texts) ? texts : [texts];
  if (PROVIDER === 'openai') return openaiEmbed(arr);
  return arr.map(hashEmbed);
}

async function embedOne(text) { return (await embed([text]))[0]; }

module.exports = { embed, embedOne, PROVIDER, HASH_DIM };
