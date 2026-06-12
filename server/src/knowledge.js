'use strict';

/*
 * Auto-ingest documents from an InsForge storage bucket into the RAG index.
 *
 * Drop .pdf / .txt / .md files into your InsForge bucket (dashboard or API);
 * sync() lists them, downloads new/changed ones, extracts + embeds the text,
 * and merges the chunks into the vector index. A small manifest object tracks
 * file sizes so unchanged files are skipped (no repeat embedding cost).
 *
 * Config:
 *   INSFORGE_BASE_URL, INSFORGE_API_KEY     (reused from the vector store)
 *   INSFORGE_DOCS_BUCKET   bucket to scan (defaults to INSFORGE_BUCKET)
 *   INSFORGE_DOCS_PREFIX   optional key prefix to limit the scan
 *   INSFORGE_MANIFEST_OBJECT  manifest blob key (default qms_docs_manifest.json)
 */

const documents = require('./documents');
const { chunkNote } = require('./obsidian');
const embeddings = require('./embeddings');
const store = require('./vectorstore');

function cfg() {
  const base = (process.env.INSFORGE_BASE_URL || '').replace(/\/+$/, '');
  const key = process.env.INSFORGE_API_KEY || '';
  const bucket = process.env.INSFORGE_DOCS_BUCKET || process.env.INSFORGE_BUCKET || '';
  const prefix = process.env.INSFORGE_DOCS_PREFIX || '';
  // v2: OCR support added — a fresh manifest forces one re-scan of every file
  // so scanned PDFs that were previously skipped as "no text" get OCR'd.
  const manifestKey = process.env.INSFORGE_MANIFEST_OBJECT || 'qms_docs_manifest_v2.json';
  return { base, key, bucket, prefix, manifestKey };
}

function enabled() { const c = cfg(); return Boolean(c.base && c.key && c.bucket); }

// Last-sync status, surfaced via /api/health.
let lastSync = null;   // { at, files, changedFiles, newChunks, totalChunks }
let lastError = null;  // { at, message }

function status() {
  const c = cfg();
  return { enabled: enabled(), bucket: enabled() ? c.bucket : null, syncing: running, lastSync, lastError };
}

const headers = (c) => ({ 'x-api-key': c.key });
const objUrl = (c, key) => `${c.base}/api/storage/buckets/${encodeURIComponent(c.bucket)}/objects/${encodeURIComponent(key)}`;

/** fetch with retry on transient failures; `opts` may be a factory so request
 *  bodies (FormData) are rebuilt per attempt. */
async function req(url, opts, tries = 4) {
  let delay = 400;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, typeof opts === 'function' ? opts() : opts);
      if ((res.status === 429 || res.status >= 500) && i < tries - 1) { await new Promise((r) => setTimeout(r, delay)); delay *= 2.5; continue; }
      return res;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, delay)); delay *= 2.5;
    }
  }
}

async function listObjects(c) {
  const out = [];
  let offset = 0;
  for (;;) {
    const url = `${c.base}/api/storage/buckets/${encodeURIComponent(c.bucket)}/objects?limit=1000&offset=${offset}`
      + (c.prefix ? `&prefix=${encodeURIComponent(c.prefix)}` : '');
    const res = await req(url, { headers: headers(c) });
    if (!res.ok) throw new Error(`list objects HTTP ${res.status}`);
    const body = await res.json();
    const data = body.data || body.objects || [];
    out.push(...data);
    if (data.length < 1000) break;
    offset += data.length;
  }
  return out;
}

async function getManifest(c) {
  const res = await req(objUrl(c, c.manifestKey), { headers: headers(c) });
  if (!res.ok) {
    if (res.status !== 404) console.warn(`  knowledge: manifest fetch HTTP ${res.status} — will recover from the index`);
    return {};
  }
  try { return JSON.parse(await res.text()); } catch { return {}; }
}

async function putManifest(c, manifest) {
  const opts = () => {
    const fd = new FormData();
    fd.append('file', new Blob([JSON.stringify(manifest)], { type: 'application/json' }), c.manifestKey);
    return { method: 'PUT', headers: headers(c), body: fd };
  };
  const res = await req(objUrl(c, c.manifestKey), opts);
  if (!res.ok) console.error(`  knowledge: MANIFEST SAVE FAILED (HTTP ${res.status}) — finished files may be re-processed after a restart`);
}

