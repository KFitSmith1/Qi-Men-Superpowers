'use strict';

/**
 * Qi Men Dun Jia engine wrapper.
 *
 * Wraps the vendored pure-Bash qmenpowers engine (engine/tools/bin/*.sh).
 * Every request runs in its own temp directory because the analysis
 * modules read/write CWD-relative JSON files (qmen_birth.json,
 * qmen_event.json, qmen_<module>.json).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ENGINE_BIN = path.resolve(__dirname, '..', '..', 'engine', 'tools', 'bin');
const ENGINE_ENV = { ...process.env, LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' };

const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const TIANQIN_MODES = new Set(['follow-tiannei', 'jikun', 'follow-zhifu']);

// In-memory plate cache so the frontend can ask follow-up questions
// (e.g. Wan Wu correspondences for a palace) without re-deriving the plate.
const plateCache = new Map();
const PLATE_CACHE_MAX = 200;

function cachePlate(plate) {
  const id = crypto.randomBytes(8).toString('hex');
  if (plateCache.size >= PLATE_CACHE_MAX) {
    const oldest = plateCache.keys().next().value;
    plateCache.delete(oldest);
  }
  plateCache.set(id, plate);
  return id;
}

function getCachedPlate(id) {
  return plateCache.get(id) || null;
}

function assertDatetime(dt, label) {
  if (typeof dt !== 'string' || !DATETIME_RE.test(dt)) {
    const err = new Error(`${label} must be formatted "YYYY-MM-DD HH:MM"`);
    err.status = 400;
    throw err;
  }
}

function run(script, args, cwd) {
  const bin = path.join(ENGINE_BIN, script);
  return new Promise((resolve, reject) => {
    execFile('bash', [bin, ...args], { cwd, env: ENGINE_ENV, maxBuffer: 16 * 1024 * 1024, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          const err = new Error(`${script} failed: ${(stderr || error.message).trim().slice(0, 500)}`);
          err.status = 500;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
  });
}

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qimen-'));
  try {
    return await fn(dir);
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

/**
 * Generate a plate (qiju). type: "birth" | "event".
 * Returns { plate, text, plateId }.
 */
async function generatePlate({ datetime, type = 'event', tianqin = 'follow-tiannei' }) {
  assertDatetime(datetime, 'datetime');
  if (!TIANQIN_MODES.has(tianqin)) {
    const err = new Error(`tianqin must be one of: ${[...TIANQIN_MODES].join(', ')}`);
    err.status = 400;
    throw err;
  }
  if (type !== 'birth' && type !== 'event') {
    const err = new Error('type must be "birth" or "event"');
    err.status = 400;
    throw err;
  }
  return withTempDir(async (dir) => {
    const out = path.join(dir, `qmen_${type}.json`);
    const { stdout } = await run('qimen_qiju.sh',
      [`--type=${type}`, `--tianqin=${tianqin}`, `--output=${out}`, datetime], dir);
    const plate = await readJson(out);
    return { plate, text: stdout, plateId: cachePlate(plate) };
  });
}

/** Write a plate JSON into dir under the conventional name. */
async function writePlate(dir, type, plate) {
  await fsp.writeFile(path.join(dir, `qmen_${type}.json`), JSON.stringify(plate, null, 2), 'utf8');
}

async function makeBirthPlate(dir, birth, tianqin) {
  assertDatetime(birth, 'birth');
  await run('qimen_qiju.sh',
    ['--type=birth', `--tianqin=${tianqin || 'follow-tiannei'}`,
     `--output=${path.join(dir, 'qmen_birth.json')}`, birth], dir);
}

async function makeEventPlate(dir, eventTime, tianqin) {
  assertDatetime(eventTime, 'eventTime');
  await run('qimen_qiju.sh',
    ['--type=event', `--tianqin=${tianqin || 'follow-tiannei'}`,
     `--output=${path.join(dir, 'qmen_event.json')}`, eventTime], dir);
}

const EVENT_QUESTIONS = ['事业', '求财', '婚姻感情', '疾病健康', '出行', '官司诉讼', '寻人寻物', '天气', '家宅风水'];

/**
 * Module registry. Each entry declares which plates it needs, how to build
 * its CLI args, and which JSON file it writes.
 */
const MODULES = {
  caiguan: {
    script: 'qimen_caiguan.sh', needs: ['birth'], output: 'qmen_caiguan.json',
    args: () => [],
  },
  hunlian: {
    script: 'qimen_hunlian.sh', needs: ['birth'], output: 'qmen_hunlian.json',
    args: () => [],
  },
  xingge: {
    script: 'qimen_xingge.sh', needs: ['birth'], output: 'qmen_xingge.json',
    args: () => [],
  },
  huaqizhen: {
    script: 'qimen_huaqizhen.sh', needs: ['birth'], output: 'qmen_huaqizhen.json',
    args: (o) => {
      const a = [];
      if (o.yixiang) a.push(`--yixiang=${o.yixiang}`);
      if (o.familyStems) a.push(`--family-stems=${o.familyStems}`);
      return a;
    },
  },
  yishenhuanjiang: {
    script: 'qimen_yishenhuanjiang.sh', needs: ['birth'], output: 'qmen_yishenhuanjiang.json',
    args: () => [],
  },
  event: {
    script: 'qimen_event.sh', needs: ['event'], output: 'qmen_event_analysis.json',
    args: (o) => {
      if (!o.question || !EVENT_QUESTIONS.includes(o.question)) {
        const err = new Error(`question must be one of: ${EVENT_QUESTIONS.join(', ')}`);
        err.status = 400;
        throw err;
      }
      return [`--question=${o.question}`];
    },
  },
  zhanduan: {
    script: 'qimen_zhanduan.sh', needs: ['event', 'birth'], output: 'qmen_zhanduan.json',
    args: (o) => (o.topic ? [`--topic=${o.topic}`] : []),
  },
  yaoce: {
    script: 'qimen_yaoce.sh', needs: ['birth', 'event'], output: 'qmen_yaoce.json',
    args: (o) => (o.yixiang ? [`--yixiang=${o.yixiang}`] : []),
  },
  xunshijieyun: {
    script: 'qimen_xunshijieyun.sh', needs: ['birth'], output: null,
    args: (o) => (o.yixiang ? [`--yixiang=${o.yixiang}`] : []),
  },
};

