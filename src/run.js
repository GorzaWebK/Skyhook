import { insideBox, updateMovers } from './course.js';
import { createPlayer, resetPlayer, step, fireHook, releaseHook, FIXED_DT, TUNING } from './physics.js';

// One attempt at a course: the timer, checkpoints, finish and respawning.
// No rendering here, so it runs the same in the browser and in Node tests.

export function createRun(course) {
  updateMovers(course, 0);
  return {
    course,
    player: createPlayer(course.spawn),
    started: false,
    finished: false,
    time: 0,
    checkpoint: -1,
    falls: 0,
  };
}

export function restartRun(run) {
  updateMovers(run.course, 0);
  resetPlayer(run.player, run.course.spawn);
  run.started = false;
  run.finished = false;
  run.time = 0;
  run.checkpoint = -1;
  run.falls = 0;
}

export function respawn(run) {
  const cp = run.course.checkpoints[run.checkpoint];
  resetPlayer(run.player, cp ? cp.spawn : run.course.spawn);
  if (!cp) {
    // Fell before the first checkpoint: start over, timer included.
    run.started = false;
    run.time = 0;
  }
}

export function hook(run, dir) {
  if (run.finished) return null;
  return fireHook(run.player, run.course, dir);
}

export function unhook(run) {
  return releaseHook(run.player, { hop: !run.finished });
}

// Advance one fixed step. Returns a list of event names for sound and HUD.
export function tick(run, input, dt = FIXED_DT) {
  const events = [];
  const p = run.player;
  const course = run.course;

  // Moving anchors follow the run clock (they wait while you're on the start).
  updateMovers(course, run.time);
  const stepEvents = step(p, run.finished ? { forward: 0, right: 0 } : input, course, dt);
  if (stepEvents.landed > 4) events.push({ type: 'land', speed: stepEvents.landed });
  if (stepEvents.jumped) events.push({ type: 'jump' });
  if (stepEvents.attached) events.push({ type: 'attach' });

  if (run.finished) {
    // Glide to a gentle hover behind the finish screen.
    p.vel.multiplyScalar(0.985);
    p.vel.y += TUNING.gravity * dt * 0.97;
    return events;
  }

  if (!run.started && !insideBox(p.pos, course.startZone)) {
    run.started = true;
    events.push({ type: 'start' });
  }
  if (run.started) run.time += dt;

  for (const cp of course.checkpoints) {
    if (cp.index > run.checkpoint && insideBox(p.pos, cp.trigger)) {
      run.checkpoint = cp.index;
      events.push({ type: 'checkpoint', index: cp.index });
    }
  }

  if (course.finish && insideBox(p.pos, course.finish.trigger)) {
    run.finished = true;
    releaseHook(p);
    events.push({ type: 'finish', time: run.time });
  } else if (p.pos.y < course.killY) {
    run.falls++;
    respawn(run);
    events.push({ type: 'fall' });
  }

  return events;
}
