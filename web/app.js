'use strict';

/* Qi Men Superpowers frontend — talks to the JSON API in server/src/index.js. */

const $ = (sel) => document.querySelector(sel);

const state = {
  tab: 'bazi',
  lastPlateId: null,
  questions: [],
};

/* ---------------- Language system ----------------
 * Three display modes, switched via CSS on <body data-lang>:
 *   zh   — Chinese only
 *   en   — English only (hanzi glyphs remain as chart data)
 *   both — bilingual
 * All translatable text is emitted as <span class="zh">…</span><span class="en">…</span>.
 */
const bi = (zh, en) => `<span class="zh">${zh}</span><span class="en">${en}</span>`;

function setLang(lang) {
  document.body.dataset.lang = lang;
  try { localStorage.setItem('qmsLang', lang); } catch (_) { /* no storage */ }
  document.querySelectorAll('#lang-switch button').forEach((b) =>
    b.classList.toggle('active', b.dataset.setlang === lang));
  refreshOptionLabels();
}

const TABS = ['bazi', 'plate', 'caiguan', 'hunlian', 'xingge', 'event', 'zhanduan', 'yaoce', 'xunshijieyun', 'huaqizhen', 'yishenhuanjiang'];

const TAB_LABELS = {
  bazi: { zh: '八字', en: 'BaZi' },
  plate: { zh: '奇门盘', en: 'Plate' },
  caiguan: { zh: '财官诊断', en: 'Wealth & Career' },
  hunlian: { zh: '婚恋分析', en: 'Romance' },
  xingge: { zh: '性格分析', en: 'Personality' },
  event: { zh: '问事', en: 'Event Reading' },
  zhanduan: { zh: '占断', en: 'Divination' },
  yaoce: { zh: '遥测', en: 'Cross-plate Sensing' },
  xunshijieyun: { zh: '寻时借运', en: 'Time Selection' },
  huaqizhen: { zh: '化气阵', en: 'Array Placement' },
  yishenhuanjiang: { zh: '移神换将', en: 'Transformation Remedy' },
};

/* What each tab does, calculates, and is for — shown atop every tab. */
const TAB_INFO = {
  bazi: {
    zh: '由出生日期与时间排出四柱八字，推算日主强弱（旺相休囚死 + 支持率）、五行平衡、十神配置与十年大运。这是长期命理的基础蓝图，其余奇门模块均以此为参照。',
    en: 'Casts your Four Pillars (BaZi) from the birth date & time, then calculates Day-Master strength (seasonal state + support ratio), five-element balance, Ten-God roles and the 10-year Luck Pillars. This is your long-term destiny blueprint — the reference for every Qi Men module.',
  },
  plate: {
    zh: '以置闰法排时家转盘奇门局：九宫各布八神、九星、八门与天/地盘干，并标注值符值使、空亡、驿马、击刑、门迫、入墓等格局。点击任意宫位查看该宫的万物类象。',
    en: 'Casts the hourly rotating-plate Qi Men chart (Zhi-Run method). Each of the nine palaces holds a deity, star, gate and heaven/earth stems, with the Chief & Envoy, Void, Sky Horse and afflictions marked. Click any palace for its full symbolic correspondences.',
  },
  caiguan: {
    zh: '在出生局中定位财富七要害（本钱戊、利润生门、合作六合、时机时干等）与事业七要害，逐宫检查六害与月令关系，并给出具体化解方案。用途：诊断财运与事业的结构性强弱点。',
    en: 'Locates the seven wealth factors (capital 戊, profit Life Gate, partnerships, timing…) and seven career factors in your birth plate, checks each palace for harms and its Monthly-Order relation, then prescribes concrete remedies. Purpose: a structural diagnosis of money and career.',
  },
  hunlian: {
    zh: '分析婚恋要害：配偶宫位、干合关系、桃花与三奇等，判断感情格局的强弱与风险，并提供化解建议。',
    en: 'Examines the romance factors — spouse palace, stem combinations, Peach Blossom and the Three Nobles — to judge the strengths and risks of your relationship pattern, with remedies.',
  },
  xingge: {
    zh: '由日干（内在性格）与时干（外在表现）所落宫位的星、门、神与类象，刻画双层性格画像。',
    en: 'Profiles your character on two levels: the palace of the Day Stem (inner self) and of the Hour Stem (outer persona), read through their stars, gates, deities and imagery.',
  },
  event: {
    zh: '以事件发生时刻起问事局，按所选问题类型选取用神宫位，判断该事的成败趋势与关键因素。',
    en: 'Casts a plate for the moment of your question, selects the focus (Yong Shen) palaces for the chosen question type, and reads the likely outcome and key factors of the matter.',
  },
  zhanduan: {
    zh: '结合出生局与问事局，对指定主题（如婚姻、官司、求财）做专项占断。',
    en: 'Combines your birth plate with the event plate to deliver a focused divination on a stated topic (marriage, lawsuit, wealth…).',
  },
  yaoce: {
    zh: '将命主的日干、时干、生年干与值符值使宫干投射到问事盘，逐一检测各自的宫位状态与六害——跨盘感知「人」与「事」的互动关系。',
    en: 'Projects your personal stems (day, hour, birth-year, Chief/Envoy palace stems) onto the event plate and inspects each one’s palace state and harms — sensing across plates how you and the matter interact.',
  },
  xunshijieyun: {
    zh: '以原盘幻化六十甲子时课，统计每课的六害总数并排序，找出六害最少的最优时辰。用途：择时行事、借运发力。',
    en: 'Transforms the base chart through all sixty Jiazi hour lessons, counts the harms in each and ranks them to find the most favourable time window. Purpose: pick the right moment to act — “borrow luck”.',
  },
  huaqizhen: {
    zh: '化气阵布置：先保护各天干，再对受害宫位灭象，并按方位给出物象布置（颜色、材质、器物），以转化宫位气场。可在左侧「意象保护」输入要保护的概念。',
    en: 'Designs a qi-transformation array: protects your stems, dissolves afflicted images, and prescribes object placements by direction (colour, material, item) to transmute each palace’s energy. Enter concepts to protect under “Yixiang Protection”.',
  },
  yishenhuanjiang: {
    zh: '逐宫诊断凶象（白虎、门迫、空亡、击刑、入墓等），以补象、化合、泄化、灭象等手法「移神换将」，逐一给出化解物与摆放要点。',
    en: 'Audits every palace for afflictions (White Tiger, Forced Gate, Void, Punishment, Tomb-entry…) and resolves them by “moving the deity, changing the general” — supplementing, combining, draining or dissolving images, with specific objects and placement notes.',
  },
};

/* Luoshu spatial arrangement: grid order top-left → bottom-right. */
const LUOSHU_LAYOUT = [4, 9, 2, 3, 5, 7, 8, 1, 6];

const EL_EN = { '木': 'Wood', '火': 'Fire', '土': 'Earth', '金': 'Metal', '水': 'Water' };

