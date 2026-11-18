import * as THREE from 'three';
import { makePanelTexture, makeStripeTexture, makeCloudTexture } from './textures.js';
import { eyePosition } from './physics.js';

const SKY_TOP = new THREE.Color('#3b7bd4');
const SKY_HORIZON = new THREE.Color('#bfdcf2');
const SUN_DIR = new THREE.Vector3(-0.4, 0.55, -0.75).normalize();

const KIND_STYLE = {
  platform: { color: '#c9ccd2', tile: 4 },
  checkpoint: { color: '#8fe3e8', tile: 4, emissive: '#1a5a60' },
  finish: { color: '#ffd36b', tile: 4, emissive: '#5a4210' },
  pillar: { color: '#a9b3c7', tile: 8 },
  blocker: { color: '#3a4150', tile: 3, metal: true },
  anchor: { color: '#ff9a4d', tile: 2.5, stripes: true, emissive: '#ff5a10', emissiveIntensity: 0.45 },
};

// Box UVs scaled to world size so texture tiles stay square on any box.
function boxGeometry(size, tile) {
  const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
  const uv = geo.attributes.uv;
  // Face order: +x, -x, +y, -y, +z, -z (4 verts each).
  const dims = [
    [size.z, size.y], [size.z, size.y],
    [size.x, size.z], [size.x, size.z],
    [size.x, size.y], [size.x, size.y],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return geo;
}

function makeSky() {
  const geo = new THREE.SphereGeometry(1500, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY_TOP },
      horizon: { value: SKY_HORIZON },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
        col = mix(col, horizon * 1.02, smoothstep(0.0, -0.3, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 1800.0) * 3.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

// A soft vertical beam for checkpoints and the finish.
function makeBeam(trigger, color) {
  const radius = Math.min(trigger.size.x, trigger.size.z) * 0.42;
  const geo = new THREE.CylinderGeometry(radius, radius, trigger.size.y, 32, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, strength: { value: 1 } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 color; uniform float time; uniform float strength;
      varying vec2 vUv;
      void main() {
        float fade = smoothstep(1.0, 0.2, vUv.y) * smoothstep(0.0, 0.05, vUv.y);
        float bands = 0.65 + 0.35 * sin(vUv.y * 40.0 - time * 3.0);
        gl_FragColor = vec4(color * fade * bands * 0.35 * strength, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(trigger.center);
  return mesh;
}

function makeRing(center, radius, color) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.35, 10, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 })
  );
  mesh.position.copy(center);
  return mesh;
}

export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 150, 700);
    this.camera = new THREE.PerspectiveCamera(85, 1, 0.1, 3000);
    this.camera.rotation.order = 'YXZ';
    this.baseFov = 85;

    this.scene.add(makeSky());
    this.scene.add(new THREE.HemisphereLight('#dceeff', '#6b7488', 1.6));
    const sun = new THREE.DirectionalLight('#fff3e0', 2.2);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(sun);

    this.textures = { panel: makePanelTexture(), stripes: makeStripeTexture() };
    this.courseGroup = new THREE.Group();
    this.scene.add(this.courseGroup);

    this.addClouds();
    this.addRope();
    this.addTargetMarker();

    this.shake = 0;
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  addClouds() {
    const tex = makeCloudTexture();
    tex.repeat.set(10, 10);
    this.cloudLayers = [];
    for (const [y, opacity, speed] of [[-38, 0.95, 1], [-55, 1, 0.6]]) {
      const t = tex.clone();
      t.repeat.set(10, 10);
      t.needsUpdate = true;
      const mat = new THREE.MeshBasicMaterial({
        map: t, transparent: true, opacity, depthWrite: false, color: '#ffffff',
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      this.scene.add(mesh);
      this.cloudLayers.push({ mesh, tex: t, speed });
    }
    // Solid haze under the clouds so you never see "through" the world.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ color: SKY_HORIZON })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -70;
    this.scene.add(floor);
  }

  addRope() {
    // Tapered: hair-thin at your hand, thicker at the anchor end, so it never
    // fills the screen up close but is still visible far away.
    const geo = new THREE.CylinderGeometry(0.07, 0.006, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    this.rope = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#2b2b33' }));
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    this.scene.add(this.rope);
    this.hookHead = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28),
      new THREE.MeshStandardMaterial({ color: '#444', metalness: 0.8, roughness: 0.3 })
    );
    this.hookHead.visible = false;
    this.scene.add(this.hookHead);
  }

  addTargetMarker() {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.65, 24),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide })
    );
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  buildCourse(course) {
    for (const child of [...this.courseGroup.children]) {
      this.courseGroup.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
    const materials = {};
    for (const [kind, style] of Object.entries(KIND_STYLE)) {
      materials[kind] = new THREE.MeshStandardMaterial({
        color: style.color,
        map: style.stripes ? this.textures.stripes : this.textures.panel,
        roughness: style.metal ? 0.25 : 0.85,
        metalness: style.metal ? 0.45 : 0.05,
        emissive: style.emissive || '#000000',
        emissiveIntensity: style.emissive ? (style.emissiveIntensity ?? 0.6) : 0,
      });
    }
    for (const b of course.boxes) {
      const style = KIND_STYLE[b.kind];
      const mesh = new THREE.Mesh(boxGeometry(b.size, style.tile), materials[b.kind]);
      mesh.position.copy(b.center);
      this.courseGroup.add(mesh);
    }

    this.checkpointFx = course.checkpoints.map((cp) => {
      const beam = makeBeam(cp.trigger, '#5ff0ff');
      const ringCenter = cp.platform.center.clone();
      ringCenter.y += 6;
      const ring = makeRing(ringCenter, 4.5, '#5ff0ff');
      this.courseGroup.add(beam, ring);
      return { beam, ring };
    });
    const fBeam = makeBeam(course.finish.trigger, '#ffd36b');
    const fRingCenter = course.finish.platform.center.clone();
    fRingCenter.y += 8;
    const fRing = makeRing(fRingCenter, 7, '#ffcf4d');
    this.courseGroup.add(fBeam, fRing);
    this.finishFx = { beam: fBeam, ring: fRing };
  }

  setCheckpointReached(index) {
    this.checkpointFx?.forEach((fx, i) => {
      const reached = i <= index;
      const color = reached ? '#7dff9a' : '#5ff0ff';
      fx.beam.material.uniforms.color.value.set(color);
      fx.ring.material.color.set(color);
      fx.ring.material.emissive.set(color);
    });
  }

  addShake(amount) {
    this.shake = Math.min(1, this.shake + amount);
  }

  // target: raycast hit under the crosshair (or null)
  render(player, target, dt) {
    this.time += dt;
    const cam = this.camera;
    eyePosition(player, cam.position);
    cam.rotation.y = player.yaw;
    cam.rotation.x = player.pitch;

    // Camera shake.
    if (this.shake > 0) {
      const s = this.shake * this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }

    // Widen the view as you go faster.
    const speed = player.vel.length();
    const fov = this.baseFov + 22 * Math.min(1, Math.max(0, (speed - 12) / 45));
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // Rope from just below-right of the camera to the anchor.
    if (player.hook) {
      const start = new THREE.Vector3(0.3, -0.35, -0.6).applyMatrix4(cam.matrixWorld);
      const end = player.hook.point;
      const dir = end.clone().sub(start);
      const len = dir.length();
      this.rope.position.copy(start);
      this.rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      this.rope.scale.set(1, len, 1);
      this.rope.visible = true;
      this.hookHead.position.copy(end);
      this.hookHead.rotation.y += dt * 4;
      this.hookHead.visible = true;
    } else {
      this.rope.visible = false;
      this.hookHead.visible = false;
    }

    // Marker on the surface the crosshair would hook.
    if (target && !player.hook) {
      this.marker.visible = true;
      this.marker.position.copy(target.point);
      this.marker.lookAt(cam.position);
      const d = target.distance;
      this.marker.scale.setScalar(Math.max(1, d * 0.04));
    } else {
      this.marker.visible = false;
    }

    // Animate beams and clouds.
    const fxList = [...(this.checkpointFx || []), this.finishFx].filter(Boolean);
    for (const fx of fxList) {
      fx.beam.material.uniforms.time.value = this.time;
      fx.ring.rotation.y += dt * 0.6;
    }
    for (const layer of this.cloudLayers) {
      layer.tex.offset.x = this.time * 0.002 * layer.speed;
      layer.tex.offset.y = this.time * 0.001 * layer.speed;
    }

    this.renderer.render(this.scene, cam);
  }
}

