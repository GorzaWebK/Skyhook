import { Vector3 } from 'three';
import { mulberry32, range } from './rng.js';

// A course is plain data: a list of axis-aligned boxes plus the start,
// checkpoints and finish. Everything solid can be hooked.
//
// Box kinds: 'platform' | 'anchor' | 'pillar' | 'checkpoint' | 'finish'

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

export const COURSES = [{ id: 'course-1', name: 'First Flight', seed: 1 }];

export function generateCourse(seed = 1) {
  const rand = mulberry32(seed);
  const boxes = [];
  const anchors = [];
  const checkpoints = [];

  // Start platform: top surface at y = 0, player faces -Z.
  const startPlatform = box(new Vector3(0, -1, 0), new Vector3(14, 2, 14), 'platform');
  boxes.push(startPlatform);
  const spawn = { pos: new Vector3(0, 0.51, 4), yaw: 0 };
  const startZone = trigger(new Vector3(0, 4, 0), new Vector3(14, 10, 14));

  const anchorCount = 16;
  const checkpointAfter = new Set([5, 10]);
  let x = 0;
  let y = 22;
  let z = -6; // first anchor ~30-40 m from the start, within hook range

  for (let i = 0; i < anchorCount; i++) {
    z -= range(rand, 24, 33);
    x = Math.max(-26, Math.min(26, x + range(rand, -11, 11)));
    y = Math.max(17, Math.min(32, y + range(rand, -4, 5)));
    const s = range(rand, 3.2, 5.2);
    const a = box(new Vector3(x, y, z), new Vector3(s, s * range(rand, 0.8, 1.3), s), 'anchor');
    boxes.push(a);
    anchors.push(a);

    if (checkpointAfter.has(i)) {
      // A small landing platform below and ahead of this anchor, with a gate.
      z -= 16;
      const py = y - 18;
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
  }

  // Finish platform under a tall column of light. Flying through the column
  // anywhere along its height counts.
  z -= 30;
  const fy = y - 16;
  const finishPlatform = box(new Vector3(x, fy - 1, z), new Vector3(18, 2, 18), 'finish');
  boxes.push(finishPlatform);
  const finish = {
    platform: finishPlatform,
    trigger: trigger(new Vector3(x, fy + 25, z), new Vector3(24, 50, 24)),
  };

  // Scenery pillars rising out of the clouds on both sides. Also hookable,
  // so they double as emergency anchors.
  for (let pz = 10; pz > z - 60; pz -= range(rand, 45, 70)) {
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

  return {
    seed,
    boxes,
    anchors,
    checkpoints,
    finish,
    spawn,
    startZone,
    killY: -45,
  };
}

export function insideBox(p, b) {
  return (
    p.x >= b.min.x && p.x <= b.max.x &&
    p.y >= b.min.y && p.y <= b.max.y &&
    p.z >= b.min.z && p.z <= b.max.z
  );
}
