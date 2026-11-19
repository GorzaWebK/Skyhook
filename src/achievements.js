// Achievements. Each has a check(c) that returns true once earned, and
// optionally progress(c) -> [current, target] for a progress bar.
//
// c = {
//   stats, medals: { gold, silver, bronze }, progress, finished: Set of level
//   ids with a best time, run: facts about the run that just finished (or
//   null), flags: one-off events ({ published, worldRecord, beatGhost })
// }

const finishedRange = (c, from, to) => {
  let n = 0;
  for (let i = from; i <= to; i++) if (c.finished.has(`level-${i}`)) n++;
  return n;
};

const run = (c, test) => !!c.run && test(c.run);

export const ACHIEVEMENTS = [
  // Getting started
  { id: 'first-swing', icon: '🪝', name: 'First Swing', desc: 'Land your first hook.', check: (c) => c.stats.hooksLanded >= 1 },
  { id: 'graduate', icon: '🎓', name: 'Graduate', desc: 'Finish the tutorial.', check: (c) => !!c.progress.tutorialDone },
  { id: 'off-ground', icon: '🛫', name: 'Off the Ground', desc: 'Finish Level 1.', check: (c) => c.finished.has('level-1') },
  // Level sets
  { id: 'daylight', icon: '☀️', name: 'Daylight', desc: 'Finish all daytime levels (1–10).', check: (c) => finishedRange(c, 1, 10) === 10, progress: (c) => [finishedRange(c, 1, 10), 10] },
  { id: 'golden-hour', icon: '🌇', name: 'Golden Hour', desc: 'Finish all sunset levels (11–20).', check: (c) => finishedRange(c, 11, 20) === 10, progress: (c) => [finishedRange(c, 11, 20), 10] },
  { id: 'night-owl', icon: '🌙', name: 'Night Owl', desc: 'Finish all night levels (21–30).', check: (c) => finishedRange(c, 21, 30) === 10, progress: (c) => [finishedRange(c, 21, 30), 10] },
  { id: 'moving-target', icon: '🎯', name: 'Moving Target', desc: 'Finish a level with moving anchors (level 16 or later).', check: (c) => run(c, (r) => r.levelNumber >= 16) },
  // Medals
  { id: 'gold-rush', icon: '🥇', name: 'Gold Rush', desc: 'Win your first gold medal.', check: (c) => c.medals.gold >= 1 },
  { id: 'bronze-10', icon: '🥉', name: 'Collector', desc: 'Win 10 medals.', check: (c) => c.medals.bronze >= 10, progress: (c) => [c.medals.bronze, 10] },
  { id: 'silver-10', icon: '🥈', name: 'Silver Lining', desc: 'Win 10 silver-or-better medals.', check: (c) => c.medals.silver >= 10, progress: (c) => [c.medals.silver, 10] },
  { id: 'gold-10', icon: '👑', name: 'Midas', desc: 'Win 10 gold medals.', check: (c) => c.medals.gold >= 10, progress: (c) => [c.medals.gold, 10] },
  { id: 'gold-all', icon: '💎', name: 'Perfectionist', desc: 'Win gold on all 30 levels.', check: (c) => c.medals.gold >= 30, progress: (c) => [c.medals.gold, 30] },
  // Skill
  { id: 'sure-footed', icon: '🦶', name: 'Sure-Footed', desc: 'Finish level 5 or later without falling or going back to a checkpoint.', check: (c) => run(c, (r) => r.levelNumber >= 5 && r.falls === 0 && r.retries === 0) },
  { id: 'hands-off', icon: '🙌', name: 'Hands Off', desc: 'Finish level 3 or later without reeling in.', check: (c) => run(c, (r) => r.levelNumber >= 3 && !r.reeled) },
  { id: 'minimalist', icon: '✂️', name: 'Minimalist', desc: 'Finish level 5 or later using 8 hooks or fewer.', check: (c) => run(c, (r) => r.levelNumber >= 5 && r.hooks <= 8) },
  { id: 'ghostbuster', icon: '👻', name: 'Ghostbuster', desc: 'Beat your own ghost.', check: (c) => !!c.flags.beatGhost },
  { id: 'speed-50', icon: '💨', name: 'Speed Demon', desc: 'Reach 50 m/s.', check: (c) => c.stats.topSpeed >= 50, progress: (c) => [Math.min(50, Math.floor(c.stats.topSpeed)), 50] },
  { id: 'speed-70', icon: '🚀', name: 'Sound Barrier', desc: 'Reach 70 m/s.', check: (c) => c.stats.topSpeed >= 70, progress: (c) => [Math.min(70, Math.floor(c.stats.topSpeed)), 70] },
  { id: 'long-haul', icon: '⏱️', name: 'Long Hauler', desc: 'Stay on one rope for 5 seconds.', check: (c) => c.stats.longestSwing >= 5 },
  // Grind
  { id: 'bunny', icon: '🐇', name: 'Bunny', desc: 'Do 100 release hops.', check: (c) => c.stats.hops >= 100, progress: (c) => [Math.min(100, c.stats.hops), 100] },
  { id: 'km-1', icon: '📏', name: 'Kilometre Club', desc: 'Travel 1 km.', check: (c) => c.stats.distance >= 1000, progress: (c) => [Math.min(1000, Math.floor(c.stats.distance)), 1000] },
  { id: 'km-10', icon: '✈️', name: 'Frequent Flyer', desc: 'Travel 10 km.', check: (c) => c.stats.distance >= 10000, progress: (c) => [Math.min(10000, Math.floor(c.stats.distance)), 10000] },
  { id: 'gravity', icon: '🪂', name: 'Gravity Wins', desc: 'Fall into the clouds 100 times.', check: (c) => c.stats.falls >= 100, progress: (c) => [Math.min(100, c.stats.falls), 100] },
  { id: 'dedicated', icon: '⌛', name: 'Dedicated', desc: 'Play for an hour in total.', check: (c) => c.stats.playTime >= 3600, progress: (c) => [Math.min(60, Math.floor(c.stats.playTime / 60)), 60] },
  // Daily
  { id: 'daily-dose', icon: '📅', name: 'Daily Dose', desc: 'Finish a daily challenge.', check: (c) => c.stats.dailyFinishes >= 1 },
  { id: 'week-warrior', icon: '🔥', name: 'Week Warrior', desc: 'Reach a 7-day daily streak.', check: (c) => c.stats.bestStreak >= 7, progress: (c) => [Math.min(7, c.stats.bestStreak), 7] },
  // Community
  { id: 'architect', icon: '🏗️', name: 'Architect', desc: 'Finish a level you built in the editor.', check: (c) => !!c.progress.editorFinished },
  { id: 'published', icon: '📤', name: 'Published', desc: 'Publish a community level.', check: (c) => !!c.flags.published },
  { id: 'explorer', icon: '🧭', name: 'Explorer', desc: "Finish a community level someone else made.", check: (c) => run(c, (r) => r.community && !r.own) },
  { id: 'world-record', icon: '🏆', name: 'World Record', desc: 'Be #1 on any online leaderboard.', check: (c) => !!c.flags.worldRecord },
];

// Returns the achievements newly earned (not in `unlocked`).
export function newAchievements(c, unlocked) {
  return ACHIEVEMENTS.filter((a) => !unlocked[a.id] && a.check(c));
}
