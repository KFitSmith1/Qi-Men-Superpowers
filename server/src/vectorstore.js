'use strict';

/*
 * Vector store for RAG retrieval. Backend chosen by VECTOR_STORE:
 *   local    : JSON file on disk + in-process cosine search (default).
 *   insforge : the vector index is persisted as many small shard files in an
 *              InsForge storage bucket (each under the gateway's body limit);
 *              the server downloads them on first use and runs cosine search
 *              in-process. Vectors are int8-quantized (base64) — cosine is
 *              scale-invariant so ranking is preserved at ~15% of the float
 *              size. Saves are incremental: unchanged shards are skipped via
 *              content hash. Uses only documented InsForge endpoints
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
const crypto = require('crypto');

const BACKEND = (process.env.VECTOR_STORE || 'local').toLowerCase();
const DATA_FILE = process.env.VECTOR_FILE || path.join(__dirname, '..', 'data', 'vectors.json');

// Each InsForge upload is kept under this size so it clears the storage
// gateway's request-body limit (the index is sharded across several files).
const SHARD_BYTES = Number(process.env.INSFORGE_SHARD_BYTES || 450 * 1024);

/* ---- int8 vector quantization -------------------------------------------
 * Cosine similarity is scale-invariant, so per-vector max-abs int8
 * quantization preserves retrieval ranking (≈1% recall impact) while cutting
 * storage and RAM ~85% vs float JSON. Stored as base64 (`q8`); legacy float
 * `vector` records are still readable and get rewritten on the next save. */

function quantize(v) {
  let m = 1e-9;
  for (let i = 0; i < v.length; i++) { const a = Math.abs(v[i]); if (a > m) m = a; }
  const s = 127 / m;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] * s);
  return q;
}

/** Runtime record -> compact stored JSON string. */
function serializeRec(it) {
  const q8 = Buffer.from(it.vector.buffer, it.vector.byteOffset, it.vector.length).toString('base64');
  return JSON.stringify({ id: it.id, q8, text: it.text, meta: it.meta });
}

/** Stored record (q8 base64 OR legacy float array) -> runtime record. */
function parseRec(r) {
  let vector;
  if (r.q8) {
    const b = Buffer.from(r.q8, 'base64');
    vector = new Int8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  } else {
    vector = quantize(r.vector || []);
  }
  return { id: r.id, vector, text: r.text, meta: r.meta };
}

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

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
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).map(parseRec); }
    catch { return []; }
  },
  save(items) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, `[${items.map(serializeRec).join(',')}]`);
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
  async _getRaw(cfg, key) {
    const res = await fetchRetry(this._url(cfg, key), { headers: { 'x-api-key': cfg.key } });
    if (!res.ok) return null;
    return res.text();
  },
  async _getJson(cfg, key) {
    const raw = await this._getRaw(cfg, key);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },
  async _delete(cfg, key) {
    await fetch(this._url(cfg, key), { method: 'DELETE', headers: { 'x-api-key': cfg.key } }).catch(() => {});
  },
  _shardHashes: {}, // shard index -> sha1 of last known stored content (skip unchanged uploads)
  async load() {
    const cfg = this._cfg();
    const idx = await this._getJson(cfg, this._indexKey(cfg));
    if (idx && Number.isInteger(idx.shards)) {
      // Fetch shards in parallel (bounded), preserving chunk order across shards.
      const raws = await mapLimit([...Array(idx.shards).keys()], 6, (i) => this._getRaw(cfg, this._shardKey(cfg, i)));
      const out = [];
      raws.forEach((raw, i) => {
        if (raw == null) return;
        this._shardHashes[i] = sha1(raw);
        try { for (const r of JSON.parse(raw)) out.push(parseRec(r)); } catch { /* corrupt shard — skip */ }
      });
      return out;
    }
    // Backward-compat: a single legacy blob from before sharding.
    const legacy = await this._getJson(cfg, cfg.object);
    return Array.isArray(legacy) ? legacy.map(parseRec) : [];
  },
  async save(items) {
    const cfg = this._cfg();
    // Split into shards small enough to clear the storage gateway's body limit.
    // Shard boundaries are deterministic over insertion order, so appending new
    // documents leaves earlier shards byte-identical — and unchanged shards are
    // skipped via content hash, making incremental checkpoints O(new data)
    // instead of re-uploading the whole index every time.
    const shards = [];
    let cur = [];
    let curBytes = 2;
    for (const it of items) {
      const s = serializeRec(it);
      if (cur.length && curBytes + s.length + 1 > SHARD_BYTES) { shards.push(`[${cur.join(',')}]`); cur = []; curBytes = 2; }
      cur.push(s);
      curBytes += s.length + 1;
    }
    if (cur.length) shards.push(`[${cur.join(',')}]`);

    const dirty = [];
    shards.forEach((text, i) => { if (this._shardHashes[i] !== sha1(text)) dirty.push(i); });
    // Upload changed shards (parallel, with retries) BEFORE the manifest, so a
    // reader never sees a manifest that points past the shards that exist.
    await mapLimit(dirty, 6, (i) => this._put(cfg, this._shardKey(cfg, i), shards[i]));
    dirty.forEach((i) => { this._shardHashes[i] = sha1(shards[i]); });
    await this._put(cfg, this._indexKey(cfg), JSON.stringify({ shards: shards.length, count: items.length, updated: new Date().toISOString() }));
    // Best-effort cleanup of shards left over from a previously larger index.
    for (let i = shards.length; i < shards.length + 8; i++) { this._delete(cfg, this._shardKey(cfg, i)); delete this._shardHashes[i]; }
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
  for (const it of items) {
    // Quantize incoming float vectors to int8 (idempotent for Int8Array input).
    const vector = it.vector instanceof Int8Array ? it.vector : quantize(it.vector || []);
    byId.set(it.id, { id: it.id, vector, text: it.text, meta: it.meta });
  }
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
    if (x.meta?.size) e.size = x.meta.size; // source file size — used for manifest recovery
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.chunks - a.chunks);
}

module.exports = { upsert, search, count, docs, BACKEND, cosine };
