import * as THREE from 'three';

// Visual effects: sparks where the hook bites, rain for the storm theme,
// and speed lines at high speed.

// --- Sparks -------------------------------------------------------------------
let dot = null;
function dotTexture() {
  if (dot) return dot;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dot = new THREE.CanvasTexture(c);
  return dot;
}
export class Sparks {
  constructor(scene, count = 28, pool = 4) {
    this.bursts = [];
    for (let b = 0; b < pool; b++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      // Small solid dots of fixed on-screen size (not additive), so they read as
      // sparks on light and dark blocks, near or far.
      const mat = new THREE.PointsMaterial({
        color: '#ffb020', size: 6, sizeAttenuation: false, map: dotTexture(), transparent: true, opacity: 1,
        depthWrite: false, toneMapped: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      scene.add(points);
      this.bursts.push({ points, vel: new Float32Array(count * 3), life: 0, count });
    }
    this.next = 0;
  }

  // point: where the hook landed; normal: the face it hit.
  burst(point, normal, color = '#ffcf6b') {
    const b = this.bursts[this.next++ % this.bursts.length];
    const pos = b.points.geometry.attributes.position.array;
    for (let i = 0; i < b.count; i++) {
      pos[i * 3] = point.x;
      pos[i * 3 + 1] = point.y;
      pos[i * 3 + 2] = point.z;
      // Random direction in the hemisphere facing out of the surface.
      const d = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (d.dot(normal) < 0) d.addScaledVector(normal, -2 * d.dot(normal));
      d.addScaledVector(normal, 0.6).normalize().multiplyScalar(4 + Math.random() * 9);
      b.vel[i * 3] = d.x;
      b.vel[i * 3 + 1] = d.y;
      b.vel[i * 3 + 2] = d.z;
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.material.color.set(color);
    b.life = 1;
    b.points.visible = true;
  }

  update(dt) {
    for (const b of this.bursts) {
      if (b.life <= 0) continue;
      b.life -= dt * 1.4; // about 0.7 s
      const pos = b.points.geometry.attributes.position.array;
      for (let i = 0; i < b.count; i++) {
        b.vel[i * 3 + 1] -= 20 * dt;
        pos[i * 3] += b.vel[i * 3] * dt;
        pos[i * 3 + 1] += b.vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.points.material.opacity = Math.max(0, b.life);
      b.points.material.size = 2.5 + 4.5 * Math.max(0, b.life); // on-screen pixels
      if (b.life <= 0) b.points.visible = false;
    }
  }

  get active() {
    return this.bursts.some((b) => b.life > 0);
  }
}

// --- Rain ---------------------------------------------------------------------
// Streaks in a box that follows the camera; the falling motion is done in
// the vertex shader, so it costs almost nothing.
export class Rain {
  constructor(scene, count = 1600) {
    const SIZE = 70;
    const HEIGHT = 50;
    const pos = new Float32Array(count * 6);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * SIZE;
      const y = Math.random() * HEIGHT;
      const z = (Math.random() - 0.5) * SIZE;
      pos.set([x, y, z, x + 0.05, y + 1.1, z], i * 6);
      const s = Math.random() * HEIGHT;
      seed[i * 2] = s;
      seed[i * 2 + 1] = s;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { time: { value: 0 }, height: { value: HEIGHT } },
      vertexShader: `
        attribute float seed;
        uniform float time; uniform float height;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - time * 38.0 + seed, height) - height * 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `void main() { gl_FragColor = vec4(0.75, 0.8, 0.9, 0.35); }`,
    });
    this.mesh = new THREE.LineSegments(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt, camPos, time) {
    if (!this.mesh.visible) return;
    this.mesh.position.copy(camPos);
    this.material.uniforms.time.value = time;
  }
}

// --- Speed lines ----------------------------------------------------------------
// A full-screen overlay (drawn with the arm's camera) with streaks rushing
// out from the centre and darker edges, fading in with speed.
export function makeSpeedLines() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { strength: { value: 0 }, time: { value: 0 }, aspect: { value: 1.7 } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform float strength; uniform float time; uniform float aspect;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
        float r = length(p);
        float a = atan(p.y, p.x);
        float lanes = 120.0;
        float fa = a * lanes / 6.2831853;
        float lane = floor(fa);
        float f = fract(fa);
        float h = hash(lane);
        // Thin streaks: only some lanes, only the middle of each lane.
        float thin = smoothstep(0.42, 0.5, f) * (1.0 - smoothstep(0.5, 0.58, f));
        float streak = step(0.6, h) * thin * smoothstep(0.32, 0.7, r);
        float moving = fract(r * 1.4 - time * (1.6 + h * 2.2) + h * 7.0);
        streak *= smoothstep(0.0, 0.1, moving) * (1.0 - smoothstep(0.25, 0.5, moving));
        float edge = smoothstep(0.5, 1.0, r);
        float alpha = strength * (streak * 0.45 + edge * 0.28);
        vec3 col = vec3(streak > 0.01 ? 1.0 : 0.0);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// --- Hook trail -----------------------------------------------------------------
// A short trail of dots behind the flying hook (cosmetic, see cosmetics.js).
export class HookTrail {
  constructor(scene, count = 48) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.age = new Float32Array(count).fill(99);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('age', new THREE.BufferAttribute(this.age, 1));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { size: { value: 7 }, life: { value: 0.45 } },
      vertexShader: `
        attribute float age; attribute vec3 color;
        uniform float size; uniform float life;
        varying float vA; varying vec3 vC;
        void main() {
          vA = clamp(1.0 - age / life, 0.0, 1.0);
          vC = color;
          gl_PointSize = size * (0.35 + 0.65 * vA);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5 || vA <= 0.0) discard;
          gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.15, d));
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.style = null;
    this.hue = 0;
  }

  setStyle(style) {
    this.style = style && style.id !== 'none' ? style : null;
    if (this.style) this.material.uniforms.size.value = style.size || 7;
  }

  emit(p) {
    if (!this.style) return;
    const s = this.style;
    const i = this.next++ % this.count;
    const j = s.jitter || 0;
    this.pos[i * 3] = p.x + (Math.random() - 0.5) * j;
    this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * j;
    this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * j;
    const c = new THREE.Color();
    if (s.rainbow) {
      this.hue = (this.hue + 0.035) % 1;
      c.setHSL(this.hue, 0.9, 0.6);
    } else {
      c.set(s.colors[Math.floor(Math.random() * s.colors.length)]);
    }
    this.col.set([c.r, c.g, c.b], i * 3);
    this.age[i] = 0;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) this.age[i] += dt;
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = g.color.needsUpdate = g.age.needsUpdate = true;
  }

  get active() {
    return this.age.some((a) => a < 0.45);
  }
}
