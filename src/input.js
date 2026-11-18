// Keyboard + mouse with pointer lock.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.hookHeld = false;
    this.reelHeld = false;
    this.locked = false;
    this.handlers = {}; // hookDown, hookUp, key (code)

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.handlers.key?.(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.setHook(false);
      this.reelHeld = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Chrome occasionally reports one huge bogus jump under pointer lock;
      // ignore those so the camera doesn't snap.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.setHook(true);
      if (e.button === 2) this.reelHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.setHook(false);
      if (e.button === 2) this.reelHeld = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.setHook(false);
        this.reelHeld = false;
        this.keys.clear();
      }
      this.handlers.lockChange?.(this.locked);
    });
  }

  setHook(down) {
    if (down === this.hookHeld) return;
    this.hookHeld = down;
    (down ? this.handlers.hookDown : this.handlers.hookUp)?.();
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      // Some browsers reject unadjustedMovement; fall back to a plain lock.
      p?.catch?.(() => this.canvas.requestPointerLock());
    } catch {
      this.canvas.requestPointerLock();
    }
  }

  consumeMouse() {
    const d = [this.mouseDX, this.mouseDY];
    this.mouseDX = this.mouseDY = 0;
    return d;
  }

  movement() {
    const k = this.keys;
    const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return {
      forward,
      right,
      jump: k.has('Space'),
      reel: this.reelHeld || k.has('ShiftLeft'),
    };
  }
}
