'use strict';

/* Qi Men Superpowers frontend — talks to the JSON API in server/src/index.js. */

const $ = (sel) => document.querySelector(sel);

const state = {
  tab: 'bazi',
  lastPlateId: null,
};

const TAB_LABELS = {
  bazi: '八字 BaZi', plate: '奇门盘 Plate', caiguan: '财官诊断 Wealth & Career',
  hunlian: '婚恋分析 Romance', xingge: '性格分析 Personality', event: '问事 Event Reading',
  zhanduan: '占断 Divination', yaoce: '遥测 Cross-plate Sensing', xunshijieyun: '寻时借运 Time Selection',
  huaqizhen: '化气阵 Array Placement', yishenhuanjiang: '移神换将 Transformation Remedy',
};

/* Luoshu spatial arrangement: grid order top-left → bottom-right. */
const LUOSHU_LAYOUT = [4, 9, 2, 3, 5, 7, 8, 1, 6];

/* Five-element English labels for readability. */
const EL_EN = { '木': 'Wood', '火': 'Fire', '土': 'Earth', '金': 'Metal', '水': 'Water' };

/* Romanisation for the 10 Heavenly Stems and 12 Earthly Branches. */
const PINYIN = {
  '甲': 'Jia', '乙': 'Yi', '丙': 'Bing', '丁': 'Ding', '戊': 'Wu',
  '己': 'Ji', '庚': 'Geng', '辛': 'Xin', '壬': 'Ren', '癸': 'Gui',
  '子': 'Zi', '丑': 'Chou', '寅': 'Yin', '卯': 'Mao', '辰': 'Chen', '巳': 'Si',
  '午': 'Wu', '未': 'Wei', '申': 'Shen', '酉': 'You', '戌': 'Xu', '亥': 'Hai',
};
/* Zodiac animal per Earthly Branch [English, 中文]. */
const ANIMAL = {
  '子': ['Rat', '鼠'], '丑': ['Ox', '牛'], '寅': ['Tiger', '虎'], '卯': ['Rabbit', '兔'],
  '辰': ['Dragon', '龙'], '巳': ['Snake', '蛇'], '午': ['Horse', '马'], '未': ['Goat', '羊'],
  '申': ['Monkey', '猴'], '酉': ['Rooster', '鸡'], '戌': ['Dog', '狗'], '亥': ['Pig', '猪'],
};

/* Circular five-element badge (colored ring + element glyph + English name). */
const elBadge = (el) => el ? `<span class="el-badge el-${esc(el)}" data-el="${esc(el)}">${esc(EL_EN[el] || '')}</span>` : '';
const pinyinOf = (ch) => esc(PINYIN[ch] || '');
const branchSub = (ch) => {
  const a = ANIMAL[ch];
  return `${pinyinOf(ch)}${a ? ` · ${esc(a[1])} ${esc(a[0])}` : ''}`;
};

/* English glosses for the recurring labels in the engine's reading output. */
const KEY_EN = {
  '出生时间': 'Birth time', '出生四柱': 'Four Pillars', '年干': 'Year Stem',
  '月令': 'Monthly Order', '天盘': 'Heaven Plate', '地盘': 'Earth Plate',
  '神': 'Deity', '星': 'Star', '门': 'Gate', '六害': 'Six Harms',
  '月令关系': 'Monthly relation', '化解': 'Remedy', '天干': 'Stem', '地支': 'Branch',
  '先灭象': 'Dissolve image', '日干': 'Day Stem', '时干': 'Hour Stem',
  '月令(大环境,天时)': 'Monthly Order (climate)', '灭象方式': 'Dissolving method',
  '光引': 'Light attractor', '声引': 'Sound attractor', '气引': 'Air attractor',
  '择时': 'Timing', '9天合象': '9-day pairing', '安全方位': 'Safe directions',
  '状态': 'State', '用神': 'Focus',
};
const SECTION_EN = {
  '财富七要害': 'Wealth · 7 Key Factors', '事业七要害': 'Career · 7 Key Factors',
  '婚恋七要害': 'Romance · 7 Key Factors', '性格分析': 'Personality',
  '内在性格(日干)': 'Inner Character (Day Stem)', '外在性格(时干)': 'Outer Persona (Hour Stem)',
  '天干角色(各角色人事)': 'Stem Roles (People & Matters)', '干财(控制力)': 'Wealth Control',
  '注意事项': 'Cautions', '符使(直属上级)': 'Chief & Envoy (Direct Superior)',
  '踩一捧一(财富与事业只能二选一)': 'Trade-off: Wealth vs Career',
  '适合行业(从戊所在宫推算)': 'Suitable Industries (from 戊’s palace)',
  '保护天干': 'Protected Stems', '三奇含义': 'Three Nobles Meaning',
};

