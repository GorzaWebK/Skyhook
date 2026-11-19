import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { generateLevel, levelParams, isHookable, buildTutorialCourse } from '../src/course.js';
import { TUTORIAL_STEPS, createTutorialFlags } from '../src/tutorial.js';
import { LEVELS, buildLevel, medalTimes, medalFor, nextMedal } from '../src/levels.js';
import { LEVEL_PAR } from '../src/level-seeds.js';
import { SKINS, isSkinUnlocked, skinRequirement } from '../src/skins.js';
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

test('raycast handles rays parallel to a box face (no phantom hits)', () => {
  const course = buildTutorialCourse();
  const p = createPlayer(course.spawn);
  // Spawn is at x = 0, the same x as the tutorial smooth block's edge.
  const hit = raycast(course, p.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0)), aimDirection(0, 0));
  assert.ok(hit === null || Number.isFinite(hit.distance), `got ${hit?.distance}`);
  // Straight down onto the start platform still works.
  const down = raycast(course, p.pos.clone(), new Vector3(0, -1, 0));
  assert.ok(down && down.box.kind === 'platform' && Math.abs(down.distance - p.pos.y) < 1e-6);
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

test('there are 40 levels and they get harder', () => {
  assert.equal(LEVELS.length, 40);
  const first = levelParams(0);
  const last = levelParams(1);
  assert.ok(last.anchorCount > first.anchorCount, 'more anchors');
  assert.ok(last.gapMin > first.gapMin, 'bigger gaps');
  assert.ok(last.sizeMax < first.sizeMin, 'smaller anchors');
  assert.equal(first.blockerChance, 0, 'no blockers early');
  const anchors = LEVELS.map((l) => buildLevel(l).anchors.length);
  for (let i = 1; i < 30; i++) assert.ok(anchors[i] >= anchors[i - 1], `level ${i + 1} not shorter than level ${i}`);
  for (let i = 31; i < 40; i++) assert.ok(anchors[i] >= anchors[i - 1], `storm level ${i + 1} not shorter than level ${i}`);
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
    // Medal times come from the autopilot: if this fails, physics or the bot
    // changed and scripts/find-seeds.mjs needs re-running.
    assert.ok(Math.abs(finish.time - LEVEL_PAR[level.index]) < 0.002, `par ${LEVEL_PAR[level.index]} vs bot ${finish.time}`);
    assert.ok(finish.time <= level.medals.gold, 'autopilot earns gold');
  });
}

test('medal times and awarding', () => {
  const m = medalTimes(20.2);
  assert.deepEqual(m, { gold: 20.5, silver: 26.5, bronze: 35.5 });
  const level = { medals: m };
  assert.equal(medalFor(level, 20.5), 'gold');
  assert.equal(medalFor(level, 20.6), 'silver');
  assert.equal(medalFor(level, 35.5), 'bronze');
  assert.equal(medalFor(level, 35.6), null);
  assert.equal(medalFor(level, null), null);
  assert.equal(nextMedal(level, null), 'bronze');
  assert.equal(nextMedal(level, 30), 'silver');
  assert.equal(nextMedal(level, 22), 'gold');
  assert.equal(nextMedal(level, 20), null);
  for (const l of LEVELS) assert.ok(l.medals.gold < l.medals.silver && l.medals.silver < l.medals.bronze);
});

test('gun skins unlock from progress', () => {
  const none = { medals: { gold: 0, silver: 0, bronze: 0 }, tutorialDone: false, editorFinished: false };
  const unlocked = (stats) => SKINS.filter((sk) => isSkinUnlocked(sk, stats)).map((sk) => sk.id);
  assert.deepEqual(unlocked(none), ['standard']);
  assert.ok(unlocked({ ...none, tutorialDone: true }).includes('rookie'));
  assert.ok(unlocked({ ...none, editorFinished: true }).includes('architect'));
  const some = { ...none, medals: { gold: 0, silver: 5, bronze: 5 } };
  assert.ok(unlocked(some).includes('bronze') && unlocked(some).includes('cobalt'));
  assert.ok(!unlocked(some).includes('crimson'));
  const all = { medals: { gold: 40, silver: 40, bronze: 40 }, tutorialDone: true, editorFinished: true, achieved: { 'week-warrior': 1, ghostbuster: 1, 'km-10': 1, 'world-record': 1 } };
  assert.equal(unlocked(all).length, SKINS.length);
  assert.equal(skinRequirement(SKINS.find((sk) => sk.id === 'gilded'), some), 'Earn 10 gold medals (0 / 10)');
  assert.equal(new Set(SKINS.map((sk) => sk.id)).size, SKINS.length, 'unique ids');
});

