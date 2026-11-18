import { generateLevel } from './course.js';
import { LEVEL_SEEDS } from './level-seeds.js';

export const LEVEL_NAMES = [
  'First Flight', 'Easy Breeze', 'Stepping Stones', 'Little Leaps', 'Updraft',
  'Zig and Zag', 'Long Reach', 'High Wire', 'Skyline', 'Cloud Hopper',
  'Iron Curtain', 'Slipstream', 'The Gauntlet', 'Crosswind', 'Pinpoint',
  'Steel Garden', 'Tailspin', 'Thin Air', 'Overpass', 'Freefall',
  'Labyrinth', 'Storm Front', 'Needle Run', 'Jet Stream', 'Vertigo',
  'Razor Ridge', 'Stratosphere', 'No Mercy', 'Edge of the World', 'Skyhook',
];

export const LEVELS = LEVEL_NAMES.map((name, index) => ({
  id: `level-${index + 1}`,
  number: index + 1,
  index,
  name,
  seed: LEVEL_SEEDS[index],
}));

export function buildLevel(level) {
  return generateLevel(level.index, level.seed, LEVELS.length);
}