const PINYIN = {
  '甲': 'Jia', '乙': 'Yi', '丙': 'Bing', '丁': 'Ding', '戊': 'Wu',
  '己': 'Ji', '庚': 'Geng', '辛': 'Xin', '壬': 'Ren', '癸': 'Gui',
  '子': 'Zi', '丑': 'Chou', '寅': 'Yin', '卯': 'Mao', '辰': 'Chen', '巳': 'Si',
  '午': 'Wu', '未': 'Wei', '申': 'Shen', '酉': 'You', '戌': 'Xu', '亥': 'Hai',
};
const ANIMAL = {
  '子': ['Rat', '鼠'], '丑': ['Ox', '牛'], '寅': ['Tiger', '虎'], '卯': ['Rabbit', '兔'],
  '辰': ['Dragon', '龙'], '巳': ['Snake', '蛇'], '午': ['Horse', '马'], '未': ['Goat', '羊'],
  '申': ['Monkey', '猴'], '酉': ['Rooster', '鸡'], '戌': ['Dog', '狗'], '亥': ['Pig', '猪'],
};
const TEN_GOD_EN = {
  '比肩': 'Friend', '劫财': 'Rob Wealth', '食神': 'Eating God', '伤官': 'Hurting Officer',
  '偏财': 'Indirect Wealth', '正财': 'Direct Wealth', '七杀': 'Seven Killings', '正官': 'Direct Officer',
  '偏印': 'Indirect Resource', '正印': 'Direct Resource', '日主': 'Day Master',
};
/* Per-symbol English names for the nine-palace grid (kept short for cells). */
const PALACE_EN = { '坎1宫': 'Kan 1', '坤2宫': 'Kun 2', '震3宫': 'Zhen 3', '巽4宫': 'Xun 4', '中5宫': 'Center 5', '乾6宫': 'Qian 6', '兑7宫': 'Dui 7', '艮8宫': 'Gen 8', '离9宫': 'Li 9' };
const DIR_EN = { '北': 'N', '东北': 'NE', '东': 'E', '东南': 'SE', '南': 'S', '西南': 'SW', '西': 'W', '西北': 'NW', '中': 'C' };
const DEITY_EN = { '值符': 'Chief', '螣蛇': 'Serpent', '太阴': 'Moon', '六合': 'Harmony', '白虎': 'White Tiger', '玄武': 'Tortoise', '九地': 'Nine Earth', '九天': 'Nine Heaven', '勾陈': 'Hook', '朱雀': 'Phoenix' };
const STAR_EN = { '天蓬': 'Tianpeng', '天任': 'Tianren', '天冲': 'Tianchong', '天辅': 'Tianfu', '天英': 'Tianying', '天芮': 'Tianrui', '天柱': 'Tianzhu', '天心': 'Tianxin', '天禽': 'Tianqin' };
const GATE_EN = { '休门': 'Rest', '生门': 'Life', '伤门': 'Harm', '杜门': 'Block', '景门': 'View', '死门': 'Death', '惊门': 'Shock', '开门': 'Open' };
const STAGE_EN = { '长生': 'Growth', '沐浴': 'Bath', '冠带': 'Adorn', '临官': 'Officer', '帝旺': 'Peak', '衰': 'Decline', '病': 'Sick', '死': 'Death', '墓': 'Tomb', '绝': 'Severed', '胎': 'Conceive', '养': 'Nurture' };
const SEASON_EN = { '旺': 'Prosperous', '相': 'Assisted', '休': 'Resting', '囚': 'Trapped', '死': 'Dead' };
const JU_EN = { '阳遁': 'Yang Dun', '阴遁': 'Yin Dun' };
const YUAN_EN = { '上元': 'Upper Yuan', '中元': 'Middle Yuan', '下元': 'Lower Yuan' };
const QUESTION_EN = {
  '事业': 'Career', '求财': 'Wealth', '婚姻感情': 'Marriage & Love', '疾病健康': 'Health',
  '出行': 'Travel', '官司诉讼': 'Lawsuit', '寻人寻物': 'Lost & Missing', '天气': 'Weather',
  '家宅风水': 'Home Feng Shui',
};

const elBadge = (el) => el ? `<span class="el-badge el-${esc(el)}" data-el="${esc(el)}"><span class="en">${esc(EL_EN[el] || '')}</span></span>` : '';
const pinyinOf = (ch) => esc(PINYIN[ch] || '');
const branchSub = (ch) => {
  const a = ANIMAL[ch];
  return `${pinyinOf(ch)}${a ? ` · ${bi(esc(a[1]), esc(a[0]))}` : ''}`;
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
  '状态': 'State', '用神': 'Focus', '时间': 'Time', '四柱': 'Four Pillars',
  '生年干': 'Birth-year Stem', '命主日干': 'Day Stem (self)', '命主时干': 'Hour Stem (matters)',
  '生年天干': 'Birth-year Stem', '值符宫干': 'Chief-palace Stem', '值使宫干': 'Envoy-palace Stem',
  '天盘宫位': 'Heaven-plate palace', '地盘宫位': 'Earth-plate palace', '问事时间': 'Event time',
  '格局': 'Patterns', '先天数': 'Innate number', '后天数': 'Acquired number', '尾数': 'Tail numbers',
  '补象': 'Supplement image', '物象': 'Imagery', '化合': 'Combine', '化合物': 'Combining objects',
  '泄化': 'Drain', '灭象': 'Dissolve image', '危险': 'Danger', '原盘': 'Base chart',
  '问题类型': 'Question type', '分析盘面': 'Plate', '用乙': 'Use Yi', '用合': 'Use combination',
  // Wan Wu correspondence categories
  '宫位': 'Palace', '符号': 'Symbols', '九星': 'Star', '八门': 'Gate', '八神': 'Deity',
  '十二长生': 'Twelve Stages', '地盘干': 'Earth stem', '五行阴阳': 'Element & polarity',
  '方位': 'Direction', '季节': 'Season', '时段': 'Time of day', '颜色': 'Colours',
  '数字': 'Numbers', '形态': 'Form', '概念': 'Concepts', '身体脏腑': 'Body & organs',
  '身体': 'Body', '性格品质': 'Character traits', '体形': 'Physique', '得令失令': 'In / out of season',
  '天象': 'Sky phenomena', '地理': 'Terrain & places', '人物': 'People', '动物': 'Animals',
  '植物': 'Plants', '器物': 'Objects', '食物': 'Food', '疾病': 'Ailments', '事件': 'Events',
  '其他': 'Other', '动植': 'Flora & fauna', '含义': 'Meaning', '味道': 'Taste',
  '地理场所': 'Places', '室内类象': 'Indoor imagery', '坟外类象': 'Grave surroundings',
  '时辰': 'Hour', '月份': 'Month', '生肖': 'Zodiac', '藏干': 'Hidden stems', '饮食': 'Food & drink',
  '静物': 'Still objects', '屋宅': 'Dwellings', '行为': 'Behaviour', '原型': 'Archetype',
  '性格': 'Character', '吉凶': 'Auspice', '名称': 'Name', '五行': 'Element',
};
const keyGloss = (label) => {
  if (KEY_EN[label]) return KEY_EN[label];
  const m = label.match(/^(.)象$/);
  if (m && (PINYIN[m[1]] || EL_EN[m[1]])) return `${PINYIN[m[1]] || EL_EN[m[1]]} imagery`;
  return null;
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
  '命局信息': 'Natal Information', '出生局': 'Birth Plate', '问事局': 'Event Plate',
  '灭象': 'Dissolving Images', '布阵': 'Array Placement', '化气阵分析': 'Array Analysis',
};

