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

function set(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
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
  getCustomLevels: () => get('custom', []),
  setCustomLevels: (list) => set('custom', list),
};
