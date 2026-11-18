import { Vector3 } from 'three';
import { mulberry32, range } from './rng.js';

// A course is plain data: a list of axis-aligned boxes plus the start,
// checkpoints and finish.
//
// Box kinds: 'platform' | 'anchor' | 'pillar' | 'checkpoint' | 'finish' | 'blocker'
// Everything solid can be hooked except 'blocker' (smooth metal).

function box(center, size, kind) {
  const half = new Vector3(size.x / 2, size.y / 2, size.z / 2);
  return {
    kind,
    center: center.clone(),
    size: size.clone(),
    min: center.clone().sub(half),
    max: center.clone().add(half),
  };
}

// A trigger is a non-solid volume (checkpoint gate, finish gate, start zone).
function trigger(center, size) {
  const b = box(center, size, 'trigger');
  return { min: b.min, max: b.max, center: b.center, size: b.size };
}

export function isHookable(b) {
  return b.kind !== 'blocker';
}

// How each level's layout scales with difficulty d (0 = level 1, 1 = level 30).
export function levelParams(d) {
  const lerp = (a, b) => a + (b - a) * d;
  return {
    anchorCount: Math.round(lerp(8, 26)),
    gapMin: lerp(18, 28),
    gapMax: lerp(24, 36),
    lateral: lerp(5, 14), // max sideways step between anchors
    rise: lerp(2.5, 6), // max height change between anchors
    sizeMin: lerp(5.5, 2.4),
    sizeMax: lerp(7, 3.4),
    checkpointEvery: Math.round(lerp(5, 9)),
    blockerChance: Math.max(0, d - 0.3) * 0.9, // none before ~level 10
  };
}

function startArea(boxes) {
  // Start platform: top surface at y = 0, player faces -Z.
  boxes.push(box(new Vector3(0, -1, 0), new Vector3(14, 2, 14), 'platform'));
  return {
    spawn: { pos: new Vector3(0, 0.51, 4), yaw: 0 },
    startZone: trigger(new Vector3(0, 4, 0), new Vector3(14, 10, 14)),
  };
}

function addCheckpoint(boxes, checkpoints, x, py, z) {
  const plat = box(new Vector3(x, py - 0.75, z), new Vector3(11, 1.5, 11), 'checkpoint');
  boxes.push(plat);
  checkpoints.push({
    index: checkpoints.length,
    platform: plat,
    // A tall column of light: fly through it anywhere along its height.
    trigger: trigger(new Vector3(x, py + 20, z), new Vector3(18, 40, 18)),
    spawn: { pos: new Vector3(x, py + 0.51, z + 3), yaw: 0 },
  });
}

function addFinish(boxes, x, fy, z) {
  const platform = box(new Vector3(x, fy - 1, z), new Vector3(18, 2, 18), 'finish');
  boxes.push(platform);
  // Flying through the column anywhere along its height counts.
  return { platform, trigger: trigger(new Vector3(x, fy + 25, z), new Vector3(24, 50, 24)) };
}

// Scenery pillars rising out of the clouds on both sides. Also hookable,
// so they double as emergency anchors.
function addPillars(boxes, rand, endZ) {
  for (let pz = 10; pz > endZ - 60; pz -= range(rand, 45, 70)) {
    for (const side of [-1, 1]) {
      if (rand() < 0.25) continue;
      const w = range(rand, 6, 14);
      const top = range(rand, 0, 38);
      const bottom = -220;
      const px = side * range(rand, 48, 80);
      boxes.push(
        box(
          new Vector3(px, (top + bottom) / 2, pz + range(rand, -15, 15)),
          new Vector3(w, top - bottom, w * range(rand, 0.7, 1.4)),
          'pillar'
        )
      );
    }
  }
}

// index: 0..levelCount-1, seed: picks this level's random layout.
export function generateLevel(index, seed, levelCount = 30) {
  const d = levelCount > 1 ? index / (levelCount - 1) : 0;
  const P = levelParams(d);
  const rand = mulberry32(seed);
  const boxes = [];
  const anchors = [];
  const checkpoints = [];
  const { spawn, startZone } = startArea(boxes);

  let x = 0;
  let y = 22;
  let z = -6; // first anchor ~25-40 m from the start, within hook range

  for (let i = 0; i < P.anchorCount; i++) {
    const prev = { x, y, z };
    z -= range(rand, P.gapMin, P.gapMax);
    x = Math.max(-26, Math.min(26, x + range(rand, -P.lateral, P.lateral)));
    y = Math.max(17, Math.min(32, y + range(rand, -P.rise, P.rise)));
    const s = range(rand, P.sizeMin, P.sizeMax);
    const a = box(new Vector3(x, y, z), new Vector3(s, s * range(rand, 0.8, 1.3), s), 'anchor');
    boxes.push(a);
    anchors.push(a);

    // Smooth blocks you can't hook, sitting in the swing path between anchors.
    if (i > 0 && rand() < P.blockerChance) {
      const side = rand() < 0.5 ? -1 : 1;
      const bx = (prev.x + x) / 2 + side * range(rand, 3, 9);
      const by = (prev.y + y) / 2 - range(rand, 6, 13);
      const bz = (prev.z + z) / 2;
      boxes.push(box(
        new Vector3(bx, by, bz),
        new Vector3(range(rand, 5, 9), range(rand, 5, 10), range(rand, 1.5, 3)),
        'blocker'
      ));
    }

    const remaining = P.anchorCount - 1 - i;
    if ((i + 1) % P.checkpointEvery === 0 && remaining >= 3) {
      z -= 16;
      addCheckpoint(boxes, checkpoints, x, y - 18, z);
    }
  }

  z -= 30;
  const finish = addFinish(boxes, x, y - 16, z);
  addPillars(boxes, rand, z);

  return { seed, boxes, anchors, checkpoints, finish, spawn, startZone, killY: -45 };
}

// Hand-built course for the tutorial: big, close anchors, one checkpoint
// and one smooth block to learn about.
export function buildTutorialCourse() {
  const rand = mulberry32(42);
  const boxes = [];
  const anchors = [];
  const checkpoints = [];
  const { spawn, startZone } = startArea(boxes);
  const anchor = (x, y, z, s) => {
    const a = box(new Vector3(x, y, z), new Vector3(s, s, s), 'anchor');
    boxes.push(a);
    anchors.push(a);
  };

  anchor(0, 20, -26, 6); // first hook, from the start platform
  anchor(0, 22, -54, 6);
  anchor(5, 25, -82, 5.5); // reel practice
  addCheckpoint(boxes, checkpoints, 5, 7, -104);
  anchor(0, 24, -128, 5.5);
  const smooth = box(new Vector3(-4, 12, -142), new Vector3(8, 8, 2), 'blocker');
  boxes.push(smooth);
  anchor(-5, 24, -156, 5.5);
  anchor(0, 26, -184, 5);
  const finish = addFinish(boxes, 0, 8, -214);
  addPillars(boxes, rand, -214);

  return {
    seed: 0, boxes, anchors, checkpoints, finish, spawn, startZone, killY: -45,
    tutorial: { smoothBlock: smooth },
  };
}

export function insideBox(p, b) {
  return (
    p.x >= b.min.x && p.x <= b.max.x &&
    p.y >= b.min.y && p.y <= b.max.y &&
    p.z >= b.min.z && p.z <= b.max.z
  );
}