/* Report titles emitted by each engine module. */
const TITLE_EN = {
  '财官诊断': 'Wealth & Career Diagnosis',
  '移神换将化解分析': 'Transformation Remedy Analysis',
  '化气阵分析': 'Qi Array Placement Analysis',
  '遥测分析': 'Cross-plate Sensing Analysis',
  '奇门遁甲分析': 'Qi Men Dun Jia Event Analysis',
  '性格分析': 'Personality Analysis',
  '婚恋分析': 'Romance Analysis',
  '占断分析': 'Divination Analysis',
  '万物类象提取': 'Wan Wu Correspondences',
  '寻时借运 幻化六十课': 'Time Selection · 60 Transformed Lessons',
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
  '可移动': 'May be moved.',
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
  '甲': 'Jia', '乙': 'Yi', '丙': 'Bing', '丁': 'Ding', '戊': 'Wu', '己': 'Ji',
  '庚': 'Geng', '辛': 'Xin', '壬': 'Ren', '癸': 'Gui',
  '子': 'Zi', '丑': 'Chou', '寅': 'Yin', '卯': 'Mao', '辰': 'Chen', '巳': 'Si',
  '午': 'Wu', '未': 'Wei', '申': 'Shen', '酉': 'You', '戌': 'Xu', '亥': 'Hai',
  '休门': 'Rest Gate', '生门': 'Life Gate', '伤门': 'Harm Gate', '杜门': 'Block Gate',
  '景门': 'View Gate', '死门': 'Death Gate', '惊门': 'Shock Gate', '开门': 'Open Gate',
  '天蓬': 'Tianpeng', '天任': 'Tianren', '天冲': 'Tianchong', '天辅': 'Tianfu',
  '天英': 'Tianying', '天芮': 'Tianrui', '天内': 'Tianrui', '天柱': 'Tianzhu', '天心': 'Tianxin', '天禽': 'Tianqin',
  '值符': 'Chief', '值使': 'Envoy', '螣蛇': 'Serpent', '太阴': 'Great Moon', '六合': 'Harmony',
  '白虎': 'White Tiger', '玄武': 'Black Tortoise', '九地': 'Nine Earth', '九天': 'Nine Heaven',
  '勾陈': 'Hook', '朱雀': 'Vermilion Bird',
  '木': 'Wood', '火': 'Fire', '土': 'Earth', '金': 'Metal', '水': 'Water',
  '吉': 'auspicious', '凶': 'inauspicious', '阴': 'Yin', '阳': 'Yang',
  '中5宫': 'Center 5 Palace', '乾': 'Qian', '坎': 'Kan', '艮': 'Gen', '震': 'Zhen',
  '巽': 'Xun', '离': 'Li', '坤': 'Kun', '兑': 'Dui', '宫': 'Palace',
  '东南': 'Southeast', '东北': 'Northeast', '西南': 'Southwest', '西北': 'Northwest',
  '东': 'East', '南': 'South', '西': 'West', '北': 'North', '正北': 'due North', '正西': 'due West',
  '长生': 'Growth', '沐浴': 'Bath', '冠带': 'Adornment', '临官': 'Officer', '帝旺': 'Peak',
  '衰': 'Decline', '病': 'Sickness', '死': 'Death', '墓': 'Tomb', '绝': 'Severed',
  '胎': 'Conceived', '养': 'Nurture',
  '击刑': 'Punishment', '入墓': 'Tomb-entry', '门迫': 'Forced Gate', '空亡': 'Void',
  '对宫': 'opposite palace', '刑': 'Punishment', '空': 'Void', '凶煞': 'malign force',
  '伏吟': 'Fu Yin', '反吟': 'Fan Yin', '危险': 'danger', '干墓': 'stem tomb', '门墓': 'gate tomb',
  '迫': 'Forced', '虎': 'Tiger',
  '压击刑': 'Suppress Punishment', '压入墓': 'Suppress Tomb-entry', '压门迫': 'Suppress Forced Gate',
  '压庚': 'Suppress Geng', '填空亡': 'Fill the Void', '用合化解': 'resolve by combination',
  '用冲打开墓库': 'open the tomb by clash', '以柔克刚': 'soft overcomes hard',
  '缺金补金': 'missing Metal → supplement Metal', '先灭象': 'first dissolve the image',
  '将': 'move', '的象移出': '’s imagery out of', '合': 'combines', '冲': 'clashes',
  '虚假不实': 'false and unreal', '克': 'overcomes', '在问事盘': 'in the event plate',
  '压制': 'to suppress', '补': 'supplement ', '象': 'image', '从': 'from', '移走': 'move away',
  '移至': 'move to', '避开': 'avoid', '有六害': 'has harms',
  '天盘': 'Heaven plate', '地盘': 'Earth plate', '天干': 'Stem', '地支': 'Branch',
  '高处': 'place high —', '低处': 'place low —',
  '本钱': 'Capital', '利润': 'Profit', '合作关系': 'Partnerships', '时机': 'Timing',
  '时干': 'Hour Stem', '日干': 'Day Stem', '年干': 'Year Stem', '月干': 'Month Stem',
  '生年干': 'Birth-year Stem', '值符宫干': 'Chief-palace stem', '值使宫干': 'Envoy-palace stem',
  '所在公司或单位': 'company / organisation', '直属上级': 'direct superior', '控制力': 'control',
  '安全方位': 'Safe directions', '状态': 'State', '用神': 'Focus (Yong Shen)',
  '先天数': 'innate number', '后天数': 'acquired number', '尾数': 'tail numbers',
  '墨绿': 'dark green', '暗红': 'dark red', '棕色': 'brown', '金黄': 'golden yellow',
  '黄白': 'yellow-white', '深蓝': 'deep blue', '暗棕': 'dark brown', '蓝黑': 'blue-black',
  '红色': 'red', '白色': 'white', '黑色': 'black', '黄色': 'yellow', '绿色': 'green',
  '软植': 'soft plants', '藤蔓花草葫芦': 'vines, flowers & gourds',
  '尖锐': 'sharp items', '烛火刀剑': 'candles, knives & swords',
  '容器': 'containers', '花盆存钱罐': 'flower pots & piggy banks',
  '浑水': 'murky water', '墨水茶壶': 'ink & teapots', '小金属': 'small metal items',
  '首饰钱币': 'jewellery & coins', '金属': 'metal items', '刀斧铁器': 'knives, axes & ironware',
  '牛摆件': 'ox ornament', '鸡摆件': 'rooster ornament', '猴摆件': 'monkey ornament',
  '狗玩偶或图片': 'dog figure or picture', '小猪存钱罐': 'piggy bank',
  '羊雕像或玩偶': 'goat statue or doll', '水盆代替': 'use a water basin instead',
  '牛': 'ox', '鸡': 'rooster', '猴': 'monkey', '狗': 'dog', '猪': 'pig', '羊': 'goat',
  '龙': 'dragon', '马': 'horse', '兔': 'rabbit', '蛇': 'snake', '鼠': 'rat',
};
/* Wan Wu correspondence vocabulary — top terms across the engine's data
   tables (body, people, places, objects, animals, traits, events…). Used for
   term-by-term translation of comma-separated correspondence lists. */
