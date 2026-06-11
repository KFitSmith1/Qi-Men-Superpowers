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

// Each InsForge upload is kept under this size so it clears the storage
// gateway's request-body limit (the index is sharded across several files).
const SHARD_BYTES = Number(process.env.INSFORGE_SHARD_BYTES || 450 * 1024);

/** Round vector components to 6 decimals — shrinks the stored index a lot with
 *  no meaningful effect on cosine similarity. */
function roundVec(v) {
  const o = new Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = Math.round(v[i] * 1e6) / 1e6;
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with retry on transient failures (network errors, 429, 5xx).
 *  `optsFn` may be a function so the request body (FormData) is rebuilt per try. */
async function fetchRetry(url, optsFn, tries = 4) {
  let delay = 400;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, typeof optsFn === 'function' ? optsFn() : optsFn);
      if ((res.status === 429 || res.status >= 500) && i < tries - 1) { await sleep(delay); delay *= 2.5; continue; }
      return res;
    } catch (e) {
      if (i < tries - 1) { await sleep(delay); delay *= 2.5; continue; }
      throw e;
    }
  }
}

/** Run async fn over items with bounded concurrency; preserves result order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

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
  _url(cfg, key) {
    return `${cfg.base}/api/storage/buckets/${encodeURIComponent(cfg.bucket)}/objects/${encodeURIComponent(key)}`;
  },
  _shardKey(cfg, i) { return `${cfg.object.replace(/\.json$/i, '')}.${String(i).padStart(4, '0')}.json`; },
  _indexKey(cfg) { return `${cfg.object.replace(/\.json$/i, '')}.index.json`; },
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
  async _put(cfg, key, text) {
    const opts = () => {
      const fd = new FormData();
      fd.append('file', new Blob([text], { type: 'application/json' }), key.split('/').pop());
      return { method: 'PUT', headers: { 'x-api-key': cfg.key }, body: fd };
    };
    let res = await fetchRetry(this._url(cfg, key), opts);
    if (res.status === 404) { // bucket missing — create and retry once
      await this._ensureBucket(cfg);
      res = await fetchRetry(this._url(cfg, key), opts);
    }
    if (!res.ok) throw new Error(`InsForge upload failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  },
  async _getJson(cfg, key) {
    const res = await fetchRetry(this._url(cfg, key), { headers: { 'x-api-key': cfg.key } });
    if (!res.ok) return null;
    try { return JSON.parse(await res.text()); } catch { return null; }
  },
  async _delete(cfg, key) {
    await fetch(this._url(cfg, key), { method: 'DELETE', headers: { 'x-api-key': cfg.key } }).catch(() => {});
  },
  async load() {
    const cfg = this._cfg();
    const idx = await this._getJson(cfg, this._indexKey(cfg));
    if (idx && Number.isInteger(idx.shards)) {
      // Fetch shards in parallel (bounded), preserving chunk order across shards.
      const parts = await mapLimit([...Array(idx.shards).keys()], 6, (i) => this._getJson(cfg, this._shardKey(cfg, i)));
      const out = [];
      for (const part of parts) if (Array.isArray(part)) out.push(...part);
      return out;
    }
    // Backward-compat: a single legacy blob from before sharding.
    const legacy = await this._getJson(cfg, cfg.object);
    return Array.isArray(legacy) ? legacy : [];
  },
  async save(items) {
    const cfg = this._cfg();
    // Split into shards small enough to clear the storage gateway's body limit.
    const shards = [];
    let cur = [];
    let curBytes = 2;
    for (const it of items) {
      const rec = { id: it.id, vector: roundVec(it.vector || []), text: it.text, meta: it.meta };
      const len = JSON.stringify(rec).length + 1;
      if (cur.length && curBytes + len > SHARD_BYTES) { shards.push(cur); cur = []; curBytes = 2; }
      cur.push(rec);
      curBytes += len;
    }
    if (cur.length) shards.push(cur);

    // Upload all shards (parallel, with retries) BEFORE writing the manifest, so
    // a reader never sees a manifest that points past the shards that exist.
    await mapLimit(shards, 6, (s, i) => this._put(cfg, this._shardKey(cfg, i), JSON.stringify(s)));
    await this._put(cfg, this._indexKey(cfg), JSON.stringify({ shards: shards.length, count: items.length, updated: new Date().toISOString() }));
    // Best-effort cleanup of shards left over from a previously larger index.
    for (let i = shards.length; i < shards.length + 8; i++) this._delete(cfg, this._shardKey(cfg, i));
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

/** Inventory: which documents are searchable, with chunk counts. */
async function docs() {
  const all = await ensureLoaded();
  const map = new Map();
  for (const x of all) {
    const key = x.meta?.path || x.meta?.title || x.id;
    const e = map.get(key) || { path: key, title: x.meta?.title || key, chunks: 0 };
    e.chunks++;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.chunks - a.chunks);
}

module.exports = { upsert, search, count, docs, BACKEND, cosine };