// --- Level editor -------------------------------------------------------------
import { buildCustomCourse } from '../src/course.js';
import { encodeLevel, decodeLevel, validateLevel } from '../src/custom.js';
import { Editor, placementCenter, faceNormal } from '../src/editor.js';
import { botRun } from '../src/botrun.js';

// The tutorial layout, rebuilt from editor blocks.
const handmade = () => ({
  v: 1,
  name: 'Handmade',
  blocks: [
    ['a', 0, 20, -26, 6, 6, 6], ['a', 0, 22, -54, 6, 6, 6], ['a', 5, 25, -82, 5.5, 5.5, 5.5],
    ['c', 5, 6.25, -104, 11, 1.5, 11], ['a', 0, 24, -128, 5.5, 5.5, 5.5],
    ['b', -4, 12, -142, 8, 8, 2], ['a', -5, 24, -156, 5.5, 5.5, 5.5], ['a', 0, 26, -184, 5, 5, 5],
    ['f', 0, 7, -214, 18, 2, 18],
  ],
});

test('custom level: course is built from editor blocks and the autopilot can finish it', () => {
  const course = buildCustomCourse(handmade());
  assert.equal(course.anchors.length, 6);
  assert.equal(course.checkpoints.length, 1);
  assert.ok(course.finish && course.finish.trigger.min.y >= course.finish.platform.max.y - 1e-6);
  assert.equal(course.boxes.filter((b) => b.kind === 'blocker').length, 1);
  const r = botRun(course);
  assert.ok(r.finished && r.falls === 0, JSON.stringify(r));
});

test('custom level without a finish can still be flown (no crash)', () => {
  const data = handmade();
  data.blocks = data.blocks.filter((b) => b[0] !== 'f');
  const course = buildCustomCourse(data);
  assert.equal(course.finish, null);
  const r = botRun(course, 20);
  assert.equal(r.finished, false);
});

test('share codes round-trip and stay short', async () => {
  const data = handmade();
  const code = await encodeLevel(data);
  assert.match(code, /^SKY1\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 260, `code length ${code.length}`);
  assert.deepEqual(await decodeLevel(code), validateLevel(data));
  assert.deepEqual(await decodeLevel(`  ${code.slice(0, 40)}\n${code.slice(40)} `), validateLevel(data), 'tolerates whitespace');
});