const WANWU_EN = {
  // events & activities
  '嫁娶': 'marriage', '出行': 'travel', '远行': 'long journeys', '开业': 'opening a business',
  '经商': 'commerce', '求财': 'seeking wealth', '求官': 'seeking office', '诉讼': 'lawsuit',
  '官司': 'lawsuit', '赌博': 'gambling', '辩论': 'debate', '竞争': 'competition', '考试': 'exams',
  '婚姻': 'marriage', '谈判': 'negotiation', '讨债': 'debt collection', '上任': 'taking office',
  '乔迁': 'moving home', '争吵': 'quarrel', '交通事故': 'traffic accident', '手术': 'surgery',
  '打猎': 'hunting', '打斗': 'fighting', '养殖': 'husbandry', '营造': 'construction',
  '行刑': 'executions', '保密': 'secrecy', '口舌是非': 'disputes & gossip', '口舌': 'gossip',
  '虚惊': 'false alarm', '哭泣': 'weeping', '死亡': 'death', '胎产': 'pregnancy & birth',
  '生育': 'childbirth', '阻碍': 'obstruction', '惊恐': 'fright', '信息': 'information',
  '大吉': 'very auspicious', '秋占不利': 'unfavourable in autumn', '夏占不利': 'unfavourable in summer',
  '春占不利': 'unfavourable in spring', '宫制门': 'palace controls gate', '受制': 'constrained',
  '血光之灾': 'bloodshed calamity', '血光': 'bloodshed', '跌打损伤': 'bruises & sprains',
  // body & ailments
  '胃': 'stomach', '皮肤': 'skin', '骨骼': 'bones', '血液': 'blood', '胆': 'gallbladder',
  '肺': 'lungs', '肌肉': 'muscles', '神经': 'nerves', '疾病': 'illness', '小肠': 'small intestine',
  '大肠': 'large intestine', '膀胱': 'bladder', '腹部': 'abdomen', '眼': 'eyes', '牙齿': 'teeth',
  '心脏': 'heart', '舌': 'tongue', '背': 'back', '肛门': 'anus', '手指': 'fingers', '头': 'head',
  '口': 'mouth', '鼻': 'nose', '腹': 'belly', '脐': 'navel', '肾脏': 'kidneys', '经络': 'meridians',
  '筋骨': 'sinews & bones', '咽喉': 'throat', '四肢': 'limbs', '骨髓': 'marrow', '骨': 'bones',
  '额头': 'forehead', '面部': 'face', '血管': 'blood vessels', '腰': 'waist', '脾胃': 'spleen & stomach',
  '脾': 'spleen', '脑': 'brain', '脊柱': 'spine', '肠': 'intestines', '肘': 'elbow', '耳': 'ears',
  '精液': 'semen', '筋脉': 'sinew channels', '筋': 'sinews', '眼目': 'eyes', '生殖器': 'genitals',
  '毛发': 'hair', '羽毛': 'feathers', '皮毛': 'fur', '眼睛': 'eyes', '手': 'hands',
  '肺病': 'lung disease', '眼疾': 'eye ailments', '骨折': 'fractures', '高血压': 'hypertension',
  '血液病': 'blood disorders', '脾胃病': 'spleen-stomach ailments', '肿瘤': 'tumours', '癌症': 'cancer',
  // people
  '军人': 'soldier', '医生': 'doctor', '农民': 'farmer', '律师': 'lawyer', '少女': 'young woman',
  '盗贼': 'thief', '运动员': 'athlete', '歌手': 'singer', '文人': 'scholar', '教师': 'teacher',
  '妇女': 'women', '名人': 'celebrity', '司机': 'driver', '军警': 'military & police',
  '领导': 'leader', '长辈': 'elders', '艺术家': 'artist', '艺人': 'performer', '胎儿': 'fetus',
  '演员': 'actor', '法官': 'judge', '巫师': 'shaman', '寡妇': 'widow', '外科医生': 'surgeon',
  '僧道': 'monks & priests', '中介': 'brokers', '黑社会': 'underworld', '酒鬼': 'drunkard',
  '老师': 'teacher', '水手': 'sailor', '执法者': 'law enforcer', '建筑师': 'architect',
  '屠夫': 'butcher', '间谍': 'spy', '长官': 'officials', '贵人': 'benefactor', '谋士': 'strategist',
  '说客': 'lobbyist', '设计师': 'designer', '警察': 'police', '公安': 'police', '公务员': 'civil servant',
  '驾驶员': 'driver', '首领': 'chieftain', '飞行员': 'pilot', '领袖': 'leader', '矿工': 'miner',
  '画家': 'painter', '男人': 'man', '老板': 'boss', '老妇人': 'old woman', '翻译': 'translator',
  '美女': 'beautiful woman', '狱警': 'prison guard', '首都': 'capital city',
  // places
  '仓库': 'warehouse', '坟墓': 'grave', '寺庙': 'temple', '车站': 'station', '池塘': 'pond',
  '地下室': 'basement', '监狱': 'prison', '道路': 'roads', '花园': 'garden', '娱乐场所': 'entertainment venues',
  '厨房': 'kitchen', '厕所': 'toilet', '下水道': 'sewers', '银行': 'bank', '酒吧': 'bar',
  '电影院': 'cinema', '法院': 'court', '沼泽': 'marsh', '战场': 'battlefield', '工地': 'construction site',
  '医院': 'hospital', '闹市': 'busy streets', '酒店': 'hotel', '码头': 'docks', '田地': 'fields',
  '洞穴': 'caves', '洗手间': 'washroom', '楼台': 'towers', '桥梁': 'bridges', '树林': 'woods',
  '机场': 'airport', '暗处': 'dark places', '影院': 'cinema', '庭院': 'courtyard', '废墟': 'ruins',
  '广场': 'plaza', '平原': 'plains', '寺院': 'monastery', '寺观': 'temples', '宫殿': 'palace hall',
  '客厅': 'living room', '学校': 'school', '大路': 'main roads', '堤坝': 'dams', '坑': 'pits',
  '化工厂': 'chemical plant', '公园': 'park', '高楼': 'tall buildings', '高岗': 'high mounds',
  '高山': 'high mountains', '高原': 'plateau', '高亢之地': 'elevated ground', '饭店': 'restaurant',
  '酒楼': 'restaurant', '荒地': 'wasteland', '竹林': 'bamboo grove', '窑灶': 'kilns & stoves',
  '矿山': 'mines', '田园': 'farmland', '牢狱': 'imprisonment', '美容院': 'beauty salon',
  '房地产': 'real estate', '门窗': 'doors & windows',
  // objects
  '文章': 'writings', '乐器': 'instruments', '首饰': 'jewellery', '珠宝': 'jewels', '音响': 'audio gear',
  '飞机': 'aircraft', '车辆': 'vehicles', '镜子': 'mirrors', '锁': 'locks', '金银': 'gold & silver',
  '衣服': 'clothing', '砖瓦': 'bricks & tiles', '电话': 'telephone', '电视': 'television',
  '电器': 'appliances', '灯': 'lamps', '汽车': 'car', '床': 'bed', '布帛': 'cloth & silk',
  '合同': 'contracts', '刀剑': 'knives & swords', '书籍': 'books', '鞭炮': 'firecrackers',
  '钥匙': 'keys', '金银首饰': 'gold & silver jewellery', '醋': 'vinegar', '证件': 'documents & IDs',
  '蜡烛': 'candles', '艺术品': 'artworks', '管道': 'pipes', '盐': 'salt', '水泥': 'cement',
  '水沟': 'ditches', '水果': 'fruit', '旧物': 'old things', '文件': 'documents', '文书': 'paperwork',
  '手术刀': 'scalpel', '布匹': 'cloth', '图画': 'pictures', '印章': 'seals', '饮料': 'beverages',
  '陶器': 'pottery', '钱财': 'money', '钟表': 'clocks & watches', '金融': 'finance', '酒食': 'wine & food',
  '财帛': 'wealth', '装饰': 'decoration', '葫芦': 'gourds', '茶': 'tea', '腰带': 'belts',
  '窗帘': 'curtains', '神像': 'sacred statues', '神佛': 'deities & buddhas', '破损之物': 'damaged items',
  '眼镜': 'spectacles', '瓦罐': 'clay pots', '珍宝': 'treasures', '玩具': 'toys', '化妆品': 'cosmetics',
  '霓虹灯': 'neon lights', '炉灶': 'stove', '酒': 'alcohol', '食物': 'food', '野味': 'game meat',
  '蔬菜': 'vegetables', '花生': 'peanuts', '地瓜': 'sweet potato', '土豆': 'potato', '高粱': 'sorghum',
  // animals & plants
  '鱼': 'fish', '鹰': 'eagle', '鳖': 'turtle', '驴': 'donkey', '猫': 'cat', '狼': 'wolf',
  '鹿': 'deer', '鸭': 'duck', '虾': 'shrimp', '蚯蚓': 'earthworm', '萤火虫': 'firefly',
  '狮子': 'lion', '狮': 'lion', '龟': 'tortoise', '鸟': 'birds', '天鹅': 'swan', '跳蚤': 'flea',
  '蟹': 'crab', '蝙蝠': 'bat', '豹': 'leopard', '熊猫': 'panda', '花草': 'flowers & plants',
  '灌木': 'shrubs', '苔藓': 'moss', '花': 'flowers', '芦苇': 'reeds', '绳索': 'ropes',
  // traits
  '固执': 'stubborn', '包容': 'tolerant', '光明': 'bright', '保守': 'conservative', '威严': 'dignified',
  '聪明': 'clever', '柔顺': 'gentle', '急躁': 'impatient', '吝啬': 'stingy', '优柔寡断': 'indecisive',
  '仁慈': 'benevolent', '阴险': 'devious', '积极进取': 'enterprising', '热情': 'passionate',
  '智慧': 'wisdom', '守信': 'trustworthy', '多疑': 'suspicious', '刚健': 'vigorous',
  '雷厉风行': 'swift & decisive', '重感情': 'sentimental', '豪放': 'bold & unrestrained',
  '虚荣': 'vain', '自私': 'selfish', '自强不息': 'self-improving', '稳重': 'steady',
  '神秘': 'mysterious', '美丽': 'beautiful', '爱表现': 'showy', '权威': 'authority',
  // weather & nature
  '阴天': 'overcast', '闪电': 'lightning', '霜雪': 'frost & snow', '阴云': 'dark clouds',
  '龙卷风': 'tornado', '晴天': 'clear weather', '太阳': 'sun', '霜降': 'frost', '雾霾': 'smog',
  '雾': 'fog', '雨': 'rain', '酷暑': 'scorching heat', '秋天': 'autumn',
  // colours & misc
  '黑': 'black', '蓝色': 'blue', '银白': 'silvery white', '黄土黄': 'earthy yellow', '青': 'green-blue',
  '紫': 'purple', '白': 'white', '弯曲': 'curved', '青绿': 'verdant green', '亮绿': 'bright green',
  '暗淡蓝': 'dim blue', '玄': 'dark mystic', '红': 'red', '黄': 'yellow', '蓝': 'blue', '绿': 'green',
  '深色': 'dark tones', '圆润': 'rounded', '小': 'small', '直': 'straight', '方': 'square', '高': 'tall',
  // seasons & times of day
  '春': 'spring', '夏': 'summer', '秋': 'autumn', '冬': 'winter', '四季': 'all seasons',
  '早晨': 'morning', '上午': 'forenoon', '中午': 'noon', '下午': 'afternoon', '黄昏': 'dusk',
  '夜晚': 'night', '深夜': 'late night', '凌晨': 'pre-dawn', '傍晚': 'evening',
  // romance / personality module words
  '妖艳': 'seductive', '玉女': 'jade maiden', '阴柔': 'soft-natured', '温柔': 'gentle',
  '如沐春风': 'like a spring breeze', '热辣': 'fiery', '男闺蜜': 'male confidant',
  '猛男': 'macho man', '帅哥': 'handsome man', '海王': 'player', '渣男渣女': 'toxic partners',
  '艳遇': 'romantic encounter', '奇遇': 'chance encounter', '一见钟情': 'love at first sight',
  '梦中情人': 'dream lover', '性冲动': 'sexual impulse', '挑逗': 'flirtation', '乱道心': 'distracts the heart',
  '点蜡烛': 'light a candle', '漂亮吊灯': 'pretty chandelier', '小花小草': 'small flowers & plants',
  '器官': 'organs', '大小': 'size', '耐久力': 'stamina', '桃花': 'Peach Blossom', '人缘': 'popularity',
  '媒': 'matchmaking', '婚': 'marriage', '恋': 'romance', '约': 'dates', '缘': 'affinity',
  '女装大佬': 'cross-dresser', '妖人': 'enchanter', '阴柔男性': 'soft-natured man', '骚女': 'flirtatious woman',
};
Object.assign(EN_VOCAB, WANWU_EN);
if (window.QMS_TERMS_EN) Object.assign(EN_VOCAB, window.QMS_TERMS_EN);
if (window.QMS_KEY_EN) Object.assign(KEY_EN, window.QMS_KEY_EN);
const EN_VOCAB_MAXLEN = Math.max(...Object.keys(EN_VOCAB).map((k) => k.length));