async function download(c, key) {
  const res = await req(objUrl(c, key), { headers: headers(c) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Live progress of an in-flight sync (null when idle). */
let running = null; // { startedAt, current, done, total }

/** Scan the bucket and ingest new/changed documents.
 *  Incremental: each file is embedded, stored, and checkpointed in the manifest
 *  as soon as it finishes — progress survives restarts and documents become
 *  searchable one by one. A mutex prevents overlapping runs (boot + timer +
 *  manual endpoint). */
async function sync() {
  if (!enabled()) return { enabled: false };
  if (running) return { enabled: true, alreadyRunning: true, progress: running };
  running = { startedAt: new Date().toISOString(), current: null, done: 0, total: 0 };
  try {
    const c = cfg();
    const objects = (await listObjects(c)).filter((o) => /\.(md|txt|pdf)$/i.test(o.key || ''));
    const manifest = await getManifest(c);

    // Self-healing: every stored chunk records its source file's size, so a
    // lost/stale manifest can be rebuilt from the vector index — a file whose
    // chunks are already indexed at the current size is never re-processed.
    let recovered = 0;
    try {
      const sizeByPath = new Map((await store.docs()).filter((d) => d.size).map((d) => [d.path, d.size]));
      for (const o of objects) {
        const size = o.size ?? 0;
        if (manifest[o.key] !== size && sizeByPath.get(o.key) === size) { manifest[o.key] = size; recovered++; }
      }
    } catch { /* index unavailable — proceed with the manifest as-is */ }
    if (recovered) {
      console.log(`  knowledge: recovered ${recovered} manifest entr${recovered === 1 ? 'y' : 'ies'} from the index`);
      await putManifest(c, manifest);
    }

    const changed = objects.filter((o) => manifest[o.key] !== (o.size ?? 0));
    running.total = changed.length;

    let changedFiles = 0;
    let newChunks = 0;
    const noTextFiles = [];   // present in the bucket but no extractable text even after OCR
    const errorFiles = [];    // download/extraction failed (will be retried next sync)
    for (const o of changed) {
      const key = o.key;
      const size = o.size ?? 0;
      running.current = key;
      let text;
      try { text = await documents.extractBuffer(key, await download(c, key)); }
      catch (e) {
        console.warn(`  knowledge: skip ${key}: ${e.message}`);
        errorFiles.push(`${key}: ${e.message}`.slice(0, 200));
        running.done++;
        continue;
      }
      if (!text || !text.trim()) {
        console.warn(`  knowledge: "${key}" has no extractable text (even after OCR) — skipped`);
        noTextFiles.push(key);
        manifest[key] = size;
      } else {
        // Embed/store failures must not abort the whole sync — record the file
        // and move on (its manifest entry stays unset, so it's retried later).
        try {
          const title = key.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
          const records = [];
          chunkNote(text).forEach((ch, i) => records.push({
            id: `bucket:${key}#${i}`, text: ch.text, meta: { title, path: key, heading: ch.heading || '', size },
          }));
          const vecs = await embeddings.embed(records.map((r) => r.text));
          await store.upsert(records.map((r, i) => ({ id: r.id, vector: vecs[i], text: r.text, meta: r.meta })));
          newChunks += records.length;
          changedFiles++;
          manifest[key] = size;
          console.log(`  knowledge: indexed "${key}" (${records.length} chunks)`);
        } catch (e) {
          console.warn(`  knowledge: failed to index ${key}: ${e.message}`);
          errorFiles.push(`${key}: ${e.message}`.slice(0, 200));
        }
      }
      // Checkpoint after every file so a restart never repeats finished work.
      await putManifest(c, manifest);
      running.done++;
    }

    const summary = {
      enabled: true, files: objects.length, changedFiles, newChunks,
      totalChunks: await store.count(),
      ...(noTextFiles.length ? { noTextFiles: noTextFiles.slice(0, 20) } : {}),
      ...(errorFiles.length ? { errorFiles: errorFiles.slice(0, 20) } : {}),
    };
    lastSync = { at: new Date().toISOString(), ...summary };
    lastError = null;
    return summary;
  } catch (e) {
    lastError = { at: new Date().toISOString(), message: e.message };
    throw e;
  } finally {
    running = null;
  }
}

module.exports = { sync, enabled, status };