test('bad level codes are rejected with a clear reason', async () => {
  await assert.rejects(decodeLevel('hello'), /doesn't look like a Skyhook level code/);
  await assert.rejects(decodeLevel('SKY1.AAAA'), /damaged or incomplete/);
  const bad = (blocks, extra = {}) => validateLevel({ v: 1, name: 'x', blocks, ...extra });
  assert.throws(() => bad([['q', 0, 0, 0, 1, 1, 1]]), /unknown type/);
  assert.throws(() => bad([['a', 0, 0, 0, 1, 1]]), /malformed/);
  assert.throws(() => bad([['a', 9999, 0, 0, 1, 1, 1]]), /too far/);
  assert.throws(() => bad([['a', 0, 0, 0, 500, 1, 1]]), /bad size/);
  assert.throws(() => bad([['a', 0, 0, 0, NaN, 1, 1]]), /bad numbers/);
  assert.throws(() => bad([['f', 0, 0, 0, 5, 1, 5], ['f', 9, 0, 0, 5, 1, 5]]), /one finish/);
  assert.throws(() => bad(Array.from({ length: 501 }, () => ['a', 0, 0, 0, 1, 1, 1])), /Too many/);
  assert.throws(() => validateLevel({ v: 2, blocks: [] }), /version/);
  assert.equal(bad([], { name: '<script>alert(1)</script>' }).name.includes('<'), false, 'names are cleaned');
});

test('editor: blocks are placed against the face you aim at', () => {
  const b = { min: new Vector3(-1, -1, -1), max: new Vector3(1, 1, 1) };
  assert.deepEqual(faceNormal(b, new Vector3(0.2, 1, 0.3)).toArray(), [0, 1, 0]);
  assert.deepEqual(faceNormal(b, new Vector3(-1, 0.1, 0)).toArray(), [-1, 0, 0]);
  const top = placementCenter({ box: b, point: new Vector3(0.2, 1, 0.3) }, [4, 2, 4], null, null);
  assert.deepEqual(top.toArray(), [0, 2, 0.5], 'sits on top, snapped to a half-metre grid');
  const side = placementCenter({ box: b, point: new Vector3(-1, 0.1, 0) }, [4, 2, 4], null, null);
  assert.deepEqual(side.toArray(), [-3, 0, 0], 'sits against the side');
  const air = placementCenter(null, [4, 4, 4], new Vector3(0, 10, 0), new Vector3(0, 0, -1));
  assert.deepEqual(air.toArray(), [0, 10, -18], 'floats in front when aiming at sky');
});

test('editor: place, delete, undo, copy, and only one finish', () => {
  const fakeRenderer = { scene: { add() {} }, buildCourse() {} };
  const ed = new Editor(fakeRenderer);
  const lvl = { id: 't', data: { v: 1, name: 'T', blocks: [] } };
  ed.open(lvl);
  const cam = { pos: new Vector3(0, 5, 10), yaw: 0, pitch: -Math.atan2(5.5, 6), vel: new Vector3() };
  // Aim down at the start platform and place an anchor on it.
  ed.place(cam);
  assert.equal(lvl.data.blocks.length, 1);
  const [k, x, y, z] = lvl.data.blocks[0];
  assert.equal(k, 'a');
  assert.ok(Math.abs(y - 2) < 1e-9, `anchor sits on the platform (y=${y})`);
  assert.ok(Math.abs(x) < 1 && z < 10, `placed where aimed (${x}, ${z})`);
  // Deleting the start platform isn't allowed; deleting the anchor is.
  const lookAtAnchor = { ...cam, pitch: -Math.atan2(cam.pos.y + 0.35 - y, cam.pos.z - z), yaw: Math.atan2(-(x - cam.pos.x), -(z - cam.pos.z)) };
  ed.setTool(2);
  assert.equal(ed.copy(lookAtAnchor), true);
  assert.equal(ed.tool, 0, 'copy picks up the anchor tool');
  assert.equal(ed.remove(lookAtAnchor), true);
  assert.equal(lvl.data.blocks.length, 0);
  assert.equal(ed.remove(cam), false, 'start platform cannot be deleted');
  assert.equal(ed.undo(), true);
  assert.equal(lvl.data.blocks.length, 1, 'undo brings it back');
  ed.setTool(4);
  ed.place(cam);
  ed.place({ ...cam, pitch: 0.3 });
  assert.equal(lvl.data.blocks.filter((b) => b[0] === 'f').length, 1, 'placing a second finish replaces the first');
});

// --- Sky themes -----------------------------------------------------------------
import { themeForLevelIndex, THEME_IDS } from '../src/themes.js';

test('sky themes: day, sunset and night by level group; custom levels keep a valid theme', async () => {
  assert.equal(themeForLevelIndex(0), 'day');
  assert.equal(themeForLevelIndex(9), 'day');
  assert.equal(themeForLevelIndex(10), 'sunset');
  assert.equal(themeForLevelIndex(29), 'night');
  assert.equal(buildLevel(LEVELS[15]).theme, 'sunset');
  assert.deepEqual([...THEME_IDS].sort(), ['day', 'night', 'storm', 'sunset']);
  const data = { ...handmade(), theme: 'storm' };
  assert.equal(buildCustomCourse(data).theme, 'storm');
  assert.equal((await decodeLevel(await encodeLevel(data))).theme, 'storm', 'theme survives a share code');
  assert.equal(validateLevel({ ...data, theme: 'lava' }).theme, 'day', 'unknown themes fall back to day');
});

// --- Moving anchors ---------------------------------------------------------------
import { updateMovers } from '../src/course.js';

test('moving anchors: none before level 16, more in later levels', () => {
  const movers = (n) => buildLevel(LEVELS[n - 1]).anchors.filter((a) => a.motion).length;
  for (let n = 1; n <= 15; n++) assert.equal(movers(n), 0, `level ${n}`);
  assert.ok(movers(30) > movers(16), `level 30 (${movers(30)}) has more than level 16 (${movers(16)})`);
  assert.ok(movers(30) >= 8);
});

test('moving anchors wait until the timer starts, then move', () => {
  const course = buildLevel(LEVELS[29]);
  const run = createRun(course);
  const a = course.anchors.find((x) => x.motion);
  const start = a.center.clone();
  for (let i = 0; i < 120; i++) tick(run, idle); // standing on the start platform
  assert.ok(a.center.distanceTo(start) < 1e-9, 'still while on the start');
  updateMovers(course, a.motion.period / 4);
  assert.ok(a.center.distanceTo(start) > 1, 'moves once the clock runs');
  assert.ok(Math.abs(a.min[a.motion.axis] - (a.center[a.motion.axis] - a.size[a.motion.axis] / 2)) < 1e-9, 'collision box moves with it');
});

test('a hook in a moving anchor rides along with it', () => {
  const course = buildLevel(LEVELS[29]);
  const a = course.anchors.find((x) => x.motion);
  updateMovers(course, 0);
  const p = createPlayer(course.spawn);
  p.pos.set(a.center.x, a.center.y - 15, a.center.z + 5);
  const eye = p.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0));
  assert.ok(tryHook(p, course, a.center.clone().sub(eye).normalize()), 'hooked');
  const offset = p.hook.point.clone().sub(a.center);
  updateMovers(course, a.motion.period / 4);
  step(p, idle, course);
  assert.ok(p.hook.point.clone().sub(a.center).distanceTo(offset) < 1e-9, 'hook stays on the same spot of the block');
});