/** Parse the 60-lesson ranking table that xunshijieyun prints to stdout. */
function parseXunshiRanking(stdout) {
  const rows = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\d{1,2})\s+([一-鿿]{2})\s+(\d+)\s*(?:←.*)?$/);
    if (m) rows.push({ index: Number(m[1]), ganzhi: m[2], liuhaiCount: Number(m[3]) });
  }
  const best = stdout.match(/最优课:\s*第(\d+)课\s*\(([一-鿿]{2})\)\s*六害总数=(\d+)/);
  return {
    lessons: rows.sort((a, b) => a.liuhaiCount - b.liuhaiCount || a.index - b.index),
    best: best ? { index: Number(best[1]), ganzhi: best[2], liuhaiCount: Number(best[3]) } : null,
  };
}

/**
 * Run an analysis module.
 * opts: { module, birth?, eventTime?, question?, topic?, yixiang?, familyStems?, tianqin? }
 * Returns { module, text, data, birthPlate?, eventPlate?, plateId? }
 */
async function runModule(opts) {
  const def = MODULES[opts.module];
  if (!def) {
    const err = new Error(`unknown module "${opts.module}"; valid: ${Object.keys(MODULES).join(', ')}`);
    err.status = 400;
    throw err;
  }
  const args = def.args(opts);

  return withTempDir(async (dir) => {
    const result = { module: opts.module };

    if (def.needs.includes('birth')) {
      if (opts.birthPlate) await writePlate(dir, 'birth', opts.birthPlate);
      else await makeBirthPlate(dir, opts.birth, opts.tianqin);
      result.birthPlate = await readJson(path.join(dir, 'qmen_birth.json'));
    }
    if (def.needs.includes('event')) {
      if (opts.eventPlate) await writePlate(dir, 'event', opts.eventPlate);
      else await makeEventPlate(dir, opts.eventTime, opts.tianqin);
      result.eventPlate = await readJson(path.join(dir, 'qmen_event.json'));
    }

    const { stdout } = await run(def.script, args, dir);
    result.text = stdout;

    if (def.output) {
      try {
        result.data = await readJson(path.join(dir, def.output));
      } catch {
        result.data = null;
      }
    } else if (opts.module === 'xunshijieyun') {
      result.data = parseXunshiRanking(stdout);
    }

    const mainPlate = result.eventPlate || result.birthPlate;
    if (mainPlate) result.plateId = cachePlate(mainPlate);
    return result;
  });
}

/**
 * Wan Wu correspondences for a palace of a cached plate, or for manually
 * specified symbols.
 * opts: { plateId?, palace?, stem?, star?, gate?, deity?, branch? }
 */
async function runWanwu(opts) {
  return withTempDir(async (dir) => {
    const args = [];
    if (opts.plateId != null && opts.palace != null) {
      const plate = getCachedPlate(opts.plateId);
      if (!plate) {
        const err = new Error('plateId not found or expired; regenerate the plate');
        err.status = 404;
        throw err;
      }
      const p = Number(opts.palace);
      if (!Number.isInteger(p) || p < 1 || p > 9) {
        const err = new Error('palace must be an integer 1-9');
        err.status = 400;
        throw err;
      }
      const file = path.join(dir, 'plate.json');
      await fsp.writeFile(file, JSON.stringify(plate, null, 2), 'utf8');
      args.push(`--input=${file}`, `--palace=${p}`);
    } else {
      for (const [key, flag] of [['stem', '--stem'], ['star', '--star'], ['gate', '--gate'], ['deity', '--deity'], ['state', '--state']]) {
        if (opts[key]) args.push(`${flag}=${opts[key]}`);
      }
      if (args.length === 0) {
        const err = new Error('provide plateId+palace, or at least one of stem/star/gate/deity/state');
        err.status = 400;
        throw err;
      }
    }
    const { stdout } = await run('qimen_wanwu.sh', args, dir);
    let data = null;
    try {
      data = await readJson(path.join(dir, 'qmen_wanwu.json'));
    } catch { /* text-only output */ }
    return { text: stdout, data };
  });
}

module.exports = {
  generatePlate,
  runModule,
  runWanwu,
  getCachedPlate,
  EVENT_QUESTIONS,
  MODULES: Object.keys(MODULES),
};
