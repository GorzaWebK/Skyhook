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

// Submit a time. Only saved if it beats your current online best (the rules
// also enforce this). Returns { saved, best }.
export async function submitScore(levelId, name, time) {
  const f = await connect();
  const mine = f.ref(f.db, `skyhook/scores/${levelId}/${f.uid}`);
  const current = (await withTimeout(f.get(mine), 'Loading your score')).val();
  if (current && current.time <= time && current.name === cleanName(name)) return { saved: false, best: current.time };
  const bestTime = current ? Math.min(current.time, time) : time;
  await withTimeout(f.set(mine, { name: cleanName(name), time: bestTime, at: f.serverTimestamp() }), 'Saving your score');
  return { saved: !current || time < current.time, best: bestTime };
}

// Top scores for a level, fastest first, plus your rank if you're on it.
export async function getLeaderboard(levelId, count = 10) {
  const f = await connect();
  const q = f.query(f.ref(f.db, `skyhook/scores/${levelId}`), f.orderByChild('time'), f.limitToFirst(count));
  const snap = await withTimeout(f.get(q), 'Loading the leaderboard');
  const rows = [];
  snap.forEach((child) => {
    const v = child.val();
    rows.push({ uid: child.key, name: v.name, time: v.time, you: child.key === f.uid });
  });
  rows.sort((a, b) => a.time - b.time);

  // Your own position, even if you're not in the top `count`.
  let me = null;
  const mineSnap = await withTimeout(f.get(f.ref(f.db, `skyhook/scores/${levelId}/${f.uid}`)), 'Loading your score');
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