// --- Ghost replays -------------------------------------------------------------------
import { GhostRecorder, ghostAt, encodeGhost, decodeGhost, GHOST_RATE } from '../src/ghost.js';

test('ghosts: recorded at 20 per second during a run, compressed and restored', async () => {
  const course = buildLevel(LEVELS[0]);
  const run = createRun(course);
  const bot = createBot(run);
  const rec = new GhostRecorder();
  let finish = null;
  for (let i = 0; i < 120 * 60 && !finish; i++) {
    finish = tick(run, botInput(bot)).find((e) => e.type === 'finish');
    if (run.started && !run.finished) rec.record(run.time, run.player);
  }
  assert.ok(finish);
  const expected = Math.floor(finish.time * GHOST_RATE);
  assert.ok(Math.abs(rec.samples.length - expected) <= 2, `${rec.samples.length} samples for ${finish.time.toFixed(2)} s`);
  assert.ok(rec.samples.some((s) => s[3] === 1), 'records when the rope is attached');
  const code = await encodeGhost(rec.samples);
  assert.match(code, /^G1\./);
  assert.ok(code.length < 20000, `ghost code ${code.length} chars`);
  const back = await decodeGhost(code);
  assert.equal(back.length, rec.samples.length);
  for (let i = 0; i < back.length; i++) {
    for (let f = 0; f < 7; f++) assert.ok(Math.abs(back[i][f] - rec.samples[i][f]) <= 0.006, `sample ${i} field ${f}`);
  }
  await assert.rejects(decodeGhost('nope'));
});

test('ghosts: playback interpolates between samples', () => {
  const samples = [[0, 0, 0, 0, 0, 0, 0], [2, 4, -6, 1, 9, 9, 9]];
  assert.deepEqual(ghostAt(samples, 0).pos, [0, 0, 0]);
  assert.deepEqual(ghostAt(samples, 0.5 / GHOST_RATE).pos, [1, 2, -3]);
  assert.equal(ghostAt(samples, 0).hook, null);
  assert.deepEqual(ghostAt(samples, 1 / GHOST_RATE).hook, [9, 9, 9]);
  assert.equal(ghostAt(samples, 99).done, true);
  assert.equal(ghostAt([], 1), null);
});

// --- Daily challenge ---------------------------------------------------------------
import { dailyFor, buildDaily, dailyStreak, timeUntilNext, dateKey } from '../src/daily.js';
import { DAILY } from '../src/daily-seeds.js';

