'use strict';

/**
 * BaZi (Four Pillars of Destiny) service.
 *
 * The four pillars themselves come from the Qi Men engine's calendar
 * conversion (si_zhu in the birth plate), so BaZi and Qi Men always agree on
 * the chart. On top of that this module derives, locally:
 *   - hidden stems (藏干) for every branch
 *   - Ten Gods (十神) for every stem relative to the Day Master
 *   - Five-Elements balance with hidden-stem weighting
 *   - Day Master strength estimate (seasonal state + support ratio)
 *   - 10-year Luck Pillars (大运) with starting age from solar terms
 *
 * If ASTROLOGY_API_KEY is configured, the high-precision Astrology-API.io
 * Luck Pillars endpoint is also queried and returned under `external`
 * (best-effort; local results are always present).
 */

const { generatePlate } = require('./qimen');
const { daysToJie } = require('./solar');

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const STEM_ELEMENT = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
const STEM_YANG = { 甲: true, 乙: false, 丙: true, 丁: false, 戊: true, 己: false, 庚: true, 辛: false, 壬: true, 癸: false };
const BRANCH_ELEMENT = { 子: '水', 丑: '土', 寅: '木', 卯: '木', 辰: '土', 巳: '火', 午: '火', 未: '土', 申: '金', 酉: '金', 戌: '土', 亥: '水' };

// Hidden stems per branch, strongest first.
const HIDDEN_STEMS = {
  子: ['癸'], 丑: ['己', '癸', '辛'], 寅: ['甲', '丙', '戊'], 卯: ['乙'],
  辰: ['戊', '乙', '癸'], 巳: ['丙', '戊', '庚'], 午: ['丁', '己'], 未: ['己', '丁', '乙'],
  申: ['庚', '壬', '戊'], 酉: ['辛'], 戌: ['戊', '辛', '丁'], 亥: ['壬', '甲'],
};
const HIDDEN_WEIGHTS = [1, 0.5, 0.3];

const GENERATES = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
const CONTROLS = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

const ELEMENT_EN = { 木: 'Wood', 火: 'Fire', 土: 'Earth', 金: 'Metal', 水: 'Water' };

const TEN_GOD_EN = {
  比肩: 'Friend', 劫财: 'Rob Wealth', 食神: 'Eating God', 伤官: 'Hurting Officer',
  偏财: 'Indirect Wealth', 正财: 'Direct Wealth', 七杀: 'Seven Killings', 正官: 'Direct Officer',
  偏印: 'Indirect Resource', 正印: 'Direct Resource', 日主: 'Day Master',
};

/** Ten God of `stem` relative to the day master stem. */
function tenGod(dayMaster, stem) {
  const dmEl = STEM_ELEMENT[dayMaster];
  const el = STEM_ELEMENT[stem];
  const samePolarity = STEM_YANG[dayMaster] === STEM_YANG[stem];
  if (el === dmEl) return samePolarity ? '比肩' : '劫财';
  if (GENERATES[dmEl] === el) return samePolarity ? '食神' : '伤官';
  if (CONTROLS[dmEl] === el) return samePolarity ? '偏财' : '正财';
  if (CONTROLS[el] === dmEl) return samePolarity ? '七杀' : '正官';
  return samePolarity ? '偏印' : '正印'; // GENERATES[el] === dmEl
}

/** Seasonal state (旺相休囚死) of an element in a month branch. */
function seasonalState(element, monthBranch) {
  const season = BRANCH_ELEMENT[monthBranch] === '土' ? '土'
    : { 寅: '木', 卯: '木', 巳: '火', 午: '火', 申: '金', 酉: '金', 亥: '水', 子: '水' }[monthBranch];
  if (element === season) return '旺';
  if (GENERATES[season] === element) return '相';
  if (GENERATES[element] === season) return '休';
  if (CONTROLS[element] === season) return '囚';
  return '死';
}

function pillarDetail(ganzhi, dayMaster, isDayPillar) {
  const stem = ganzhi[0];
  const branch = ganzhi[1];
  return {
    ganzhi,
    stem,
    branch,
    stemElement: STEM_ELEMENT[stem],
    branchElement: BRANCH_ELEMENT[branch],
    tenGod: isDayPillar ? '日主' : tenGod(dayMaster, stem),
    hiddenStems: HIDDEN_STEMS[branch].map((s, i) => ({
      stem: s,
      element: STEM_ELEMENT[s],
      tenGod: tenGod(dayMaster, s),
      weight: HIDDEN_WEIGHTS[i],
    })),
  };
}

function fiveElementBalance(pillars) {
  const counts = { 木: 0, 火: 0, 土: 0, 金: 0, 水: 0 };
  for (const p of pillars) {
    counts[p.stemElement] += 1;
    for (const h of p.hiddenStems) counts[h.element] += h.weight;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts).map(([element, raw]) => ({
    element,
    elementEn: ELEMENT_EN[element],
    score: Math.round(raw * 100) / 100,
    percent: Math.round((raw / total) * 1000) / 10,
  }));
}

