// Lifetime stats, saved in the browser.

export function defaultStats() {
  return {
    playTime: 0, // seconds spent playing
    distance: 0, // metres travelled
    swung: 0, // metres travelled while on the rope
    hooksFired: 0,
    hooksLanded: 0,
    hops: 0, // release hops
    jumps: 0,
    falls: 0,
    checkpoints: 0,
    topSpeed: 0, // m/s
    longestSwing: 0, // seconds on one rope
    finishes: 0, // all finishes
    levelFinishes: 0,
    dailyFinishes: 0,
    customFinishes: 0,
    bestStreak: 0,
  };
}

export class StatsTracker {
  constructor(saved) {
    this.s = { ...defaultStats(), ...(saved || {}) };
    this.prev = null;
    this.hookStart = null;
    this.dirty = false;
    this.sinceSave = 0;
  }

  // Call once per physics step while playing.
  step(player, dt, runTime) {
    const s = this.s;
    s.playTime += dt;
    if (this.prev) {
      const d = this.prev.distanceTo(player.pos);
      if (d < 5) { // ignore teleports (respawns)
        s.distance += d;
        if (player.hook) s.swung += d;
      }
    }
    this.prev = player.pos.clone();
    s.topSpeed = Math.max(s.topSpeed, player.vel.length());
    if (player.hook) {
      if (this.hookStart === null) this.hookStart = runTime;
      s.longestSwing = Math.max(s.longestSwing, runTime - this.hookStart);
    } else {
      this.hookStart = null;
    }
    this.dirty = true;
    this.sinceSave += dt;
  }

  resetPosition() {
    this.prev = null;
    this.hookStart = null;
  }

  add(key, n = 1) {
    this.s[key] += n;
    this.dirty = true;
  }

  max(key, v) {
    if (v > this.s[key]) {
      this.s[key] = v;
      this.dirty = true;
    }
  }
}

const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
function fmtDuration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(sec % 60)}s`;
}

// [label, value] pairs for the Stats page.
export function statsRows(s, medals) {
  const acc = s.hooksFired ? Math.round((s.hooksLanded / s.hooksFired) * 100) : 0;
  return [
    ['Play time', fmtDuration(s.playTime)],
    ['Distance travelled', fmtDistance(s.distance)],
    ['Distance swung on the rope', fmtDistance(s.swung)],
    ['Hooks fired', `${s.hooksFired}`],
    ['Hooks landed', `${s.hooksLanded} (${acc}%)`],
    ['Top speed', `${Math.round(s.topSpeed)} m/s`],
    ['Longest single swing', `${s.longestSwing.toFixed(1)} s`],
    ['Release hops', `${s.hops}`],
    ['Jumps', `${s.jumps}`],
    ['Falls', `${s.falls}`],
    ['Checkpoints reached', `${s.checkpoints}`],
    ['Levels finished', `${s.levelFinishes}`],
    ['Daily challenges finished', `${s.dailyFinishes}`],
    ['Custom levels finished', `${s.customFinishes}`],
    ['Medals', `${medals.gold} gold · ${medals.silver - medals.gold} silver · ${medals.bronze - medals.silver} bronze`],
    ['Best daily streak', `${s.bestStreak} day${s.bestStreak === 1 ? '' : 's'}`],
  ];
}