test('daily challenge: same layout for everyone on a date, different each day', () => {
  const a = dailyFor('2026-11-19');
  const b = dailyFor('2026-11-19');
  const c = dailyFor('2026-11-20');
  assert.deepEqual(a, b);
  assert.equal(a.id, 'daily-2026-11-19');
  assert.equal(a.number, 1);
  assert.notEqual(a.seed, c.seed);
  assert.deepEqual(['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map((d) => dailyFor(d).theme), ['day', 'sunset', 'night', 'storm']);
  assert.equal(DAILY.length, 730, 'two years of dailies');
  assert.ok(dailyFor('2030-01-01').seed > 0, 'keeps going after the list runs out');
  assert.equal(dateKey(new Date('2026-11-19T23:59:00Z')), '2026-11-19', 'days follow UTC');
  assert.equal(timeUntilNext(new Date('2026-11-19T22:30:00Z')), '1h 30m');
});

test('daily challenge: the first 60 days are finishable and their gold times are current', () => {
  for (let day = 0; day < 60; day++) {
    const key = new Date(Date.UTC(2026, 10, 19 + day)).toISOString().slice(0, 10);
    const def = dailyFor(key);
    const r = botRun(buildDaily(def));
    assert.ok(r.finished && r.falls === 0, `day ${day + 1} (${key})`);
    assert.ok(Math.abs(r.time - DAILY[day][2]) < 0.002, `day ${day + 1} par ${DAILY[day][2]} vs ${r.time}`);
  }
});

test('daily streak counts consecutive days', () => {
  assert.equal(dailyStreak([], '2026-11-25'), 0);
  assert.equal(dailyStreak(['2026-11-23', '2026-11-24', '2026-11-25'], '2026-11-25'), 3);
  assert.equal(dailyStreak(['2026-11-23', '2026-11-24'], '2026-11-25'), 2, "today not played yet: yesterday's streak still counts");
  assert.equal(dailyStreak(['2026-11-20', '2026-11-24', '2026-11-25'], '2026-11-25'), 2, 'a missed day breaks it');
});

// --- Stats -------------------------------------------------------------------------
import { StatsTracker, statsRows } from '../src/stats.js';

test('stats: distance, swing distance, top speed and longest swing; respawns are ignored', () => {
  const t = new StatsTracker(null);
  const p = { pos: new Vector3(0, 0, 0), vel: new Vector3(0, 0, -30), hook: null };
  t.step(p, 0.5, 0);
  p.pos.set(0, 0, -2);
  t.step(p, 0.5, 0.5);
  p.hook = { point: new Vector3() };
  p.pos.set(0, 0, -5);
  t.step(p, 0.5, 1);
  p.pos.set(0, 0, -8);
  t.step(p, 0.5, 2.5);
  p.pos.set(0, 0, 500); // respawn teleport
  t.step(p, 0.5, 3);
  assert.equal(t.s.distance, 8);
  assert.equal(t.s.swung, 6);
  assert.equal(t.s.topSpeed, 30);
  assert.equal(t.s.longestSwing, 2);
  assert.equal(t.s.playTime, 2.5);
  const rows = statsRows({ ...t.s, hooksFired: 4, hooksLanded: 3 }, { gold: 1, silver: 3, bronze: 4 });
  assert.ok(rows.find(([l]) => l === 'Hooks landed')[1] === '3 (75%)');
  assert.ok(rows.find(([l]) => l === 'Medals')[1] === '1 gold · 2 silver · 1 bronze');
});

// --- Achievements ------------------------------------------------------------------
import { ACHIEVEMENTS, newAchievements } from '../src/achievements.js';
import { defaultStats } from '../src/stats.js';

test('achievements: 31 unique, and they unlock from the right situations', () => {
  assert.equal(ACHIEVEMENTS.length, 31);
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, 31);
  const base = { stats: defaultStats(), medals: { gold: 0, silver: 0, bronze: 0 }, progress: {}, finished: new Set(), run: null, flags: {} };
  assert.deepEqual(newAchievements(base, {}), [], 'nothing for a brand new player');
  const ids = (c) => newAchievements(c, {}).map((a) => a.id);
  assert.ok(ids({ ...base, stats: { ...defaultStats(), hooksLanded: 1 } }).includes('first-swing'));
  const days = new Set(Array.from({ length: 10 }, (_, i) => `level-${i + 1}`));
  assert.ok(ids({ ...base, finished: days }).includes('daylight'));
  const cleanRun = { levelNumber: 6, falls: 0, retries: 0, reeled: false, hooks: 7, community: false, own: false };
  const got = ids({ ...base, run: cleanRun });
  for (const id of ['sure-footed', 'hands-off', 'minimalist']) assert.ok(got.includes(id), id);
  assert.ok(!ids({ ...base, run: { ...cleanRun, falls: 1, reeled: true, hooks: 12 } }).some((id) => ['sure-footed', 'hands-off', 'minimalist'].includes(id)));
  assert.ok(ids({ ...base, flags: { worldRecord: true } }).includes('world-record'));
  assert.deepEqual(newAchievements({ ...base, stats: { ...defaultStats(), hooksLanded: 1 } }, { 'first-swing': '2026-11-19' }), [], 'already earned ones are not repeated');
  const km = ACHIEVEMENTS.find((a) => a.id === 'km-1');
  assert.deepEqual(km.progress({ ...base, stats: { ...defaultStats(), distance: 250.7 } }), [250, 1000]);
});

// --- Cosmetics -----------------------------------------------------------------------
import { ROPES, TRAILS, isCosmeticUnlocked } from '../src/cosmetics.js';

test('rope colours and hook trails unlock from achievements that exist', () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const item of [...ROPES, ...TRAILS, ...SKINS.filter((s) => s.req.type === 'achievement')]) {
    if (item.req.type === 'achievement') assert.ok(ids.has(item.req.id), `${item.name} needs a real achievement (${item.req.id})`);
  }
  assert.deepEqual(ROPES.filter((r) => isCosmeticUnlocked(r, {})).map((r) => r.id), ['black', 'white']);
  assert.deepEqual(TRAILS.filter((t) => isCosmeticUnlocked(t, {})).map((t) => t.id), ['none']);
  assert.ok(isCosmeticUnlocked(ROPES.find((r) => r.id === 'gold'), { 'gold-10': '2026-11-19' }));
  assert.equal(SKINS.length, 13);
});