/* Translate one list term: exact match first, then STRICT segmentation —
   a term is fully English or stays fully Chinese, never a hybrid. */
function cnEnTerm(t) {
  if (EN_VOCAB[t] !== undefined) return EN_VOCAB[t];
  return cnEn(t, true);
}

/* Comma-separated correspondence lists → per-term translation. Unknown terms
   keep their hanzi (graceful fallback); below 40% coverage we give up. */
function cnEnList(val) {
  const whole = String(val).trim();
  if (EN_VOCAB[whole] !== undefined) return EN_VOCAB[whole];   // short single values (北, 胎, 冬…)
  const parts = String(val).split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) {
    // short values: strict per-part, else loose only for longer prose
    if (whole.length <= 8) return cnEn(whole, true);
    return cnEn(whole);
  }
  let hit = 0;
  const out = parts.map((p) => {
    const e = cnEnTerm(p);
    if (e) { hit++; return e; }
    return p;
  });
  if (hit / parts.length < 0.4) return null;
  return out.join(', ');
}

/* Translate a line via EN_FIXED, else longest-match glossary segmentation.
   Loose mode tolerates partial coverage (long prose); strict mode requires
   every CJK character to translate — used for list terms so the output is
   either fully English or cleanly left in Chinese, never a hybrid. */
function cnEn(s, strict) {
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
      if (/[一-鿿]/.test(ch)) {
        if (strict) return null;
        total += 1;
      }
      out += ch;
      i += 1;
    }
  }
  if (!strict && (total < 2 || covered / total < 0.55)) return null;
  if (strict && covered === 0) return null;
  return out
    .replace(/，/g, ', ').replace(/。/g, '. ').replace(/：/g, ': ')
    .replace(/（/g, ' (').replace(/）/g, ') ').replace(/、/g, ', ')
    .replace(/\s+([,):.])/g, '$1').replace(/\(\s+/g, '(')
    .replace(/(\d)(?=[A-Z])/g, '$1 ')
    .replace(/\s{2,}/g, ' ').trim();
}

/* Decorate a plain text fragment: escape, turn [tags] into chips, colour 吉/凶. */
function deco(s) {
  let t = esc(s);
  t = t.replace(/\[([^\]]+)\]/g, '<span class="rd-tag">$1</span>');
  t = t.replace(/(吉)/g, '<span class="jixi-吉">$1</span>').replace(/(凶)/g, '<span class="jixi-凶">$1</span>');
  return t;
}
const indentRem = (n) => `margin-left:${Math.min(n, 10) * 0.5}rem`;

/* zh text + optional EN as a language-switchable pair. */
function rdPair(zhHtml, en) {
  if (!en) return `<span class="zh-keep">${zhHtml}</span>`;
  return `<span class="has-en"><span class="zh">${zhHtml}</span><span class="rd-en">${esc(en)}</span></span>`;
}

/* Lines that are engine/CLI internals, not part of the reading. */
function isJunkLine(t) {
  return /\.json/.test(t) || /^--?[a-zA-Z]/.test(t) || /^依赖/.test(t) || /^用法/.test(t) || /显示帮助/.test(t);
}

/*
 * Turn the engine's indented, ===section=== text reports into structured,
 * readable HTML. Generic across modules; falls back to plain lines.
 */