/* Exact English translations for the engine's fixed explanatory sentences. */
const EN_FIXED = {
  '月令是天时大势，决定做事的难度和量级，难以完全逆转':
    'The Monthly Order is the prevailing climate: it sets the difficulty and scale of endeavours and can hardly be reversed.',
  '选择被月令生助的方向会事半功倍，逆天时看性价比':
    'Directions supported by the Monthly Order give twice the result for half the effort; going against the season, weigh the cost-benefit.',
  '月令生→扩张(量大) | 月令同→稳健(量大) | 克月令→努力(量小) | 生月令→损耗(量小) | 月令克→大亏(量小，最差)':
    'Month feeds you → expand (large) | Same as month → steady (large) | You overcome month → effortful (small) | You feed month → drain (small) | Month overcomes you → heavy loss (smallest, worst)',
  '克月令，努力，量小': 'You overcome the month — effortful, small scale',
  '月令克，大亏，量小。最差': 'Month overcomes you — heavy loss, smallest scale (worst)',
  '生月令，损耗，量小': 'You feed the month — draining, small scale',
  '月令生，扩张，量大': 'Month feeds you — expansion, large scale',
  '月令同，稳健，量大': 'Same as the month — steady, large scale',
  '灭象方式: 可移动,不可抛弃,不可赠送': 'Dissolving method: may be moved; never discarded or given away.',
  '可移动,不可抛弃,不可赠送': 'May be moved; never discarded or given away.',
  '移动后不要再碰，不要再拿回原位直到问题解决': 'After moving it, do not touch it again or return it until the issue is resolved.',
  '摆放后的3-7天内，留意克应信号': 'Watch for response signals within 3–7 days of placement.',
  '用则为信，三月起效，前提和环境发生重大变化时结束': 'Apply with trust; takes effect in about three months; ends when circumstances change fundamentally.',
  '只灭能灭的象，不能移动的不动': 'Only dissolve images that can be dissolved; leave immovable things untouched.',
  '必须在真太阳时的对应时辰执行': 'Must be carried out at the matching true-solar-time hour.',
  '亮灯、焚香、反光镜': 'Bright lamps, incense, mirrors.',
  '响铃、乐器': 'Bells, musical instruments.',
  '通风、开窗': 'Ventilation, open windows.',
  '两物各自方位放满9天（代表天干本身），再将两物放到一起':
    'Keep each object in its own direction for 9 full days (representing the stems themselves), then bring the two together.',
  '冲突禁忌：化解物的地支象意绝对不能与该宫位地支相冲':
    'Conflict taboo: a remedy object’s branch imagery must never clash with the palace branch.',
  '动静结合禁忌：泄法物应能动（铃铛偶尔响），合法物应静（红卡安放不动）':
    'Motion taboo: draining objects should be able to move (a bell that occasionally rings); combining objects should stay still.',
  '填实禁忌：在宫位逢空亡且带击刑/凶格时，绝对禁止使用大质量、实心、沉重的物品进行硬填':
    'Filling taboo: when a palace is void with punishment or malign patterns, never hard-fill it with massive, solid, heavy objects.',
  '时间错位禁忌：不校对真太阳时，或在日全食、月全食、雷电交加等极端天气下实施':
    'Timing taboo: never skip the true-solar-time correction, and never act during eclipses or violent thunderstorms.',
  '材质纯度禁忌：泄法用金必须真材实料（铜、钢、铝），电镀塑料无效':
    'Material taboo: metal used for draining must be genuine (copper, steel, aluminium); plated plastic is ineffective.',
  '贪合忘生禁忌：入墓宫位慎用合法——合会进一步束缚能量加重入墓，优先用生和泄':
    'Combination taboo: for tomb palaces avoid combining — it binds the energy further; prefer feeding and draining.',
  '贪多禁忌：一个宫位内放置过多属性混杂的化解物':
    'Excess taboo: do not crowd one palace with too many mixed remedy objects.',
  '正确的时间做正确的事': 'Do the right thing at the right time.',
  '月令是天时大势，决定做事的难度和量级': 'The Monthly Order is the prevailing climate; it sets difficulty and scale.',
};

