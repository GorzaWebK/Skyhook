import { createRun, tick } from './run.js';
import { createBot, botInput } from './bot.js';

// Fly a whole course with the autopilot (no rendering). Used by the seed
// script, the tests and medal times.
export function botRun(course, maxSeconds = 240) {
  const run = createRun(course);
  const bot = createBot(run);
  const checkpoints = [];
  for (let i = 0; i < 120 * maxSeconds; i++) {
    for (const e of tick(run, botInput(bot))) {
      if (e.type === 'checkpoint') checkpoints.push(e.index);
      if (e.type === 'finish') return { finished: true, time: e.time, falls: run.falls, checkpoints };
    }
    if (run.falls > 0) break;
  }
  return { finished: false, falls: run.falls, checkpoints };
}