// --- Storm levels and special blocks ---------------------------------------------------
import { updateHazards, resetHazards, CRUMBLE_DELAY, laserOn } from '../src/hazards.js';

test('storm levels 31-40 have crumbling anchors, wind, lasers and zip-lines', () => {
  let crumble = 0, winds = 0, lasers = 0, zips = 0;
  for (let n = 31; n <= 40; n++) {
    const c = buildLevel(LEVELS[n - 1]);
    assert.equal(c.theme, 'storm');
    crumble += c.anchors.filter((a) => a.crumble).length;
    winds += c.winds.length;
    lasers += c.lasers.length;
    zips += c.boxes.filter((b) => b.kind === 'zip').length;
  }
  assert.ok(crumble >= 10 && winds >= 10 && lasers >= 5 && zips >= 5, JSON.stringify({ crumble, winds, lasers, zips }));
  for (let n = 1; n <= 30; n++) {
    const c = buildLevel(LEVELS[n - 1]);
    assert.ok(!c.winds?.length && !c.lasers?.length && !c.anchors.some((a) => a.crumble), `level ${n} has no storm blocks`);
  }
});

test('a crumbling anchor drops your rope after a moment, and comes back on restart', () => {
  const course = buildLevel(LEVELS[39]);
  const a = course.anchors.find((x) => x.crumble && !x.motion) || course.anchors.find((x) => x.crumble);
  const run = createRun(course);
  const p = run.player;
  p.pos.set(a.center.x, a.center.y - 12, a.center.z + 4);
  const eye = p.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0));
  assert.ok(tryHook(p, course, a.center.clone().sub(eye).normalize()), 'hooked');
  const home = a.center.clone();
  let dropped = false;
  for (let i = 0; i < 120 * (CRUMBLE_DELAY + 0.5) && !dropped; i++) dropped = updateHazards(course, 1 / 120, p, 0).dropped;
  assert.ok(dropped && p.hook === null, 'rope dropped');
  for (let i = 0; i < 240; i++) updateHazards(course, 1 / 120, p, 0);
  assert.ok(a.center.y < home.y - 10, 'anchor fell');
  resetHazards(course);
  assert.ok(a.center.distanceTo(home) < 1e-9 && a.crumble.t === null, 'back in place');
});