/* Token glossary for templated lines — longest match wins. */
const EN_VOCAB = {
  // stems & branches (pinyin)
  '甲': 'Jia', '乙': 'Yi', '丙': 'Bing', '丁': 'Ding', '戊': 'Wu', '己': 'Ji',
  '庚': 'Geng', '辛': 'Xin', '壬': 'Ren', '癸': 'Gui',
  '子': 'Zi', '丑': 'Chou', '寅': 'Yin', '卯': 'Mao', '辰': 'Chen', '巳': 'Si',
  '午': 'Wu', '未': 'Wei', '申': 'Shen', '酉': 'You', '戌': 'Xu', '亥': 'Hai',
  // gates, stars, deities
  '休门': 'Rest Gate', '生门': 'Life Gate', '伤门': 'Harm Gate', '杜门': 'Block Gate',
  '景门': 'View Gate', '死门': 'Death Gate', '惊门': 'Shock Gate', '开门': 'Open Gate',
  '天蓬': 'Tianpeng', '天任': 'Tianren', '天冲': 'Tianchong', '天辅': 'Tianfu',
  '天英': 'Tianying', '天芮': 'Tianrui', '天柱': 'Tianzhu', '天心': 'Tianxin', '天禽': 'Tianqin',
  '值符': 'Chief', '值使': 'Envoy', '螣蛇': 'Serpent', '太阴': 'Great Moon', '六合': 'Harmony',
  '白虎': 'White Tiger', '玄武': 'Black Tortoise', '九地': 'Nine Earth', '九天': 'Nine Heaven',
  '勾陈': 'Hook', '朱雀': 'Vermilion Bird',
  // elements, polarity, verdicts
  '木': 'Wood', '火': 'Fire', '土': 'Earth', '金': 'Metal', '水': 'Water',
  '吉': 'auspicious', '凶': 'inauspicious', '阴': 'Yin', '阳': 'Yang',
  // palaces & directions
  '中5宫': 'Center 5 Palace', '乾': 'Qian', '坎': 'Kan', '艮': 'Gen', '震': 'Zhen',
  '巽': 'Xun', '离': 'Li', '坤': 'Kun', '兑': 'Dui', '宫': 'Palace',
  '东南': 'Southeast', '东北': 'Northeast', '西南': 'Southwest', '西北': 'Northwest',
  '东': 'East', '南': 'South', '西': 'West', '北': 'North',
  // 12 life stages
  '长生': 'Growth', '沐浴': 'Bath', '冠带': 'Adornment', '临官': 'Officer', '帝旺': 'Peak',
  '衰': 'Decline', '病': 'Sickness', '死': 'Death', '墓': 'Tomb', '绝': 'Severed',
  '胎': 'Conceived', '养': 'Nurture',
  // harms & patterns
  '击刑': 'Punishment', '入墓': 'Tomb-entry', '门迫': 'Forced Gate', '空亡': 'Void',
  '对宫': 'opposite palace', '刑': 'Punishment', '空': 'Void', '凶煞': 'malign force',
  '伏吟': 'Fu Yin', '反吟': 'Fan Yin', '危险': 'danger',
  // remedy operations
  '压击刑': 'Suppress Punishment', '压入墓': 'Suppress Tomb-entry', '压门迫': 'Suppress Forced Gate',
  '压庚': 'Suppress Geng', '填空亡': 'Fill the Void', '用合化解': 'resolve by combination',
  '用冲打开墓库': 'open the tomb by clash', '以柔克刚': 'soft overcomes hard',
  '缺金补金': 'missing Metal → supplement Metal', '先灭象': 'first dissolve the image',
  '将': 'move', '的象移出': '’s imagery out of', '合': 'combines', '冲': 'clashes',
  '虚假不实': 'false and unreal', '克': 'overcomes',
  // structure words
  '天盘': 'Heaven plate', '地盘': 'Earth plate', '天干': 'Stem', '地支': 'Branch',
  '高处': 'place high —', '低处': 'place low —',
  '本钱': 'Capital', '利润': 'Profit', '合作关系': 'Partnerships', '时机': 'Timing',
  '时干': 'Hour Stem', '日干': 'Day Stem', '年干': 'Year Stem', '月干': 'Month Stem',
  '所在公司或单位': 'company / organisation', '直属上级': 'direct superior', '控制力': 'control',
  '安全方位': 'Safe directions', '状态': 'State', '用神': 'Focus (Yong Shen)',
  // colours
  '墨绿': 'dark green', '暗红': 'dark red', '棕色': 'brown', '金黄': 'golden yellow',
  '黄白': 'yellow-white', '深蓝': 'deep blue', '暗棕': 'dark brown', '蓝黑': 'blue-black',
  '红色': 'red', '白色': 'white', '黑色': 'black', '黄色': 'yellow', '绿色': 'green',
  // remedy objects
  '软植': 'soft plants', '藤蔓花草葫芦': 'vines, flowers & gourds',
  '尖锐': 'sharp items', '烛火刀剑': 'candles, knives & swords',
  '容器': 'containers', '花盆存钱罐': 'flower pots & piggy banks',
  '浑水': 'murky water', '墨水茶壶': 'ink & teapots',
  '牛摆件': 'ox ornament', '鸡摆件': 'rooster ornament', '猴摆件': 'monkey ornament',
  '狗玩偶或图片': 'dog figure or picture', '小猪存钱罐': 'piggy bank',
  '羊雕像或玩偶': 'goat statue or doll', '水盆代替': 'use a water basin instead',
  '牛': 'ox', '鸡': 'rooster', '猴': 'monkey', '狗': 'dog', '猪': 'pig', '羊': 'goat',
  '龙': 'dragon', '马': 'horse', '兔': 'rabbit', '虎': 'tiger', '蛇': 'snake', '鼠': 'rat',
};
const EN_VOCAB_MAXLEN = Math.max(...Object.keys(EN_VOCAB).map((k) => k.length));

