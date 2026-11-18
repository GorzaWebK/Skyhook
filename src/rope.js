import * as THREE from 'three';

// The rope is a flat strip that always faces the camera, with its width
// scaled by distance so it looks like a crisp line of constant thickness:
// never a fat wedge up close, never vanishing far away.
export class Rope {
  constructor(segments = 40) {
    this.n = segments;
    const count = (segments + 1) * 2;
    this.positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const index = [];
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#1c1f27', side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.points = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    this._t = new THREE.Vector3();
    this._toCam = new THREE.Vector3();
    this._side = new THREE.Vector3();
  }

  // shapeFn(u, out) fills out with the rope point at u in [0, 1].
  update(shapeFn, camPos, pixelWidth = 0.0019) {
    const pts = this.points;
    for (let i = 0; i <= this.n; i++) shapeFn(i / this.n, pts[i]);
    const pos = this.positions;
    for (let i = 0; i <= this.n; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(this.n, i + 1)];
      this._t.subVectors(b, a).normalize();
      this._toCam.subVectors(camPos, p);
      const w = Math.max(0.003, this._toCam.length() * pixelWidth);
      this._side.crossVectors(this._t, this._toCam).normalize().multiplyScalar(w);
      pos[i * 6] = p.x + this._side.x;
      pos[i * 6 + 1] = p.y + this._side.y;
      pos[i * 6 + 2] = p.z + this._side.z;
      pos[i * 6 + 3] = p.x - this._side.x;
      pos[i * 6 + 4] = p.y - this._side.y;
      pos[i * 6 + 5] = p.z - this._side.z;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}
