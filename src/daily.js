import { DAILY_START, DAILY } from './daily-seeds.js';
import { generateLevel } from './course.js';
import { medalTimes } from './levels.js';
import { THEME_IDS } from './themes.js';

// The daily challenge: one level per day (UTC), the same for everyone.

const DAY_MS = 24 * 60 * 60 * 1000;

export function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

function dayNumber(key) {
  return Math.floor((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${DAILY_START}T00:00:00Z`)) / DAY_MS);
}

// The daily challenge for a date (defaults to today).
export function dailyFor(key = dateKey()) {
  const day = dayNumber(key);
  const [index, seed, par] = DAILY[((day % DAILY.length) + DAILY.length) % DAILY.length];
  return {
    id: `daily-${key}`,
    daily: true,
    date: key,
    number: day + 1,
    index: -1,
    difficulty: index,
    seed,
    name: `Daily #${day + 1}`,
    medals: medalTimes(par),
    theme: THEME_IDS[((day % 4) + 4) % 4], // day, sunset, night, storm in turn
  };
}

export function buildDaily(def) {
  const course = generateLevel(def.difficulty, def.seed, 30);
  course.theme = def.theme;
  return course;
}

// Time until the next daily, as "5h 12m".
export function timeUntilNext(now = new Date()) {
  const next = Date.parse(`${dateKey(now)}T00:00:00Z`) + DAY_MS;
  const mins = Math.max(0, Math.ceil((next - now.getTime()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Consecutive days finished, counting back from today (or yesterday, if
// today isn't done yet). doneDates: array of YYYY-MM-DD strings.
export function dailyStreak(doneDates, today = dateKey()) {
  const done = new Set(doneDates);
  let d = Date.parse(`${today}T00:00:00Z`);
  if (!done.has(today)) d -= DAY_MS;
  let streak = 0;
  while (done.has(new Date(d).toISOString().slice(0, 10))) {
    streak++;
    d -= DAY_MS;
  }
  return streak;
}
