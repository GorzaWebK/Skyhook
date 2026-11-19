import { packJson, unpackJson, validateLevel } from './custom.js';
import { cleanName } from './online.js';

// Account codes. Your save (best times, medals, unlocks, achievements, stats,
// your name and your levels) is stored online under a secret 16-character
// code. Paste the code into Skyhook on any computer to carry on there. The
// code works like a password: anyone who has it can use the account.

// No 0/O, 1/I: easy to read out and type.
export const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 16;

export function newAccountCode() {
  const bytes = new Uint8Array(CODE_LEN);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < CODE_LEN; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

// "ABCD-EFGH-JKLM-NPQR"
export function formatCode(code) {
  return code.match(/.{1,4}/g).join('-');
}

// Accepts the code with or without dashes/spaces, any letter case. Returns
// the bare 16-character code, or null if it isn't one.
export function parseCode(text) {
  const c = String(text ?? '').toUpperCase().replace(/[\s-]/g, '');
  return c.length === CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null;
}

// --- Saves ------------------------------------------------------------------------
// {
//   v: 1,
//   profile: { name, skin, rope, trail, at },  // at: when it was last changed
//   bests: { courseId: { time, splits } },
//   progress: { unlocked, tutorialDone, editorFinished, dailyDone, trophies, trophyChecked },
//   achievements: { id: 'YYYY-MM-DD' },
//   stats: { deviceId: stats },                 // each computer counts its own
//   custom: [ level ],                           // My Levels (with .updated)
//   deleted: { levelId: time },                  // levels deleted from My Levels
// }

export function emptySave() {
  return { v: 1, profile: { at: 0 }, bests: {}, progress: {}, achievements: {}, stats: {}, custom: [], deleted: {} };
}

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

// Clean up a save that came from the network (or an older version).
export function cleanSave(raw) {
  const s = emptySave();
  if (!isObj(raw)) return s;
  const p = isObj(raw.profile) ? raw.profile : {};
  s.profile = { at: isNum(p.at) ? p.at : 0 };
  if (typeof p.name === 'string') s.profile.name = cleanName(p.name);
  for (const k of ['skin', 'rope', 'trail']) if (typeof p[k] === 'string' && ID_RE.test(p[k])) s.profile[k] = p[k];

  if (isObj(raw.bests)) {
    for (const [id, b] of Object.entries(raw.bests)) {
      if (!ID_RE.test(id) || !isObj(b) || !isNum(b.time) || b.time <= 0) continue;
      s.bests[id] = { time: b.time, splits: Array.isArray(b.splits) ? b.splits.filter(isNum).slice(0, 100) : [] };
    }
  }
  const g = isObj(raw.progress) ? raw.progress : {};
  if (isNum(g.unlocked)) s.progress.unlocked = Math.max(1, Math.floor(g.unlocked));
  if (g.tutorialDone) s.progress.tutorialDone = true;
  if (g.editorFinished) s.progress.editorFinished = true;
  if (Array.isArray(g.dailyDone)) s.progress.dailyDone = g.dailyDone.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (isObj(g.trophies)) {
    s.progress.trophies = {};
    for (const [w, r] of Object.entries(g.trophies)) if (/^\d{4}-W\d{2}$/.test(w) && [1, 2, 3].includes(r)) s.progress.trophies[w] = r;
  }
  if (typeof g.trophyChecked === 'string') s.progress.trophyChecked = g.trophyChecked;

  if (isObj(raw.achievements)) {
    for (const [id, d] of Object.entries(raw.achievements)) if (ID_RE.test(id) && typeof d === 'string') s.achievements[id] = d.slice(0, 10);
  }
  if (isObj(raw.stats)) {
    for (const [dev, st] of Object.entries(raw.stats)) {
      if (!ID_RE.test(dev) || !isObj(st)) continue;
      s.stats[dev] = Object.fromEntries(Object.entries(st).filter(([, v]) => isNum(v) && v >= 0));
    }
  }
  if (Array.isArray(raw.custom)) {
    for (const l of raw.custom) {
      if (!isObj(l) || typeof l.id !== 'string' || !ID_RE.test(l.id)) continue;
      try {
        const lvl = { id: l.id, own: !!l.own, tested: !!l.tested, data: validateLevel(l.data), updated: isNum(l.updated) ? l.updated : 0 };
        if (typeof l.publishedId === 'string' && /^[A-Za-z0-9]{12}$/.test(l.publishedId)) lvl.publishedId = l.publishedId;
        s.custom.push(lvl);
      } catch { /* broken level: skip it */ }
    }
  }
  s.custom.sort((x, y) => y.updated - x.updated); // newest first, like My Levels
  if (isObj(raw.deleted)) {
    for (const [id, t] of Object.entries(raw.deleted)) if (ID_RE.test(id) && isNum(t)) s.deleted[id] = t;
  }
  return s;
}

// Stats that are records (keep the highest) rather than totals (add up).
const MAX_STATS = new Set(['topSpeed', 'longestSwing', 'bestStreak']);

// Lifetime stats over all of an account's computers.
export function combineStats(perDevice) {
  const out = {};
  for (const st of Object.values(perDevice)) {
    for (const [k, v] of Object.entries(st)) {
      out[k] = MAX_STATS.has(k) ? Math.max(out[k] ?? 0, v) : (out[k] ?? 0) + v;
    }
  }
  return out;
}

// Combine two saves of the same player, keeping the best of both: fastest
// times, every unlock and achievement, the newest name and the newest
// version of each level.
export function mergeSaves(a, b) {
  a = cleanSave(a);
  b = cleanSave(b);
  const m = emptySave();
  m.profile = { ...(b.profile.at > a.profile.at ? b.profile : a.profile) };

  m.bests = { ...a.bests };
  for (const [id, x] of Object.entries(b.bests)) if (!m.bests[id] || x.time < m.bests[id].time) m.bests[id] = x;

  const pa = a.progress;
  const pb = b.progress;
  m.progress.unlocked = Math.max(pa.unlocked || 1, pb.unlocked || 1);
  if (pa.tutorialDone || pb.tutorialDone) m.progress.tutorialDone = true;
  if (pa.editorFinished || pb.editorFinished) m.progress.editorFinished = true;
  m.progress.dailyDone = [...new Set([...(pa.dailyDone || []), ...(pb.dailyDone || [])])].sort().slice(-400);
  m.progress.trophies = { ...(pa.trophies || {}) };
  for (const [w, r] of Object.entries(pb.trophies || {})) m.progress.trophies[w] = Math.min(r, m.progress.trophies[w] ?? 3);
  const checked = [pa.trophyChecked, pb.trophyChecked].filter(Boolean).sort();
  if (checked.length) m.progress.trophyChecked = checked[checked.length - 1];

  m.achievements = { ...a.achievements };
  for (const [id, d] of Object.entries(b.achievements)) if (!m.achievements[id] || d < m.achievements[id]) m.achievements[id] = d;

  m.stats = { ...a.stats };
  for (const [dev, st] of Object.entries(b.stats)) {
    if (!m.stats[dev] || (st.playTime ?? 0) > (m.stats[dev].playTime ?? 0)) m.stats[dev] = st;
  }

  m.deleted = { ...a.deleted };
  for (const [id, t] of Object.entries(b.deleted)) m.deleted[id] = Math.max(t, m.deleted[id] ?? 0);
  // Keep the 300 newest deletions.
  m.deleted = Object.fromEntries(Object.entries(m.deleted).sort((x, y) => y[1] - x[1]).slice(0, 300));

  const byId = new Map();
  for (const l of [...a.custom, ...b.custom]) {
    const have = byId.get(l.id);
    if (!have || l.updated > have.updated) byId.set(l.id, l);
  }
  m.custom = [...byId.values()]
    .filter((l) => !(m.deleted[l.id] >= l.updated))
    .sort((x, y) => y.updated - x.updated);
  return m;
}

export function encodeSave(save) {
  return packJson(save, 'SV');
}

export async function decodeSave(code) {
  const raw = await unpackJson(code, 'SV');
  if (raw === null) throw new Error("That isn't a Skyhook save");
  return cleanSave(raw);
}

// JSON with object keys sorted, so the same content always gives the same text.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// Same content? (Used to skip needless writes.)
export function sameSave(a, b) {
  return canonical(a) === canonical(b);
}