/* Translate a line via EN_FIXED, else longest-match glossary segmentation.
   Returns null when coverage of CJK characters is too low to be useful. */
function cnEn(s) {
  const t = String(s).trim();
  if (!t) return null;
  if (EN_FIXED[t]) return EN_FIXED[t];
  let out = '', covered = 0, total = 0, i = 0;
  while (i < t.length) {
    let hit = null;
    for (let len = Math.min(EN_VOCAB_MAXLEN, t.length - i); len > 0; len--) {
      const seg = t.substr(i, len);
      if (EN_VOCAB[seg] !== undefined) { hit = seg; break; }
    }
    if (hit) {
      out += EN_VOCAB[hit] + ' ';
      const cjk = (hit.match(/[一-鿿]/g) || []).length;
      covered += cjk; total += cjk;
      i += hit.length;
    } else {
      const ch = t[i];
      if (/[一-鿿]/.test(ch)) total += 1;
      out += ch;
      i += 1;
    }
  }
  if (total < 2 || covered / total < 0.55) return null;
  return out
    .replace(/，/g, ', ').replace(/。/g, '. ').replace(/：/g, ': ')
    .replace(/（/g, ' (').replace(/）/g, ') ').replace(/、/g, ', ')
    .replace(/\s+([,):.])/g, '$1').replace(/\(\s+/g, '(')
    .replace(/\s{2,}/g, ' ').trim();
}

/* English subtitle block for a translated line (safe: cnEn output is built
   from our own glossary strings plus passthrough chars, escaped here). */
function enSub(s) {
  const en = cnEn(s);
  return en ? `<small class="rd-en">${esc(en)}</small>` : '';
}

/* Decorate a plain text fragment: escape, turn [tags] into chips, colour 吉/凶. */
function deco(s) {
  let t = esc(s);
  t = t.replace(/\[([^\]]+)\]/g, '<span class="rd-tag">$1</span>');
  t = t.replace(/(吉)/g, '<span class="jixi-吉">$1</span>').replace(/(凶)/g, '<span class="jixi-凶">$1</span>');
  return t;
}
const gloss = (label) => KEY_EN[label] ? ` <small>${KEY_EN[label]}</small>` : '';
const indentRem = (n) => `margin-left:${Math.min(n, 10) * 0.5}rem`;

/*
 * Turn the engine's indented, ===section=== text reports into structured,
 * readable HTML. Generic across modules; falls back to plain lines.
 */