function dayMasterStrength(pillars, monthBranch, dayMaster) {
  const dmEl = STEM_ELEMENT[dayMaster];
  const resourceEl = Object.keys(GENERATES).find((e) => GENERATES[e] === dmEl);
  let support = 0;
  let total = 0;
  for (const p of pillars) {
    total += 1;
    if (p.stemElement === dmEl || p.stemElement === resourceEl) support += 1;
    for (const h of p.hiddenStems) {
      total += h.weight;
      if (h.element === dmEl || h.element === resourceEl) support += h.weight;
    }
  }
  const state = seasonalState(dmEl, monthBranch);
  const seasonBonus = { 旺: 0.18, 相: 0.1, 休: 0, 囚: -0.08, 死: -0.12 }[state];
  const ratio = support / total + seasonBonus;
  const verdict = ratio >= 0.55 ? '偏强' : ratio <= 0.42 ? '偏弱' : '中和';
  const verdictEn = { 偏强: 'Strong', 偏弱: 'Weak', 中和: 'Balanced' }[verdict];
  return {
    seasonalState: state,
    supportRatio: Math.round(ratio * 1000) / 1000,
    verdict,
    verdictEn,
    note: verdict === '偏强'
      ? '日主得令得势，喜克泄耗（财官食伤）。Day Master is well supported; wealth, officer and output elements are favourable.'
      : verdict === '偏弱'
        ? '日主失令少助，喜生扶（印比）。Day Master lacks support; resource and companion elements are favourable.'
        : '日主中和，依大运流年取用。Day Master is balanced; favourable elements shift with luck cycles.',
  };
}

function ganzhiIndex(ganzhi) {
  const s = STEMS.indexOf(ganzhi[0]);
  const b = BRANCHES.indexOf(ganzhi[1]);
  for (let i = 0; i < 60; i++) {
    if (i % 10 === s && i % 12 === b) return i;
  }
  throw new Error(`invalid ganzhi: ${ganzhi}`);
}

function ganzhiAt(i) {
  const n = ((i % 60) + 60) % 60;
  return STEMS[n % 10] + BRANCHES[n % 12];
}

/** 10-year Luck Pillars from the month pillar. */
function luckPillars(siZhu, gender, birthDate, dayMaster) {
  const yearStemYang = STEM_YANG[siZhu.year[0]];
  const male = gender === 'male';
  const forward = yearStemYang === male; // yang-male / yin-female run forward
  const { days, term } = daysToJie(birthDate, forward);
  const startAge = Math.max(Math.round((days / 3) * 10) / 10, 0.1); // 3 days = 1 year
  const monthIdx = ganzhiIndex(siZhu.month);
  const birthYear = birthDate.getUTCFullYear();
  const pillars = [];
  for (let i = 1; i <= 8; i++) {
    const gz = ganzhiAt(monthIdx + (forward ? i : -i));
    const age = Math.round((startAge + (i - 1) * 10) * 10) / 10;
    pillars.push({
      ganzhi: gz,
      stem: gz[0],
      branch: gz[1],
      stemElement: STEM_ELEMENT[gz[0]],
      branchElement: BRANCH_ELEMENT[gz[1]],
      tenGod: tenGod(dayMaster, gz[0]),
      startAge: age,
      startYear: birthYear + Math.round(age),
      endYear: birthYear + Math.round(age) + 9,
    });
  }
  return {
    direction: forward ? '顺行' : '逆行',
    directionEn: forward ? 'forward' : 'backward',
    referenceTerm: term,
    startAge,
    pillars,
  };
}

/** Optional high-precision call to Astrology-API.io (best effort). */
async function fetchExternalBazi(birth, gender, tzOffset) {
  const key = process.env.ASTROLOGY_API_KEY;
  if (!key) return null;
  const url = process.env.ASTROLOGY_API_URL || 'https://astrology-api.io/api/v1/luck-pillars';
  const [date, time] = birth.split(' ');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ birth_datetime: `${date}T${time}:00`, gender, tz_offset: tzOffset }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { error: `Astrology-API returned ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: `Astrology-API unreachable: ${e.message}` };
  }
}

/**
 * Full BaZi analysis.
 * @param {object} opts { birth: "YYYY-MM-DD HH:MM", gender: "male"|"female", tzOffset? }
 */
async function analyzeBazi(opts) {
  const { birth, gender } = opts;
  if (gender !== 'male' && gender !== 'female') {
    const err = new Error('gender must be "male" or "female"');
    err.status = 400;
    throw err;
  }
  const { plate, plateId } = await generatePlate({ datetime: birth, type: 'birth' });
  const siZhu = plate.si_zhu;
  const dayMaster = siZhu.day[0];

  const pillars = [
    { name: '年柱', nameEn: 'Year', ...pillarDetail(siZhu.year, dayMaster, false) },
    { name: '月柱', nameEn: 'Month', ...pillarDetail(siZhu.month, dayMaster, false) },
    { name: '日柱', nameEn: 'Day', ...pillarDetail(siZhu.day, dayMaster, true) },
    { name: '时柱', nameEn: 'Hour', ...pillarDetail(siZhu.hour, dayMaster, false) },
  ];

  const m = birth.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const birthDate = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const monthBranch = siZhu.month[1];

  const [external] = await Promise.all([fetchExternalBazi(birth, gender, opts.tzOffset ?? 8)]);

  return {
    birth,
    gender,
    dayMaster: {
      stem: dayMaster,
      element: STEM_ELEMENT[dayMaster],
      elementEn: ELEMENT_EN[STEM_ELEMENT[dayMaster]],
      polarity: STEM_YANG[dayMaster] ? '阳' : '阴',
    },
    pillars,
    tenGodLegend: TEN_GOD_EN,
    fiveElements: fiveElementBalance(pillars),
    strength: dayMasterStrength(pillars, monthBranch, dayMaster),
    luckPillars: luckPillars(siZhu, gender, birthDate, dayMaster),
    birthPlateId: plateId,
    source: 'engine si_zhu + local derivation',
    external,
  };
}

module.exports = { analyzeBazi, tenGod, STEM_ELEMENT, BRANCH_ELEMENT };
