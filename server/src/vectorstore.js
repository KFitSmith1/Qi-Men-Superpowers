'use strict';

/*
 * Vector store for RAG retrieval. Backend chosen by VECTOR_STORE:
 *   local    : JSON file on disk + in-process cosine search (default).
 *              Zero infra; fine up to ~tens of thousands of chunks.
 *   insforge : InsForge-hosted pgvector table over REST (see NOTE below).
 *
 * Common interface:
 *   await upsert(items)            items: [{ id, vector, text, meta }]
 *   await search(queryVector, k)   -> [{ id, score, text, meta }]
 *   await count()
 *
 * --- NOTE on the InsForge backend ----------------------------------------
 * The InsForge calls below are written against the common PostgREST + pgvector
 * pattern but are NOT yet verified against InsForge's actual API. To finalise,
 * I need three things from your InsForge project:
 *   1. Base URL + auth header (e.g. apikey / Authorization: Bearer <key>)
 *   2. How a vector similarity search is exposed (an RPC like `match_chunks`,
 *      or a REST query with an order-by-distance operator)
 *   3. The table/columns (this code assumes a table `qms_chunks` with columns
 *      id text, embedding vector, content text, meta jsonb)
 * Until then, VECTOR_STORE defaults to `local` so everything runs.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = (process.env.VECTOR_STORE || 'local').toLowerCase();
const DATA_FILE = process.env.VECTOR_FILE || path.join(__dirname, '..', 'data', 'vectors.json');

/* ---- cosine similarity -------------------------------------------------- */

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/* ---- local JSON-file backend ------------------------------------------- */

const local = {
  _items: null,
  _load() {
    if (this._items) return this._items;
    try { this._items = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { this._items = []; }
    return this._items;
  },
  _save() {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(this._items));
  },
  async upsert(items) {
    const all = this._load();
    const byId = new Map(all.map((x) => [x.id, x]));
    for (const it of items) byId.set(it.id, it);
    this._items = [...byId.values()];
    this._save();
    return this._items.length;
  },
  async search(q, k = 6) {
    const all = this._load();
    return all
      .map((x) => ({ id: x.id, score: cosine(q, x.vector), text: x.text, meta: x.meta }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  },
  async count() { return this._load().length; },
};

/* ---- InsForge pgvector backend (unverified — see NOTE) ------------------ */

const insforge = {
  _cfg() {
    const base = (process.env.INSFORGE_BASE_URL || '').replace(/\/+$/, '');
    const key = process.env.INSFORGE_API_KEY || '';
    if (!base || !key) throw new Error('InsForge not configured: set INSFORGE_BASE_URL and INSFORGE_API_KEY');
    return { base, key, table: process.env.INSFORGE_TABLE || 'qms_chunks' };
  },
  _headers(cfg) {
    return { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };
  },
  async upsert(items) {
    const cfg = this._cfg();
    const rows = items.map((it) => ({ id: it.id, embedding: it.vector, content: it.text, meta: it.meta }));
    const res = await fetch(`${cfg.base}/rest/v1/${cfg.table}`, {
      method: 'POST',
      headers: { ...this._headers(cfg), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`InsForge upsert failed: ${(await res.text().catch(() => res.status)).slice(0, 200)}`);
    return rows.length;
  },
  async search(q, k = 6) {
    const cfg = this._cfg();
    // Assumes a Postgres function exposed as an RPC; exact name TBD.
    const res = await fetch(`${cfg.base}/rest/v1/rpc/match_${cfg.table}`, {
      method: 'POST',
      headers: this._headers(cfg),
      body: JSON.stringify({ query_embedding: q, match_count: k }),
    });
    if (!res.ok) throw new Error(`InsForge search failed: ${(await res.text().catch(() => res.status)).slice(0, 200)}`);
    const rows = await res.json();
    return rows.map((r) => ({ id: r.id, score: r.similarity ?? r.score, text: r.content, meta: r.meta }));
  },
  async count() { return -1; }, // unknown without a query
};

const store = BACKEND === 'insforge' ? insforge : local;

module.exports = { upsert: (i) => store.upsert(i), search: (q, k) => store.search(q, k), count: () => store.count(), BACKEND, cosine };