function formatReading(raw) {
  const lines = String(raw).replace(/\r/g, '').split('\n');
  let html = '';
  let inItem = false;
  const closeItem = () => { if (inItem) { html += '</div>'; inItem = false; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[=\-]{3,}$/.test(trimmed)) continue;                 // underline rule — skip
    const indent = line.length - line.replace(/^\s+/, '').length;
    const next = (lines[i + 1] || '').trim();

    if (indent === 0 && /^[=]{3,}$/.test(next)) {              // title underlined with ===
      closeItem(); html += `<h3 class="rd-title">${deco(trimmed)}</h3>`; continue;
    }
    const sec = trimmed.match(/^={2,}\s*(.+?)\s*={2,}$/);      // === Section ===
    if (sec) {
      closeItem();
      html += `<h4 class="rd-section">${deco(sec[1])}${SECTION_EN[sec[1]] ? ` <small>${SECTION_EN[sec[1]]}</small>` : ''}</h4>`;
      continue;
    }
    if (/\s—\s/.test(trimmed) && /宫/.test(trimmed)) {          // factor header "戊(本钱) — 震3宫(…)"
      closeItem();
      html += `<div class="rd-item"><div class="rd-item-h">${deco(trimmed)}${enSub(trimmed)}</div>`;
      inItem = true; continue;
    }
    const kv = trimmed.match(/^([^：:，。]{1,16})[：:]\s*(.*)$/); // key: value
    if (kv) {
      const label = kv[1], val = kv[2];
      if (!val) html += `<div class="rd-kv-h" style="${indentRem(indent)}">${deco(label)}${gloss(label)}</div>`;
      else html += `<div class="rd-kv" style="${indentRem(indent)}"><span class="rd-k">${deco(label)}${gloss(label)}</span><span class="rd-v">${deco(val)}${enSub(val)}</span></div>`;
      continue;
    }
    html += `<div class="rd-line" style="${indentRem(indent)}">${deco(trimmed)}${enSub(trimmed)}</div>`;
  }
  closeItem();
  return `<div class="reading" translate="no">${html}</div>`;
}

function setStatus(msg, isError) {
  const el = $('#status');
  el.textContent = msg || '';
  el.classList.toggle('error', Boolean(isError));
}

function getBirth() {
  const d = $('#birth-date').value;
  const t = $('#birth-time').value;
  if (!d || !t) return null;
  return `${d} ${t.slice(0, 5)}`;
}

function getEventTime() {
  const d = $('#event-date').value;
  const t = $('#event-time').value;
  if (!d || !t) return null;
  return `${d} ${t.slice(0, 5)}`;
}

function commonParams() {
  const p = { tianqin: $('#tianqin').value };
  const lng = $('#longitude').value;
  if (lng !== '') {
    p.longitude = Number(lng);
    p.tzOffset = Number($('#tz-offset').value || 8);
  }
  return p;
}

/* Prefix API paths with the configured backend origin (config.js). Empty = same origin. */
const apiUrl = (path) => (window.QMS_API_BASE || '') + path;

