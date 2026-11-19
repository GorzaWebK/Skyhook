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
  check(!(await ok(db.set(db.ref(B.d, `skyhook/scores/level-99/${B.uid}`), entry('Bob', 20)))) && await ok(db.set(db.ref(B.d, `skyhook/scores/level-40/${B.uid}`), entry('Bob', 20))), 'rules: only real level names (level-1 to level-40)');
  check(!(await ok(db.get(db.ref(B.d, 'skyhook')))), 'rules: the whole database cannot be read in one go');
  check(await ok(db.set(refB, entry('Bob', 20))), 'rules: a valid entry on another level is fine');
  // Community levels.
  const lvl = (uid, name = 'Test Level', code = 'SKY1.abc') => ({ uid, name, author: 'Tester', code, blocks: 5, at: db.serverTimestamp() });
  const publish = (c, id, data) => db.update(db.ref(c.d, 'skyhook'), { [`levels/${id}`]: data, [`publishers/${c.uid}`]: db.serverTimestamp() });
  check(await ok(publish(A, 'AAAAAAAAAAAA', lvl(A.uid))), 'rules: a player can publish a level');
  check(!(await ok(publish(A, 'AAAAAAAAAAAB', lvl(A.uid)))), 'rules: publishing again within a minute is refused (anti-spam)');
  check(!(await ok(db.set(db.ref(A.d, 'skyhook/levels/AAAAAAAAAAAC'), lvl(A.uid)))), 'rules: publishing must go through the once-a-minute check');
  check(!(await ok(publish(B, 'AAAAAAAAAAAA', lvl(B.uid, 'Hijack')))), "rules: you cannot overwrite someone else's level");
  check(!(await ok(publish(B, 'BBBBBBBBBBBB', lvl(A.uid)))), 'rules: you cannot publish under someone else\'s name');
  check(!(await ok(publish(B, 'BBBBBBBBBBBB', lvl(B.uid, 'Bad', 'javascript:alert(1)')))), 'rules: a published level must be a Skyhook level code');
  check(await ok(db.set(db.ref(B.d, 'skyhook/levelVotes/AAAAAAAAAAAA/' + B.uid), true)), 'rules: players can upvote a level');
  check(!(await ok(db.set(db.ref(B.d, 'skyhook/levelVotes/ZZZZZZZZZZZZ/' + B.uid), true))), 'rules: you cannot vote for a level that does not exist');
  check(!(await ok(db.set(db.ref(B.d, 'skyhook/levelVotes/AAAAAAAAAAAA/' + A.uid), true))), 'rules: you cannot vote as someone else');
  check(!(await ok(db.remove(db.ref(B.d, 'skyhook/levels/AAAAAAAAAAAA')))), "rules: you cannot remove someone else's level");
  check(await ok(db.remove(db.ref(A.d, 'skyhook/levels/AAAAAAAAAAAA'))), 'rules: you can remove your own level');
  // Ghosts must be uploaded together with a matching score.
  const both = (d, uid, board, time, data = 'G1.abc') => db.update(db.ref(d, 'skyhook'), {
    [`scores/${board}/${uid}`]: entry('Ghosty', time),
    [`ghosts/${board}/${uid}`]: { time, data, at: db.serverTimestamp() },
  });
  check(await ok(both(B.d, B.uid, 'level-28', 40)), 'rules: a score and its ghost can be saved together');
  check(!(await ok(db.set(db.ref(B.d, `skyhook/ghosts/level-28/${B.uid}`), { time: 12, data: 'G1.abc', at: db.serverTimestamp() }))), "rules: a ghost that doesn't match your score is rejected");
  check(!(await ok(both(B.d, B.uid, 'level-27', 40, 'not-a-ghost'))), 'rules: ghost data must be a real recording');
  check(!(await ok(db.set(db.ref(A.d, `skyhook/ghosts/level-28/${B.uid}`), { time: 40, data: 'G1.x', at: db.serverTimestamp() }))), "rules: you cannot overwrite someone else's ghost");
  check(await ok(db.set(db.ref(B.d, `skyhook/scores/daily-2026-11-19/${B.uid}`), entry('Bob', 25))), 'rules: daily challenge boards accept scores');
  check(!(await ok(db.set(db.ref(B.d, `skyhook/scores/daily-tomorrow/${B.uid}`), entry('Bob', 25)))), 'rules: daily boards must be named by date');
  // Account codes.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const CODE = 'ABCDEFGHJKLMNPQR';
  const acc = (pid, save = 'SV1.abc') => ({ pid, save, at: db.serverTimestamp() });
  const accRef = (c, code = CODE) => db.ref(c.d, `skyhook/accounts/${code}`);
  check(await ok(db.set(accRef(A), acc(A.uid))), 'rules: a player can make an account');
  check(!(await ok(db.set(accRef(B, 'ZZZZZZZZZZZZZZZZ'), acc(A.uid)))), "rules: you can't make an account that claims someone else's times");
  check(!(await ok(db.set(accRef(B, 'SHORT'), acc(B.uid)))), 'rules: account codes must be 16 characters');
  check(!(await ok(db.set(accRef(B, 'YYYYYYYYYYYYYYYY'), acc(B.uid, 'not a save')))), 'rules: an account must hold a real save');
  check(!(await ok(db.set(accRef(anon, 'XXXXXXXXXXXXXXXX'), acc('nobody')))), 'rules: you must be signed in to make an account');
  check(!(await ok(db.get(db.ref(B.d, 'skyhook/accounts')))), 'rules: nobody can list the account codes');
  check(await ok(db.get(accRef(B))), 'rules: with the code you can load the account');
  check(!(await ok(db.get(db.ref(B.d, `skyhook/members/${A.uid}`)))), "rules: nobody can read which computers joined an account (it holds the code)");
  check(!(await ok(db.set(db.ref(B.d, `skyhook/scores/level-25/${A.uid}`), entry('Bee', 30)))), "rules: without joining, you can't save times to an account");
  check(!(await ok(db.set(db.ref(B.d, `skyhook/members/${A.uid}/${B.uid}`), 'QQQQQQQQQQQQQQQQ'))), 'rules: joining an account needs its real code');
  check(!(await ok(db.set(db.ref(B.d, `skyhook/members/${A.uid}/${A.uid}`), CODE))), 'rules: you can only join as yourself');
  check(await ok(db.set(db.ref(B.d, `skyhook/members/${A.uid}/${B.uid}`), CODE)), 'rules: with the code, another computer can join the account');
  check(await ok(db.set(db.ref(B.d, `skyhook/scores/level-25/${A.uid}`), entry('Alice', 30))), '...and then save times to it');
  await sleep(2100);
  check(await ok(db.update(accRef(B), { save: 'SV1.def', at: db.serverTimestamp() })), "...and update the account's save");
  check(!(await ok(db.update(accRef(B), { save: 'SV1.ghi', at: db.serverTimestamp() }))), 'rules: saves to an account are limited to one every 2 seconds');
  await sleep(2100);
  check(!(await ok(db.update(accRef(B), { pid: B.uid, save: 'SV1.jkl', at: db.serverTimestamp() }))), "rules: an account's id can't be changed");
  check(!(await ok(db.remove(accRef(B)))), "rules: an account can't be deleted");
  check(!(await ok(db.update(accRef(B), { save: 'SV1.mno', at: db.serverTimestamp(), extra: 1 }))), 'rules: accounts have no extra fields');
  const q = await db.get(db.query(db.ref(B.d, 'skyhook/scores/level-29'), db.orderByChild('time'), db.limitToFirst(10)));
  check(q.exists() && q.size === 1, 'rules: anyone can read a level leaderboard, sorted by time');
  if ((process.env.RULES_FILE || '').includes('full')) {
    // The merged file must leave Foundry Arena's rules working as before.
    check(await ok(db.get(db.ref(anon.d, 'board'))), 'full rules: Foundry Arena leaderboard is still publicly readable');
    check(!(await ok(db.get(db.ref(anon.d, 'reports')))), 'full rules: Foundry Arena reports stay private');
    check(!(await ok(db.set(db.ref(A.d, 'somewhere-else'), 1))), 'full rules: nothing outside the known paths is writable');
  }
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
    await p1.addInitScript(() => localStorage.setItem('skyhook.settings', JSON.stringify({ flyover: false, playerName: 'SkyAce' })));
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
    // Player 2 races player 1's world record ghost.
    const ctxG = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const pg = await ctxG.newPage();
    pg.on('pageerror', (e) => errors.push(e.message));
    await pg.addInitScript(() => localStorage.setItem('skyhook.settings', JSON.stringify({ flyover: false, playerName: 'Chaser', ghost: 'record' })));
    await pg.goto(`${URL}?emulator=1&level=1`);
    let rec = null;
    for (let i = 0; i < 40 && !rec; i++) { await pg.waitForTimeout(250); rec = await pg.evaluate(() => window.__skyhook.ghosts.record && { name: window.__skyhook.ghosts.record.name, n: window.__skyhook.ghosts.record.samples.length }); }
    check(rec && rec.name === 'SkyAce' && rec.n > 50, `another player gets the world record ghost (${rec ? `${rec.name}, ${rec.n} samples` : 'none'})`);
    check(await pg.evaluate(() => window.__skyhook.renderer.ghosts.length === 1 && window.__skyhook.renderer.ghosts[0].label === 'WR · SkyAce'), 'the world record ghost is shown with the holder\'s name');
    // ... and can watch it as a replay from the Leaderboards page.
    await pg.click('#boards-btn');
    await pg.waitForTimeout(500);
    await pg.click('#board-watch');
    let label = '';
    for (let i = 0; i < 40 && !label; i++) { await pg.waitForTimeout(250); label = await pg.evaluate(() => window.__skyhook.replay?.label || ''); }
    check(label === 'World record · SkyAce' && await pg.isVisible('#replay-bar'), `"Watch the world record" plays the record holder's run (${label})`);
    await ctxG.close();

    // Player 2 (different browser profile) sees it on the Leaderboards page.
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.addInitScript(() => localStorage.setItem('skyhook.settings', JSON.stringify({ flyover: false, playerName: 'Rival' })));
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
    // Today's daily is on the leaderboard page too (one step back from level 1).
    await p2.evaluate(() => window.__skyhook.online.submitScore(window.__skyhook.dailyFor().id, 'Rival', 22));
    await p2.click('#board-prev');
    let dailyList = '';
    for (let i = 0; i < 40 && !dailyList.includes('Rival'); i++) { await p2.waitForTimeout(250); dailyList = await p2.textContent('#board-list'); }
    check((await p2.textContent('#board-level')).includes("Today's daily") && dailyList.includes('Rival (you)'), 'the Leaderboards page has a board for today\'s daily challenge');
    await p2.click('#board-next');
    // This week's tournament board (two steps back from level 1).
    await p2.evaluate(() => window.__skyhook.online.submitScore(window.__skyhook.weeklyFor().id, 'Rival', 40));
    await p2.click('#board-prev');
    await p2.click('#board-prev');
    let wList = '';
    for (let i = 0; i < 40 && !wList.includes('Rival'); i++) { await p2.waitForTimeout(250); wList = await p2.textContent('#board-list'); }
    check((await p2.textContent('#board-level')).includes("This week's tournament") && wList.includes('Rival (you)'), "the Leaderboards page has this week's tournament board");
    // Trophies: top of last week's board -> a trophy.
    const trophy = await p2.evaluate(async () => {
      const s = window.__skyhook;
      const prevId = s.weeklyFor(s.weeklyFor().weekNum - 1).id;
      await s.online.submitScore(prevId, 'Rival', 33);
      s.progress.trophyChecked = null;
      await s.checkTrophies();
      return s.progress.trophies;
    });
    check(Object.values(trophy || {}).includes(1), `finishing top of last week's tournament earns a trophy (${JSON.stringify(trophy)})`);
    await p2.click('#board-next');
    await p2.click('#board-next');
    await p2.fill('#board-name', 'Rival<script>');
    await p2.press('#board-name', 'Tab');
    check((await p2.inputValue('#board-name')) === 'Rivalscript', 'player names are cleaned');
    await p2.screenshot({ path: 'test-results/online-board.png' });

    // Community levels: player 1 publishes, player 2 finds, votes and plays it.
    const level = {
      id: 'c-test', own: true, tested: true,
      data: { v: 1, name: 'Sky Steps', theme: 'sunset', blocks: [
        ['a', 0, 20, -26, 6, 6, 6], ['a', 0, 22, -54, 6, 6, 6], ['a', 0, 24, -82, 6, 6, 6],
        ['c', 0, 6.25, -104, 11, 1.5, 11], ['f', 0, 7, -150, 18, 2, 18],
      ] },
    };
    await p1.evaluate((l) => localStorage.setItem('skyhook.custom', JSON.stringify([l])), level);
    await p1.goto(`${URL}?emulator=1`);
    await p1.waitForTimeout(800);
    await p1.click('#editor-btn');
    await p1.click('.ml-row [data-act="publish"]');
    let pubMsg = '';
    for (let i = 0; i < 40 && !pubMsg.includes('published'); i++) { await p1.waitForTimeout(250); pubMsg = await p1.textContent('#ml-msg'); }
    check(pubMsg.includes('is published'), `My Levels: Publish puts the level online ("${pubMsg}")`);
    check((await p1.textContent('.ml-row [data-act="publish"]')) === 'Update online', 'a published level offers Update online');

    await p2.goto(`${URL}?emulator=1`);
    await p2.waitForTimeout(800);
    check(await p2.isVisible('#community-btn'), 'Community levels button shows when online');
    await p2.click('#community-btn');
    let clist = '';
    for (let i = 0; i < 40 && !clist.includes('Sky Steps'); i++) { await p2.waitForTimeout(250); clist = await p2.textContent('#community-list'); }
    check(clist.includes('Sky Steps') && clist.includes('by SkyAce'), 'another player sees the published level with its author');
    await p2.click('.ml-row [data-act="vote"]');
    await p2.waitForTimeout(800);
    await p2.click('#tab-top');
    check((await p2.textContent('.ml-row [data-act="vote"]')).includes('1') && await p2.isVisible('.btn.vote.on'), 'upvoting counts the vote');
    await p2.click('.ml-row [data-act="play"]');
    await p2.waitForTimeout(1000);
    const cs = await p2.evaluate(() => ({ mode: window.__skyhook.mode, community: window.__skyhook.level.community, theme: window.__skyhook.renderer.themeId }));
    check(cs.mode === 'custom' && cs.community && cs.theme === 'sunset', 'a community level can be played (with its sky)');
    // (a realistic clock: the rules reject times under 3 s as impossible)
    await p2.evaluate(() => { const s = window.__skyhook; s.run.started = true; s.run.time = 14.2; s.run.player.pos.copy(s.course.finish.trigger.center); });
    await p2.waitForTimeout(600);
    check((await p2.textContent('#finish-title')).includes('Sky Steps') && !(await p2.evaluate(() => (JSON.parse(localStorage.getItem('skyhook.custom') || '[]')).length)), 'finishing it works and does not add it to your own levels');
    let cBoard = '';
    for (let i = 0; i < 40 && !cBoard.includes('#1'); i++) { await p2.waitForTimeout(250); cBoard = await p2.textContent('#finish-board'); }
    check(cBoard.includes('#1') && cBoard.includes('Rival'), `finishing a community level puts your time on its own leaderboard ("${cBoard.slice(0, 50)}...")`);
    await p2.evaluate(() => document.exitPointerLock());
    await p2.waitForTimeout(300);
    await p2.click('#community-btn');
    for (let i = 0; i < 40 && !(await p2.isVisible('.ml-row [data-act="top"]')); i++) await p2.waitForTimeout(250);
    await p2.click('.ml-row [data-act="top"]');
    let topList = '';
    for (let i = 0; i < 40 && !topList.includes('Rival'); i++) { await p2.waitForTimeout(250); topList = await p2.textContent('.ml-board'); }
    check(topList.includes('Rival'), 'the community list shows each level\'s top times');
    await p2.screenshot({ path: 'test-results/community-finish.png' });

    // Owner removes it.
    await p1.click('#screen-mylevels [data-back]');
    await p1.click('#community-btn');
    for (let i = 0; i < 40 && !(await p1.isVisible('.ml-row [data-act="remove"]')); i++) await p1.waitForTimeout(250);
    await p1.screenshot({ path: 'test-results/community.png' });
    await p1.click('.ml-row [data-act="remove"]');
    await p1.click('.ml-row [data-act="remove"]');
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) { await p1.waitForTimeout(250); gone = (await p1.textContent('#community-msg')).includes('No levels published'); }
    check(gone, 'the owner can remove their published level');

    // Account codes: player 1 carries on in another browser with their code.
    let acct = null;
    for (let i = 0; i < 40 && !acct; i++) { await p1.waitForTimeout(250); acct = await p1.evaluate(() => window.__skyhook.account); }
    check(acct && /^[2-9A-HJ-NP-Z]{16}$/.test(acct.code), `an account code is made automatically once you have progress (${acct && acct.code})`);
    await ctx1.grantPermissions(['clipboard-read', 'clipboard-write']);
    await p1.goto(`${URL}?emulator=1`);
    await p1.waitForTimeout(800);
    await p1.click('#profile-btn');
    await p1.click('#tab-account');
    const shown = await p1.inputValue('#acct-code');
    check(shown === acct.code.match(/.{4}/g).join('-'), `Profile > Account code shows your code (${shown})`);
    await p1.click('#acct-copy');
    await p1.waitForTimeout(300);
    const copied = await p1.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check(copied === shown && (await p1.textContent('#acct-status')).includes('Copied'), 'the Copy button copies the code');
    await p1.screenshot({ path: 'test-results/account.png' });

    const ctx4 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p4 = await ctx4.newPage();
    p4.on('pageerror', (e) => errors.push(e.message));
    await p4.addInitScript(() => { if (!localStorage.getItem('skyhook.settings')) localStorage.setItem('skyhook.settings', JSON.stringify({ flyover: false })); });
    await p4.goto(`${URL}?emulator=1`);
    await p4.waitForTimeout(800);
    await p4.click('#profile-btn');
    await p4.click('#tab-account');
    check(await p4.isVisible('#acct-create') && !(await p4.evaluate(() => window.__skyhook.account)), 'a new player has no code until they make progress (or press the button)');
    await p4.fill('#acct-paste', 'hello');
    await p4.click('#acct-load');
    check((await p4.textContent('#acct-msg')).includes("isn't an account code"), 'a pasted code that is not one gets a clear message');
    await p4.fill('#acct-paste', 'ABCD-EFGH-JKLM-NPQS');
    await p4.click('#acct-load');
    let am = '';
    for (let i = 0; i < 40 && !am.includes('No account'); i++) { await p4.waitForTimeout(250); am = await p4.textContent('#acct-msg'); }
    check(am.includes('No account has that code'), 'a code with no account behind it says so');
    await p4.fill('#acct-paste', ` ${shown.toLowerCase()} `);
    await p4.click('#acct-load');
    for (let i = 0; i < 40 && !am.includes('Loaded'); i++) { await p4.waitForTimeout(250); am = await p4.textContent('#acct-msg'); }
    const got = await p4.evaluate(() => ({
      name: JSON.parse(localStorage.getItem('skyhook.settings')).playerName,
      best: JSON.parse(localStorage.getItem('skyhook.best.level-1') || 'null'),
      custom: JSON.parse(localStorage.getItem('skyhook.custom') || '[]').map((l) => l.data.name),
      unlocked: window.__skyhook.progress.unlocked,
      account: window.__skyhook.account,
    }));
    check(am.includes('Loaded') && got.name === 'SkyAce' && got.best && got.best.time > 3 && got.custom.includes('Sky Steps') && got.unlocked >= 2 && got.account.pid === acct.pid,
      `pasting the code in another browser brings your name, times, unlocks and levels (${JSON.stringify({ ...got, account: undefined, best: got.best && got.best.time })})`);
    check(await p4.inputValue('#profile-name') === 'SkyAce' && await p4.inputValue('#acct-code') === shown, 'the profile now shows that name and code');
    await p4.click('#tab-stats');
    await p4.click('#screen-profile [data-back]');
    await p4.click('#editor-btn');
    check((await p4.textContent('#ml-list')).includes('Sky Steps'), 'your levels show up in My Levels');
    await p4.click('#screen-mylevels [data-back]');

    // Times set on the new computer go to the same leaderboard entry.
    const boards = await p4.evaluate(async () => {
      const o = window.__skyhook.online;
      await o.submitScore('level-1', 'SkyAce', 99); // slower: keeps the old best
      await o.submitScore('level-2', 'SkyAce', 50);
      return { l1: await o.getLeaderboard('level-1', 10), l2: await o.getLeaderboard('level-2', 10) };
    });
    const l1 = boards.l1.rows.filter((r) => r.name === 'SkyAce');
    check(l1.length === 1 && l1[0].you && l1[0].time === got.best.time && l1[0].uid === acct.pid, 'on another computer you are still one entry on the leaderboard (with your best time)');
    check(boards.l2.rows.some((r) => r.uid === acct.pid && r.you), 'new times from the other computer count for your account');

    // Renaming from the profile updates the leaderboards.
    await p4.click('#profile-btn');
    await p4.fill('#profile-name', 'Sky King!');
    await p4.press('#profile-name', 'Tab');
    let nm = '';
    for (let i = 0; i < 40 && !nm.includes('updated on'); i++) { await p4.waitForTimeout(250); nm = await p4.textContent('#name-msg'); }
    const renamed = await p4.evaluate(async () => (await window.__skyhook.online.getLeaderboard('level-1', 10)).rows.map((r) => r.name));
    check(nm.includes('Sky King') && nm.includes('updated on') && renamed.includes('Sky King') && !renamed.includes('SkyAce'), `changing your name in the Profile renames you on the leaderboards ("${nm}")`);
    // Player 1's first browser picks up the new name from the account.
    let p1name = '';
    for (let i = 0; i < 12 && p1name !== 'Sky King'; i++) {
      await p1.waitForTimeout(1000);
      await p1.evaluate(() => window.__skyhook.syncNow());
      p1name = await p1.evaluate(() => JSON.parse(localStorage.getItem('skyhook.settings')).playerName);
    }
    check(p1name === 'Sky King', `the first computer picks up changes made on the other one (${p1name})`);
    check(await p1.inputValue('#profile-name') === 'Sky King', '...and shows them on screen');
    await ctx4.close();

    // Switched off (as in the automated tests): no Leaderboards button.
    const p3 = await (await browser.newContext()).newPage();
    await p3.addInitScript(() => { window.__SKYHOOK_OFFLINE = true; });
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
