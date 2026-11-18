// End-to-end browser test. Builds nothing itself: run `npm run build` first
// (or just `npm run e2e`, which does both). Needs Playwright + Chromium.
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

(async () => {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await waitForServer();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const g = (fn, arg) => page.evaluate(fn, arg);

    await page.goto(URL);
    await page.waitForTimeout(1500);
    check(await page.isVisible('#menu'), 'title menu is shown');
    check(!(await page.isVisible('#screen-controls')), 'controls are hidden until the Controls button is pressed');
    await page.click('#controls-btn');
    check(await page.isVisible('#screen-controls') && !(await page.isVisible('#screen-main')), 'Controls button opens the controls page');
    await page.click('#screen-controls [data-back]');
    check(await page.isVisible('#screen-main'), 'Back returns to the main menu');

    await page.click('#levels-btn');
    check(await page.isVisible('#screen-levels'), 'Levels button opens level select');
    const tiles = await page.$$eval('.level-tile', (els) => els.map((e) => ({ locked: e.disabled, text: e.textContent })));
    check(tiles.length === 30, `level select shows 30 levels (${tiles.length})`);
    check(!tiles[0].locked && tiles.slice(1).every((t) => t.locked), 'only level 1 is unlocked at first');
    await page.click('#screen-levels [data-back]');

    await page.click('#play-btn');
    await page.waitForTimeout(800);
    check(await g(() => window.__skyhook.state === 'playing' && !!document.pointerLockElement), 'click to play locks the pointer and starts');

    // Headless Playwright can't produce real pointer-lock mouse deltas, so
    // dispatch the event a real mouse would send.
    await g(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: -100, movementY: -50 })));
    await page.waitForTimeout(500);
    const look = await g(() => ({ yaw: window.__skyhook.run.player.yaw, pitch: window.__skyhook.run.player.pitch }));
    check(look.yaw > 0.1 && look.pitch > 0.05, 'mouse movement turns and looks up');

    await page.waitForTimeout(300);
    await page.keyboard.down('Space');
    await page.waitForTimeout(200);
    await page.keyboard.up('Space');
    const peak = await g(() => new Promise((r) => {
      let m = 0;
      const t0 = performance.now();
      (function f() {
        m = Math.max(m, window.__skyhook.run.player.pos.y);
        if (performance.now() - t0 < 1500) requestAnimationFrame(f); else r(m);
      })();
    }));
    check(peak > 1.2, `Space jumps (peak ${peak.toFixed(2)})`);

    // Aim at the first anchor, then use real mouse buttons.
    await g(() => {
      const s = window.__skyhook;
      const p = s.run.player;
      const a = s.course.anchors[0].center;
      const ex = a.x - p.pos.x, ey = a.y - (p.pos.y + 0.35), ez = a.z - p.pos.z;
      p.yaw = Math.atan2(-ex, -ez);
      p.pitch = Math.atan2(ey, Math.hypot(ex, ez));
    });
    await page.waitForTimeout(400);
    check(await g(() => document.getElementById('crosshair').className === 'in-range'), 'crosshair turns orange over a hookable block');

    await page.mouse.down({ button: 'left' });
    await page.waitForTimeout(300);
    const len0 = await g(() => window.__skyhook.run.player.hook?.length ?? 0);
    check(len0 > 10, `left click attaches the hook (rope ${len0.toFixed(1)} m)`);

    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(1500);
    const len1 = await g(() => window.__skyhook.run.player.hook?.length ?? 0);
    await page.mouse.up({ button: 'right' });
    check(len1 < len0 - 3, `right click reels in (${len0.toFixed(1)} -> ${len1.toFixed(1)} m)`);

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    check(await g(() => window.__skyhook.run.started && window.__skyhook.run.time > 0), 'timer starts after leaving the start platform');

    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(300);
    check(await g(() => window.__skyhook.run.player.hook === null), 'letting go of left click releases the hook');
    const rel = await g(() => window.__skyhook.lastRelease);
    check(rel?.hopped && rel.velY >= 10, `letting go gives the release hop (upward speed ${rel?.velY?.toFixed(1)} m/s)`);

    let fell = false;
    for (let i = 0; i < 40 && !fell; i++) {
      await page.waitForTimeout(500);
      fell = await g(() => window.__skyhook.run.falls >= 1);
    }
    check(fell, 'falling into the clouds respawns you');

    await page.keyboard.press('KeyR');
    await page.waitForTimeout(400);
    check(await g(() => window.__skyhook.run.time === 0 && !window.__skyhook.run.started), 'R restarts the run');

    const muted = await page.isChecked('#mute');
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(100);
    check((await page.isChecked('#mute')) !== muted, 'M toggles mute');
    await page.keyboard.press('KeyM');

    await g(() => document.exitPointerLock());
    await page.waitForTimeout(500);
    check(await g(() => window.__skyhook.state === 'menu'), 'Esc (leaving pointer lock) pauses to the menu');

    await g(() => localStorage.setItem('skyhook.best.level-1', JSON.stringify({ time: 42.5, splits: [10, 20] })));
    await page.reload();
    await page.waitForTimeout(1500);
    check((await page.textContent('#menu-best')) === '0:42.500', 'best time survives a reload');

    // Autopilot: full course in the real game, beating the stored best.
    await page.goto(`${URL}?bot=1`);
    let state = '';
    for (let i = 0; i < 160 && state !== 'finished'; i++) {
      await page.waitForTimeout(500);
      state = await g(() => window.__skyhook.state);
    }
    const run = await g(() => ({ t: window.__skyhook.run.time, cp: window.__skyhook.run.checkpoint, cps: window.__skyhook.course.checkpoints.length, falls: window.__skyhook.run.falls }));
    check(state === 'finished' && run.cp === run.cps - 1 && run.falls === 0, `autopilot finishes level 1 in the browser (${run.t.toFixed(3)} s)`);
    check((await page.textContent('#finish-note')).startsWith('New best!'), 'finish screen announces a new best');
    check(await g(() => JSON.parse(localStorage.getItem('skyhook.progress')).unlocked === 2), 'finishing level 1 unlocks level 2');
    await page.waitForTimeout(3000);
    check(await g(() => window.__skyhook.run.player.vel.length() < 5), 'player settles into a hover after finishing');
    await page.keyboard.press('KeyN');
    await page.waitForTimeout(500);
    check(await g(() => window.__skyhook.level.number === 2 && window.__skyhook.state === 'playing'), 'N goes to the next level');
    await page.screenshot({ path: 'test-results/level-2.png' });

    // Level select reflects progress; a later level can be started from it.
    await page.goto(URL);
    await page.waitForTimeout(1000);
    await page.click('#levels-btn');
    const t2 = await page.$$eval('.level-tile', (els) => els.map((e) => e.disabled));
    check(!t2[0] && !t2[1] && t2[2], 'level select shows levels 1-2 open, 3 locked');
    await page.screenshot({ path: 'test-results/level-select.png' });
    await page.click('.level-tile[data-level="1"]');
    await page.waitForTimeout(800);
    check(await g(() => window.__skyhook.level.number === 2 && window.__skyhook.state === 'playing'), 'clicking a level tile starts that level');

    // Late levels render with smooth blocks and no errors.
    await page.goto(`${URL}?unlock=all&level=30`);
    await page.waitForTimeout(1500);
    check(await g(() => window.__skyhook.level.number === 30), '?unlock=all&level=30 opens level 30');
    await page.click('#play-btn');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/level-30.png' });

    check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
  process.exit(failures ? 1 : 0);
})();
