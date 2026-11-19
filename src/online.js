import { ONLINE_CONFIG } from './online-config.js';

// Online leaderboards: Firebase Realtime Database + anonymous sign-in.
// Scores live at skyhook/scores/<levelId>/<uid> = { name, time, at }.
// Each player has one entry per level (their best); the security rules
// only allow improving it.
//
// ?emulator=1 talks to the local Firebase emulators instead (for testing).

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const useEmulator = params.has('emulator');

// Automated tests set window.__SKYHOOK_OFFLINE so they never touch the live
// database.
const forcedOffline = typeof window !== 'undefined' && window.__SKYHOOK_OFFLINE === true;

export const onlineEnabled = useEmulator || (!!ONLINE_CONFIG && !forcedOffline);

const TIMEOUT_MS = 8000;
let connecting = null;

function withTimeout(promise, what) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), TIMEOUT_MS)),
  ]);
}

// Player names: letters, digits, spaces, _ . - and at most 16 characters
// (the same rule the database enforces).
export function cleanName(name) {
  const n = String(name ?? '').replace(/[^A-Za-z0-9 _.-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n || 'Player';
}

async function connect() {
  if (!onlineEnabled) throw new Error('Online leaderboards are switched off');
  if (connecting) return connecting;
  connecting = (async () => {
    const [{ initializeApp }, authMod, dbMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/database'),
    ]);
    const config = useEmulator
      ? { apiKey: 'demo-key', projectId: 'demo-skyhook', databaseURL: 'http://127.0.0.1:9000?ns=demo-skyhook' }
      : ONLINE_CONFIG;
    const app = initializeApp(config, 'skyhook');
    const auth = authMod.getAuth(app);
    const db = dbMod.getDatabase(app);
    if (useEmulator) {
      authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      dbMod.connectDatabaseEmulator(db, '127.0.0.1', 9000);
    }
    const cred = await withTimeout(authMod.signInAnonymously(auth), 'Signing in');
    return { db, uid: cred.user.uid, ...dbMod };
  })();
  try {
    return await connecting;
  } catch (e) {
    connecting = null; // allow a retry later
    throw e;
  }
}

// --- Accounts -------------------------------------------------------------------
// Your times are saved under your account id ("pid"). Without an account
// code it's this browser's sign-in id. With a code it's the id of the
// account, and this browser joins it (skyhook/members/<pid>/<uid> = code),
// which the rules check before letting it save times there.
// skyhook/accounts/<code> = { pid, save, at } holds the save itself.

let account = null; // { code, pid } or null
let joined = null; // the code this browser has joined, this session

export function setAccount(a) {
  account = a && a.code && a.pid ? { code: a.code, pid: a.pid } : null;
}

// The connection plus the id to save times under.
async function ident() {
  const f = await connect();
  if (!account || account.pid === f.uid) return { ...f, pid: f.uid };
  if (joined !== account.code) {
    try {
      await withTimeout(f.set(f.ref(f.db, `skyhook/members/${account.pid}/${f.uid}`), account.code), 'Joining your account');
      joined = account.code;
    } catch {
      // Couldn't join (e.g. older database rules): use this browser's own id
      // for now, so leaderboards still work.
      return { ...f, pid: f.uid };
    }
  }
  return { ...f, pid: account.pid };
}

// A new account holding `save`; its id is this browser's sign-in id, so
// times you already set stay yours. Returns { code, pid }.
export async function createAccount(code, save) {
  const f = await connect();
  await withTimeout(f.set(f.ref(f.db, `skyhook/accounts/${code}`), { pid: f.uid, save, at: f.serverTimestamp() }), 'Creating your account');
  return { code, pid: f.uid };
}

// { pid, save } for a code, or null if there's no such account.
export async function fetchAccount(code) {
  const f = await connect();
  const v = (await withTimeout(f.get(f.ref(f.db, `skyhook/accounts/${code}`)), 'Loading the account')).val();
  return v && typeof v.pid === 'string' && typeof v.save === 'string' ? { pid: v.pid, save: v.save } : null;
}

export async function writeAccount(code, save) {
  const f = await connect();
  await withTimeout(f.update(f.ref(f.db, `skyhook/accounts/${code}`), { save, at: f.serverTimestamp() }), 'Saving to your account');
}

// Put your current name on every board where you have a time.
// Returns how many entries were updated.
export async function renameEverywhere(boardIds, name) {
  const f = await ident();
  const clean = cleanName(name);
  let n = 0;
  for (const id of boardIds) {
    const mine = f.ref(f.db, `skyhook/scores/${id}/${f.pid}`);
    const cur = (await withTimeout(f.get(mine), 'Loading your score')).val();
    if (!cur || cur.name === clean) continue;
    await withTimeout(f.set(mine, { name: clean, time: cur.time, at: f.serverTimestamp() }), 'Renaming');
    n++;
  }
  return n;
}

// Submit a time. Only saved if it beats your current online best (the rules
// also enforce this). With a ghost recording, a new best uploads it too (in
// the same write, so the ghost always matches the score). Returns { saved, best }.
// levelId is "level-N" for the 30 levels or "daily-YYYY-MM-DD" for a daily.
export async function submitScore(levelId, name, time, ghost = null) {
  const f = await ident();
  const mine = f.ref(f.db, `skyhook/scores/${levelId}/${f.pid}`);
  const current = (await withTimeout(f.get(mine), 'Loading your score')).val();
  if (current && current.time <= time && current.name === cleanName(name)) return { saved: false, best: current.time };
  const improved = !current || time < current.time;
  const bestTime = improved ? time : current.time;
  const entry = { name: cleanName(name), time: bestTime, at: f.serverTimestamp() };
  let saved = false;
  if (improved && ghost) {
    try {
      await withTimeout(f.update(f.ref(f.db, 'skyhook'), {
        [`scores/${levelId}/${f.pid}`]: entry,
        [`ghosts/${levelId}/${f.pid}`]: { time: bestTime, data: ghost, at: f.serverTimestamp() },
      }), 'Saving your score');
      saved = true;
    } catch {
      // If the ghost is refused (e.g. older database rules), still save the score.
    }
  }
  if (!saved) {
    await withTimeout(f.set(mine, entry), 'Saving your score');
  }
  return { saved: improved, best: bestTime };
}

// The world record holder's ghost for a level, or null if there isn't one.
// Returns { name, time, code, you }.
export async function getRecordGhost(levelId) {
  const f = await ident();
  const top = await withTimeout(
    f.get(f.query(f.ref(f.db, `skyhook/scores/${levelId}`), f.orderByChild('time'), f.limitToFirst(1))),
    'Loading the record'
  );
  let rec = null;
  top.forEach((c) => { rec = { uid: c.key, ...c.val() }; });
  if (!rec) return null;
  const g = (await withTimeout(f.get(f.ref(f.db, `skyhook/ghosts/${levelId}/${rec.uid}`)), 'Loading the record ghost')).val();
  if (!g || g.time !== rec.time || typeof g.data !== 'string') return null; // ghost from an older run
  return { name: rec.name, time: rec.time, code: g.data, you: rec.uid === f.pid };
}

// Top scores for a level, fastest first, plus your rank if you're on it.
export async function getLeaderboard(levelId, count = 10) {
  const f = await ident();
  const q = f.query(f.ref(f.db, `skyhook/scores/${levelId}`), f.orderByChild('time'), f.limitToFirst(count));
  const snap = await withTimeout(f.get(q), 'Loading the leaderboard');
  const rows = [];
  snap.forEach((child) => {
    const v = child.val();
    rows.push({ uid: child.key, name: v.name, time: v.time, you: child.key === f.pid });
  });
  rows.sort((a, b) => a.time - b.time);

  // Your own position, even if you're not in the top `count`.
  let me = null;
  const mineSnap = await withTimeout(f.get(f.ref(f.db, `skyhook/scores/${levelId}/${f.pid}`)), 'Loading your score');
  if (mineSnap.exists()) {
    const myTime = mineSnap.val().time;
    const faster = await withTimeout(
      f.get(f.query(f.ref(f.db, `skyhook/scores/${levelId}`), f.orderByChild('time'), f.endBefore(myTime))),
      'Loading your rank'
    );
    me = { time: myTime, rank: faster.size + 1 };
  }
  return { rows, me };
}

// --- Community levels -----------------------------------------------------------
// skyhook/levels/<id> = { uid, name, author, code, blocks, at }
// skyhook/levelVotes/<id>/<uid> = true
// skyhook/publishers/<uid> = time of your last publish (rules allow one a minute)

function newId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// Publish (or update, if id is given and it's yours). Returns the level id.
export async function publishLevel({ id = null, name, author, code, blocks }) {
  const f = await ident();
  const levelId = id || newId();
  await withTimeout(f.update(f.ref(f.db, 'skyhook'), {
    [`levels/${levelId}`]: {
      uid: f.pid, name: String(name).slice(0, 24) || 'Untitled', author: cleanName(author), code, blocks, at: f.serverTimestamp(),
    },
    [`publishers/${f.uid}`]: f.serverTimestamp(),
  }), 'Publishing');
  return levelId;
}

export async function unpublishLevel(id) {
  const f = await connect();
  await withTimeout(f.remove(f.ref(f.db, `skyhook/levels/${id}`)), 'Removing');
}

// The newest published levels with vote counts. Returns
// [{ id, name, author, code, blocks, at, votes, voted, mine }], newest first.
export async function listLevels(count = 40) {
  const f = await ident();
  const snap = await withTimeout(
    f.get(f.query(f.ref(f.db, 'skyhook/levels'), f.orderByChild('at'), f.limitToLast(count))),
    'Loading community levels'
  );
  const levels = [];
  snap.forEach((c) => { levels.push({ id: c.key, ...c.val() }); });
  await Promise.all(levels.map(async (l) => {
    const v = await withTimeout(f.get(f.ref(f.db, `skyhook/levelVotes/${l.id}`)), 'Loading votes');
    l.votes = v.exists() ? v.size : 0;
    l.voted = v.child(f.pid).exists();
    l.mine = l.uid === f.pid;
  }));
  return levels.sort((a, b) => b.at - a.at);
}

export async function voteLevel(id, on) {
  const f = await ident();
  const r = f.ref(f.db, `skyhook/levelVotes/${id}/${f.pid}`);
  await withTimeout(on ? f.set(r, true) : f.remove(r), 'Voting');
}

export async function myUid() {
  return (await ident()).pid;
}