test('wind pushes you, lasers send you back, zip-lines carry you', () => {
  const course = buildLevel(LEVELS[39]);
  // Wind
  const w = course.winds[0];
  const p = createPlayer(course.spawn);
  p.pos.copy(w.center);
  p.vel.set(0, 0, 0);
  step(p, idle, course);
  const pushed = p.vel.clone().setY(p.vel.y + TUNING.gravity / 120); // remove gravity's share
  assert.ok(pushed.dot(w.force) > 0, 'pushed along the wind');
  // Laser: on and off over its period, and touching it while on sends you back
  const l = course.lasers[0];
  let onAt = null;
  for (let t = 0; t < l.period && onAt === null; t += 0.05) if (laserOn(l, t)) onAt = t;
  assert.ok(onAt !== null && [0, 0.25, 0.5, 0.75].some((f) => !laserOn(l, onAt + l.period * f)), 'switches on and off');
  const run = createRun(course);
  run.started = true;
  run.time = onAt;
  run.player.pos.copy(l.center);
  const ev = tick(run, idle);
  assert.ok(ev.some((e) => e.type === 'zap') && run.falls === 1, 'zapped back');
  // Zip-line
  const zip = course.boxes.find((b) => b.kind === 'zip');
  const q = createPlayer(course.spawn);
  q.pos.set(zip.center.x, zip.center.y - 6, zip.max.z - 1);
  const eye = q.pos.clone().add(new Vector3(0, TUNING.eyeHeight, 0));
  const target = new Vector3(zip.center.x, zip.center.y, zip.max.z - 1.5);
  assert.ok(tryHook(q, course, target.sub(eye).normalize()), 'hooked the rail');
  const z0 = q.hook.point.z;
  for (let i = 0; i < 60; i++) step(q, idle, course);
  assert.ok(q.hook.point.z < z0 - 5 && q.pos.z < zip.max.z - 3, 'hook slides along the rail and pulls you');
});

// --- Weekly tournament -----------------------------------------------------------------
import { weeklyFor, buildWeekly, weekKey, weekNumber } from '../src/weekly.js';
import { WEEKLY } from '../src/weekly-seeds.js';

test('weekly tournament: one storm level per week, with ISO week names', () => {
  assert.equal(weekKey(0), '2026-W47');
  assert.equal(weekKey(6), '2026-W53', '2026 has 53 ISO weeks');
  assert.equal(weekKey(7), '2027-W01');
  assert.equal(weekNumber(new Date('2026-11-22T23:59:00Z')), 0, 'Sunday is still week 0');
  assert.equal(weekNumber(new Date('2026-11-23T00:00:00Z')), 1, 'Monday starts week 1');
  const w = weeklyFor(3);
  assert.deepEqual(weeklyFor(3), w);
  assert.equal(w.id, `weekly-${weekKey(3)}`);
  assert.equal(buildWeekly(w).theme, 'storm');
  assert.equal(WEEKLY.length, 104);
});

test('weekly tournament: the first 20 weeks are finishable and their gold times are current', () => {
  for (let n = 0; n < 20; n++) {
    const r = botRun(buildWeekly(weeklyFor(n)));
    assert.ok(r.finished && r.falls === 0, `week ${n}`);
    assert.ok(Math.abs(r.time - WEEKLY[n][2]) < 0.002, `week ${n} par`);
  }
});

// --- Account codes -----------------------------------------------------------------
import { newAccountCode, formatCode, parseCode, mergeSaves, encodeSave, decodeSave, cleanSave, sameSave, combineStats } from '../src/account.js';

