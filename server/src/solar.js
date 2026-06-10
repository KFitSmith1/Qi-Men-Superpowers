'use strict';

/**
 * Solar utilities:
 *  - True solar time correction (longitude offset + equation of time),
 *    mirroring engine/tools/bin/qimen_zhentaiyangshi.sh so the server can
 *    correct clock time before plate generation.
 *  - Approximate Jie (节) solar-term dates used to find the BaZi luck-pillar
 *    starting age. The century-constant approximation is accurate to ±1 day
 *    for 1901-2100, which shifts the start age by at most ~4 months.
 */

/** Equation of time in minutes for a given date (NOAA-style approximation). */
function equationOfTime(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000);
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * Convert clock time to true solar time.
 * @param {string} datetime "YYYY-MM-DD HH:MM" local clock time
 * @param {number} longitude degrees, east positive
 * @param {number} tzOffset hours from UTC of the clock (default 8, CST)
 * @returns {{datetime: string, offsetMinutes: number}}
 */
function trueSolarTime(datetime, longitude, tzOffset = 8) {
  const m = datetime.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) throw new Error('datetime must be "YYYY-MM-DD HH:MM"');
  const [, Y, Mo, D, H, Mi] = m.map(Number);
  const longitudeCorrection = 4 * (longitude - 15 * tzOffset); // minutes
  const eot = equationOfTime(new Date(Date.UTC(Y, Mo - 1, D)));
  const offsetMinutes = Math.round(longitudeCorrection + eot);
  const t = new Date(Date.UTC(Y, Mo - 1, D, H, Mi + offsetMinutes));
  const pad = (n) => String(n).padStart(2, '0');
  return {
    datetime: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
    offsetMinutes,
  };
}

// Century constants for the 12 Jie (节, month-boundary solar terms).
// [month, C for 1901-2000, C for 2001-2100]
const JIE_TABLE = [
  ['小寒', 1, 6.11, 5.4055],
  ['立春', 2, 4.6295, 3.87],
  ['惊蛰', 3, 6.318, 5.63],
  ['清明', 4, 5.59, 4.81],
  ['立夏', 5, 6.318, 5.52],
  ['芒种', 6, 6.5, 5.678],
  ['小暑', 7, 7.928, 7.108],
  ['立秋', 8, 8.35, 7.5],
  ['白露', 9, 8.44, 7.646],
  ['寒露', 10, 9.098, 8.318],
  ['立冬', 11, 8.218, 7.438],
  ['大雪', 12, 7.9, 7.18],
];

/** Approximate date of a Jie term. Returns a Date (UTC midnight). */
function jieDate(year, idx) {
  const [, month, c1900, c2000] = JIE_TABLE[idx];
  const C = year >= 2001 ? c2000 : c1900;
  const y = year % 100;
  const leapAdjust = month <= 2 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
  const day = Math.floor(y * 0.2422 + C) - leapAdjust;
  return new Date(Date.UTC(year, month - 1, day));
}

/** All Jie dates surrounding a moment, sorted ascending. */
function jieAround(date) {
  const terms = [];
  for (const year of [date.getUTCFullYear() - 1, date.getUTCFullYear(), date.getUTCFullYear() + 1]) {
    for (let i = 0; i < 12; i++) {
      terms.push({ name: JIE_TABLE[i][0], date: jieDate(year, i) });
    }
  }
  return terms.sort((a, b) => a.date - b.date);
}

/**
 * Days from birth to the next Jie (forward) or since the previous Jie
 * (backward). Used for the luck-pillar starting age (3 days = 1 year).
 */
function daysToJie(birthDate, forward) {
  const terms = jieAround(birthDate);
  if (forward) {
    const next = terms.find((t) => t.date > birthDate);
    return { days: (next.date - birthDate) / 86400000, term: next.name };
  }
  const prev = [...terms].reverse().find((t) => t.date <= birthDate);
  return { days: (birthDate - prev.date) / 86400000, term: prev.name };
}

module.exports = { trueSolarTime, daysToJie, equationOfTime };
