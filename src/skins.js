import { ACHIEVEMENTS } from './achievements.js';

// Gun skins: colour sets for the grapple gun, unlocked by progress.
// body = main casing, dark = grip/barrel/back, accent = top rail and claw tip,
// glow = the spool ring.
export const SKINS = [
  { id: 'standard', name: 'Standard', colors: { body: '#7a8496', dark: '#363c48', accent: '#ff8a3d', glow: '#5ff0ff' }, req: { type: 'free' } },
  { id: 'rookie', name: 'Rookie Teal', colors: { body: '#5f9089', dark: '#24403e', accent: '#eafaf6', glow: '#7dffcf' }, req: { type: 'tutorial' } },
  { id: 'bronze', name: 'Bronze Age', colors: { body: '#a06d43', dark: '#40291a', accent: '#f0b47a', glow: '#ffb36b' }, req: { type: 'medals', tier: 'bronze', count: 5 } },
  { id: 'crimson', name: 'Crimson', colors: { body: '#9a2c37', dark: '#2c1015', accent: '#f4f4f4', glow: '#ff4a5a' }, req: { type: 'medals', tier: 'bronze', count: 15 } },
  { id: 'cobalt', name: 'Cobalt', colors: { body: '#3261c9', dark: '#15213f', accent: '#ffd36b', glow: '#6fb2ff' }, req: { type: 'medals', tier: 'silver', count: 5 } },
  { id: 'toxic', name: 'Toxic', colors: { body: '#46552f', dark: '#1b2113', accent: '#b6ff3d', glow: '#b6ff3d' }, req: { type: 'medals', tier: 'silver', count: 15 } },
  { id: 'architect', name: 'Architect', colors: { body: '#e6e2d6', dark: '#56606e', accent: '#3d8bff', glow: '#3dd5ff' }, req: { type: 'editor' } },
  { id: 'gilded', name: 'Gilded', colors: { body: '#d9a521', dark: '#3b2b06', accent: '#fff1b8', glow: '#ffe066' }, req: { type: 'medals', tier: 'gold', count: 10 } },
  { id: 'dawn', name: 'Daybreak', colors: { body: '#ff9d6b', dark: '#3d2238', accent: '#ffe08a', glow: '#ff7ab8' }, req: { type: 'achievement', id: 'week-warrior' } },
  { id: 'spectre', name: 'Spectre', colors: { body: '#cfe8ee', dark: '#38515a', accent: '#ffffff', glow: '#8ff7ff' }, req: { type: 'achievement', id: 'ghostbuster' } },
  { id: 'voyager', name: 'Voyager', colors: { body: '#2f6b5a', dark: '#14261f', accent: '#f2d27a', glow: '#62ffc8' }, req: { type: 'achievement', id: 'km-10' } },
  { id: 'champion', name: 'Champion', colors: { body: '#1a1a1f', dark: '#0b0b0d', accent: '#ffc928', glow: '#ffc928' }, req: { type: 'achievement', id: 'world-record' } },
  { id: 'phantom', name: 'Phantom Chrome', colors: { body: '#d3dbe6', dark: '#11141a', accent: '#c78bff', glow: '#c78bff' }, req: { type: 'medals', tier: 'gold', count: 40 } },
];

const TIER_WORD = { bronze: 'medals', silver: 'silver or better medals', gold: 'gold medals' };

// stats: { medals: { gold, silver, bronze }, tutorialDone, editorFinished, achieved }
// (silver counts golds too, bronze counts every medal.)
export function isSkinUnlocked(skin, stats) {
  const r = skin.req;
  if (r.type === 'free') return true;
  if (r.type === 'tutorial') return !!stats.tutorialDone;
  if (r.type === 'editor') return !!stats.editorFinished;
  if (r.type === 'achievement') return !!stats.achieved?.[r.id];
  return stats.medals[r.tier] >= r.count;
}

export function skinRequirement(skin, stats) {
  const r = skin.req;
  if (r.type === 'free') return 'Always available';
  if (r.type === 'tutorial') return 'Finish the tutorial';
  if (r.type === 'editor') return 'Finish a level you built in the editor';
  if (r.type === 'achievement') return `Achievement: ${achievementName(r.id)}`;
  return `Earn ${r.count} ${TIER_WORD[r.tier]} (${Math.min(r.count, stats.medals[r.tier])} / ${r.count})`;
}

export function achievementName(id) {
  return ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id;
}

export function getSkin(id) {
  return SKINS.find((s) => s.id === id) || SKINS[0];
}