async function api(path, body) {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function solarNote(result) {
  const cs = result.solarCorrections || (result.solarCorrection ? [result.solarCorrection] : []);
  return cs.filter(Boolean).map((c) =>
    `<p class="notice">真太阳时校正 True solar time: ${esc(c.original)} → <b>${esc(c.corrected)}</b> (${c.offsetMinutes >= 0 ? '+' : ''}${c.offsetMinutes} min)</p>`
  ).join('');
}

/* ---------------- Nine-palace grid ---------------- */

function markBadges(p) {
  const marks = [];
  if (p.kong_wang) marks.push(['空亡', 'note']);
  if (p.yi_ma) marks.push(['驿马', 'note']);
  if (p.ji_xing) marks.push(['击刑', 'bad']);
  if (p.men_po) marks.push(['门迫', 'bad']);
  if (p.rumu_gan || p.rumu_star || p.rumu_gate) marks.push(['入墓', 'bad']);
  if (p.geng) marks.push(['庚', 'bad']);
  if (p.star_fu_yin || p.gate_fu_yin || p.gan_fu_yin) marks.push(['伏吟', 'bad']);
  if (p.star_fan_yin || p.gate_fan_yin || p.gan_fan_yin) marks.push(['反吟', 'bad']);
  return marks.map(([t, cls]) => `<span class="mark ${cls}">${t}</span>`).join('');
}

function renderPlateGrid(plate, plateId) {
  const zhifuPalace = plate.zhi_fu?.palace;
  const zhishiPalace = plate.zhi_shi?.palace;
  const cells = LUOSHU_LAYOUT.map((n) => {
    if (n === 5) {
      return `<div class="palace center">
        <div class="pname">中5宫</div>
        <div class="center-info">
          <div class="ju">${esc(plate.ju.type)} ${plate.ju.number}局</div>
          <div>${esc(plate.ju.yuan)}${plate.ju.run ? ' · 置闰' : ''}</div>
          <div>值符 ${esc(plate.zhi_fu.star)} · 值使 ${esc(plate.zhi_shi.gate)}</div>
          <div>${esc(plate.datetime)}</div>
        </div>
      </div>`;
    }
    const p = plate.palaces[String(n)];
    const cls = ['palace'];
    if (n === zhifuPalace) cls.push('zhifu');
    if (n === zhishiPalace) cls.push('zhishi');
    return `<div class="${cls.join(' ')}" data-palace="${n}" title="点击查看万物类象 · click for Wan Wu correspondences">
      <div class="pname">${esc(p.name)} ${esc(p.direction)}</div>
      <div class="deity">${esc(p.deity)}</div>
      <div class="row">
        <span class="jixi-${esc(p.star_jixi)}">${esc(p.star)}${p.tianqin ? '<small>[寄禽]</small>' : ''}</span>
        <span class="gan el-${esc(p.tian_gan_wuxing)}">${esc(p.tian_gan)}</span>
      </div>
      <div class="row">
        <span class="jixi-${esc(p.gate_jixi)}">${esc(p.gate)}</span>
        <span class="gan digan el-${esc(p.di_gan_wuxing)}">${esc(p.di_gan)}</span>
      </div>
      <div class="row"><span class="hint">${esc(p.state || '')}</span></div>
      <div class="marks">${markBadges(p)}</div>
    </div>`;
  }).join('');

  return `<div class="grid9" data-plate-id="${esc(plateId || '')}" translate="no">${cells}</div>
  <div class="legend">
    <span>◆ 金框 = 值符宫 zhifu</span><span>◆ 蓝框 = 值使宫 zhishi</span>
    <span>右列大字 = 天盘干/地盘干 heaven & earth stems</span>
    <span>点击宫位查看万物类象 click a palace for correspondences</span>
  </div>`;
}

function plateMeta(plate) {
  const sz = plate.si_zhu;
  return `<div class="plate-meta" translate="no">
    <span>四柱 Pillars: <b>${esc(sz.year)} ${esc(sz.month)} ${esc(sz.day)} ${esc(sz.hour)}</b></span>
    <span>局 Ju: <b>${esc(plate.ju.type)}${plate.ju.number}局 ${esc(plate.ju.yuan)}</b></span>
    <span>空亡 Void: <b>${plate.kong_wang.map((k) => esc(k.branch)).join(' ')}</b></span>
    <span>驿马 Horse: <b>${esc(plate.yi_ma.branch)}</b></span>
  </div>`;
}

async function showWanwu(plateId, palace) {
  const modal = $('#palace-modal');
  $('#modal-title').textContent = `第${palace}宫 万物类象 · Palace ${palace} Correspondences`;
  $('#modal-body').innerHTML = '<div class="loading">查询中</div>';
  modal.classList.remove('hidden');
  try {
    const r = await api('/api/qimen/wanwu', { plateId, palace });
    $('#modal-body').innerHTML = formatReading(r.text);
  } catch (e) {
    $('#modal-body').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
}

document.addEventListener('click', (ev) => {
  const cell = ev.target.closest('.palace[data-palace]');
  if (cell) {
    const grid = cell.closest('.grid9');
    const plateId = grid?.dataset.plateId;
    if (plateId) showWanwu(plateId, Number(cell.dataset.palace));
    return;
  }
  if (ev.target.closest('.modal-close') || ev.target === $('#palace-modal')) {
    $('#palace-modal').classList.add('hidden');
  }
});

/* ---------------- BaZi tab ---------------- */

function renderBazi(r) {
  const pillarCards = r.pillars.map((p) => `
    <div class="pillar ${p.tenGod === '日主' ? 'day-master' : ''}">
      <h4>${esc(p.name)} ${esc(p.nameEn)}</h4>
      <div class="tg">${esc(p.tenGod)}${p.tenGod !== '日主' ? `<br><small>${esc(r.tenGodLegend[p.tenGod] || '')}</small>` : '<br><small>Day Master</small>'}</div>
      <div class="stem el-${esc(p.stemElement)}">${esc(p.stem)}</div>
      <div class="pinyin">${pinyinOf(p.stem)}</div>
      ${elBadge(p.stemElement)}
      <div class="branch el-${esc(p.branchElement)}">${esc(p.branch)}</div>
      <div class="pinyin">${branchSub(p.branch)}</div>
      ${elBadge(p.branchElement)}
      <div class="hidden">藏干 ${p.hiddenStems.map((h) => `<b class="el-${esc(h.element)}">${esc(h.stem)}</b><small>(${esc(h.tenGod)})</small>`).join(' ')}</div>
    </div>`).join('');

  const bars = r.fiveElements.map((e) => `
    <div class="elem-bar">
      <span class="el-${esc(e.element)}">${esc(e.element)} ${esc(e.elementEn)}</span>
      <div class="track"><div class="fill fill-${esc(e.element)}" style="width:${Math.min(e.percent * 2.2, 100)}%"></div></div>
      <span>${e.percent}%</span>
    </div>`).join('');

  const lp = r.luckPillars;
  const luckCards = lp.pillars.map((p) => `
    <div class="luck">
      <div class="age">${p.startAge}岁</div>
      <div class="gz"><span class="el-${esc(p.stemElement)}">${esc(p.stem)}</span><span class="el-${esc(p.branchElement)}">${esc(p.branch)}</span></div>
      <div class="luck-py">${pinyinOf(p.stem)} ${pinyinOf(p.branch)}</div>
      <div>${esc(p.tenGod)}</div>
      <div class="yrs">${p.startYear}–${p.endYear}</div>
    </div>`).join('');

  const sr = Number(r.strength.supportRatio);
  const srPct = Math.max(0, Math.min(1, isFinite(sr) ? sr : 0.5)) * 100;
  const polEn = r.dayMaster.polarity === '阳' ? 'Yang' : r.dayMaster.polarity === '阴' ? 'Yin' : '';

  return `${solarNote(r)}
    <div class="pillars" translate="no">${pillarCards}</div>
    <div class="section-block">
      <h3>日主 Day Master</h3>
      <div class="dm-grid">
        <div class="dm-glyph el-${esc(r.dayMaster.element)}" translate="no">
          <div class="dm-stem">${esc(r.dayMaster.stem)}</div>
          <span class="el-badge el-${esc(r.dayMaster.element)}" data-el="${esc(r.dayMaster.element)}">${esc(r.dayMaster.elementEn)}</span>
          <div class="dm-polarity">${esc(r.dayMaster.polarity)}${esc(r.dayMaster.element)} · ${esc(polEn)} ${esc(r.dayMaster.elementEn)}</div>
        </div>
        <div class="dm-detail">
          <div class="dm-strength">
            <div class="dm-strength-head">
              <span class="dm-verdict" translate="no">${esc(r.strength.verdict)} <small>${esc(r.strength.verdictEn)}</small></span>
              <span class="dm-ratio">支持率 Support ratio <b>${esc(r.strength.supportRatio)}</b></span>
            </div>
            <div class="dm-meter" title="支持率 ${esc(r.strength.supportRatio)}"><span class="dm-marker" style="left:${srPct.toFixed(1)}%"></span></div>
            <div class="dm-meter-scale"><span>弱 Weak</span><span>中和 Balanced</span><span>强 Strong</span></div>
          </div>
          <table class="kv">
            <tr><td>月令状态 Seasonal state</td><td><span translate="no">${esc(r.strength.seasonalState)}</span></td></tr>
            <tr><td>取用提示 Guidance</td><td>${esc(r.strength.note)}</td></tr>
          </table>
        </div>
      </div>
    </div>
    <div class="section-block"><h3>五行平衡 Five Elements Balance</h3><div class="elem-bars">${bars}</div></div>
    <div class="section-block">
      <h3>大运 10-Year Luck Pillars · ${esc(lp.direction)} (${esc(lp.directionEn)}) · 起运 ${lp.startAge} 岁（参照节气 ${esc(lp.referenceTerm)}）</h3>
      <div class="luck-row" translate="no">${luckCards}</div>
      <p class="hint">起运岁数按「3 日 = 1 年」由出生到节气的天数推算（节气取近似公式，误差 ≤1 天）。</p>
    </div>`;
}

/* ---------------- Tab loading ---------------- */

const MODULE_NEEDS = {
  caiguan: ['birth'], hunlian: ['birth'], xingge: ['birth'],
  huaqizhen: ['birth'], yishenhuanjiang: ['birth'], xunshijieyun: ['birth'],
  event: ['event'], zhanduan: ['event', 'birth'], yaoce: ['birth', 'event'],
};

function renderXunshi(r) {
  if (!r.data || !r.data.lessons?.length) return '';
  const rows = r.data.lessons.slice(0, 15).map((l) => `
    <tr class="${r.data.best && l.index === r.data.best.index ? 'best' : ''}">
      <td>第${l.index}课</td><td>${esc(l.ganzhi)}</td><td>${l.liuhaiCount}</td>
    </tr>`).join('');
  return `<div class="section-block">
    <h3>最优时辰排行 Top Time Windows（六害越少越吉）</h3>
    ${r.data.best ? `<p>最优课 Best: <b>第${r.data.best.index}课 ${esc(r.data.best.ganzhi)}</b>（六害 ${r.data.best.liuhaiCount}）</p>` : ''}
    <table class="lesson-table" translate="no"><tr><th>课 Lesson</th><th>干支 Ganzhi</th><th>六害数 Harm count</th></tr>${rows}</table>
  </div>`;
}

async function loadTab(tab) {
  const body = $('#tab-body');
  const birth = getBirth();
  const eventTime = getEventTime();
  const needs = MODULE_NEEDS[tab] || (tab === 'bazi' || tab === 'plate' ? ['birth'] : []);

  if (needs.includes('birth') && !birth) {
    body.innerHTML = '<div class="error-box">请先填写出生日期与时间。Please enter birth date and time first.</div>';
    return;
  }
  if (needs.includes('event') && !eventTime) {
    body.innerHTML = '<div class="error-box">此模块需要事件时间，请在左侧「问事」面板填写。This module needs an event date & time (left panel).</div>';
    return;
  }

  body.innerHTML = `<div class="loading">起局推演中 Computing ${esc(TAB_LABELS[tab])}</div>`;
  setStatus('');
  try {
    let html = `<h2 style="color:var(--gold-bright);margin-top:0">${esc(TAB_LABELS[tab])}</h2>`;

    if (tab === 'bazi') {
      const r = await api('/api/bazi', { birth, gender: $('#gender').value, ...commonParams() });
      html += renderBazi(r);
    } else if (tab === 'plate') {
      const r = await api('/api/qimen/plate', { datetime: birth, type: 'birth', ...commonParams() });
      state.lastPlateId = r.plateId;
      html += solarNote(r) + plateMeta(r.plate) + renderPlateGrid(r.plate, r.plateId);
      if (eventTime) {
        const e = await api('/api/qimen/plate', { datetime: eventTime, type: 'event', ...commonParams() });
        html += `<h3 style="color:var(--gold)">问事局 Event Plate · ${esc(eventTime)}</h3>` + plateMeta(e.plate) + renderPlateGrid(e.plate, e.plateId);
      }
    } else {
      const payload = { module: tab, ...commonParams() };
      if (needs.includes('birth')) payload.birth = birth;
      if (needs.includes('event')) payload.eventTime = eventTime;
      if (tab === 'event') payload.question = $('#question').value;
      if (tab === 'zhanduan' && $('#topic').value.trim()) payload.topic = $('#topic').value.trim();
      if (['huaqizhen', 'xunshijieyun', 'yaoce'].includes(tab) && $('#yixiang').value.trim()) {
        payload.yixiang = $('#yixiang').value.trim();
      }
      const r = await api('/api/qimen/analyze', payload);
      const plate = r.eventPlate || r.birthPlate;
      html += solarNote(r);
      if (tab === 'xunshijieyun') html += renderXunshi(r);
      if (plate && r.plateId) html += plateMeta(plate) + renderPlateGrid(plate, r.plateId) + '<br>';
      html += formatReading(r.text);
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div class="error-box">分析失败 Analysis failed: ${esc(e.message)}</div>`;
  }
}

/* ---------------- Init ---------------- */

async function init() {
  const now = new Date();
  $('#event-date').value = now.toISOString().slice(0, 10);
  $('#event-time').value = now.toTimeString().slice(0, 5);

  try {
    const res = await fetch(apiUrl('/api/health'));
    const health = await res.json();
    const sel = $('#question');
    for (const q of health.eventQuestions) {
      const opt = document.createElement('option');
      opt.value = q;
      opt.textContent = q;
      sel.appendChild(opt);
    }
    setStatus(health.astrologyApiConfigured ? 'Astrology-API.io ✓ 已连接' : '本地推算模式 local calculation mode');
  } catch {
    setStatus('无法连接后端 API — backend unreachable', true);
  }

  document.querySelectorAll('#tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.tab = btn.dataset.tab;
      loadTab(state.tab);
    });
  });

  for (const id of ['birth-date', 'birth-time', 'gender', 'event-date', 'event-time', 'question', 'topic', 'yixiang', 'longitude', 'tz-offset', 'tianqin']) {
    document.getElementById(id).addEventListener('change', () => loadTab(state.tab));
  }

  loadTab('bazi');
}

init();
