import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { generateCourse, COURSES } from '../src/course.js';
import { createPlayer, step, tryHook, raycast, aimDirection, TUNING, FIXED_DT } from '../src/physics.js';
import { createRun, tick } from '../src/run.js';
import { createBot, botInput } from '../src/bot.js';

const idle = { forward: 0, right: 0, jump: false, reel: false };

test('course generation is deterministic for a seed', () => {
  const a = generateCourse(1);
  const b = generateCourse(1);
  const c = generateCourse(2);
  assert.equal(a.boxes.length, b.boxes.length);
  assert.deepEqual(a.anchors.map((x) => x.center.toArray()), b.anchors.map((x) => x.center.toArray()));
  assert.notDeepEqual(a.anchors.map((x) => x.center.toArray()), c.anchors.map((x) => x.center.toArray()));
});

test('player stands on the start platform', () => {
  const course = generateCourse(1);
  const p = createPlayer(course.spawn);
  for (let i = 0; i < 240; i++) step(p, idle, course);
  assert.ok(p.grounded, 'should be grounded');
  assert.ok(Math.abs(p.pos.y - TUNING.radius) < 0.05, `y=${p.pos.y}`);
});

test('player can walk and jump', () => {
  const course = generateCourse(1);
  const p = createPlayer(course.spawn);
  for (let i = 0; i < 60; i++) step(p, idle, course);
  const z0 = p.pos.z;
  for (let i = 0; i < 30; i++) step(p, { ...idle, forward: 1 }, course);
  assert.ok(p.pos.z < z0 - 1, 'walked forward (-z)');
  step(p, { ...idle, jump: true }, course);
  assert.ok(p.vel.y > 5, 'jumped');
});

test('rope never stretches beyond its length', () => {
  const course = generateCourse(1);
  const p = createPlayer(course.spawn);
  p.pos.set(0, 20, -20);
  p.hook = { point: new Vector3(0, 30, -30), length: 12 };
  p.vel.set(15, 0, 0);
  let maxDist = 0;
  for (let i = 0; i < 600; i++) {
    step(p, idle, course);
    maxDist = Math.max(maxDist, p.pos.distanceTo(p.hook.point));
  }
  assert.ok(maxDist <= 12 + 1e-6, `max ${maxDist}`);
});

test('reeling in shortens the rope and pulls the player in', () => {
  const course = generateCourse(1);
  const p = createPlayer(course.spawn);
  p.pos.set(0, 10, -40);
  p.hook = { point: new Vector3(0, 30, -40), length: 20 };
  for (let i = 0; i < 90; i++) step(p, { ...idle, reel: true }, course);
  assert.ok(p.hook.length < 10, `rope ${p.hook.length}`);
  assert.ok(p.pos.y > 18, `pulled up to ${p.pos.y}`);
});

test('hook raycast hits the first anchor from the start', () => {
  const course = generateCourse(1);
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
  const course = generateCourse(1);
  const p = createPlayer(course.spawn);
  assert.equal(tryHook(p, course, aimDirection(Math.PI, 1.2)), null);
  assert.equal(p.hook, null);
});

test('falling into the clouds respawns the player', () => {
  const course = generateCourse(1);
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

for (const c of COURSES) {
  test(`autopilot bot finishes ${c.id} without falling`, () => {
    const course = generateCourse(c.seed);
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
    console.log(`  ${c.id}: bot time ${finish.time.toFixed(2)}s`);
  });
}
