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
  const all = { medals: { gold: 30, silver: 30, bronze: 30 }, tutorialDone: true, editorFinished: true };
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
  assert.throws(() => bad([['z', 0, 0, 0, 1, 1, 1]]), /unknown type/);
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
  assert.deepEqual(THEME_IDS.sort(), ['day', 'night', 'storm', 'sunset']);
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
