import * as THREE from 'three';

// First-person arm holding the grapple gun. Built from simple shapes in code
// and drawn in its own pass with its own camera, so it never clips into
// walls and doesn't stretch when the main view widens at speed.

const MAT = {
  gunmetal: new THREE.MeshStandardMaterial({ color: '#7a8496', metalness: 0.25, roughness: 0.42 }),
  dark: new THREE.MeshStandardMaterial({ color: '#363c48', metalness: 0.2, roughness: 0.55 }),
  accent: new THREE.MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff5a10', emissiveIntensity: 0.35, roughness: 0.5 }),
  glow: new THREE.MeshStandardMaterial({ color: '#5ff0ff', emissive: '#5ff0ff', emissiveIntensity: 1.4, roughness: 0.3 }),
  glove: new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.9 }),
  sleeve: new THREE.MeshStandardMaterial({ color: '#3d6699', roughness: 0.95 }),
  cuff: new THREE.MeshStandardMaterial({ color: '#203754', roughness: 0.95 }),
};

// Recolour the gun (and the flying hook head, which shares materials).
export function applySkin(colors) {
  MAT.gunmetal.color.set(colors.body);
  MAT.dark.color.set(colors.dark);
  MAT.accent.color.set(colors.accent);
  MAT.accent.emissive.set(colors.accent);
  MAT.glow.color.set(colors.glow);
  MAT.glow.emissive.set(colors.glow);
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// The claw on the front of the hook. Also used (scaled up) for the hook
// head that flies through the world.
export function makeClaw(materialBody = MAT.dark, materialTip = MAT.accent) {
  const g = new THREE.Group();
  const cone = mesh(new THREE.ConeGeometry(0.02, 0.05, 8), materialTip);
  cone.rotation.x = -Math.PI / 2; // point along -Z
  cone.position.z = -0.015;
  g.add(cone);
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 8).rotateX(Math.PI / 2), materialBody, 0, 0, 0.012));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = mesh(new THREE.BoxGeometry(0.007, 0.007, 0.045), materialBody);
    const pivot = new THREE.Group();
    pivot.rotation.z = a;
    prong.position.set(0, 0.022, -0.01);
    prong.rotation.x = 0.55; // flare outwards
    pivot.add(prong);
    g.add(pivot);
  }
  return g;
}

