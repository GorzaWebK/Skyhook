// localStorage can be unavailable (private windows, blocked storage), so
// every access is wrapped and the game works fine without it.
const PREFIX = 'skyhook.';

function get(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

let listener = null;
// Called with the key after every save (used to sync to your account).
export function onStorageChange(fn) {
  listener = fn;
}

function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  listener?.(key);
}

export const storage = {
  getBest: (courseId) => get(`best.${courseId}`, null),
  setBest: (courseId, time) => set(`best.${courseId}`, time),
  getSettings: () => ({ sensitivity: 1, muted: false, ...get('settings', {}) }),
  setSettings: (s) => set('settings', s),
  // unlocked: how many levels are open (level 1 always is); last: last level played
  getProgress: () => ({ unlocked: 1, last: 0, ...get('progress', {}) }),
  setProgress: (p) => set('progress', p),
  // Levels made in the editor (or imported): [{ id, data: { v, name, blocks }, own, tested }]
  // Best-run ghost recording per level (see ghost.js).
  getGhost: (id) => get(`ghost.${id}`, null),
  setGhost: (id, code) => set(`ghost.${id}`, code),
  getAchievements: () => get('achievements', {}),
  setAchievements: (a) => set('achievements', a),
  getStats: () => get('stats', null),
  setStats: (s) => set('stats', s),
  getCustomLevels: () => get('custom', []),
  setCustomLevels: (list) => set('custom', list),
  // Levels deleted from My Levels: { id: time } (so syncing doesn't bring them back).
  getDeleted: () => get('deleted', {}),
  setDeleted: (d) => set('deleted', d),
  // Every saved best time: { courseId: { time, splits } }.
  allBests() {
    const out = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`${PREFIX}best.`)) {
          const v = get(k.slice(PREFIX.length), null);
          if (v) out[k.slice(PREFIX.length + 5)] = v;
        }
      }
    } catch { /* no storage */ }
    return out;
  },
  // Account code for this browser: { code, pid } or null.
  getAccount: () => get('account', null),
  setAccount: (a) => set('account', a),
  // Random id for this browser (its stats are kept separately in the account).
  getDevice() {
    let d = get('device', null);
    if (!d) {
      d = `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
      set('device', d);
    }
    return d;
  },
  // Stats from the account's other computers: { deviceId: stats }.
  getOtherStats: () => get('otherStats', {}),
  setOtherStats: (s) => set('otherStats', s),
};
