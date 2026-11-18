import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { generateLevel, levelParams, isHookable, buildTutorialCourse } from '../src/course.js';
import { TUTORIAL_STEPS, createTutorialFlags } from '../src/tutorial.js';
import { LEVELS, buildLevel } from '../src/levels.js';
import { createPlayer, step, tryHook, releaseHook, raycast, aimDirection, TUNING, FIXED_DT } from '../src/physics.js';
import { createRun, tick } from '../src/run.js';
import { createBot, botInput } from '../src/bot.js';

const idle = { forward: 0, right: 0, jump: false, reel: false };

test('course generation is deterministic for a seed', () => {
  const a = generateLevel(5, 1);
  const b = generateLevel(5, 1);
  const c = generateLevel(5, 2);
  assert.equal(a.boxes.length, b.boxes.length);
  assert.deepEqual(a.anchors.map((x) => x.center.toArray()), b.anchors.map((x) => x.center.toArray()));
  assert.notDeepEqual(a.anchors.map((x) => x.center.toArray()), c.anchors.map((x) => x.center.toArray()));
});

test('player stands on the start platform', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  for (let i = 0; i < 240; i++) step(p, idle, course);
  assert.ok(p.grounded, 'should be grounded');
  assert.ok(Math.abs(p.pos.y - TUNING.radius) < 0.05, `y=${p.pos.y}`);
});

test('player can walk and jump', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  for (let i = 0; i < 60; i++) step(p, idle, course);
  const z0 = p.pos.z;
  for (let i = 0; i < 30; i++) step(p, { ...idle, forward: 1 }, course);
  assert.ok(p.pos.z < z0 - 1, 'walked forward (-z)');
  step(p, { ...idle, jump: true }, course);
  assert.ok(p.vel.y > 5, 'jumped');
});

test('rope never stretches beyond its length', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  p.pos.set(0, 20, -3000); // far away from any geometry
  p.hook = { point: new Vector3(0, 30, -3010), length: 12 };
  p.vel.set(15, 0, 0);
  let maxDist = 0;
  for (let i = 0; i < 600; i++) {
    step(p, idle, course);
    maxDist = Math.max(maxDist, p.pos.distanceTo(p.hook.point));
  }
  assert.ok(maxDist <= 12 + 1e-6, `max ${maxDist}`);
});

test('reeling in shortens the rope and pulls the player in', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  p.pos.set(0, 10, -40);
  p.hook = { point: new Vector3(0, 30, -40), length: 20 };
  for (let i = 0; i < 90; i++) step(p, { ...idle, reel: true }, course);
  assert.ok(p.hook.length < 10, `rope ${p.hook.length}`);
  assert.ok(p.pos.y > 18, `pulled up to ${p.pos.y}`);
});

test('the rope keeps the length it had when it caught', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  p.pos.set(0, -10, -100);
  p.hook = { point: new Vector3(0, 30, -100), length: 40, time: 0 };
  for (let i = 0; i < 240; i++) step(p, idle, course);
  assert.equal(p.hook.length, 40);
});

test('hook range is limited', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  // Straight down the course: the far anchors are out of range.
  const far = course.anchors[3].center;
  const eye = p.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0));
  assert.ok(eye.distanceTo(far) > TUNING.hookRange);
  assert.equal(raycast(course, eye, far.clone().sub(eye).normalize()), null);
});

test('letting go after holding the rope gives a hop up and forward', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  p.pos.set(0, 0, -100);
  p.vel.set(0, -20, 0); // falling fast
  p.yaw = 0; // facing -Z
  p.hook = { point: new Vector3(0, 30, -100), length: 40, time: 0 };
  for (let i = 0; i < 40; i++) step(p, idle, course); // ~0.33 s held
  p.vel.set(0, -20, 0);
  const r = releaseHook(p, { hop: true });
  assert.deepEqual(r, { released: true, hopped: true });
  assert.equal(p.vel.y, TUNING.releaseHopUp, 'fall is cancelled and you go up');
  assert.ok(p.vel.z < -3, 'pushed in the facing direction');
});

test('no hop when the rope is let go too quickly (no hook spamming)', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  p.pos.set(0, 0, -100);
  p.hook = { point: new Vector3(0, 30, -100), length: 40, time: 0 };
  for (let i = 0; i < 10; i++) step(p, idle, course);
  p.vel.set(0, -20, 0);
  assert.deepEqual(releaseHook(p, { hop: true }), { released: true, hopped: false });
  assert.equal(p.vel.y, -20);
});

test('hook raycast hits the first anchor from the start', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  const a = course.anchors[0];
  const eye = p.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0));
  const dir = a.center.clone().sub(eye).normalize();
  const hit = raycast(course, eye, dir);
  assert.ok(hit, 'hit something');
  assert.equal(hit.box, a);
  assert.ok(tryHook(p, course, dir));
  assert.ok(p.hook.length > 10);
});

