'use strict';

/*
 * Vector store for RAG retrieval. Backend chosen by VECTOR_STORE:
 *   local    : JSON file on disk + in-process cosine search (default).
 *   insforge : the vector index is persisted as a single JSON blob in an
 *              InsForge storage bucket; the server downloads it on first use
 *              and runs cosine search in-process. Survives the ephemeral
 *              deploy container, and uses only documented InsForge endpoints
 *              (InsForge has no managed vector-search API).
 *
 * Both backends share the same in-memory cosine search; they differ only in
 * where the index is loaded from / saved to.
 *
 * Common interface:
 *   await upsert(items)            items: [{ id, vector, text, meta }]
 *   await search(queryVector, k)   -> [{ id, score, text, meta }]
 *   await count()
 *
 * InsForge config (VECTOR_STORE=insforge):
 *   INSFORGE_BASE_URL   e.g. https://<project>.insforge.app   (no trailing /)
 *   INSFORGE_API_KEY    project API key (sent as x-api-key)
 *   INSFORGE_BUCKET     storage bucket name you created
 *   INSFORGE_OBJECT     blob key (default qms_vectors.json)
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

/* ---- persistence adapters ----------------------------------------------- */
/* Each adapter implements load() -> items[] and save(items) -> void/Promise. */

const localAdapter = {
  load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { return []; }
  },
  save(items) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(items));
  },
};

const insforgeAdapter = {
  _cfg() {
    const base = (process.env.INSFORGE_BASE_URL || '').replace(/\/+$/, '');
    const key = process.env.INSFORGE_API_KEY || '';
    const bucket = process.env.INSFORGE_BUCKET || '';
    if (!base || !key || !bucket) {
      throw new Error('InsForge store not configured: set INSFORGE_BASE_URL, INSFORGE_API_KEY, INSFORGE_BUCKET');
    }
    const object = process.env.INSFORGE_OBJECT || 'qms_vectors.json';
    return { base, key, bucket, object };
  },
  _objectUrl(cfg) {
    return `${cfg.base}/api/storage/buckets/${encodeURIComponent(cfg.bucket)}/objects/${encodeURIComponent(cfg.object)}`;
  },
  async _ensureBucket(cfg) {
    // Create the bucket if it doesn't exist yet (private). Ignore 409 (exists).
    const res = await fetch(`${cfg.base}/api/storage/buckets`, {
      method: 'POST',
      headers: { 'x-api-key': cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketName: cfg.bucket, isPublic: false }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`InsForge create-bucket failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    }
  },
  async load() {
    const cfg = this._cfg();
    const res = await fetch(this._objectUrl(cfg), { headers: { 'x-api-key': cfg.key } });
    if (res.status === 404) return [];                       // bucket/object not there yet
    if (!res.ok) throw new Error(`InsForge download failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return []; }
  },
  async save(items) {
    const cfg = this._cfg();
    const put = () => {
      const fd = new FormData();
      fd.append('file', new Blob([JSON.stringify(items)], { type: 'application/json' }), cfg.object);
      return fetch(this._objectUrl(cfg), { method: 'PUT', headers: { 'x-api-key': cfg.key }, body: fd });
    };
    let res = await put();
    if (res.status === 404) {            // bucket missing — create it and retry once
      await this._ensureBucket(cfg);
      res = await put();
    }
    if (!res.ok) throw new Error(`InsForge upload failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  },
};

const adapter = BACKEND === 'insforge' ? insforgeAdapter : localAdapter;

/* ---- store (shared in-memory index over the chosen adapter) -------------- */

let cache = null; // loaded lazily; persists for the process lifetime

async function ensureLoaded() {
  if (!cache) cache = await adapter.load();
  return cache;
}

async function upsert(items) {
  const all = await ensureLoaded();
  const byId = new Map(all.map((x) => [x.id, x]));
  for (const it of items) byId.set(it.id, it);
  cache = [...byId.values()];
  await adapter.save(cache);
  return cache.length;
}

async function search(q, k = 6) {
  const all = await ensureLoaded();
  return all
    .map((x) => ({ id: x.id, score: cosine(q, x.vector), text: x.text, meta: x.meta }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

async function count() { return (await ensureLoaded()).length; }

module.exports = { upsert, search, count, BACKEND, cosine };
