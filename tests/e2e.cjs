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
    // Never touch the live leaderboard from tests.
    await page.addInitScript(() => { window.__SKYHOOK_OFFLINE = true; });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const g = (fn, arg) => page.evaluate(fn, arg);

    await page.goto(URL);
    await page.waitForTimeout(1500);
    check(await page.isVisible('#menu'), 'title menu is shown');
    check(!(await page.isVisible('#community-btn')) && !(await page.isVisible('#boards-btn')), 'online-only buttons are hidden when offline');
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
    await page.waitForTimeout(100);
    check(await g(() => !!window.__skyhook.run.player.pending || !!window.__skyhook.run.player.hook), 'left click fires the hook (it flies to the block)');
    for (let i = 0; i < 20 && !(await g(() => !!window.__skyhook.run.player.hook)); i++) await page.waitForTimeout(100);
    const len0 = await g(() => window.__skyhook.run.player.hook?.length ?? 0);
    check(len0 > 10, `the hook catches when it arrives (rope ${len0.toFixed(1)} m)`);

    await page.mouse.down({ button: 'right' });
    await page.waitForTimeout(1500);
    const len1 = await g(() => window.__skyhook.run.player.hook?.length ?? 0);
    await page.mouse.up({ button: 'right' });
    check(len1 < len0 - 3, `right click reels in (${len0.toFixed(1)} -> ${len1.toFixed(1)} m)`);
    check(await g(() => !!window.__skyhook.achieved['first-swing']) && (await page.textContent('#ach-popup')).includes('First Swing'), 'landing your first hook unlocks "First Swing" with a pop-up');

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    check(await g(() => window.__skyhook.run.started && window.__skyhook.run.time > 0), 'timer starts after leaving the start platform');

    await page.mouse.up({ button: 'left' });
    await page.waitForTimeout(300);
    check(await g(() => window.__skyhook.run.player.hook === null), 'letting go of left click releases the hook');
    const rel = await g(() => window.__skyhook.lastRelease);
    check(rel?.hopped && rel.velY >= 10, `letting go gives the release hop (upward speed ${rel?.velY?.toFixed(1)} m/s)`);

    // Drop the player in open air, well away from every block, so the fall
    // doesn't depend on where the swing happened to land.
    await g(() => {
      const p = window.__skyhook.run.player;
      p.pos.set(400, 0, 0);
      p.vel.set(0, 0, 0);
    });
    let fell = false;
    for (let i = 0; i < 40 && !fell; i++) {
      await page.waitForTimeout(500);
      fell = await g(() => window.__skyhook.run.falls >= 1);
    }
    const back = await g(() => window.__skyhook.run.player.pos.distanceTo(window.__skyhook.course.spawn.pos) < 0.2 || window.__skyhook.run.checkpoint >= 0);
    check(fell && back, 'falling into the clouds respawns you');

    await page.keyboard.press('KeyR');
    await page.waitForTimeout(400);
    check(await g(() => window.__skyhook.run.time === 0 && !window.__skyhook.run.started), 'R restarts the run');

    // C: back to the last checkpoint without restarting the clock.
    await g(() => {
      const s = window.__skyhook; const cp = s.course.checkpoints[0];
      s.run.player.pos.copy(cp.trigger.center); // fly through checkpoint 1
    });
    await page.waitForTimeout(400);
    await g(() => { const p = window.__skyhook.run.player; p.pos.set(300, 10, -50); p.vel.set(0, 0, 0); });
    const tBefore = await g(() => window.__skyhook.run.time);
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(300);
    const afterC = await g(() => {
      const s = window.__skyhook; const cp = s.course.checkpoints[0];
      return { d: s.run.player.pos.distanceTo(cp.spawn.pos), t: s.run.time, cp: s.run.checkpoint };
    });
    check(afterC.cp === 0 && afterC.d < 1 && afterC.t >= tBefore, `C puts you back at your last checkpoint with the clock still running (${afterC.t.toFixed(2)} s)`);
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(300);

    const muted = await page.isChecked('#mute');
    await page.keyboard.press('KeyM');
    await page.waitForTimeout(100);
    check((await page.isChecked('#mute')) !== muted, 'M toggles mute');

    // Settings page.
    await g(() => document.exitPointerLock());
    await page.waitForTimeout(300);
    await page.click('#settings-btn');
    check(await page.isVisible('#screen-settings') && !(await page.isVisible('#sens')) === false, 'Settings button opens the settings page');
    await page.fill('#fov', '100');
    await page.dispatchEvent('#fov', 'input');
    check(await g(() => window.__skyhook.renderer.baseFov === 100), 'field of view slider changes the view');
    await page.check('#invert');
    await page.fill('#sfx-vol', '0.25');
    await page.dispatchEvent('#sfx-vol', 'input');
    check((await page.textContent('#sfx-val')) === '25%', 'sound effects volume has its own slider');
    await page.uncheck('#shake');
    await page.reload();
    await page.waitForTimeout(800);
    const saved = await g(() => JSON.parse(localStorage.getItem('skyhook.settings')));
    check(saved.fov === 100 && saved.invertY === true && saved.sfxVolume === 0.25 && saved.shake === false, 'settings are remembered after a reload');
    await page.click('#play-btn');
    await page.waitForTimeout(500);
    const pitch0 = await g(() => window.__skyhook.run.player.pitch);
    await g(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -60 })));
    await page.waitForTimeout(400);
    check(await g((p0) => window.__skyhook.run.player.pitch < p0 - 0.05, pitch0), 'invert mouse flips looking up and down');
    // Graphics quality and fps counter.
    await g(() => document.exitPointerLock());
    await page.waitForTimeout(300);
    await page.click('#settings-btn');
    await page.selectOption('#quality', 'low');
    check(await g(() => window.__skyhook.renderer.quality === 'low' && window.__skyhook.renderer.renderer.getPixelRatio() === 0.7 && !window.__skyhook.renderer.cloudLayers[1].mesh.visible), 'Low graphics quality lowers resolution and effects');
    await page.selectOption('#quality', 'high');
    await page.check('#show-fps');
    await page.waitForTimeout(800);
    check(await page.isVisible('#fps') && /\d+ fps/.test(await page.textContent('#fps')), `frames-per-second counter can be shown (${await page.textContent('#fps')})`);
    await page.uncheck('#show-fps');
    await page.click('#screen-settings [data-back]');
    check(!(await page.isVisible('#phone-notice')), 'no phone notice on a desktop');
    await g(() => { const st = JSON.parse(localStorage.getItem('skyhook.settings')); Object.assign(st, { fov: 85, invertY: false, sfxVolume: 1, shake: true }); localStorage.setItem('skyhook.settings', JSON.stringify(st)); });
    await page.keyboard.press('KeyM');

    await g(() => document.exitPointerLock());
    await page.waitForTimeout(500);
    check(await g(() => window.__skyhook.state === 'menu'), 'Esc (leaving pointer lock) pauses to the menu');
    await page.click('#profile-btn');
    const statText = await page.textContent('#stats-grid');
    const lifetime = await g(() => window.__skyhook.stats);
    check(await page.isVisible('#screen-profile') && lifetime.hooksFired >= 1 && lifetime.jumps >= 1 && lifetime.falls >= 1 && lifetime.distance > 5 && statText.includes('Hooks fired'),
      `Profile shows your stats (hooks ${lifetime.hooksFired}, jumps ${lifetime.jumps}, falls ${lifetime.falls}, ${Math.round(lifetime.distance)} m)`);
    await page.click('#tab-ach');
    check(await page.isVisible('#ach-grid') && (await page.$$('.ach')).length === 30 && (await page.textContent('#ach-summary')).includes('/ 30 unlocked'), 'Profile shows all 30 achievements');
    check((await page.$$('.ach.done')).length >= 1 && (await page.$$('.ach-bar')).length >= 1, 'earned achievements are highlighted and others show progress');
    await page.screenshot({ path: 'test-results/achievements.png' });
    await page.click('#screen-profile [data-back]');

    await g(() => localStorage.setItem('skyhook.best.level-1', JSON.stringify({ time: 42.5, splits: [10, 20] })));
    await page.reload();
    await page.waitForTimeout(1500);
    check((await page.textContent('#menu-best')) === '0:42.500', 'best time survives a reload');
    await page.click('#play-btn');
    await page.waitForTimeout(500);
    check((await page.textContent('#target')).trim() === 'Bronze 0:20.500', `HUD shows the next medal to aim for ("${(await page.textContent('#target')).trim()}")`);
    await g(() => document.exitPointerLock());
    await page.waitForTimeout(300);

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
    check((await page.textContent('#finish-medal')).includes('New Gold medal!') && await page.isVisible('#finish-medal .medal-gold.big'), 'finishing at autopilot pace awards a gold medal');
    check(await g(() => JSON.parse(localStorage.getItem('skyhook.progress')).unlocked === 2), 'finishing level 1 unlocks level 2');
    const ach = await g(() => Object.keys(window.__skyhook.achieved));
    check(ach.includes('off-ground') && ach.includes('gold-rush'), `finishing level 1 at gold pace earns achievements (${ach.join(', ')})`);
    let ghostSaved = false;
    for (let i = 0; i < 20 && !ghostSaved; i++) { await page.waitForTimeout(100); ghostSaved = await g(() => !!localStorage.getItem('skyhook.ghost.level-1')); }
    check(ghostSaved, 'a new best saves your ghost');
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
    // Your ghost races you on level 1.
    await page.click('.level-tile[data-level="0"]');
    await page.waitForTimeout(1200);
    const gh = await g(() => ({ n: window.__skyhook.renderer.ghosts.length, label: window.__skyhook.renderer.ghosts[0]?.label, pos: window.__skyhook.renderer.ghosts[0]?.group.position.toArray() }));
    await g(() => { const p = window.__skyhook.run.player; p.pos.set(0, 6, -12); });
    await page.waitForTimeout(1500);
    const gh2 = await g(() => window.__skyhook.renderer.ghosts[0]?.group.position.toArray());
    check(gh.n === 1 && gh.label === 'Your best' && gh2 && Math.hypot(gh2[0] - gh.pos[0], gh2[1] - gh.pos[1], gh2[2] - gh.pos[2]) > 2, 'your best ghost appears and races you once the timer starts');
    await page.screenshot({ path: 'test-results/ghost.png' });
    await g(() => document.exitPointerLock());
    await page.waitForTimeout(300);
    await page.click('#levels-btn');
    check(!t2[0] && !t2[1] && t2[2], 'level select shows levels 1-2 open, 3 locked');
    check(await page.isVisible('.level-tile[data-level="0"] .medal-gold'), 'level select shows the gold medal on level 1');
    check((await page.textContent('#medal-totals')).replace(/\s+/g, ' ').trim().startsWith('1'), 'level select shows medal totals');
    await page.screenshot({ path: 'test-results/level-select.png' });
    await page.click('.level-tile[data-level="1"]');
    await page.waitForTimeout(800);
    check(await g(() => window.__skyhook.level.number === 2 && window.__skyhook.state === 'playing'), 'clicking a level tile starts that level');

    // Tutorial: highlighted for new players; play through the first steps.
    await page.goto(URL);
    await page.waitForTimeout(1000);
    check(await g(() => document.getElementById('tutorial-btn').classList.contains('highlight')), 'Tutorial button is highlighted for new players');
    await page.click('#tutorial-btn');
    await page.waitForTimeout(800);
    const tutStep = () => g(() => window.__skyhook.tutorial?.step);
    check(await g(() => window.__skyhook.level.tutorial && window.__skyhook.state === 'playing') && await page.isVisible('#tutorial'), 'Tutorial button starts the tutorial with the prompt box');
    check((await tutStep()) === 0 && (await page.textContent('#tut-text')).includes('look around'), 'step 1 asks you to look around');
    for (let i = 0; i < 8; i++) await g(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 120, movementY: 0 })));
    await page.waitForTimeout(500);
    check((await tutStep()) === 1, 'looking around ticks off step 1');
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    check((await tutStep()) === 2, 'jumping ticks off step 2');
    await g(() => {
      const s = window.__skyhook; const p = s.run.player; const a = s.course.anchors[0].center;
      const ex = a.x - p.pos.x, ey = a.y - (p.pos.y + 0.35), ez = a.z - p.pos.z;
      p.yaw = Math.atan2(-ex, -ez); p.pitch = Math.atan2(ey, Math.hypot(ex, ez));
    });
    await page.waitForTimeout(500);
    check((await tutStep()) === 3, 'aiming at the orange block ticks off step 3');
    await page.mouse.down();
    let hs = 0;
    for (let i = 0; i < 20 && hs < 4; i++) { await page.waitForTimeout(150); hs = await tutStep(); }
    check(hs === 4, 'firing the hook ticks off step 4');
    await page.keyboard.down('KeyW');
    let st = 0;
    for (let i = 0; i < 20 && st < 5; i++) { await page.waitForTimeout(300); st = await tutStep(); }
    await page.keyboard.up('KeyW');
    check(st === 5, 'swinging off the edge ticks off step 5');
    await page.screenshot({ path: 'test-results/tutorial.png' });
    await page.mouse.up();
    await page.waitForTimeout(400);
    check((await tutStep()) === 6, 'letting go mid-air ticks off step 6');

    // Autopilot finishes the tutorial -> tutorial complete, N goes to level 1.
    await page.goto(`${URL}?bot=1&tutorial=1`);
    state = '';
    for (let i = 0; i < 160 && state !== 'finished'; i++) {
      await page.waitForTimeout(500);
      state = await g(() => window.__skyhook.state);
    }
    check(state === 'finished' && (await page.textContent('#finish-title')) === 'Tutorial complete!', 'finishing the tutorial shows "Tutorial complete!"');
    check((await page.textContent('#finish-medal')).includes('New gun skin unlocked: Rookie Teal'), 'finishing the tutorial unlocks the Rookie Teal gun skin');
    await page.keyboard.press('KeyN');
    await page.waitForTimeout(500);
    check(await g(() => window.__skyhook.level.number === 1 && !window.__skyhook.tutorial), 'N after the tutorial starts level 1');
    await page.goto(URL);
    await page.waitForTimeout(800);
    check(await g(() => !document.getElementById('tutorial-btn').classList.contains('highlight')), 'Tutorial highlight goes away once it is done');

    // Gun skins page: locked/unlocked cards, equipping recolours the 3D gun.
    await g(() => {
      for (let i = 1; i <= 5; i++) {
        const l = window.__skyhook; // silver-or-better on levels 1-5 via near-gold times
        localStorage.setItem(`skyhook.best.level-${i}`, JSON.stringify({ time: 1 }));
      }
    });
    await page.goto(URL);
    await page.waitForTimeout(1000);
    await page.click('#skins-btn');
    check(await page.isVisible('#screen-skins'), 'Gun button opens the gun skins page');
    const cards = await page.$$eval('.skin-card', (els) => els.map((e) => ({ id: e.dataset.skin, locked: e.disabled, text: e.textContent })));
    check(cards.length === 9, `9 gun skins listed (${cards.length})`);
    const open = cards.filter((c) => !c.locked).map((c) => c.id).sort().join(',');
    check(open === 'bronze,cobalt,rookie,standard', `skins unlocked by 5 golds + tutorial: ${open}`);
    check(cards.find((c) => c.id === 'gilded').text.includes('5 / 10'), 'locked skins show progress towards unlocking');
    await page.click('.skin-card[data-skin="cobalt"]');
    await page.waitForTimeout(300);
    check(await g(() => window.__skyhook.skin === 'cobalt' && window.__skyhook.renderer.viewModel.gun.children[0].material.color.getHexString() === '3261c9'),
      'equipping Cobalt recolours the gun');
    await page.screenshot({ path: 'test-results/skins.png' });
    await page.reload();
    await page.waitForTimeout(1000);
    check(await g(() => window.__skyhook.skin === 'cobalt'), 'equipped skin is remembered after a reload');

    // Music: render it offline and measure it (we can't listen in a test).
    const audio = await g(async () => {
      const { Music } = window.__skyhook;
      async function render(level) {
        const ctx = new OfflineAudioContext(1, 44100 * 5, 44100);
        const m = new Music(ctx, ctx.destination, 1);
        m.setIntensity(level);
        m.level = level;
        m.schedule(4.6);
        const buf = await ctx.startRendering();
        const d = buf.getChannelData(0);
        let sum = 0, peak = 0, hf = 0;
        for (let i = 1; i < d.length; i++) {
          sum += d[i] * d[i];
          peak = Math.max(peak, Math.abs(d[i]));
          hf += (d[i] - d[i - 1]) ** 2; // high-frequency energy (drums, hats)
        }
        return { rms: Math.sqrt(sum / d.length), peak, hf: Math.sqrt(hf / d.length), notes: m.notesPlayed };
      }
      return { calm: await render(0), fast: await render(1) };
    });
    check(audio.calm.rms > 0.005 && audio.fast.rms > 0.005, `music makes sound (rms calm ${audio.calm.rms.toFixed(3)}, fast ${audio.fast.rms.toFixed(3)})`);
    check(audio.fast.peak < 1 && audio.calm.peak < 1, `music doesn't clip (peaks ${audio.calm.peak.toFixed(2)}, ${audio.fast.peak.toFixed(2)})`);
    check(audio.fast.notes > audio.calm.notes * 2 && audio.fast.hf > audio.calm.hf * 1.5,
      `music gets busier at speed (${audio.calm.notes} -> ${audio.fast.notes} notes, drums/hats energy x${(audio.fast.hf / audio.calm.hf).toFixed(1)})`);
    await page.goto(`${URL}?level=1`);
    await page.waitForTimeout(800);
    await page.click('#play-btn');
    await page.waitForTimeout(1500);
    check(await g(() => window.__skyhook.music && window.__skyhook.music.notesPlayed > 0 && window.__skyhook.music.ctx.state === 'running'),
      'music starts playing when you click Play');
    await g(() => document.exitPointerLock());
    await page.waitForTimeout(300);

    // Level editor: build, test, share and import with real input.
    await page.goto(URL);
    await page.waitForTimeout(1000);
    await page.click('#editor-btn');
    check(await page.isVisible('#screen-mylevels') && (await page.textContent('#ml-list')).includes('No levels yet'), 'Level editor button opens My Levels (empty at first)');
    await page.click('#ml-new');
    await page.waitForTimeout(800);
    check(await g(() => window.__skyhook.state === 'editor' && !!document.pointerLockElement) && await page.isVisible('#editor-panel'), 'New level opens the editor with its help panel');
    const blocks = () => g(() => window.__skyhook.customLevel.data.blocks.length);
    await g(() => { const p = window.__skyhook.run.player; p.pos.set(0, 5, 10); p.yaw = 0; p.pitch = -Math.atan2(5.35, 6); });
    await page.waitForTimeout(300);
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(300);
    check((await blocks()) === 1 && await g(() => window.__skyhook.customLevel.data.blocks[0][0] === 'a'), 'left click places an anchor where you aim');
    await page.keyboard.press('Digit3');
    const size0 = await page.textContent('#ep-size');
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(200);
    check((await page.textContent('.ep-tool.on')).includes('Platform') && (await page.textContent('#ep-size')) !== size0, 'number keys pick the block type, mouse wheel changes size');
    await g(() => {
      const s = window.__skyhook; const p = s.run.player; const [, x, y, z] = s.customLevel.data.blocks[0];
      p.yaw = Math.atan2(-(x - p.pos.x), -(z - p.pos.z)); p.pitch = -Math.atan2(p.pos.y + 0.35 - y, Math.hypot(x - p.pos.x, z - p.pos.z));
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/editor.png' });
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(300);
    check((await blocks()) === 0, 'right click deletes the block you aim at');
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(300);
    check((await blocks()) === 1, 'Z undoes');

    // "Build" the rest quickly, then test-play it.
    await g(() => {
      const s = window.__skyhook;
      s.customLevel.data.blocks = [
        ['a', 0, 20, -26, 6, 6, 6], ['a', 0, 22, -54, 6, 6, 6], ['a', 5, 25, -82, 5.5, 5.5, 5.5],
        ['c', 5, 6.25, -104, 11, 1.5, 11], ['a', 0, 24, -128, 5.5, 5.5, 5.5], ['f', 0, 7, -214, 18, 2, 18],
      ];
      s.editor.rebuild();
    });
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(500);
    check(await g(() => window.__skyhook.mode === 'test' && window.__skyhook.state === 'playing' && window.__skyhook.course.anchors.length === 4), 'T test-plays the level');
    await g(() => window.__skyhook.run.player.pos.copy(window.__skyhook.course.finish.trigger.center));
    await page.waitForTimeout(500);
    check((await page.textContent('#finish-title')) === 'Test run complete!', 'finishing your level in a test run');
    check((await page.textContent('#finish-medal')).includes('Architect'), 'finishing your own level unlocks the Architect gun skin');
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(500);
    check(await g(() => window.__skyhook.state === 'editor' && window.__skyhook.mode === 'editor'), 'T goes back to the editor');

    await g(() => document.exitPointerLock());
    await page.waitForTimeout(400);
    check(await page.isVisible('#screen-editor-menu'), 'Esc in the editor opens the editor menu');
    await page.fill('#edit-name', 'Sky Bridge');
    await page.selectOption('#edit-theme', 'storm');
    check(await g(() => window.__skyhook.renderer.themeId === 'storm' && window.__skyhook.customLevel.data.theme === 'storm'), 'the editor sky picker changes and saves the theme');
    await page.click('#edit-share');
    let code = '';
    for (let i = 0; i < 20 && !code; i++) { await page.waitForTimeout(100); code = await page.inputValue('#edit-share-code'); }
    check(/^SKY1\.[A-Za-z0-9_-]+$/.test(code), `Share code is produced (${code.length} characters)`);
    await page.click('#edit-exit');
    await page.waitForTimeout(400);
    check((await page.textContent('#ml-list')).includes('Sky Bridge') && (await page.textContent('#ml-list')).includes('made by you'), 'the level is saved in My Levels under its new name');

    await page.click('#ml-import-toggle');
    await page.fill('#import-code', 'not a code');
    await page.click('#import-btn');
    await page.waitForTimeout(200);
    check((await page.textContent('#import-msg')).includes("doesn't look like"), 'importing junk shows a clear error');
    await page.fill('#import-code', code);
    await page.click('#import-btn');
    await page.waitForTimeout(300);
    check((await page.textContent('#import-msg')).includes('Imported "Sky Bridge"') && (await page.$$('.ml-row')).length === 2, 'importing a share code adds the level');
    await page.click('.ml-row:first-child [data-act="play"]');
    await page.waitForTimeout(800);
    check(await g(() => window.__skyhook.mode === 'custom' && window.__skyhook.state === 'playing' && window.__skyhook.course.custom), 'an imported level can be played');
    await g(() => document.exitPointerLock());
    await page.waitForTimeout(300);

    // Daily challenge.
    await page.goto(URL);
    await page.waitForTimeout(800);
    check(await page.isVisible('#daily-btn') && (await page.textContent('#daily-info')).includes('not played yet'), 'Daily challenge button shows on the main menu');
    await page.goto(`${URL}?bot=1&daily=1`);
    state = '';
    for (let i = 0; i < 200 && state !== 'finished'; i++) { await page.waitForTimeout(500); state = await g(() => window.__skyhook.state); }
    const daily = await g(() => ({ title: document.getElementById('finish-title').textContent, lvl: window.__skyhook.level, done: JSON.parse(localStorage.getItem('skyhook.progress')).dailyDone }));
    check(state === 'finished' && daily.lvl.daily && daily.title.startsWith('Daily challenge #'), `the autopilot finishes today's daily (${daily.title})`);
    check(daily.done?.includes(daily.lvl.date) && (await page.textContent('#finish-medal')).includes('Gold'), 'finishing the daily records the day and awards a medal');
    await page.goto(URL);
    await page.waitForTimeout(800);
    check((await page.textContent('#daily-info')).includes('best') && (await page.textContent('#daily-info')).includes('streak'), `main menu shows your daily best and streak ("${(await page.textContent('#daily-info')).trim()}")`);

    // Sky themes, speed lines, sparks.
    for (const [lvl, theme] of [[1, 'day'], [11, 'sunset'], [21, 'night']]) {
      await page.goto(`${URL}?unlock=all&level=${lvl}`);
      await page.waitForTimeout(700);
      check(await g(() => window.__skyhook.renderer.themeId) === theme, `level ${lvl} uses the ${theme} sky`);
    }
    await page.click('#play-btn');
    await page.waitForTimeout(600);
    await g(() => { const p = window.__skyhook.run.player; p.pos.set(0, 40, -60); p.vel.set(0, 3, -62); });
    await page.waitForTimeout(900);
    await g(() => window.__skyhook.run.player.vel.set(0, 3, -62));
    check(await g(() => window.__skyhook.renderer.speedStrength > 0.3), 'speed lines appear when flying fast');
    await g(() => { window.__skyhook.renderer.speedFx = false; });
    await page.waitForTimeout(900);
    check(await g(() => window.__skyhook.renderer.speedStrength < 0.1), 'speed lines can be switched off in settings');
    await g(() => { window.__skyhook.renderer.speedFx = true; window.__skyhook.restart(); });
    await page.waitForTimeout(300);
    await g(() => {
      const s = window.__skyhook; const p = s.run.player; const a = s.course.anchors[0].center;
      const ex = a.x - p.pos.x, ey = a.y - (p.pos.y + 0.35), ez = a.z - p.pos.z;
      p.yaw = Math.atan2(-ex, -ez); p.pitch = Math.atan2(ey, Math.hypot(ex, ez));
    });
    await page.waitForTimeout(300);
    await page.mouse.down();
    let sparked = false;
    for (let i = 0; i < 20 && !sparked; i++) { await page.waitForTimeout(80); sparked = await g(() => window.__skyhook.renderer.sparks.active); }
    await page.mouse.up();
    check(sparked, 'the hook throws sparks when it bites');
    await g(() => document.exitPointerLock());
    await page.waitForTimeout(300);

    // Late levels render with smooth blocks and no errors.
    await page.goto(`${URL}?unlock=all&level=30`);
    await page.waitForTimeout(1500);
    check(await g(() => window.__skyhook.level.number === 30), '?unlock=all&level=30 opens level 30');
    await page.click('#play-btn');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/level-30.png' });
    const movers = await g(() => window.__skyhook.renderer.movers.length);
    const before = await g(() => window.__skyhook.renderer.movers.map((m) => m.mesh.position.toArray()));
    await g(() => { const p = window.__skyhook.run.player; p.pos.set(0, 6, -20); }); // leave the start: timer runs
    await page.waitForTimeout(1500);
    const moved = await g((b) => window.__skyhook.renderer.movers.some((m, i) => Math.hypot(...m.mesh.position.toArray().map((v, k) => v - b[i][k])) > 0.3), before);
    check(movers > 5 && moved, `level 30 has moving anchors (${movers}) and they move once the timer starts`);

    // Arm + grapple gun are drawn; rope starts at the gun's muzzle.
    await page.goto(`${URL}?level=1`);
    await page.waitForTimeout(1000);
    await page.click('#play-btn');
    await page.waitForTimeout(800);
    check(await g(() => {
      const vm = window.__skyhook.renderer.viewModel;
      return vm.scene.children.includes(vm.root) && vm.claw.visible;
    }), 'arm and grapple gun are drawn, with the claw loaded');
    await g(() => {
      const s = window.__skyhook; const p = s.run.player; const a = s.course.anchors[0].center;
      const ex = a.x - p.pos.x, ey = a.y - (p.pos.y + 0.35), ez = a.z - p.pos.z;
      p.yaw = Math.atan2(-ex, -ez); p.pitch = Math.atan2(ey, Math.hypot(ex, ez));
      s.TUNING.hookSpeed = 20; // slow it down so the flight can be observed
    });
    await page.mouse.down();
    await page.waitForTimeout(600);
    const flight = await g(() => {
      const s = window.__skyhook; const r = s.renderer; const pd = s.run.player.pending;
      return { pending: !!pd, progress: pd ? pd.travel / pd.dist : 0, rope: r.rope.mesh.visible, head: r.hookHead.visible, claw: r.viewModel.claw.visible };
    });
    check(flight.pending && flight.progress > 0 && flight.progress < 1 && flight.rope && flight.head && !flight.claw,
      `hook visibly travels to the block (rope and claw in flight, ${(flight.progress * 100).toFixed(0)}% of the way)`);
    await page.mouse.up();
    await page.waitForTimeout(300);
    check(await g(() => !window.__skyhook.run.player.pending && !window.__skyhook.run.player.hook && window.__skyhook.renderer.viewModel.claw.visible),
      'letting go before it lands cancels the shot and reloads the claw');
    await g(() => { window.__skyhook.TUNING.hookSpeed = 250; });

    // Phones: a 'play on a PC' notice.
    const { devices } = require('playwright');
    const phone = await browser.newContext({ ...devices['iPhone 13'] });
    const pp = await phone.newPage();
    await pp.addInitScript(() => { window.__SKYHOOK_OFFLINE = true; });
    await pp.goto(URL);
    await pp.waitForTimeout(1200);
    check(await pp.isVisible('#phone-notice') && (await pp.textContent('#phone-notice')).includes('Play on a PC'), 'phones see a "play on a PC" notice');
    await pp.screenshot({ path: 'test-results/phone.png' });
    await pp.click('#phone-continue');
    check(!(await pp.isVisible('#phone-notice')), 'the phone notice can be dismissed');
    await phone.close();

    check(errors.length === 0, `no console errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
  process.exit(failures ? 1 : 0);
})();