function formatReading(raw) {
  const lines = String(raw).replace(/\r/g, '').split('\n');
  let html = '';
  let inItem = false;
  const closeItem = () => { if (inItem) { html += '</div>'; inItem = false; } };
  const sectionBar = (zh) => {
    const en = SECTION_EN[zh] || cnEn(zh);
    html += `<h4 class="rd-section">${en ? bi(deco(zh), esc(en)) : deco(zh)}</h4>`;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[=]{3,}$/.test(trimmed)) continue;                    // underline rule — skip
    if (isJunkLine(trimmed)) continue;                          // CLI/internal noise
    const indent = line.length - line.replace(/^\s+/, '').length;
    const next = (lines[i + 1] || '').trim();

    if ((indent === 0 && /^[=]{3,}$/.test(next)) || (i === 0 && !/[：:]/.test(trimmed))) { // report title
      closeItem();
      const tEn = TITLE_EN[trimmed] || cnEn(trimmed);
      html += `<h3 class="rd-title">${tEn ? bi(deco(trimmed), esc(tEn)) : deco(trimmed)}</h3>`;
      continue;
    }
    const sec = trimmed.match(/^={2,}\s*(.+?)\s*={2,}$/);       // === Section ===
    if (sec) { closeItem(); sectionBar(sec[1]); continue; }

    const dash = trimmed.match(/^-{3,}\s*(.+?)\s*-{3,}$/);      // --- Sub section --- (yaoce)
    if (dash) {
      closeItem();
      const en = cnEn(dash[1]);
      html += `<h5 class="rd-sub">${en ? bi(deco(dash[1]), esc(en)) : deco(dash[1])}</h5>`;
      continue;
    }
    const pal = trimmed.match(/^\[\s*(.+?)\s*[｜|]\s*(.+?)\s*[｜|]\s*(.+?)\s*\]$/); // [ 坎1宫｜北｜水 ]
    if (pal) {
      closeItem();
      const zh = `${pal[1]} · ${pal[2]} · ${pal[3]}`;
      const en = [cnEn(pal[1]), cnEn(pal[2]), cnEn(pal[3])].filter(Boolean).join(' · ');
      html += `<h4 class="rd-palace">${en ? bi(deco(zh), esc(en)) : deco(zh)}</h4>`;
      continue;
    }
    const brk = trimmed.match(/^\[([^\]｜|]{2,10})\]$/);        // [出生局] style heads
    if (brk) { closeItem(); sectionBar(brk[1]); continue; }

    const sym = trimmed.match(/^\[([^\]]{1,8})\]\s+(\S.*)$/);   // "[天干] 癸" symbol heads (wanwu)
    if (sym) {
      const zh = `${sym[1]} · ${sym[2]}`;
      const en = [keyGloss(sym[1]) || cnEn(sym[1]), cnEn(sym[2])].filter(Boolean).join(' · ');
      html += `<h5 class="rd-sub">${en ? bi(deco(zh), esc(en)) : deco(zh)}</h5>`;
      continue;
    }

    const bullet = trimmed.match(/^-\s+(.+)$/);                 // - affliction item
    if (bullet) {
      const en = cnEn(bullet[1]);
      html += `<div class="rd-bullet" style="${indentRem(indent)}">${rdPair(deco(bullet[1]), en)}</div>`;
      continue;
    }
    if (/\s—\s/.test(trimmed) && /宫/.test(trimmed)) {           // factor header "戊(本钱) — 震3宫(…)"
      closeItem();
      html += `<div class="rd-item"><div class="rd-item-h">${rdPair(deco(trimmed), cnEn(trimmed))}</div>`;
      inItem = true; continue;
    }
    const kv = trimmed.match(/^([^：:，。]{1,16})[：:]\s*(.*)$/); // key: value
    if (kv) {
      const label = kv[1].trim(), val = kv[2];
      const g = keyGloss(label);
      const kHtml = g ? `<span class="has-en"><span class="zh">${deco(label)}</span><span class="k-en">${esc(g)}</span></span>` : deco(label);
      if (!val) html += `<div class="rd-kv-h" style="${indentRem(indent)}">${kHtml}</div>`;
      else html += `<div class="rd-kv" style="${indentRem(indent)}"><span class="rd-k">${kHtml}</span><span class="rd-v">${rdPair(deco(val), cnEnList(val))}</span></div>`;
      continue;
    }
    html += `<div class="rd-line" style="${indentRem(indent)}">${rdPair(deco(trimmed), cnEn(trimmed))}</div>`;
  }
  closeItem();
  return `<div class="reading" translate="no">${html}</div>`;
}

function setStatus(html, isError) {
  const el = $('#status');
  el.innerHTML = html || '';
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
    `<p class="notice">${bi('真太阳时校正', 'True solar time')}: ${esc(c.original)} → <b>${esc(c.corrected)}</b> (${c.offsetMinutes >= 0 ? '+' : ''}${c.offsetMinutes} min)</p>`
  ).join('');
}

/* ---------------- Nine-palace grid ---------------- */

function markBadges(p) {
  const marks = [];
  if (p.kong_wang) marks.push(['空亡', 'Void', 'note']);
  if (p.yi_ma) marks.push(['驿马', 'Horse', 'note']);
  if (p.ji_xing) marks.push(['击刑', 'Punish', 'bad']);
  if (p.men_po) marks.push(['门迫', 'Forced', 'bad']);
  if (p.rumu_gan || p.rumu_star || p.rumu_gate) marks.push(['入墓', 'Tomb', 'bad']);
  if (p.geng) marks.push(['庚', 'Geng', 'bad']);
  if (p.star_fu_yin || p.gate_fu_yin || p.gan_fu_yin) marks.push(['伏吟', 'Fu Yin', 'bad']);
  if (p.star_fan_yin || p.gate_fan_yin || p.gan_fan_yin) marks.push(['反吟', 'Fan Yin', 'bad']);
  return marks.map(([zh, en, cls]) => `<span class="mark ${cls}">${bi(zh, en)}</span>`).join('');
}

function renderPlateGrid(plate, plateId) {
  const zhifuPalace = plate.zhi_fu?.palace;
  const zhishiPalace = plate.zhi_shi?.palace;
  const cells = LUOSHU_LAYOUT.map((n) => {
    if (n === 5) {
      return `<div class="palace center">
        <div class="pname">${bi('中5宫', 'Center 5')}</div>
        <div class="center-info">
          <div class="ju">${bi(esc(plate.ju.type), esc(JU_EN[plate.ju.type] || plate.ju.type))} ${plate.ju.number}${bi('局', ' Ju')}</div>
          <div>${bi(esc(plate.ju.yuan), esc(YUAN_EN[plate.ju.yuan] || plate.ju.yuan))}${plate.ju.run ? bi(' · 置闰', ' · leap') : ''}</div>
          <div>${bi('值符', 'Chief')} ${bi(esc(plate.zhi_fu.star), esc(STAR_EN[plate.zhi_fu.star] || plate.zhi_fu.star))} · ${bi('值使', 'Envoy')} ${bi(esc(plate.zhi_shi.gate), esc(GATE_EN[plate.zhi_shi.gate] || plate.zhi_shi.gate))}</div>
          <div>${esc(plate.datetime)}</div>
        </div>
      </div>`;
    }
    const p = plate.palaces[String(n)];
    const cls = ['palace'];
    if (n === zhifuPalace) cls.push('zhifu');
    if (n === zhishiPalace) cls.push('zhishi');
    const ganCell = (gan, wuxing, extra) =>
      `<span class="gan ${extra || ''} el-${esc(wuxing)}">${esc(gan)}<small class="en gan-py">${pinyinOf(gan)}</small></span>`;
    return `<div class="${cls.join(' ')}" data-palace="${n}" title="万物类象 Wan Wu correspondences">
      <div class="pname">${bi(`${esc(p.name)} ${esc(p.direction)}`, `${esc(PALACE_EN[p.name] || p.name)} · ${esc(DIR_EN[p.direction] || p.direction)}`)}</div>
      <div class="deity">${bi(esc(p.deity), esc(DEITY_EN[p.deity] || p.deity))}</div>
      <div class="row">
        <span class="jixi-${esc(p.star_jixi)}">${bi(esc(p.star), esc(STAR_EN[p.star] || p.star))}${p.tianqin ? `<small>${bi('[寄禽]', '[+Qin]')}</small>` : ''}</span>
        ${ganCell(p.tian_gan, p.tian_gan_wuxing)}
      </div>
      <div class="row">
        <span class="jixi-${esc(p.gate_jixi)}">${bi(esc(p.gate), esc(GATE_EN[p.gate] || p.gate))}</span>
        ${ganCell(p.di_gan, p.di_gan_wuxing, 'digan')}
      </div>
      <div class="row"><span class="hint">${p.state ? bi(esc(p.state), esc(STAGE_EN[p.state] || p.state)) : ''}</span></div>
      <div class="marks">${markBadges(p)}</div>
    </div>`;
  }).join('');

  return `<div class="grid9" data-plate-id="${esc(plateId || '')}" translate="no">${cells}</div>
  <div class="legend">
    <span>${bi('◆ 金框 = 值符宫', '◆ gold ring = Chief palace')}</span>
    <span>${bi('◆ 蓝框 = 值使宫', '◆ blue ring = Envoy palace')}</span>
    <span>${bi('右列大字 = 天盘干 / 地盘干', 'right column = heaven & earth stems')}</span>
    <span>${bi('点击宫位查看万物类象', 'click a palace for correspondences')}</span>
  </div>`;
}

