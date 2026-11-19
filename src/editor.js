import * as THREE from 'three';
import { buildCustomCourse } from './course.js';
import { raycast, eyePosition, aimDirection } from './physics.js';

// Level editor: fly around and place or delete blocks where you aim.

export const TOOLS = [
  { key: 'a', name: 'Anchor', color: '#ff9a4d', sizes: [[4, 4, 4], [3, 3, 3], [5, 5, 5], [6, 6, 6], [8, 8, 8], [3, 8, 3]] },
  { key: 'b', name: 'Smooth block', color: '#7a8496', sizes: [[8, 8, 2], [6, 6, 2], [12, 10, 2], [4, 14, 4], [10, 3, 10]] },
  { key: 'p', name: 'Platform', color: '#c9ccd2', sizes: [[10, 1.5, 10], [6, 1.5, 6], [16, 2, 16], [4, 1, 20]] },
  { key: 'c', name: 'Checkpoint', color: '#8fe3e8', sizes: [[11, 1.5, 11], [8, 1.5, 8]] },
  { key: 'f', name: 'Finish', color: '#ffd36b', sizes: [[18, 2, 18], [12, 2, 12]] },
];

export const EDITOR_RANGE = 150;
const FLY_SPEED = 22;
const snap = (v) => Math.round(v * 2) / 2;

// Which face of the box is the point on? Returns a unit axis vector.
export function faceNormal(b, p) {
  const faces = [
    [Math.abs(p.x - b.max.x), 1, 0, 0], [Math.abs(p.x - b.min.x), -1, 0, 0],
    [Math.abs(p.y - b.max.y), 0, 1, 0], [Math.abs(p.y - b.min.y), 0, -1, 0],
    [Math.abs(p.z - b.max.z), 0, 0, 1], [Math.abs(p.z - b.min.z), 0, 0, -1],
  ];
  faces.sort((f1, f2) => f1[0] - f2[0]);
  return new THREE.Vector3(faces[0][1], faces[0][2], faces[0][3]);
}

// Where a block of `size` goes when placed against the hit surface (or
// floating in front of you if you're aiming at empty sky).
export function placementCenter(hit, size, eye, dir) {
  const size3 = new THREE.Vector3(...size);
  if (!hit) {
    const p = eye.clone().addScaledVector(dir, 18);
    return new THREE.Vector3(snap(p.x), snap(p.y), snap(p.z));
  }
  const n = faceNormal(hit.box, hit.point);
  const c = new THREE.Vector3(snap(hit.point.x), snap(hit.point.y), snap(hit.point.z));
  for (const axis of ['x', 'y', 'z']) {
    if (n[axis] > 0) c[axis] = hit.box.max[axis] + size3[axis] / 2;
    if (n[axis] < 0) c[axis] = hit.box.min[axis] - size3[axis] / 2;
  }
  return c;
}

export class Editor {
  constructor(renderer) {
    this.renderer = renderer;
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false })
    );
    this.ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: '#ffffff' })
    );
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: '#ff5a5a', depthTest: false })
    );
    this.highlight.renderOrder = 20;
    for (const o of [this.ghost, this.ghostEdges, this.highlight]) {
      o.visible = false;
      o.frustumCulled = false;
      renderer.scene.add(o);
    }
    this.level = null;
    this.onChange = null;
  }

  open(level) {
    this.level = level;
    this.tool = 0;
    this.sizeIndex = TOOLS.map(() => 0);
    this.rotated = false;
    this.customSize = null; // set by "copy block"
    this.undoStack = [];
    this.rebuild();
  }

  get blocks() {
    return this.level.data.blocks;
  }

  rebuild() {
    this.course = buildCustomCourse(this.level.data);
    this.renderer.buildCourse(this.course);
    this.onChange?.();
  }

  setTool(i) {
    this.tool = i;
    this.customSize = null;
    this.onChange?.();
  }

  cycleSize(delta) {
    const n = TOOLS[this.tool].sizes.length;
    this.sizeIndex[this.tool] = (this.sizeIndex[this.tool] + delta + n) % n;
    this.customSize = null;
    this.onChange?.();
  }

  rotate() {
    this.rotated = !this.rotated;
    this.onChange?.();
  }

  size() {
    const s = this.customSize || TOOLS[this.tool].sizes[this.sizeIndex[this.tool]];
    return this.rotated ? [s[2], s[1], s[0]] : [...s];
  }

  // What you're aiming at: the hit, the index of the block you'd delete
  // (-1 for the start platform or nothing), and where a new block would go.
  aim(player) {
    const eye = eyePosition(player);
    const dir = aimDirection(player.yaw, player.pitch);
    const hit = raycast(this.course, eye, dir, EDITOR_RANGE);
    const blockIndex = hit ? this.course.boxes.indexOf(hit.box) - 1 : -1; // box 0 is the start platform
    const size = this.size();
    return { hit, blockIndex, size, center: placementCenter(hit, size, eye, dir) };
  }

  updatePreview(player) {
    const a = this.aim(player);
    const tool = TOOLS[this.tool];
    this.ghost.visible = this.ghostEdges.visible = true;
    this.ghost.position.copy(a.center);
    this.ghost.scale.set(...a.size);
    this.ghostEdges.position.copy(a.center);
    this.ghostEdges.scale.set(...a.size);
    this.ghost.material.color.set(tool.color);
    this.ghostEdges.material.color.set(tool.color);
    if (a.blockIndex >= 0) {
      const b = a.hit.box;
      this.highlight.visible = true;
      this.highlight.position.copy(b.center);
      this.highlight.scale.copy(b.size).addScalar(0.15);
    } else {
      this.highlight.visible = false;
    }
    return a;
  }

  hidePreview() {
    this.ghost.visible = this.ghostEdges.visible = this.highlight.visible = false;
  }

  pushUndo() {
    this.undoStack.push(JSON.stringify(this.blocks));
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  place(player) {
    const a = this.aim(player);
    const key = TOOLS[this.tool].key;
    this.pushUndo();
    if (key === 'f') this.level.data.blocks = this.blocks.filter((b) => b[0] !== 'f'); // only one finish
    this.blocks.push([key, a.center.x, a.center.y, a.center.z, ...a.size]);
    this.rebuild();
    return true;
  }

  remove(player) {
    const a = this.aim(player);
    if (a.blockIndex < 0) return false;
    this.pushUndo();
    this.blocks.splice(a.blockIndex, 1);
    this.rebuild();
    return true;
  }

  // Pick up the type and size of the block you're aiming at.
  copy(player) {
    const a = this.aim(player);
    if (a.blockIndex < 0) return false;
    const [k, , , , sx, sy, sz] = this.blocks[a.blockIndex];
    this.tool = TOOLS.findIndex((t) => t.key === k);
    this.rotated = false;
    this.customSize = [sx, sy, sz];
    this.onChange?.();
    return true;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.level.data.blocks = JSON.parse(this.undoStack.pop());
    this.rebuild();
    return true;
  }

  // Free flight: no gravity, no collisions.
  fly(player, move, dt) {
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const v = new THREE.Vector3()
      .addScaledVector(fwd, move.forward)
      .addScaledVector(right, move.right);
    v.y += (move.up ? 1 : 0) - (move.down ? 1 : 0);
    if (v.lengthSq() > 1) v.normalize();
    player.pos.addScaledVector(v, FLY_SPEED * dt);
    player.vel.set(0, 0, 0);
  }
}
