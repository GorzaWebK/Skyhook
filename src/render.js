import * as THREE from 'three';
import { makePanelTexture, makeStripeTexture, makeCloudTexture } from './textures.js';
import { eyePosition } from './physics.js';
import { ViewModel, makeClaw } from './viewmodel.js';
import { Rope } from './rope.js';
import { THEMES } from './themes.js';
import { Sparks, Rain, makeSpeedLines } from './effects.js';
import { faceNormal } from './editor.js';
import { ghostAt } from './ghost.js';

const SKY_TOP = new THREE.Color('#3b7bd4');
const SKY_HORIZON = new THREE.Color('#bfdcf2');
const SUN_DIR = new THREE.Vector3(-0.4, 0.55, -0.75).normalize();

const KIND_STYLE = {
  platform: { color: '#c9ccd2', tile: 4 },
  checkpoint: { color: '#8fe3e8', tile: 4, emissive: '#1a5a60' },
  finish: { color: '#ffd36b', tile: 4, emissive: '#5a4210' },
  pillar: { color: '#a9b3c7', tile: 8 },
  blocker: { color: '#3a4150', tile: 3, metal: true },
  moving: { color: '#ffc43d', tile: 2.5, stripes: true, emissive: '#ffae00', emissiveIntensity: 0.55 },
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
      top: { value: SKY_TOP.clone() },
      horizon: { value: SKY_HORIZON.clone() },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: new THREE.Color('#fff0d6') },
      sunGlow: { value: 1 },
      stars: { value: 0 },
      flash: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor;
      uniform float sunGlow; uniform float stars; uniform float flash;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
        col = mix(col, horizon * 1.02, smoothstep(0.0, -0.3, h));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 1800.0) * 3.0 * min(1.0, sunGlow * 2.0) + pow(s, 12.0) * 0.25 * sunGlow + pow(s, 3.0) * 0.12 * max(sunGlow - 1.0, 0.0));
        if (stars > 0.0) {
          vec3 cell = floor(d * 260.0);
          float r = hash(cell);
          float twinkle = 0.6 + 0.4 * sin(r * 100.0);
          col += vec3(0.85, 0.9, 1.0) * step(0.9965, r) * twinkle * stars * smoothstep(0.02, 0.25, h);
        }
        col += vec3(0.75, 0.8, 0.95) * flash;
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
    this.renderer.autoClear = false; // world pass, then the arm on top

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_HORIZON, 150, 700);
    this.camera = new THREE.PerspectiveCamera(85, 1, 0.1, 3000);
    this.camera.rotation.order = 'YXZ';
    this.baseFov = 85;

    this.sky = makeSky();
    this.scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight('#dceeff', '#6b7488', 1.6);
    this.scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight('#fff3e0', 2.2);
    this.sunLight.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(this.sunLight);

    this.textures = { panel: makePanelTexture(), stripes: makeStripeTexture() };
    this.courseGroup = new THREE.Group();
    this.scene.add(this.courseGroup);

    this.addClouds();
    this.addRope();
    this.addTargetMarker();
    this.viewModel = new ViewModel();
    this.sparks = new Sparks(this.scene);
    this.rain = new Rain(this.scene);
    this.fxScene = new THREE.Scene();
    this.speedLines = makeSpeedLines();
    this.fxScene.add(this.speedLines);
    this.speedStrength = 0;
    this.flash = 0;
    this.nextLightning = 5;
    this.onThunder = null; // set by the game to play thunder
    this.ghosts = [];
    this.setTheme('day');

    this.shake = 0;
    this.snapT = 0;
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
    this.viewModel?.resize(w / h);
    if (this.speedLines) this.speedLines.material.uniforms.aspect.value = w / h;
  }

  // Graphics quality: 'high' | 'medium' | 'low'.
  setQuality(q) {
    this.quality = ['high', 'medium', 'low'].includes(q) ? q : 'high';
    const dpr = window.devicePixelRatio || 1;
    const ratio = { high: Math.min(dpr, 2), medium: 1, low: 0.7 }[this.quality];
    this.renderer.setPixelRatio(ratio);
    this.resize();
    // Low: one cloud layer, less rain, shorter draw distance.
    this.cloudLayers[1].mesh.visible = this.quality !== 'low';
    this.rain.mesh.geometry.setDrawRange(0, this.rain.mesh.geometry.attributes.position.count * (this.quality === 'high' ? 1 : this.quality === 'medium' ? 0.6 : 0.3));
    this.camera.far = this.quality === 'low' ? 1600 : 3000;
    this.camera.updateProjectionMatrix();
  }

  setTheme(id) {
    const t = THEMES[id] || THEMES.day;
    this.themeId = THEMES[id] ? id : 'day';
    this.theme = t;
    const u = this.sky.material.uniforms;
    u.top.value.set(t.skyTop);
    u.horizon.value.set(t.horizon);
    u.sunDir.value.set(...t.sunDir).normalize();
    u.sunColor.value.set(t.sunColor);
    u.sunGlow.value = t.sunGlow;
    u.stars.value = t.stars;
    this.scene.fog.color.set(t.horizon);
    this.scene.fog.near = t.fog[0];
    this.scene.fog.far = t.fog[1];
    this.hemi.color.set(t.hemiSky);
    this.hemi.groundColor.set(t.hemiGround);
    this.hemi.intensity = this.baseHemi = t.hemi;
    this.sunLight.color.set(t.sun);
    this.sunLight.intensity = t.sunLight;
    this.sunLight.position.copy(u.sunDir.value).multiplyScalar(100);
    this.renderer.toneMappingExposure = t.exposure;
    for (const layer of this.cloudLayers) {
      layer.mesh.material.color.set(t.clouds);
      layer.mesh.material.opacity = t.cloudOpacity * layer.baseOpacity;
    }
    this.floor.material.color.set(t.horizon);
    this.rain.mesh.visible = !!t.rain;
    this.flash = 0;
  }

  // Ghosts: [{ samples, color, label }]. Replaces any current ghosts.
  setGhosts(list) {
    for (const g of this.ghosts) {
      this.scene.remove(g.group, g.rope);
      g.group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      g.rope.geometry.dispose();
      g.rope.material.dispose();
    }
    this.ghosts = list.filter((g) => g.samples?.length).map((g) => {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0.4, depthWrite: false });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.7, 6, 12), mat);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshBasicMaterial({ color: g.color, transparent: true, opacity: 0.9, depthWrite: false }));
      core.position.y = 0.3;
      group.add(body, core);
      // Name tag.
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const ctx = c.getContext('2d');
      ctx.font = 'bold 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(10, 18, 32, 0.6)';
      ctx.fillRect(8, 10, 240, 44);
      ctx.fillStyle = g.color;
      ctx.fillText(g.label.slice(0, 20), 128, 43);
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      tag.scale.set(2.6, 0.65, 1);
      tag.position.y = 1.3;
      group.add(tag);
      const ropeGeo = new THREE.BufferGeometry();
      ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: g.color, transparent: true, opacity: 0.7 }));
      rope.frustumCulled = false;
      this.scene.add(group, rope);
      return { ...g, group, rope, body };
    });
  }

  updateGhosts(t) {
    for (const g of this.ghosts) {
      const s = ghostAt(g.samples, t);
      g.group.visible = !!s;
      g.rope.visible = !!s?.hook;
      if (!s) continue;
      g.group.position.set(...s.pos);
      // Fade the ghost when it's right on top of you so it doesn't block the view.
      const d = g.group.position.distanceTo(this.camera.position);
      g.body.material.opacity = 0.4 * Math.min(1, Math.max(0.1, (d - 1) / 4));
      if (s.hook) {
        const a = g.rope.geometry.attributes.position;
        a.setXYZ(0, s.pos[0], s.pos[1] + 0.3, s.pos[2]);
        a.setXYZ(1, ...s.hook);
        a.needsUpdate = true;
      }
    }
  }

  // Sparks where the hook bites into a block.
  hookSparks(point, box) {
    const n = box ? faceNormal(box, point) : new THREE.Vector3(0, 1, 0);
    this.sparks.burst(point, n, box?.kind === 'anchor' ? '#ffb020' : '#ffe08a');
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
      this.cloudLayers.push({ mesh, tex: t, speed, baseOpacity: opacity });
    }
    // Solid haze under the clouds so you never see "through" the world.
    const floor = (this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ color: SKY_HORIZON })
    ));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -70;
    this.scene.add(floor);
  }

  addRope() {
    this.rope = new Rope();
    this.scene.add(this.rope.mesh);
    // The hook head that flies out: the gun's claw, scaled up to be visible.
    this.hookHead = makeClaw();
    this.hookHead.scale.setScalar(7);
    this.hookHead.visible = false;
    this.scene.add(this.hookHead);
  }

  fire() {
    this.viewModel.fire();
  }

  ropeSnap() {
    this.snapT = 1;
    this.viewModel.ropeSnap();
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
    this.movers = [];
    for (const b of course.boxes) {
      const kind = b.motion ? 'moving' : b.kind; // moving anchors are amber
      const style = KIND_STYLE[kind];
      const mesh = new THREE.Mesh(boxGeometry(b.size, style.tile), materials[kind]);
      mesh.position.copy(b.center);
      this.courseGroup.add(mesh);
      if (b.motion) this.movers.push({ box: b, mesh });
    }

    this.checkpointFx = course.checkpoints.map((cp) => {
      const beam = makeBeam(cp.trigger, '#5ff0ff');
      const ringCenter = cp.platform.center.clone();
      ringCenter.y += 6;
      const ring = makeRing(ringCenter, 4.5, '#5ff0ff');
      this.courseGroup.add(beam, ring);
      return { beam, ring };
    });
    this.finishFx = null;
    if (course.finish) {
      const fBeam = makeBeam(course.finish.trigger, '#ffd36b');
      const fRingCenter = course.finish.platform.center.clone();
      fRingCenter.y += 8;
      const fRing = makeRing(fRingCenter, 7, '#ffcf4d');
      this.courseGroup.add(fBeam, fRing);
      this.finishFx = { beam: fBeam, ring: fRing };
    }
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
    if (this.shakeEnabled === false) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  updateRope(player) {
    const pd = player.pending;
    const hook = player.hook;
    if (!pd && !hook) {
      this.rope.hide();
      this.hookHead.visible = false;
      return;
    }
    const cam = this.camera;
    const S = this.viewModel.muzzleWorld(cam);
    const E = pd
      ? pd.origin.clone().addScaledVector(pd.dir, Math.min(pd.travel, pd.dist))
      : hook.point.clone();
    const dir = E.clone().sub(S);
    const len = dir.length();
    const dirN = dir.clone().divideScalar(len || 1);
    const camFwd = cam.getWorldDirection(new THREE.Vector3());
    const side = new THREE.Vector3().crossVectors(dirN, camFwd);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, dirN).normalize();
    const t = this.time;

    // While flying: a wave that settles as the hook nears its target.
    const progress = pd ? Math.min(1, pd.travel / pd.dist) : 1;
    const flyAmp = pd ? 0.35 * (1 - progress) * Math.min(1, len / 6) : 0;
    // After catching: a quick wobble, plus sag when the rope is slack.
    const snapAmp = 0.25 * this.snapT * this.snapT;
    let sag = 0;
    if (hook) {
      const d = player.pos.distanceTo(hook.point);
      sag = Math.min(4, Math.sqrt(Math.max(0, hook.length * hook.length - d * d)) * 0.5);
    }

    this.rope.update((u, out) => {
      const bell = Math.sin(u * Math.PI);
      out.copy(S).addScaledVector(dir, u);
      if (flyAmp) {
        out.addScaledVector(side, flyAmp * Math.sin(u * Math.PI * 5 - t * 40) * bell);
        out.addScaledVector(up, flyAmp * 0.5 * Math.cos(u * Math.PI * 3 - t * 30) * bell);
      }
      if (snapAmp) out.addScaledVector(side, snapAmp * Math.sin(u * Math.PI * 6 + t * 50) * bell);
      if (sag) out.y -= sag * bell;
    }, cam.position);

    this.hookHead.visible = true;
    this.hookHead.position.copy(E);
    this.hookHead.lookAt(E.clone().sub(dirN)); // claw points along -Z
  }

  // target: raycast hit under the crosshair (or null)
  // view: { mouseDX, mouseDY, right, reeling } for the arm animation
  render(player, target, dt, view = {}) {
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

    // Arm and gun.
    this.viewModel.update(dt, {
      mouseDX: view.mouseDX || 0,
      mouseDY: view.mouseDY || 0,
      right: view.right || 0,
      grounded: player.grounded,
      speed: Math.hypot(player.vel.x, player.vel.z),
      velY: player.vel.y,
      reeling: !!(player.hook && view.reeling),
      hookOut: !!(player.hook || player.pending),
    });

    // Rope from the gun's muzzle to the hook.
    this.snapT = Math.max(0, this.snapT - dt * 4);
    this.updateRope(player);
    // Marker on the surface the crosshair would hook.
    if (target && !player.hook && !player.pending) {
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

    // Moving anchors: meshes follow the physics boxes.
    for (const m of this.movers || []) m.mesh.position.copy(m.box.center);

    // Effects.
    this.sparks.update(dt);
    this.rain.update(dt, cam.position, this.time);
    if (this.theme.lightning) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.flash = 1;
        this.nextLightning = 6 + Math.random() * 10;
        this.onThunder?.();
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.5);
    const flicker = this.flash > 0.3 ? 1 : this.flash; // a sharp flash, then a fade
    this.sky.material.uniforms.flash.value = flicker * 0.9;
    this.hemi.intensity = this.baseHemi + flicker * 2.5;
    const speedTarget = this.speedFx === false || this.showViewModel === false ? 0 : Math.min(1, Math.max(0, (speed - 26) / 30));
    this.speedStrength += (speedTarget - this.speedStrength) * Math.min(1, dt * 5);
    this.speedLines.material.uniforms.strength.value = this.speedStrength;
    this.speedLines.material.uniforms.time.value = this.time;

    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (this.speedStrength > 0.01) this.renderer.render(this.fxScene, this.viewModel.camera);
    if (this.showViewModel !== false) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewModel.scene, this.viewModel.camera);
    }
  }
}

