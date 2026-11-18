import { Vector3 } from 'three';
import { isHookable } from './course.js';

// All the movement feel lives in these numbers.
export const TUNING = {
  gravity: 24,
  radius: 0.5,
  eyeHeight: 0.35, // camera offset above the player's centre
  hookRange: 55,
  hookSpeed: 250, // how fast the fired hook flies to its target (m/s)
  reelSpeed: 17, // how fast holding right mouse shortens the rope (m/s)
  minRope: 2,
  releaseHopUp: 10, // upward speed given when you let go of the rope (m/s)
  releaseHopForward: 4, // push in the direction you're facing when you let go
  releaseHopMinHold: 0.25, // must hold the rope this long to earn the hop (s)
  attachTug: 2.5, // small pull towards the anchor the moment you hook
  walkSpeed: 9,
  groundAccel: 70,
  jumpSpeed: 9,
  airAccel: 6, // steering while flying free
  swingAccel: 11, // pumping the swing while hooked
  airControlMax: 16, // steering won't push you faster than this in a direction
  drag: 0.02,
  maxSpeed: 90,
};

export const FIXED_DT = 1 / 120;

export function createPlayer(spawn) {
  return {
    pos: spawn.pos.clone(),
    vel: new Vector3(),
    yaw: spawn.yaw,
    pitch: 0,
    grounded: false,
    groundBox: null,
    hook: null, // { point: Vector3, length: number, box, time }
    pending: null, // hook in flight: { point, box, origin, dir, dist, travel }
  };
}

export function resetPlayer(player, spawn) {
  player.pos.copy(spawn.pos);
  player.vel.set(0, 0, 0);
  player.yaw = spawn.yaw;
  player.pitch = 0;
  player.grounded = false;
  player.groundBox = null;
  player.hook = null;
  player.pending = null;
}

export function eyePosition(player, out = new Vector3()) {
  return out.set(player.pos.x, player.pos.y + TUNING.eyeHeight, player.pos.z);
}

export function aimDirection(yaw, pitch, out = new Vector3()) {
  const c = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c).normalize();
}

