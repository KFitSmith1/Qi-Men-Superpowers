'use strict';

/**
 * Smoke test: exercises every API-facing code path directly (no HTTP).
 * Run with: npm test  (from server/)
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const qimen = require('../src/qimen');
const { analyzeBazi } = require('../src/bazi');
const { trueSolarTime, daysToJie } = require('../src/solar');

const BIRTH = '1990-05-15 14:30';
const EVENT = '2026-06-10 10:00';

async function main() {
  // Plate generation
  const { plate, plateId, text } = await qimen.generatePlate({ datetime: BIRTH, type: 'birth' });
  assert.deepStrictEqual(plate.si_zhu, { year: '庚午', month: '辛巳', day: '庚辰', hour: '癸未' });
  assert.strictEqual(Object.keys(plate.palaces).length, 9);
  assert.ok(text.includes('四柱'));
  console.log('✓ plate generation (si_zhu, 9 palaces)');

  // Wan Wu from cached plate
  const ww = await qimen.runWanwu({ plateId, palace: 3 });
  assert.ok(ww.text.length > 50);
  console.log('✓ wanwu palace lookup via plate cache');

  // BaZi analysis
  const bz = await analyzeBazi({ birth: BIRTH, gender: 'male' });
  assert.strictEqual(bz.dayMaster.stem, '庚');
  assert.strictEqual(bz.pillars.length, 4);
  const dayPillar = bz.pillars[2];
  assert.strictEqual(dayPillar.tenGod, '日主');
  const yearPillar = bz.pillars[0]; // 庚午 vs DM 庚 → 比肩
  assert.strictEqual(yearPillar.tenGod, '比肩');
  const sum = bz.fiveElements.reduce((a, e) => a + e.percent, 0);
  assert.ok(Math.abs(sum - 100) < 1, `five-element percentages sum to ~100, got ${sum}`);
  assert.strictEqual(bz.luckPillars.pillars.length, 8);
  // 1990 = 庚午 year (yang stem), male → forward; month 辛巳 → first luck pillar 壬午
  assert.strictEqual(bz.luckPillars.directionEn, 'forward');
  assert.strictEqual(bz.luckPillars.pillars[0].ganzhi, '壬午');
  console.log('✓ bazi analysis (day master, ten gods, elements, luck pillars)');

  // Birth-plate modules
  for (const mod of ['caiguan', 'hunlian', 'xingge', 'yishenhuanjiang', 'huaqizhen']) {
    const r = await qimen.runModule({ module: mod, birth: BIRTH });
    assert.ok(r.text.length > 50, `${mod} produced text`);
    assert.ok(r.data, `${mod} produced JSON`);
    console.log(`✓ module ${mod}`);
  }

  // Event modules
  const ev = await qimen.runModule({ module: 'event', eventTime: EVENT, question: '求财' });
  assert.ok(ev.text.includes('求财') || ev.text.length > 50);
  console.log('✓ module event');

  const zd = await qimen.runModule({ module: 'zhanduan', eventTime: EVENT, birth: BIRTH, topic: '婚姻' });
  assert.ok(zd.text.length > 20);
  console.log('✓ module zhanduan');

  const yc = await qimen.runModule({ module: 'yaoce', birth: BIRTH, eventTime: EVENT });
  assert.ok(yc.text.length > 50);
  console.log('✓ module yaoce');

  const xs = await qimen.runModule({ module: 'xunshijieyun', birth: BIRTH });
  assert.strictEqual(xs.data.lessons.length, 60);
  assert.ok(xs.data.best, 'best lesson identified');
  console.log(`✓ module xunshijieyun (best: 第${xs.data.best.index}课 ${xs.data.best.ganzhi})`);

  // Solar utilities
  const tst = trueSolarTime('2026-06-10 12:00', 116.4, 8); // Beijing
  assert.ok(Math.abs(tst.offsetMinutes) < 60);
  const jie = daysToJie(new Date(Date.UTC(1990, 4, 15)), true);
  assert.ok(jie.days > 0 && jie.days < 32);
  console.log(`✓ solar utils (TST offset ${tst.offsetMinutes} min; next jie ${jie.term} in ${jie.days} days)`);

  // Validation errors
  await assert.rejects(() => qimen.generatePlate({ datetime: 'bogus' }), /YYYY-MM-DD/);
  await assert.rejects(() => qimen.runModule({ module: 'nope' }), /unknown module/);
  await assert.rejects(() => analyzeBazi({ birth: BIRTH, gender: 'other' }), /gender/);
  console.log('✓ input validation');

  await testRag();

  console.log('\nAll smoke tests passed.');
}

/* RAG: Obsidian loader -> hash embeddings -> local vector store -> retrieval.
   Isolated to a temp dir with the offline hash embedder (no keys/network). */
async function testRag() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qms-rag-'));
  const vault = path.join(tmp, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'wealth.md'), '# Wealth Star\n\nDirect Wealth is steady salary income. Indirect Wealth is windfall and business profit money.');
  fs.writeFileSync(path.join(vault, 'romance.md'), '# Romance\n\nThe spouse palace is the day branch and governs marriage and relationships.');

  process.env.EMBEDDINGS_PROVIDER = 'hash';
  process.env.VECTOR_STORE = 'local';
  process.env.VECTOR_FILE = path.join(tmp, 'vectors.json');
  // Require after env is set so module-level config picks it up.
  const obsidian = require('../src/obsidian');
  const embeddings = require('../src/embeddings');
  const store = require('../src/vectorstore');

  const items = obsidian.loadVault(vault);
  assert.ok(items.length >= 2, `vault produced chunks, got ${items.length}`);
  assert.ok(items.every((i) => i.id && i.text && i.meta.title), 'chunks carry id/text/meta');

  const vectors = await embeddings.embed(items.map((i) => i.text));
  assert.strictEqual(vectors.length, items.length);
  assert.strictEqual(vectors[0].length, embeddings.HASH_DIM);
  await store.upsert(items.map((s, j) => ({ id: s.id, vector: vectors[j], text: s.text, meta: s.meta })));
  assert.strictEqual(await store.count(), items.length);

  const q = await embeddings.embedOne('How is my wealth and income luck?');
  const hits = await store.search(q, 2);
  assert.strictEqual(hits[0].meta.title, 'wealth', `wealth query ranks wealth note first, got ${hits[0].meta.title}`);

  // Idempotent upsert (re-ingest does not duplicate).
  await store.upsert(items.map((s, j) => ({ id: s.id, vector: vectors[j], text: s.text, meta: s.meta })));
  assert.strictEqual(await store.count(), items.length, 'upsert is idempotent by id');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✓ RAG pipeline (obsidian chunk -> embed -> store -> retrieve, idempotent)');
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED:', e);
  process.exit(1);
});
