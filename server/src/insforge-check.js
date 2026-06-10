'use strict';

/*
 * InsForge connectivity check. Validates INSFORGE_BASE_URL + INSFORGE_API_KEY
 * by listing buckets, and confirms INSFORGE_BUCKET exists and the vector blob
 * (if any) is readable. Run once on deploy before ingesting:
 *
 *   node src/insforge-check.js
 */

async function main() {
  const base = (process.env.INSFORGE_BASE_URL || '').replace(/\/+$/, '');
  const key = process.env.INSFORGE_API_KEY || '';
  const bucket = process.env.INSFORGE_BUCKET || '';
  const object = process.env.INSFORGE_OBJECT || 'qms_vectors.json';
  if (!base || !key) { console.error('Set INSFORGE_BASE_URL and INSFORGE_API_KEY first.'); process.exit(1); }
  const headers = { 'x-api-key': key };

  console.log(`Base URL : ${base}`);
  const list = await fetch(`${base}/api/storage/buckets`, { headers });
  if (!list.ok) { console.error(`✗ List buckets failed: HTTP ${list.status} ${(await list.text().catch(() => '')).slice(0, 200)}`); process.exit(1); }
  const buckets = (await list.json()).buckets || [];
  console.log(`✓ Connected. Buckets: ${buckets.join(', ') || '(none)'}`);

  if (!bucket) { console.log('Set INSFORGE_BUCKET to also check the vector blob.'); return; }
  if (!buckets.includes(bucket)) { console.error(`✗ Bucket "${bucket}" not found.`); process.exit(1); }
  console.log(`✓ Bucket "${bucket}" exists.`);

  const obj = await fetch(`${base}/api/storage/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(object)}`, { headers });
  if (obj.status === 404) { console.log(`• "${object}" not uploaded yet — run: node src/ingest.js <vault>`); return; }
  if (!obj.ok) { console.error(`✗ Reading "${object}" failed: HTTP ${obj.status}`); process.exit(1); }
  let n = '?';
  try { n = JSON.parse(await obj.text()).length; } catch { /* not JSON */ }
  console.log(`✓ "${object}" readable — ${n} chunks in the index.`);
}

main().catch((e) => { console.error('Check failed:', e.message); process.exit(1); });
