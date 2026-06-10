'use strict';

/*
 * API endpoint configuration.
 *
 * The Qi Men Superpowers backend (server/ + engine/) must run somewhere that
 * can execute Node.js AND spawn bash. The files in this web/ folder are only a
 * static frontend — they contain no divination logic and cannot work alone.
 *
 * When web/ is hosted SEPARATELY from the backend — e.g. published as static
 * files to here.now while the Node server runs elsewhere — set API_BASE below
 * to the backend's origin (no trailing slash), e.g.:
 *
 *     const API_BASE = 'https://my-qimen-backend.example.com';
 *
 * Leave it empty ('') to call the same origin that served this page — the
 * default when the Node server serves both the API and these files.
 *
 * The backend must allow this page's origin via CORS_ALLOW_ORIGIN
 * (see server/src/index.js).
 *
 * Resolution order (first match wins), so you can override without editing:
 *   1. ?api=<url> query parameter   (quick testing)
 *   2. localStorage 'qmsApiBase'     (persists across reloads)
 *   3. API_BASE constant below
 *   4. '' (same origin)
 */
const API_BASE = '';

window.QMS_API_BASE = (() => {
  const clean = (u) => String(u).replace(/\/+$/, '');
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q) return clean(q);
    const ls = localStorage.getItem('qmsApiBase');
    if (ls) return clean(ls);
  } catch (_) { /* sandboxed / no storage — fall through */ }
  return clean(API_BASE);
})();
