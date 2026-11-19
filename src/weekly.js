import { WEEKLY_START, WEEKLY } from './weekly-seeds.js';
import { generateStormLevel } from './course.js';
import { medalTimes } from './levels.js';

// The weekly tournament: one storm level per week (Monday-Sunday, UTC).
// The top 3 when the week ends earn a trophy.

const DAY_MS = 24 * 60 * 60 * 1000;
const startMs = Date.parse(`${WEEKLY_START}T00:00:00Z`);

export function weekNumber(d = new Date()) {
  return Math.floor((d.getTime() - startMs) / (7 * DAY_MS));
}

// "2026-W47" style id from the week's Monday.
export function weekKey(n) {
  const monday = new Date(startMs + n * 7 * DAY_MS);
  const thursday = new Date(monday.getTime() + 3 * DAY_MS); // ISO week belongs to its Thursday's year
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / (7 * DAY_MS)) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weeklyFor(n = weekNumber()) {
  const [storm, seed, par] = WEEKLY[((n % WEEKLY.length) + WEEKLY.length) % WEEKLY.length];
  const key = weekKey(n);
  return {
    id: `weekly-${key}`,
    weekly: true,
    week: key,
    weekNum: n,
    number: n + 1,
    index: -1,
    storm,
    seed,
    name: `Weekly #${n + 1}`,
    medals: medalTimes(par),
    theme: 'storm',
  };
}

export function buildWeekly(def) {
  return generateStormLevel(def.storm, def.seed);
}

// Time left this week, as "3d 4h" or "5h 12m".
export function timeUntilWeekEnd(now = new Date()) {
  const end = startMs + (weekNumber(now) + 1) * 7 * DAY_MS;
  const mins = Math.max(0, Math.ceil((end - now.getTime()) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${mins % 60}m`;
}
