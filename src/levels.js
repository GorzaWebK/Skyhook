import { generateLevel } from './course.js';
import { LEVEL_SEEDS, LEVEL_PAR } from './level-seeds.js';

export const LEVEL_NAMES = [
  'First Flight', 'Easy Breeze', 'Stepping Stones', 'Little Leaps', 'Updraft',
  'Zig and Zag', 'Long Reach', 'High Wire', 'Skyline', 'Cloud Hopper',
  'Iron Curtain', 'Slipstream', 'The Gauntlet', 'Crosswind', 'Pinpoint',
  'Steel Garden', 'Tailspin', 'Thin Air', 'Overpass', 'Freefall',
  'Labyrinth', 'Storm Front', 'Needle Run', 'Jet Stream', 'Vertigo',
  'Razor Ridge', 'Stratosphere', 'No Mercy', 'Edge of the World', 'Skyhook',
];

// Medal target times: gold is the autopilot's time, silver 30% slower,
// bronze 75% slower, each rounded up to the next half second.
export const MEDALS = ['gold', 'silver', 'bronze'];
const ceilHalf = (t) => Math.ceil(t * 2) / 2;

export function medalTimes(par) {
  return { gold: ceilHalf(par), silver: ceilHalf(par * 1.3), bronze: ceilHalf(par * 1.75) };
}

// Best medal for a time on a level ('gold' | 'silver' | 'bronze' | null).
export function medalFor(level, time) {
  if (time == null || !level.medals) return null;
  return MEDALS.find((m) => time <= level.medals[m]) ?? null;
}

// The next medal to aim for given a best time (null if gold already).
export function nextMedal(level, time) {
  const have = medalFor(level, time);
  const i = have ? MEDALS.indexOf(have) : MEDALS.length;
  return i > 0 ? MEDALS[i - 1] : null;
}

export const LEVELS = LEVEL_NAMES.map((name, index) => ({
  id: `level-${index + 1}`,
  number: index + 1,
  index,
  name,
  seed: LEVEL_SEEDS[index],
  medals: medalTimes(LEVEL_PAR[index]),
}));

export function buildLevel(level) {
  return generateLevel(level.index, level.seed, LEVELS.length);
}
