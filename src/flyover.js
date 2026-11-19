import * as THREE from 'three';
import { eyePosition } from './physics.js';

// Level flyover: before a level starts, the camera sweeps along the route
// (start -> anchors -> finish), then settles back into the player's view.

export class Flyover {
  constructor(course, player) {
    const pts = [course.spawn.pos.clone().add(new THREE.Vector3(0, 10, 22))];
    const anchors = course.anchors;
    const stride = Math.max(1, Math.ceil(anchors.length / 9)); // keep it short on long levels
    for (let i = 0; i < anchors.length; i += stride) {
      pts.push(anchors[i].center.clone().add(new THREE.Vector3(10, 16, 28))); // above, behind and to the side
    }
    const end = course.finish ? course.finish.platform.center : anchors[anchors.length - 1]?.center;
    if (end) pts.push(end.clone().add(new THREE.Vector3(0, 14, 24)));
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const length = this.curve.getLength();
    this.flyTime = Math.min(6, Math.max(3.5, length / 110));
    this.returnTime = 0.9;
    this.duration = this.flyTime + this.returnTime;
    this.t = 0;
    this.player = player;
    this.done = pts.length < 2;
    this.pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  }

  // Advance and return the camera pose ({ pos, look }), or null when done.
  update(dt) {
    if (this.done) return null;
    this.t += dt;
    if (this.t >= this.duration) {
      this.done = true;
      return null;
    }
    const ease = (x) => x * x * (3 - 2 * x);
    if (this.t < this.flyTime) {
      const u = ease(this.t / this.flyTime);
      this.curve.getPointAt(u, this.pose.pos);
      this.curve.getPointAt(Math.min(1, u + 0.12), this.pose.look);
      this.pose.look.add(new THREE.Vector3(-10, -16, -28)); // look at the route itself, not the camera path
    } else {
      // Glide from the end of the route back to the player's eyes.
      const k = ease((this.t - this.flyTime) / this.returnTime);
      const eye = eyePosition(this.player);
      const fwd = new THREE.Vector3(-Math.sin(this.player.yaw), Math.sin(this.player.pitch), -Math.cos(this.player.yaw));
      const endPos = this.curve.getPointAt(1);
      this.pose.pos.copy(endPos).lerp(eye, k);
      this.pose.look.copy(this.curve.getPointAt(1).add(new THREE.Vector3(0, -6, -10))).lerp(eye.clone().add(fwd.multiplyScalar(10)), k);
    }
    return this.pose;
  }

  skip() {
    this.done = true;
  }
}
