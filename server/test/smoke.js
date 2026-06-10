'use strict';

/**
 * Smoke test: exercises every API-facing code path directly (no HTTP).
 * Run with: npm test  (from server/)
 */

const assert = require('assert');
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

  console.log('\nAll smoke tests passed.');
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED:', e);
  process.exit(1);
});
