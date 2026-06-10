'use strict';

/**
 * Qi Men Superpowers — BaZi & Qi Men Dun Jia web application server.
 *
 * Zero-dependency Node.js (>=18) HTTP server:
 *   - serves the static frontend from web/
 *   - exposes a JSON API over the vendored qmenpowers bash engine
 *   - provides BaZi analysis (local + optional Astrology-API.io)
 *
 * API:
 *   GET  /api/health
 *   POST /api/bazi             { birth, gender, longitude?, tzOffset? }
 *   POST /api/qimen/plate      { datetime, type?, tianqin?, longitude?, tzOffset? }
 *   POST /api/qimen/analyze    { module, birth?, eventTime?, question?, topic?,
 *                                yixiang?, familyStems?, tianqin?, longitude?, tzOffset? }
 *   POST /api/qimen/wanwu      { plateId, palace } | { stem?/star?/gate?/deity?/branch? }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const qimen = require('./qimen');
const bazi = require('./bazi');
const llm = require('./llm');
const embeddings = require('./embeddings');
const vectorstore = require('./vectorstore');
const { trueSolarTime } = require('./solar');

const PORT = Number(process.env.PORT || 8787);
const WEB_ROOT = path.resolve(__dirname, '..', '..', 'web');

// When the frontend is hosted on a different origin (e.g. static web/ published
// to here.now while this server runs elsewhere), set CORS_ALLOW_ORIGIN to that
// origin, e.g. "https://woody-rosette-bekc.here.now". Defaults to "*".
const CORS_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Simple response cache: identical computation requests within the TTL are
// served from memory (plate setting + module analysis are deterministic).
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 256 * 1024) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** Apply true-solar-time correction to a datetime field when longitude given. */
function applySolarCorrection(body, field) {
  if (body.longitude == null || body[field] == null) return null;
  const lng = Number(body.longitude);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw Object.assign(new Error('longitude must be a number in [-180, 180]'), { status: 400 });
  }
  const tz = body.tzOffset == null ? 8 : Number(body.tzOffset);
  const corrected = trueSolarTime(body[field], lng, tz);
  const original = body[field];
  body[field] = corrected.datetime;
  return { field, original, corrected: corrected.datetime, offsetMinutes: corrected.offsetMinutes };
}

const routes = {
  'POST /api/bazi': async (body) => {
    const correction = applySolarCorrection(body, 'birth');
    const key = `bazi:${body.birth}:${body.gender}`;
    const cached = cacheGet(key);
    if (cached) return { ...cached, solarCorrection: correction, cached: true };
    const result = await bazi.analyzeBazi(body);
    cacheSet(key, result);
    return { ...result, solarCorrection: correction };
  },

  'POST /api/qimen/plate': async (body) => {
    const correction = applySolarCorrection(body, 'datetime');
    const result = await qimen.generatePlate(body);
    return { ...result, solarCorrection: correction };
  },

  'POST /api/qimen/analyze': async (body) => {
    const corrections = [
      applySolarCorrection(body, 'birth'),
      applySolarCorrection(body, 'eventTime'),
    ].filter(Boolean);
    const key = `mod:${JSON.stringify([body.module, body.birth, body.eventTime, body.question, body.topic, body.yixiang, body.familyStems, body.tianqin])}`;
    const cached = cacheGet(key);
    if (cached) return { ...cached, solarCorrections: corrections, cached: true };
    const result = await qimen.runModule(body);
    cacheSet(key, result);
    return { ...result, solarCorrections: corrections };
  },

  'POST /api/qimen/wanwu': (body) => qimen.runWanwu(body),

  'GET /api/health': async () => ({
    ok: true,
    engine: 'qmenpowers (pure Bash, Zhi-Run, rotating plate)',
    modules: qimen.MODULES,
    eventQuestions: qimen.EVENT_QUESTIONS,
    astrologyApiConfigured: Boolean(process.env.ASTROLOGY_API_KEY),
  }),
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(WEB_ROOT, urlPath));
  if (!file.startsWith(WEB_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/** Streaming chat over SSE. Body: { messages:[{role,content}], context?, lang? } */
async function handleChat(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.message });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  try {
    send({ type: 'meta', provider: llm.PROVIDER });
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const context = body.context || {};

    // RAG: retrieve reference chunks for the latest user question.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser && (await vectorstore.count()) !== 0) {
      try {
        const qvec = await embeddings.embedOne(lastUser.content);
        const hits = await vectorstore.search(qvec, 6);
        const useful = hits.filter((h) => h.score > 0.15);
        if (useful.length) {
          context.retrieved = useful.map((h) => `(${h.meta?.title || h.id}) ${h.text}`);
          send({ type: 'sources', items: useful.map((h) => ({ title: h.meta?.title || h.id, score: Number(h.score.toFixed(3)) })) });
        }
      } catch (e) {
        console.error(`[${new Date().toISOString()}] /api/chat retrieval:`, e.message);
      }
    }

    await llm.streamChat({
      messages,
      context,
      lang: body.lang || 'en',
      signal: ac.signal,
      onToken: (t) => send({ type: 'token', text: t }),
    });
    send({ type: 'done' });
  } catch (err) {
    if (!ac.signal.aborted) {
      console.error(`[${new Date().toISOString()}] /api/chat:`, err.message);
      send({ type: 'error', message: err.message });
    }
  } finally {
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  // CORS preflight — lets a browser on a different origin call the JSON API.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return;
  }
  const reqPath = req.url.split('?')[0];

  // Streaming chat endpoint (Server-Sent Events) — handled outside the JSON routes.
  if (req.method === 'POST' && reqPath === '/api/chat') {
    return handleChat(req, res);
  }

  const routeKey = `${req.method} ${reqPath}`;
  const handler = routes[routeKey];
  if (!handler) {
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    return sendJson(res, 404, { error: 'not found' });
  }
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    const result = await handler(body);
    sendJson(res, 200, result);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${routeKey}:`, err.message);
    sendJson(res, status, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Qi Men Superpowers listening on http://localhost:${PORT}`);
  console.log(`Astrology-API.io integration: ${process.env.ASTROLOGY_API_KEY ? 'enabled' : 'disabled (local BaZi calculation only)'}`);
});