function limb(from, dir, length, rTop, rBottom, mat) {
  // A cylinder running from `from` along `dir`.
  const geo = new THREE.CylinderGeometry(rTop, rBottom, length, 12);
  const m = new THREE.Mesh(geo, mat);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  m.position.copy(from).addScaledVector(dir, length / 2);
  return m;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#e4f1ff', '#59606e', 1.5));
    const key = new THREE.DirectionalLight('#fff3e0', 2.0);
    key.position.set(-0.6, 1, 0.4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9fd8ff', 0.8);
    rim.position.set(1, 0.2, -1);
    this.scene.add(rim);
    // Soft fill from the viewer so faces pointing back at you aren't black.
    const fill = new THREE.DirectionalLight('#ffffff', 0.9);
    fill.position.set(0.2, 0.3, 1);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.build();

    this.base = new THREE.Vector3(0.18, -0.13, -0.55);
    this.recoil = 0;
    this.snap = 0;
    this.sway = new THREE.Vector2();
    this.roll = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.lift = 0;
  }

  build() {
    const gun = (this.gun = new THREE.Group());
    this.root.add(gun);

    // Body, rail, barrel and back cap.
    gun.add(mesh(new THREE.BoxGeometry(0.075, 0.095, 0.3), MAT.gunmetal));
    gun.add(mesh(new THREE.BoxGeometry(0.045, 0.018, 0.22), MAT.accent, 0, 0.056, -0.01));
    gun.add(mesh(new THREE.BoxGeometry(0.081, 0.03, 0.12), MAT.dark, 0, -0.025, 0.06));
    gun.add(mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.16, 12).rotateX(Math.PI / 2), MAT.dark, 0, 0.005, -0.22));
    gun.add(mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 14).rotateX(Math.PI / 2), MAT.gunmetal, 0, 0.005, -0.29));
    gun.add(mesh(new THREE.BoxGeometry(0.068, 0.082, 0.04), MAT.dark, 0, 0, 0.165));

    // Glowing rope spool ring around the body: spins when reeling.
    this.coil = new THREE.Group();
    this.coil.position.z = -0.075;
    const ring = mesh(new THREE.TorusGeometry(0.058, 0.011, 8, 24), MAT.glow);
    this.coil.add(ring);
    for (let i = 0; i < 4; i++) {
      const spoke = mesh(new THREE.BoxGeometry(0.008, 0.03, 0.016), MAT.dark);
      const pivot = new THREE.Group();
      pivot.rotation.z = (i / 4) * Math.PI * 2;
      spoke.position.y = 0.058;
      pivot.add(spoke);
      this.coil.add(pivot);
    }
    gun.add(this.coil);

    // Grip and trigger.
    const grip = mesh(new THREE.BoxGeometry(0.048, 0.12, 0.058), MAT.dark, 0, -0.1, 0.085);
    grip.rotation.x = -0.28;
    gun.add(grip);
    gun.add(mesh(new THREE.BoxGeometry(0.012, 0.03, 0.012), MAT.gunmetal, 0, -0.062, 0.03));

    // Loaded claw at the muzzle (hidden while the hook is out).
    this.claw = makeClaw();
    this.claw.position.set(0, 0.005, -0.32);
    gun.add(this.claw);

    // Where the rope leaves the gun.
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.005, -0.31);
    gun.add(this.muzzle);

    // Gloved hand wrapped around the grip.
    const hand = new THREE.Group();
    hand.position.set(0.004, -0.1, 0.085);
    hand.rotation.x = -0.28;
    hand.add(mesh(new THREE.BoxGeometry(0.064, 0.085, 0.07), MAT.glove, 0.004, -0.005, 0.012)); // palm
    hand.add(mesh(new THREE.BoxGeometry(0.066, 0.078, 0.026), MAT.glove, 0.002, -0.012, -0.04)); // fingers
    hand.add(mesh(new THREE.BoxGeometry(0.02, 0.02, 0.07), MAT.glove, -0.04, 0.038, -0.02)); // thumb
    hand.add(mesh(new THREE.BoxGeometry(0.018, 0.018, 0.035), MAT.glove, 0, 0.04, -0.055)); // trigger finger
    gun.add(hand);

    // Forearm running off the bottom-right of the screen.
    const wrist = new THREE.Vector3(0.012, -0.16, 0.14);
    const dir = new THREE.Vector3(0.28, -0.4, 0.87).normalize();
    gun.add(limb(wrist, dir, 0.08, 0.036, 0.04, MAT.glove)); // glove cuff
    const sleeveStart = wrist.clone().addScaledVector(dir, 0.07);
    gun.add(limb(sleeveStart, dir, 0.03, 0.054, 0.056, MAT.cuff));
    gun.add(limb(sleeveStart.clone().addScaledVector(dir, 0.03), dir, 0.7, 0.05, 0.068, MAT.sleeve));

    gun.scale.setScalar(0.6);
    gun.rotation.set(0.05, 0.1, -0.03);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  fire() {
    this.recoil = 1;
  }

  ropeSnap() {
    this.snap = 1;
  }

  // view: { mouseDX, mouseDY, forward, right, grounded, speed, velY, reeling, hookOut }
  update(dt, view) {
    const k = Math.min(1, dt * 10);
    // Sway: the gun lags behind mouse movement.
    const tx = Math.max(-0.05, Math.min(0.05, -view.mouseDX * 0.00035));
    const ty = Math.max(-0.04, Math.min(0.04, view.mouseDY * 0.00035));
    this.sway.x += (tx - this.sway.x) * k;
    this.sway.y += (ty - this.sway.y) * k;
    // Lean into strafing.
    this.roll += (-view.right * 0.07 - this.roll) * k;
    // Walk bob.
    const walking = view.grounded && view.speed > 1;
    this.bobAmount += ((walking ? 1 : 0) - this.bobAmount) * Math.min(1, dt * 6);
    this.bobPhase += dt * (4 + view.speed * 0.9);
    // Gun drifts up when falling, down when rising.
    const tl = Math.max(-0.025, Math.min(0.025, -view.velY * 0.0008));
    this.lift += (tl - this.lift) * Math.min(1, dt * 5);

    this.recoil = Math.max(0, this.recoil - dt * 5);
    this.snap = Math.max(0, this.snap - dt * 4);
    const r = this.recoil * this.recoil;

    const bobX = Math.cos(this.bobPhase) * 0.009 * this.bobAmount;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.012 * this.bobAmount;
    this.root.position.set(
      this.base.x + this.sway.x + bobX,
      this.base.y + this.sway.y - bobY + this.lift - this.snap * 0.01,
      this.base.z + r * 0.07
    );
    this.root.rotation.set(r * 0.32 + (view.hookOut ? 0.05 : 0) + this.snap * 0.05, this.sway.x * 1.5, this.roll);

    // Spool spins when reeling (fast), while the hook is out (slow).
    const spin = view.reeling ? 28 : view.hookOut ? 4 : 0.6;
    this.coil.rotation.z += dt * spin;
    MAT.glow.emissiveIntensity = view.reeling ? 2.4 : 1.4;
    this.claw.visible = !view.hookOut;
  }

  // Where the muzzle appears in the main camera's world: same spot on
  // screen, at the same distance from the eye.
  muzzleWorld(mainCam, out = new THREE.Vector3()) {
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const v = this.muzzle.getWorldPosition(new THREE.Vector3());
    const depth = -v.z;
    const ndc = v.clone().project(this.camera);
    const tanH = Math.tan(THREE.MathUtils.degToRad(mainCam.fov) / 2);
    out.set(ndc.x * depth * tanH * mainCam.aspect, ndc.y * depth * tanH, -depth);
    return out.applyMatrix4(mainCam.matrixWorld);
  }
}
