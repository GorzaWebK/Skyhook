import { Vector3 } from 'three';
import { mulberry32, range } from './rng.js';

// Special blocks used by the storm levels (31-40) and the editor:
// - crumbling anchors: fall CRUMBLE_DELAY seconds after you hook them
// - wind zones: push you while you're inside (sideways or upwards)
// - laser gates: switch on and off; touching one while it's on sends you
//   back to your checkpoint
// - zip-lines: a hook on the rail slides forward along it (towards -Z),
//   pulling you with it

export const CRUMBLE_DELAY = 1.1;
export const ZIP_SPEED = 22;
const FALL_GRAVITY = 30;

function volume(center, size) {
  const half = size.clone().multiplyScalar(0.5);
  return { center: center.clone(), size: size.clone(), min: center.clone().sub(half), max: center.clone().add(half) };
}

export function makeWind(center, size, force) {
  return { ...volume(center, size), force: force.clone() };
}

export function makeLaser(center, size, period = 2.8, duty = 0.5, phase = 0) {
  return { ...volume(center, size), period, duty, phase };
}

export function laserOn(l, t) {
  return ((t + l.phase) % l.period) / l.period < l.duty;
}

function inside(p, b) {
  return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
}

export function windForce(course, p, out = new Vector3()) {
  out.set(0, 0, 0);
  for (const w of course.winds || []) if (inside(p, w)) out.add(w.force);
  return out;
}

function setBoxCenter(b) {
  b.min.set(b.center.x - b.size.x / 2, b.center.y - b.size.y / 2, b.center.z - b.size.z / 2);
  b.max.set(b.center.x + b.size.x / 2, b.center.y + b.size.y / 2, b.center.z + b.size.z / 2);
}

// Put every crumbling anchor back (restart, or back to the start).
export function resetHazards(course) {
  for (const b of course.boxes) {
    if (!b.crumble) continue;
    b.crumble.t = null;
    b.crumble.fallV = 0;
    b.gone = false;
    b.center.copy(b.crumble.home);
    setBoxCenter(b);
  }
}

// One physics step of crumbling anchors and laser gates.
// Returns { dropped: bool (your anchor fell away), zapped: bool }.
export function updateHazards(course, dt, player, time) {
  const res = { dropped: false, zapped: false };
  for (const b of course.boxes) {
    const c = b.crumble;
    if (!c || b.gone) continue;
    if (c.t === null && player.hook?.box === b) c.t = 0;
    if (c.t === null) continue;
    c.t += dt;
    if (c.t < CRUMBLE_DELAY) continue;
    // Falling.
    c.fallV += FALL_GRAVITY * dt;
    b.center.y -= c.fallV * dt;
    setBoxCenter(b);
    if (player.hook?.box === b) {
      player.hook = null;
      res.dropped = true;
    }
    if (player.pending?.box === b) player.pending = null;
    if (b.center.y < course.killY - 80) b.gone = true;
  }
  for (const l of course.lasers || []) {
    if (laserOn(l, time) && inside(player.pos, l)) res.zapped = true;
  }
  return res;
}

// Add storm hazards on top of a generated layout. n: 0..9 (level 31..40).
export function decorateStorm(course, seed, n) {
  const e = n / 9;
  const rand = mulberry32(seed ^ 0x7f4a7c15);
  const A = course.anchors;
  course.winds = [];
  course.lasers = [];
  const cpZ = course.checkpoints.map((cp) => cp.platform.center.z);
  for (let i = 1; i < A.length; i++) {
    const prev = A[i - 1].motion ? A[i - 1].base : A[i - 1].center;
    const a = A[i];
    const ac = a.motion ? a.base : a.center;
    const gapHasCheckpoint = cpZ.some((z) => z < prev.z && z > ac.z);
    if (i < A.length - 1 && rand() < 0.2 + 0.2 * e) {
      a.crumble = { t: null, fallV: 0, home: (a.motion ? a.base : a.center).clone() };
    }
    if (gapHasCheckpoint) continue;
    const mid = prev.clone().lerp(ac, 0.5);
    const gap = prev.z - ac.z;
    const lowY = Math.min(prev.y, ac.y);
    if (rand() < 0.25 + 0.15 * e) {
      const up = rand() < 0.3;
      const force = up ? new Vector3(0, 16, 0) : new Vector3((rand() < 0.5 ? -1 : 1) * range(rand, 9, 16), 0, 0);
      course.winds.push(makeWind(new Vector3(mid.x, mid.y - 10, mid.z), new Vector3(22, 34, gap * 0.8), force));
    } else if (rand() < 0.15 + 0.25 * e) {
      // A gate across the lower half of the swing: stay high or time it.
      course.lasers.push(makeLaser(
        new Vector3(mid.x, lowY - 25, mid.z),
        new Vector3(26, 22, 0.8),
        range(rand, 2.4, 3.2), 0.5, rand() * 3
      ));
    }
    if (rand() < 0.2) {
      const side = rand() < 0.5 ? -1 : 1;
      const len = gap + 6;
      const zip = {
        kind: 'zip',
        center: new Vector3(mid.x + side * 10, Math.max(prev.y, ac.y) + 2, (prev.z + ac.z) / 2),
        size: new Vector3(0.5, 0.5, len),
      };
      zip.min = zip.center.clone().sub(zip.size.clone().multiplyScalar(0.5));
      zip.max = zip.center.clone().add(zip.size.clone().multiplyScalar(0.5));
      course.boxes.push(zip);
    }
  }
  return course;
}