test('account codes: 16 easy-to-read characters, pasted with or without dashes', () => {
  const codes = new Set(Array.from({ length: 500 }, () => newAccountCode()));
  assert.equal(codes.size, 500, 'codes are unique');
  for (const c of codes) assert.match(c, /^[2-9A-HJ-NP-Z]{16}$/);
  const c = [...codes][0];
  assert.match(formatCode(c), /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
  assert.equal(parseCode(formatCode(c)), c);
  assert.equal(parseCode(`  ${formatCode(c).toLowerCase()} `), c, 'lower case and spaces are fine');
  assert.equal(parseCode(c.replace(/(.{4})/g, '$1 ')), c);
  assert.equal(parseCode('ABCD-EFGH-JKLM-NPQ'), null, 'too short');
  assert.equal(parseCode('ABCD-EFGH-JKLM-NPQ0'), null, 'no zeros (they look like O)');
  assert.equal(parseCode('SKY1.abc'), null);
});

const lvl = (id, name, updated, extra = {}) => ({ id, own: true, tested: false, updated, data: { v: 1, name, theme: 'day', blocks: [['f', 0, 0, 0, 10, 2, 10]] }, ...extra });

test('account saves: merging keeps the best of two computers', () => {
  const a = {
    profile: { name: 'Alice', skin: 'standard', at: 100 },
    bests: { 'level-1': { time: 20, splits: [5] }, 'level-2': { time: 30, splits: [] } },
    progress: { unlocked: 5, tutorialDone: true, dailyDone: ['2026-11-19'], trophies: { '2026-W47': 2 } },
    achievements: { first: '2026-11-20' },
    stats: { pc1: { playTime: 100, distance: 1000, topSpeed: 40 } },
    custom: [lvl('c1', 'Old name', 10), lvl('c2', 'Mine', 5)],
    deleted: {},
  };
  const b = {
    profile: { name: 'Ali', skin: 'neon', at: 200 },
    bests: { 'level-1': { time: 18, splits: [4] }, 'level-3': { time: 40, splits: [] } },
    progress: { unlocked: 8, editorFinished: true, dailyDone: ['2026-11-18'], trophies: { '2026-W47': 1 } },
    achievements: { first: '2026-11-19', swing: '2026-11-21' },
    stats: { pc2: { playTime: 50, distance: 500, topSpeed: 55 } },
    custom: [lvl('c1', 'New name', 20), lvl('c3', 'Other', 7)],
    deleted: { c2: 6 },
  };
  const m = mergeSaves(a, b);
  assert.equal(m.profile.name, 'Ali', 'the newest name wins');
  assert.equal(m.profile.skin, 'neon');
  assert.deepEqual(m.bests['level-1'], { time: 18, splits: [4] }, 'fastest time wins');
  assert.equal(m.bests['level-2'].time, 30);
  assert.equal(m.bests['level-3'].time, 40);
  assert.equal(m.progress.unlocked, 8);
  assert.ok(m.progress.tutorialDone && m.progress.editorFinished);
  assert.deepEqual(m.progress.dailyDone, ['2026-11-18', '2026-11-19']);
  assert.equal(m.progress.trophies['2026-W47'], 1, 'best trophy wins');
  assert.equal(m.achievements.first, '2026-11-19', 'earliest unlock date');
  assert.ok(m.achievements.swing);
  assert.deepEqual(Object.keys(m.stats).sort(), ['pc1', 'pc2']);
  const total = combineStats(m.stats);
  assert.equal(total.playTime, 150, 'totals add up across computers');
  assert.equal(total.topSpeed, 55, 'records take the highest');
  assert.deepEqual(m.custom.map((l) => [l.id, l.data.name]), [['c1', 'New name'], ['c3', 'Other']], 'newest version of each level; deleted ones stay deleted');
  assert.ok(sameSave(mergeSaves(m, a), m), 'merging again changes nothing');
  assert.ok(sameSave(mergeSaves(b, a), m), 'order does not matter');
});

test('account saves: a level edited after it was deleted elsewhere comes back', () => {
  const m = mergeSaves({ custom: [lvl('c9', 'Edited', 50)] }, { deleted: { c9: 40 } });
  assert.equal(m.custom.length, 1);
});

test('account saves: bad data from the network is cleaned up', () => {
  const s = cleanSave({
    profile: { name: '<script>alert(1)</script>Bob', skin: '../x', at: 'soon' },
    bests: { 'level-1': { time: -5 }, 'level-2': { time: 'fast' }, 'bad id!': { time: 4 }, 'level-3': { time: 12, splits: [1, 'x', 2] } },
    progress: { unlocked: 'all', dailyDone: ['2026-11-19', 'yesterday'], trophies: { '2026-W47': 9, '2026-W48': 3 } },
    stats: { pc: { playTime: 10, hacked: 'yes', falls: -2 } },
    custom: [{ id: 'c1', data: { v: 1, name: 'x', blocks: 'nope' } }, lvl('c2', 'Fine', 1)],
  });
  assert.equal(s.profile.name, 'scriptalert1scri');
  assert.equal(s.profile.skin, undefined);
  assert.equal(s.profile.at, 0);
  assert.deepEqual(Object.keys(s.bests), ['level-3']);
  assert.deepEqual(s.bests['level-3'].splits, [1, 2]);
  assert.equal(s.progress.unlocked, undefined);
  assert.deepEqual(s.progress.dailyDone, ['2026-11-19']);
  assert.deepEqual(s.progress.trophies, { '2026-W48': 3 });
  assert.deepEqual(s.stats.pc, { playTime: 10 });
  assert.deepEqual(s.custom.map((l) => l.id), ['c2']);
});

test('account saves: pack into an SV1. code and back', async () => {
  const save = mergeSaves({ bests: { 'level-1': { time: 21.5, splits: [3, 9] } }, custom: [lvl('c1', 'Packed', 3)] }, {});
  const code = await encodeSave(save);
  assert.match(code, /^SV1\.[A-Za-z0-9_-]+$/);
  assert.ok(sameSave(await decodeSave(code), save));
  await assert.rejects(decodeSave('SKY1.abc'));
  await assert.rejects(decodeSave('SV1.!!!'));
});
