import { Vector3 } from 'three';
import { eyePosition, raycast, TUNING } from './physics.js';
import { hook, unhook } from './run.js';

// A simple autopilot used by the automated tests (and ?bot=1) to prove a
// course can actually be finished. It hooks each anchor in turn, reels in a
// little, and lets go once it has swung past the anchor.
export function createBot(run) {
  return { run, target: 0, holdTime: 0 };
}

const _eye = new Vector3();
const _dir = new Vector3();

export function botInput(bot) {
  const { run } = bot;
  const p = run.player;
  const anchors = run.course.anchors;
  const input = { forward: 1, right: 0, jump: false, reel: false };

  // Skip anchors we've already flown past (e.g. after a checkpoint respawn).
  while (bot.target < anchors.length && !p.hook && anchors[bot.target].center.z > p.pos.z + 2) {
    bot.target++;
  }

  const a = anchors[bot.target];
  const aimPoint = a ? a.center : run.course.finish.trigger.center;

  // Face the next target.
  const dx = aimPoint.x - p.pos.x;
  const dz = aimPoint.z - p.pos.z;
  p.yaw = Math.atan2(-dx, -dz);

  if (!a) return input; // Last anchor done: glide to the finish.

  eyePosition(p, _eye);
  _dir.subVectors(a.center, _eye);
  const dist = _dir.length();
  _dir.normalize();
  p.pitch = Math.asin(_dir.y);

  if (p.pending) return input; // hook still flying
  if (!p.hook) {
    const falling = p.vel.y < 2 || p.grounded;
    if (dist < TUNING.hookRange - 3 && dist > 12 && falling) {
      const hit = raycast(run.course, _eye, _dir);
      if (hit && hit.box === a) {
        hook(run, _dir);
        bot.holdTime = 0;
      }
    }
    if (p.grounded) input.forward = 1;
  } else {
    bot.holdTime += 1 / 120;
    input.reel = p.hook.length > 16;
    // Let go once past the anchor and heading towards the next target.
    const next = anchors[bot.target + 1]?.center ?? run.course.finish.trigger.center;
    const nx = next.x - p.pos.x;
    const nz = next.z - p.pos.z;
    const hv = Math.hypot(p.vel.x, p.vel.z);
    const heading = hv > 1 ? (p.vel.x * nx + p.vel.z * nz) / (hv * Math.hypot(nx, nz)) : 0;
    const past = p.pos.z < a.center.z - 3;
    if ((past && p.vel.z < -6 && heading > 0.8) || bot.holdTime > 4) {
      unhook(run);
      bot.target++;
    }
  }
  return input;
}