function plateMeta(plate) {
  const sz = plate.si_zhu;
  return `<div class="plate-meta" translate="no">
    <span>${bi('四柱', 'Pillars')}: <b>${esc(sz.year)} ${esc(sz.month)} ${esc(sz.day)} ${esc(sz.hour)}</b></span>
    <span>${bi('局', 'Ju')}: <b>${bi(`${esc(plate.ju.type)}${plate.ju.number}局 ${esc(plate.ju.yuan)}`, `${esc(JU_EN[plate.ju.type] || plate.ju.type)} ${plate.ju.number} · ${esc(YUAN_EN[plate.ju.yuan] || plate.ju.yuan)}`)}</b></span>
    <span>${bi('空亡', 'Void')}: <b>${plate.kong_wang.map((k) => esc(k.branch)).join(' ')}</b></span>
    <span>${bi('驿马', 'Sky Horse')}: <b>${esc(plate.yi_ma.branch)}</b></span>
  </div>`;
}

async function showWanwu(plateId, palace) {
  const modal = $('#palace-modal');
  $('#modal-title').innerHTML = `${bi(`第${palace}宫 万物类象`, `Palace ${palace} Correspondences`)}`;
  $('#modal-body').innerHTML = `<div class="loading">${bi('查询中', 'Loading')}</div>`;
  modal.classList.remove('hidden');
  try {
    const r = await api('/api/qimen/wanwu', { plateId, palace });
    $('#modal-body').innerHTML = formatReading(r.text);
  } catch (e) {
    $('#modal-body').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
}

document.addEventListener('click', (ev) => {
  const lang = ev.target.closest('#lang-switch button');
  if (lang) { setLang(lang.dataset.setlang); return; }
  const card = ev.target.closest('.guide-card[data-tab]');
  if (card) { activateTab(card.dataset.tab); return; }
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
      <h4>${bi(esc(p.name), esc(p.nameEn))}</h4>
      <div class="tg">${bi(esc(p.tenGod), esc(TEN_GOD_EN[p.tenGod] || p.tenGod))}</div>
      <div class="stem el-${esc(p.stemElement)}">${esc(p.stem)}</div>
      <div class="pinyin">${pinyinOf(p.stem)}</div>
      ${elBadge(p.stemElement)}
      <div class="branch el-${esc(p.branchElement)}">${esc(p.branch)}</div>
      <div class="pinyin">${branchSub(p.branch)}</div>
      ${elBadge(p.branchElement)}
      <div class="hidden">${bi('藏干', 'Hidden')} ${p.hiddenStems.map((h) => `<b class="el-${esc(h.element)}">${esc(h.stem)}</b><small>(${bi(esc(h.tenGod), esc(TEN_GOD_EN[h.tenGod] || h.tenGod))})</small>`).join(' ')}</div>
    </div>`).join('');

  const bars = r.fiveElements.map((e) => `
    <div class="elem-bar">
      <span class="el-${esc(e.element)}">${esc(e.element)} <span class="en">${esc(e.elementEn)}</span></span>
      <div class="track"><div class="fill fill-${esc(e.element)}" style="width:${Math.min(e.percent * 2.2, 100)}%"></div></div>
      <span>${e.percent}%</span>
    </div>`).join('');

  const lp = r.luckPillars;
  const luckCards = lp.pillars.map((p) => `
    <div class="luck">
      <div class="age">${p.startAge}${bi('岁', ' y/o')}</div>
      <div class="gz"><span class="el-${esc(p.stemElement)}">${esc(p.stem)}</span><span class="el-${esc(p.branchElement)}">${esc(p.branch)}</span></div>
      <div class="luck-py">${pinyinOf(p.stem)} ${pinyinOf(p.branch)}</div>
      <div>${bi(esc(p.tenGod), esc(TEN_GOD_EN[p.tenGod] || p.tenGod))}</div>
      <div class="yrs">${p.startYear}–${p.endYear}</div>
    </div>`).join('');

  const sr = Number(r.strength.supportRatio);
  const srPct = Math.max(0, Math.min(1, isFinite(sr) ? sr : 0.5)) * 100;
  const polEn = r.dayMaster.polarity === '阳' ? 'Yang' : r.dayMaster.polarity === '阴' ? 'Yin' : '';
  const noteM = String(r.strength.note || '').match(/^([^A-Za-z]*)([\s\S]*)$/);
  const noteZh = noteM ? noteM[1].trim() : r.strength.note;
  const noteEn = noteM ? noteM[2].trim() : '';

  return `${solarNote(r)}
    <div class="pillars" translate="no">${pillarCards}</div>
    <div class="section-block">
      <h3>${bi('日主', 'Day Master')}</h3>
      <div class="dm-grid">
        <div class="dm-glyph el-${esc(r.dayMaster.element)}" translate="no">
          <div class="dm-stem">${esc(r.dayMaster.stem)}</div>
          <span class="el-badge el-${esc(r.dayMaster.element)}" data-el="${esc(r.dayMaster.element)}"><span class="en">${esc(r.dayMaster.elementEn)}</span></span>
          <div class="dm-polarity">${bi(`${esc(r.dayMaster.polarity)}${esc(r.dayMaster.element)}`, `${esc(polEn)} ${esc(r.dayMaster.elementEn)}`)}</div>
        </div>
        <div class="dm-detail">
          <div class="dm-strength">
            <div class="dm-strength-head">
              <span class="dm-verdict" translate="no">${bi(esc(r.strength.verdict), esc(r.strength.verdictEn))}</span>
              <span class="dm-ratio">${bi('支持率', 'Support ratio')} <b>${esc(r.strength.supportRatio)}</b></span>
            </div>
            <div class="dm-meter"><span class="dm-marker" style="left:${srPct.toFixed(1)}%"></span></div>
            <div class="dm-meter-scale"><span>${bi('弱', 'Weak')}</span><span>${bi('中和', 'Balanced')}</span><span>${bi('强', 'Strong')}</span></div>
          </div>
          <table class="kv">
            <tr><td>${bi('月令状态', 'Seasonal state')}</td><td><span translate="no">${bi(esc(r.strength.seasonalState), esc(SEASON_EN[r.strength.seasonalState] || r.strength.seasonalState))}</span></td></tr>
            <tr><td>${bi('取用提示', 'Guidance')}</td><td>${noteEn ? bi(esc(noteZh), esc(noteEn)) : esc(r.strength.note)}</td></tr>
          </table>
        </div>
      </div>
    </div>
    <div class="section-block"><h3>${bi('五行平衡', 'Five Elements Balance')}</h3><div class="elem-bars">${bars}</div></div>
    <div class="section-block">
      <h3>${bi('大运', '10-Year Luck Pillars')} · ${bi(esc(lp.direction), esc(lp.directionEn))} · ${bi(`起运 ${lp.startAge} 岁（参照节气 ${esc(lp.referenceTerm)}）`, `starts at age ${lp.startAge} (solar term ${esc(lp.referenceTerm)})`)}</h3>
      <div class="luck-row" translate="no">${luckCards}</div>
      <p class="hint">${bi('起运岁数按「3 日 = 1 年」由出生到节气的天数推算（节气取近似公式，误差 ≤1 天）。', 'Starting age uses the “3 days = 1 year” rule from birth to the solar term (approximate formula, ±1 day).')}</p>
    </div>`;
}

/* ---------------- Tab loading ---------------- */

const MODULE_NEEDS = {
  caiguan: ['birth'], hunlian: ['birth'], xingge: ['birth'],
  huaqizhen: ['birth'], yishenhuanjiang: ['birth'], xunshijieyun: ['birth'],
  event: ['event'], zhanduan: ['event', 'birth'], yaoce: ['birth', 'event'],
};

function tabHeading(tab) {
  const L = TAB_LABELS[tab];
  return `<h2 class="tab-h">${bi(L.zh, L.en)}</h2>
    <div class="tab-info"><span class="ti-icon">☯</span><p>${bi(TAB_INFO[tab].zh, TAB_INFO[tab].en)}</p></div>`;
}

function renderXunshi(r) {
  if (!r.data || !r.data.lessons?.length) return '';
  const rows = r.data.lessons.slice(0, 12).map((l) => `
    <tr class="${r.data.best && l.index === r.data.best.index ? 'best' : ''}">
      <td>${bi(`第${l.index}课`, `#${l.index}`)}</td>
      <td>${esc(l.ganzhi)} <small class="luck-py">${pinyinOf(l.ganzhi[0])} ${pinyinOf(l.ganzhi[1])}</small></td>
      <td>${l.liuhaiCount}</td>
    </tr>`).join('');
  return `<div class="section-block">
    <h3>${bi('最优时辰排行（六害越少越吉）', 'Top Time Windows (fewer harms = better)')}</h3>
    ${r.data.best ? `<p class="best-line">${bi('最优课', 'Best window')}: <b>${bi(`第${r.data.best.index}课`, `#${r.data.best.index}`)} ${esc(r.data.best.ganzhi)}</b>（${bi('六害', 'harms')} ${r.data.best.liuhaiCount}）</p>` : ''}
    <table class="lesson-table" translate="no"><tr><th>${bi('课', 'Lesson')}</th><th>${bi('干支', 'Ganzhi')}</th><th>${bi('六害数', 'Harms')}</th></tr>${rows}</table>
  </div>`;
}

async function loadTab(tab) {
  const body = $('#tab-body');
  const birth = getBirth();
  const eventTime = getEventTime();
  const needs = MODULE_NEEDS[tab] || (tab === 'bazi' || tab === 'plate' ? ['birth'] : []);

  if (needs.includes('birth') && !birth) {
    body.innerHTML = tabHeading(tab) + `<div class="error-box">${bi('请先填写出生日期与时间。', 'Please enter birth date and time first.')}</div>`;
    return;
  }
  if (needs.includes('event') && !eventTime) {
    body.innerHTML = tabHeading(tab) + `<div class="error-box">${bi('此模块需要事件时间，请在左侧「问事」面板填写。', 'This module needs an event date & time — see the “Event Question” panel.')}</div>`;
    return;
  }

  body.innerHTML = `<div class="loading">${bi('起局推演中', 'Computing')}</div>`;
  setStatus('');
  try {
    let html = tabHeading(tab);

    if (tab === 'bazi') {
      const r = await api('/api/bazi', { birth, gender: $('#gender').value, ...commonParams() });
      html += renderBazi(r);
    } else if (tab === 'plate') {
      const r = await api('/api/qimen/plate', { datetime: birth, type: 'birth', ...commonParams() });
      state.lastPlateId = r.plateId;
      html += solarNote(r) + plateMeta(r.plate) + renderPlateGrid(r.plate, r.plateId);
      if (eventTime) {
        const e = await api('/api/qimen/plate', { datetime: eventTime, type: 'event', ...commonParams() });
        html += `<h3 class="subplate-h">${bi('问事局', 'Event Plate')} · ${esc(eventTime)}</h3>` + plateMeta(e.plate) + renderPlateGrid(e.plate, e.plateId);
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
      if (tab === 'xunshijieyun') {
        html += renderXunshi(r);
        if (plate && r.plateId) html += plateMeta(plate) + renderPlateGrid(plate, r.plateId);
      } else {
        if (plate && r.plateId) html += plateMeta(plate) + renderPlateGrid(plate, r.plateId) + '<br>';
        html += formatReading(r.text);
      }
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = tabHeading(tab) + `<div class="error-box">${bi('分析失败', 'Analysis failed')}: ${esc(e.message)}</div>`;
  }
}

function activateTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  state.tab = tab;
  loadTab(tab);
}

/* ---------------- Home / module guide ---------------- */

function renderHome() {
  const cards = TABS.map((t) => `
    <div class="guide-card" data-tab="${t}" role="button" tabindex="0">
      <h4>${bi(TAB_LABELS[t].zh, TAB_LABELS[t].en)}</h4>
      <p>${bi(TAB_INFO[t].zh, TAB_INFO[t].en)}</p>
    </div>`).join('');
  $('#tab-body').innerHTML = `
    <h2 class="tab-h">${bi('模块指南', 'Module Guide')}</h2>
    <p class="guide-intro">${bi('填写左侧出生信息后，点击任意模块开始分析。八字与奇门共用同一套历法换算（置闰法 · 时家转盘奇门）。', 'Fill in your birth details on the left, then pick a module. BaZi and Qi Men share the same calendar engine (Zhi-Run hourly rotating plate).')}</p>
    <div class="guide-grid">${cards}</div>`;
}

/* ---------------- Init ---------------- */

function refreshOptionLabels() {
  const lang = document.body.dataset.lang;
  const qSel = $('#question');
  [...qSel.options].forEach((o) => {
    const en = QUESTION_EN[o.value] || o.value;
    o.textContent = lang === 'en' ? en : lang === 'zh' ? o.value : `${o.value} ${en}`;
  });
  const gender = { male: ['男', 'Male'], female: ['女', 'Female'] };
  [...$('#gender').options].forEach((o) => {
    const [zh, en] = gender[o.value];
    o.textContent = lang === 'en' ? en : lang === 'zh' ? zh : `${zh} ${en}`;
  });
  const tq = {
    'follow-tiannei': ['随天芮（默认）', 'Follow Tianrui (default)'],
    'jikun': ['寄坤二宫', 'Lodge in Kun 2'],
    'follow-zhifu': ['随值符', 'Follow the Chief'],
  };
  [...$('#tianqin').options].forEach((o) => {
    const [zh, en] = tq[o.value];
    o.textContent = lang === 'en' ? en : lang === 'zh' ? zh : `${zh} ${en}`;
  });
}

async function init() {
  // language: saved preference, else English
  let lang = 'en';
  try { lang = localStorage.getItem('qmsLang') || 'en'; } catch (_) { /* no storage */ }

  // build tabs
  $('#tabs').innerHTML = TABS.map((t) =>
    `<button data-tab="${t}">${bi(TAB_LABELS[t].zh, TAB_LABELS[t].en)}</button>`).join('');
  document.querySelectorAll('#tabs button').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

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
    setStatus(bi('本地推算模式', 'Local calculation mode'));
  } catch {
    setStatus(bi('无法连接后端 API', 'Backend unreachable'), true);
  }

  setLang(lang);

  for (const id of ['birth-date', 'birth-time', 'gender', 'event-date', 'event-time', 'question', 'topic', 'yixiang', 'longitude', 'tz-offset', 'tianqin']) {
    document.getElementById(id).addEventListener('change', () => loadTab(state.tab));
  }

  renderHome();
}

init();