// Ray vs axis-aligned box (slab method). Returns distance or -1.
function rayBox(o, d, b, maxDist) {
  let tmin = 0;
  let tmax = maxDist;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(d[axis]) < 1e-12) {
      // Ray runs parallel to this pair of faces: it hits only if it starts
      // between them. (Avoids 0 * Infinity = NaN.)
      if (o[axis] < b.min[axis] || o[axis] > b.max[axis]) return -1;
      continue;
    }
    const inv = 1 / d[axis];
    let t1 = (b.min[axis] - o[axis]) * inv;
    let t2 = (b.max[axis] - o[axis]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

export function raycast(course, origin, dir, maxDist = TUNING.hookRange) {
  let best = null;
  for (const b of course.boxes) {
    const t = rayBox(origin, dir, b, maxDist);
    if (t >= 0 && (!best || t < best.distance)) best = { distance: t, box: b };
  }
  if (!best) return null;
  best.point = origin.clone().addScaledVector(dir, best.distance);
  return best;
}

function attachHook(player, point, box) {
  const toAnchor = point.clone().sub(player.pos);
  const dist = toAnchor.length();
  player.hook = { point, length: Math.max(TUNING.minRope, dist), box, time: 0 };
  player.pending = null;
  if (dist > 0.001) player.vel.addScaledVector(toAnchor.divideScalar(dist), TUNING.attachTug);
}

// Fire the hook: it flies to whatever is under the crosshair and catches
// when it arrives (see step). Returns the hit, or null if there's nothing
// hookable in range.
export function fireHook(player, course, dir) {
  const origin = eyePosition(player);
  const hit = raycast(course, origin, dir);
  if (!hit || !isHookable(hit.box)) return null;
  player.hook = null;
  player.pending = { point: hit.point, box: hit.box, origin, dir: dir.clone(), dist: hit.distance, travel: 0 };
  return hit;
}

// Instant version (no flight time), used by tests.
export function tryHook(player, course, dir) {
  const hit = raycast(course, eyePosition(player), dir);
  if (!hit || !isHookable(hit.box)) return null;
  attachHook(player, hit.point, hit.box);
  return hit;
}

// Let go of the rope. With hop, a rope held long enough gives a small jump
// up and forward, which can save a run that was about to fall.
// Returns { released, hopped }.
export function releaseHook(player, { hop = false } = {}) {
  const hook = player.hook;
  player.hook = null;
  if (!hook) {
    // Let go while the hook was still flying: the shot is cancelled.
    const cancelled = !!player.pending;
    player.pending = null;
    return { released: false, hopped: false, cancelled };
  }
  const t = TUNING;
  if (hop && hook.time >= t.releaseHopMinHold) {
    player.vel.y = Math.max(player.vel.y, 0) + t.releaseHopUp;
    player.vel.x += -Math.sin(player.yaw) * t.releaseHopForward;
    player.vel.z += -Math.cos(player.yaw) * t.releaseHopForward;
    return { released: true, hopped: true };
  }
  return { released: true, hopped: false };
}

const _fwd = new Vector3();
const _right = new Vector3();
const _wish = new Vector3();
const _n = new Vector3();

// input: { forward: -1..1, right: -1..1, jump: bool, reel: bool }
// Returns events from this step (e.g. landing impact speed).
export function step(player, input, course, dt = FIXED_DT) {
  const t = TUNING;
  const events = {};

  _fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  _wish.set(0, 0, 0)
    .addScaledVector(_fwd, input.forward || 0)
    .addScaledVector(_right, input.right || 0);
  const wishLen = Math.min(1, _wish.length());
  if (wishLen > 0) _wish.normalize();

  if (player.grounded) {
    // Walk: steer horizontal velocity towards the wished velocity.
    const tx = _wish.x * t.walkSpeed * wishLen;
    const tz = _wish.z * t.walkSpeed * wishLen;
    let dx = tx - player.vel.x;
    let dz = tz - player.vel.z;
    const dl = Math.hypot(dx, dz);
    const maxDelta = t.groundAccel * dt;
    if (dl > maxDelta) {
      dx *= maxDelta / dl;
      dz *= maxDelta / dl;
    }
    player.vel.x += dx;
    player.vel.z += dz;
    if (input.jump) {
      player.vel.y = t.jumpSpeed;
      player.grounded = false;
      events.jumped = true;
    }
  } else if (wishLen > 0) {
    const accel = player.hook ? t.swingAccel : t.airAccel;
    const along = player.vel.dot(_wish);
    if (along < t.airControlMax) player.vel.addScaledVector(_wish, accel * wishLen * dt);
  }

  player.vel.y -= t.gravity * dt;
  player.vel.multiplyScalar(1 - t.drag * dt);

  // A fired hook travels towards its target and catches when it arrives.
  if (player.pending) {
    const pd = player.pending;
    pd.travel += t.hookSpeed * dt;
    if (pd.travel >= pd.dist) {
      attachHook(player, pd.point, pd.box);
      events.attached = true;
    }
  }

  // The rope keeps the length it had when it caught, unless you reel in.
  let reeling = false;
  if (player.hook) {
    player.hook.time += dt;
    if (input.reel) {
      player.hook.length = Math.max(t.minRope, player.hook.length - t.reelSpeed * dt);
      reeling = player.hook.length > t.minRope;
    }
  }

  player.pos.addScaledVector(player.vel, dt);

  // Rope: a rope, not a rod. It only pulls when stretched to full length.
  if (player.hook) {
    _n.subVectors(player.pos, player.hook.point);
    const dist = _n.length();
    if (dist > player.hook.length && dist > 1e-6) {
      _n.divideScalar(dist);
      player.pos.copy(player.hook.point).addScaledVector(_n, player.hook.length);
      const vr = player.vel.dot(_n);
      // Reeling in gives real inward speed, so you keep the momentum.
      const minInward = reeling ? -t.reelSpeed : 0;
      if (vr > minInward) player.vel.addScaledVector(_n, minInward - vr);
    }
  }

  const wasGrounded = player.grounded;
  const preVelY = player.vel.y;
  player.grounded = false;
  player.groundBox = null;
  collide(player, course);
  if (player.grounded && !wasGrounded) events.landed = -preVelY;

  const speed = player.vel.length();
  if (speed > t.maxSpeed) player.vel.multiplyScalar(t.maxSpeed / speed);

  return events;
}

function collide(player, course) {
  const r = TUNING.radius;
  const p = player.pos;
  for (const b of course.boxes) {
    // Cheap reject.
    if (p.x < b.min.x - r || p.x > b.max.x + r ||
        p.y < b.min.y - r || p.y > b.max.y + r ||
        p.z < b.min.z - r || p.z > b.max.z + r) continue;

    const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
    const cy = Math.max(b.min.y, Math.min(p.y, b.max.y));
    const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
    let nx = p.x - cx;
    let ny = p.y - cy;
    let nz = p.z - cz;
    const d2 = nx * nx + ny * ny + nz * nz;
    if (d2 >= r * r) continue;

    let pen;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      nx /= d; ny /= d; nz /= d;
      pen = r - d;
    } else {
      // Centre is inside the box: push out through the nearest face.
      const faces = [
        [b.max.x - p.x, 1, 0, 0], [p.x - b.min.x, -1, 0, 0],
        [b.max.y - p.y, 0, 1, 0], [p.y - b.min.y, 0, -1, 0],
        [b.max.z - p.z, 0, 0, 1], [p.z - b.min.z, 0, 0, -1],
      ];
      faces.sort((f1, f2) => f1[0] - f2[0]);
      [pen, nx, ny, nz] = faces[0];
      pen += r;
    }
    p.x += nx * pen; p.y += ny * pen; p.z += nz * pen;
    const vn = player.vel.x * nx + player.vel.y * ny + player.vel.z * nz;
    if (vn < 0) {
      player.vel.x -= nx * vn; player.vel.y -= ny * vn; player.vel.z -= nz * vn;
    }
    if (ny > 0.6) {
      player.grounded = true;
      player.groundBox = b;
    }
  }
}
