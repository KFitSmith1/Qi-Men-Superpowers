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
const elLabel = (el) => el ? `<span class="el-label el-${esc(el)}">${esc(el)} ${esc(EL_EN[el] || '')}</span>` : '';

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

function rawJsonBlock(data) {
  if (data == null) return '';
  return `<details class="raw-json"><summary>原始 JSON · Raw structured data</summary><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`;
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

  return `<div class="grid9" data-plate-id="${esc(plateId || '')}">${cells}</div>
  <div class="legend">
    <span>◆ 金框 = 值符宫 zhifu</span><span>◆ 蓝框 = 值使宫 zhishi</span>
    <span>右列大字 = 天盘干/地盘干 heaven & earth stems</span>
    <span>点击宫位查看万物类象 click a palace for correspondences</span>
  </div>`;
}

function plateMeta(plate) {
  const sz = plate.si_zhu;
  return `<div class="plate-meta">
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
    $('#modal-body').innerHTML = `<div class="module-text">${esc(r.text)}</div>${rawJsonBlock(r.data)}`;
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
      ${elLabel(p.stemElement)}
      <div class="branch el-${esc(p.branchElement)}">${esc(p.branch)}</div>
      ${elLabel(p.branchElement)}
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
      <div>${esc(p.tenGod)}</div>
      <div class="yrs">${p.startYear}–${p.endYear}</div>
    </div>`).join('');

  const ext = r.external
    ? (r.external.error
      ? `<p class="hint">Astrology-API.io: ${esc(r.external.error)}</p>`
      : `<div class="section-block"><h3>Astrology-API.io 精算 Precision Data</h3>${rawJsonBlock(r.external)}</div>`)
    : '<p class="hint">配置 ASTROLOGY_API_KEY 可启用 Astrology-API.io 高精度核验。Set ASTROLOGY_API_KEY to enable the precision API.</p>';

  return `${solarNote(r)}
    <div class="pillars">${pillarCards}</div>
    <div class="section-block">
      <h3>日主 Day Master · ${esc(r.dayMaster.stem)} ${esc(r.dayMaster.polarity)}${esc(r.dayMaster.element)} (${esc(r.dayMaster.elementEn)})</h3>
      <table class="kv">
        <tr><td>月令状态 Seasonal state</td><td>${esc(r.strength.seasonalState)}</td></tr>
        <tr><td>强弱 Strength</td><td>${esc(r.strength.verdict)} (${esc(r.strength.verdictEn)}) — support ratio ${r.strength.supportRatio}</td></tr>
        <tr><td>取用提示 Guidance</td><td>${esc(r.strength.note)}</td></tr>
      </table>
    </div>
    <div class="section-block"><h3>五行平衡 Five Elements Balance</h3><div class="elem-bars">${bars}</div></div>
    <div class="section-block">
      <h3>大运 10-Year Luck Pillars · ${esc(lp.direction)} (${esc(lp.directionEn)}) · 起运 ${lp.startAge} 岁（参照节气 ${esc(lp.referenceTerm)}）</h3>
      <div class="luck-row">${luckCards}</div>
      <p class="hint">起运岁数按「3 日 = 1 年」由出生到节气的天数推算（节气取近似公式，误差 ≤1 天）。</p>
    </div>
    ${ext}
    ${rawJsonBlock(r)}`;
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
    <table class="lesson-table"><tr><th>课 Lesson</th><th>干支 Ganzhi</th><th>六害数 Harm count</th></tr>${rows}</table>
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
      html += `<div class="module-text">${esc(r.text)}</div>${rawJsonBlock(r.data)}`;
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
