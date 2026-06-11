/**
 * Natural Time engine for ZeppOS.
 *
 * Dependency-free port of sylvain441/natural-time-js (CC0).
 * The only external dependency of the original library was astronomy-engine,
 * used solely to locate the December solstice that opens each natural year.
 * Here that lookup is replaced by a precomputed solstice table, so the engine
 * is pure arithmetic and runs anywhere.
 *
 * Output has been validated to be byte-identical to natural-time-js v1.x
 * (precision = 0, i.e. integer NT zones) across multiple dates/longitudes.
 */

const MS_PER_DAY = 86400000;

// Natural year 1 corresponds to the Gregorian solstice of December 2012.
const NT_YEAR_ONE_GREGORIAN = 2012;

/**
 * "New year" instant for each Gregorian year: the December-solstice day at
 * noon UTC, day-corrected exactly like natural-time-js (if the solstice falls
 * at or after 12:00 UTC, the natural year opens the next day).
 *
 * Values were generated from astronomy-engine ground truth. Note that the
 * 2012 entry equals END_OF_ARTIFICIAL_TIME (1356091200000) by definition.
 *
 * To extend coverage beyond 2055, append more entries computed the same way.
 */
const SOLSTICE = {
  2012: 1356091200000, 2013: 1387713600000, 2014: 1419249600000, 2015: 1450785600000,
  2016: 1482321600000, 2017: 1513944000000, 2018: 1545480000000, 2019: 1577016000000,
  2020: 1608552000000, 2021: 1640174400000, 2022: 1671710400000, 2023: 1703246400000,
  2024: 1734782400000, 2025: 1766404800000, 2026: 1797940800000, 2027: 1829476800000,
  2028: 1861012800000, 2029: 1892635200000, 2030: 1924171200000, 2031: 1955707200000,
  2032: 1987243200000, 2033: 2018865600000, 2034: 2050401600000, 2035: 2081937600000,
  2036: 2113473600000, 2037: 2145096000000, 2038: 2176632000000, 2039: 2208168000000,
  2040: 2239704000000, 2041: 2271326400000, 2042: 2302862400000, 2043: 2334398400000,
  2044: 2365934400000, 2045: 2397470400000, 2046: 2429092800000, 2047: 2460628800000,
  2048: 2492164800000, 2049: 2523700800000, 2050: 2555323200000, 2051: 2586859200000,
  2052: 2618395200000, 2053: 2649931200000, 2054: 2681553600000, 2055: 2713089600000,
};

/**
 * Builds the year context (local year start + duration in days) for the
 * natural year that opens at the given Gregorian year's December solstice.
 * The start is shifted by longitude: 360 degrees of longitude == one full day.
 */
function yearContext(gregorianYear, longitude) {
  const start = SOLSTICE[gregorianYear];
  const end = SOLSTICE[gregorianYear + 1];
  return {
    gregorianYear,
    start: start + (-longitude + 180) * MS_PER_DAY / 360,
    duration: (end - start) / MS_PER_DAY, // 365 or 366
  };
}

/**
 * Converts a UTC unix timestamp (ms) and a longitude into natural time.
 *
 * @param {number} unixMs    UTC epoch milliseconds (e.g. Date.now()).
 * @param {number} longitude Longitude in degrees, -180..+180.
 * @returns {object} Natural date fields:
 *   { year, moon, week, weekOfMoon, dayOfYear, dayOfMoon, dayOfWeek,
 *     time, isRainbow, yearDuration, effectiveLongitude }
 *   `time` is the day position in natural degrees, 0..360.
 */
export function computeNaturalDate(unixMs, longitude) {
  const lon = longitude || 0;

  // precision = 0: longitude is truncated toward zero to the nearest NT zone.
  const effLon = Math.trunc(lon);

  // The solstice that opens the current natural year is usually the previous
  // Gregorian year's; correct forward if we are already past the year end.
  const gYear = new Date(unixMs).getUTCFullYear();
  let ctx = yearContext(gYear - 1, effLon);
  if (unixMs - ctx.start >= ctx.duration * MS_PER_DAY) {
    ctx = yearContext(gYear, effLon);
  }

  const daysSinceYearStart = (unixMs - ctx.start) / MS_PER_DAY;
  const wholeDays = Math.floor(daysSinceYearStart);
  const dayOfYear = wholeDays + 1;

  // Nadir = local midnight that opened the current natural day.
  const nadir = ctx.start + wholeDays * MS_PER_DAY;

  return {
    year: ctx.gregorianYear - NT_YEAR_ONE_GREGORIAN + 1,
    moon: Math.floor(daysSinceYearStart / 28) + 1,
    week: Math.floor(daysSinceYearStart / 7) + 1,
    weekOfMoon: (Math.floor(daysSinceYearStart / 7) % 4) + 1,
    dayOfYear,
    dayOfMoon: (wholeDays % 28) + 1,
    dayOfWeek: (wholeDays % 7) + 1,
    time: (unixMs - nadir) * 360 / MS_PER_DAY,
    isRainbow: dayOfYear > 13 * 28, // days 365/366 are "out of time"
    yearDuration: ctx.duration,
    effectiveLongitude: effLon,
  };
}

/** Pads a non-negative integer with leading zeros to `len` characters. */
function pad(n, len) {
  let s = String(n);
  while (s.length < len) s = '0' + s;
  return s;
}

/** "014)06)28", or "014)RAINBOW" / "014)RAINBOW+" on rainbow days. */
export function formatDate(nd) {
  const year = pad(Math.abs(nd.year), 3);
  const sign = nd.year < 0 ? '-' : '';
  if (nd.isRainbow) {
    return `${sign}${year})RAINBOW${nd.dayOfYear === 366 ? '+' : ''}`;
  }
  return `${sign}${year})${pad(nd.moon, 2)})${pad(nd.dayOfMoon, 2)}`;
}

/** Integer-degree time label, e.g. "226°". */
export function formatTime(nd) {
  let deg = Math.floor(nd.time);
  if (deg >= 360) deg = 0;
  return `${pad(deg, 3)}°`;
}

/** "NTZ" near the prime meridian, otherwise "NT+9" / "NT-120". */
export function formatLongitude(lon) {
  if (Math.abs(lon) < 1) return 'NTZ';
  const sign = lon >= 0 ? '+' : '-';
  return `NT${sign}${Math.trunc(Math.abs(lon))}`;
}

// Suggested rainbow colors for the 7 week days (from the natural-time spec).
export const WEEKDAY_COLORS = [
  0xd74d40, // 1 red
  0xeaa945, // 2 orange
  0xdfdd45, // 3 yellow
  0x7fc663, // 4 green
  0x49a2f0, // 5 blue
  0x443cea, // 6 indigo
  0x8047eb, // 7 violet
];