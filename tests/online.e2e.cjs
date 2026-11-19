// Online leaderboard tests against the local Firebase emulators.
// Run with: npm run test:online   (starts the emulators, then this file)
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

async function rulesTests() {
  const { initializeApp, setLogLevel } = await import('firebase/app');
  setLogLevel('silent'); // the rejected writes below are expected
  const { getAuth, connectAuthEmulator, signInAnonymously } = await import('firebase/auth');
  const db = await import('firebase/database');
  const config = { apiKey: 'demo-key', projectId: 'demo-skyhook', databaseURL: 'http://127.0.0.1:9000?ns=demo-skyhook' };

  async function client(name, signIn = true) {
    const app = initializeApp(config, name);
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    const d = db.getDatabase(app);
    db.connectDatabaseEmulator(d, '127.0.0.1', 9000);
    const uid = signIn ? (await signInAnonymously(auth)).user.uid : null;
    return { d, uid };
  }
  const ok = async (p) => { try { await p; return true; } catch { return false; } };
  const entry = (name, time, extra = {}) => ({ name, time, at: db.serverTimestamp(), ...extra });

  const A = await client('a');
  const B = await client('b');
  const anon = await client('anon', false);
  const refA = db.ref(A.d, `skyhook/scores/level-29/${A.uid}`);

  check(await ok(db.set(refA, entry('Alice', 10))), 'rules: a signed-in player can save their time');
  check(!(await ok(db.set(refA, entry('Alice', 12)))), 'rules: a slower time cannot overwrite a faster one');
  check(await ok(db.set(refA, entry('Alice', 9.5))), 'rules: a faster time replaces the old one');
  check(await ok(db.set(refA, entry('Alice B', 9.5))), 'rules: the same time with a new name is allowed (renaming)');
  check(!(await ok(db.set(db.ref(A.d, `skyhook/scores/level-29/${B.uid}`), entry('Mallory', 5)))), "rules: you cannot write someone else's entry");
  check(!(await ok(db.set(db.ref(anon.d, 'skyhook/scores/level-29/someone'), entry('Anon', 20)))), 'rules: you must be signed in to write');
  const refB = db.ref(B.d, `skyhook/scores/level-30/${B.uid}`);
  check(!(await ok(db.set(refB, entry('<b>hi</b>', 20)))), 'rules: names with odd characters are rejected');
  check(!(await ok(db.set(refB, entry('x'.repeat(17), 20)))), 'rules: names over 16 characters are rejected');
  check(!(await ok(db.set(refB, entry('Bob', 1)))), 'rules: impossibly fast times (under 3 s) are rejected');
  check(!(await ok(db.set(refB, entry('Bob', 20, { cheat: true })))), 'rules: extra fields are rejected');
  check(!(await ok(db.set(refB, { name: 'Bob', time: 20, at: 12345 }))), 'rules: the timestamp must be the server time');
  check(!(await ok(db.set(db.ref(B.d, `skyhook/scores/level-99/${B.uid}`), entry('Bob', 20)))), 'rules: only real level names (level-1 to level-30)');
  check(!(await ok(db.get(db.ref(B.d, 'skyhook')))), 'rules: the whole database cannot be read in one go');
  check(await ok(db.set(refB, entry('Bob', 20))), 'rules: a valid entry on another level is fine');
  const q = await db.get(db.query(db.ref(B.d, 'skyhook/scores/level-29'), db.orderByChild('time'), db.limitToFirst(10)));
  check(q.exists() && q.size === 1, 'rules: anyone can read a level leaderboard, sorted by time');
}

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not start`);
}

async function browserTests() {
  const PORT = 4181;
  const URL = `http://localhost:${PORT}/`;
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await waitFor(URL);
    const errors = [];
    // Player 1 finishes level 1 with the autopilot.
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p1 = await ctx1.newPage();
    p1.on('pageerror', (e) => errors.push(e.message));
    await p1.addInitScript(() => localStorage.setItem('skyhook.settings', JSON.stringify({ playerName: 'SkyAce' })));
    await p1.goto(`${URL}?emulator=1&bot=1&level=1`);
    let state = '';
    for (let i = 0; i < 160 && state !== 'finished'; i++) {
      await p1.waitForTimeout(500);
      state = await p1.evaluate(() => window.__skyhook.state);
    }
    let boardText = '';
    for (let i = 0; i < 40 && !boardText.includes('#'); i++) {
      await p1.waitForTimeout(250);
      boardText = await p1.textContent('#finish-board');
    }
    check(boardText.includes('#1') && boardText.includes('SkyAce (you)'), `finishing a level saves your time online and shows your rank ("${boardText.slice(0, 60)}...")`);
    await p1.screenshot({ path: 'test-results/online-finish.png' });

    // Player 2 (different browser profile) sees it on the Leaderboards page.
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.addInitScript(() => localStorage.setItem('skyhook.settings', JSON.stringify({ playerName: 'Rival' })));
    await p2.goto(`${URL}?emulator=1`);
    await p2.waitForTimeout(1000);
    check(await p2.isVisible('#boards-btn'), 'Leaderboards button shows when online is switched on');
    await p2.click('#boards-btn');
    let list = '';
    for (let i = 0; i < 40 && !list.includes('SkyAce'); i++) {
      await p2.waitForTimeout(250);
      list = await p2.textContent('#board-list');
    }
    check(list.includes('SkyAce') && !list.includes('(you)'), "another player sees the time on the Leaderboards page");
    // Player 2 sets a slower time, then renames.
    await p2.evaluate(() => window.__skyhook.online.submitScore('level-1', 'Rival', 30));
    await p2.click('#board-next');
    await p2.click('#board-prev');
    for (let i = 0; i < 40 && !list.includes('Rival'); i++) {
      await p2.waitForTimeout(250);
      list = await p2.textContent('#board-list');
    }
    const rows = await p2.$$eval('#board-list .board-row', (els) => els.map((e) => e.textContent));
    check(rows.length === 2 && rows[0].includes('SkyAce') && rows[1].includes('Rival (you)'), `leaderboard is sorted fastest first (${rows.join(' | ')})`);
    await p2.fill('#board-name', 'Rival<script>');
    await p2.press('#board-name', 'Tab');
    check((await p2.inputValue('#board-name')) === 'Rivalscript', 'player names are cleaned');
    await p2.screenshot({ path: 'test-results/online-board.png' });

    // Switched off when there's no config and no emulator.
    const p3 = await (await browser.newContext()).newPage();
    await p3.goto(URL);
    await p3.waitForTimeout(800);
    check(!(await p3.isVisible('#boards-btn')), 'Leaderboards button is hidden while online is switched off');
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    server.kill();
  }
}

(async () => {
  try {
    await rulesTests();
    await browserTests();
  } catch (e) {
    console.log(`FAIL ${e.stack || e}`);
    failures++;
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll online checks passed');
  process.exit(failures ? 1 : 0);
})();