test('hook misses when aiming at empty sky', () => {
  const course = buildLevel(LEVELS[0]);
  const p = createPlayer(course.spawn);
  assert.equal(tryHook(p, course, aimDirection(Math.PI, 1.2)), null);
  assert.equal(p.hook, null);
});

test('falling into the clouds respawns the player', () => {
  const course = buildLevel(LEVELS[0]);
  const run = createRun(course);
  run.player.pos.set(0, -40, -60);
  let fell = false;
  for (let i = 0; i < 120 && !fell; i++) {
    fell = tick(run, idle).some((e) => e.type === 'fall');
  }
  assert.ok(fell);
  assert.equal(run.falls, 1);
  assert.ok(run.player.pos.distanceTo(course.spawn.pos) < 0.01);
});

test('there are 30 levels and they get harder', () => {
  assert.equal(LEVELS.length, 30);
  const first = levelParams(0);
  const last = levelParams(1);
  assert.ok(last.anchorCount > first.anchorCount, 'more anchors');
  assert.ok(last.gapMin > first.gapMin, 'bigger gaps');
  assert.ok(last.sizeMax < first.sizeMin, 'smaller anchors');
  assert.equal(first.blockerChance, 0, 'no blockers early');
  const anchors = LEVELS.map((l) => buildLevel(l).anchors.length);
  for (let i = 1; i < anchors.length; i++) assert.ok(anchors[i] >= anchors[i - 1], `level ${i + 1} not shorter than level ${i}`);
  const blockers = buildLevel(LEVELS[29]).boxes.filter((b) => b.kind === 'blocker').length;
  assert.ok(blockers > 5, `level 30 has smooth blocks (${blockers})`);
});

test('smooth blocks cannot be hooked', () => {
  const course = buildLevel(LEVELS[29]);
  const blocker = course.boxes.find((b) => b.kind === 'blocker');
  assert.equal(isHookable(blocker), false);
  const p = createPlayer(course.spawn);
  p.pos.copy(blocker.center).add(new Vector3(0, 0, 10));
  const dir = blocker.center.clone().sub(p.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0))).normalize();
  assert.equal(tryHook(p, course, dir), null);
  assert.equal(p.hook, null);
});

test('tutorial course: first anchor is reachable from the start and the autopilot finishes it', () => {
  const course = buildTutorialCourse();
  const p = createPlayer(course.spawn);
  const eye = p.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0));
  assert.ok(eye.distanceTo(course.anchors[0].center) < TUNING.hookRange - 10);
  assert.equal(course.checkpoints.length, 1);
  assert.ok(course.boxes.some((b) => b.kind === 'blocker'), 'has a smooth block to learn about');
  const run = createRun(course);
  const bot = createBot(run);
  let finish = null;
  for (let i = 0; i < 120 * 120 && !finish; i++) {
    finish = tick(run, botInput(bot)).find((e) => e.type === 'finish') || finish;
  }
  assert.ok(finish, 'finished');
  assert.equal(run.falls, 0);
});

test('tutorial steps tick off in order, and doing one early still counts', () => {
  const f = createTutorialFlags();
  const stepAfter = () => {
    let i = 0;
    while (i < TUTORIAL_STEPS.length - 1 && TUTORIAL_STEPS[i].done(f)) i++;
    return i;
  };
  assert.equal(stepAfter(), 0);
  f.hooked = true; // done early: doesn't skip ahead on its own
  assert.equal(stepAfter(), 0);
  f.look = 2;
  f.jumped = true;
  f.aimedAnchor = true;
  assert.equal(stepAfter(), 4, 'look, move, aim and the early hook all count');
  Object.assign(f, { swung: true, flung: true, reeled: 5, checkpoint: true, pastSmooth: true });
  assert.equal(stepAfter(), TUTORIAL_STEPS.length - 1, 'ends on the finish step');
});

for (const level of LEVELS) {
  test(`autopilot finishes level ${level.number} (${level.name}) without falling`, () => {
    const course = buildLevel(level);
    const run = createRun(course);
    const bot = createBot(run);
    const checkpoints = [];
    let finish = null;
    for (let i = 0; i < 120 * 240 && !finish; i++) {
      for (const e of tick(run, botInput(bot), FIXED_DT)) {
        if (e.type === 'checkpoint') checkpoints.push(e.index);
        if (e.type === 'finish') finish = e;
      }
    }
    assert.ok(finish, `did not finish; got to z=${run.player.pos.z.toFixed(1)}, target anchor ${bot.target}/${course.anchors.length}, falls ${run.falls}`);
    assert.deepEqual(checkpoints, course.checkpoints.map((cp) => cp.index));
    assert.equal(run.falls, 0, 'bot fell');
  });
}
