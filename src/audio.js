// Every sound is synthesised with the Web Audio API. No audio files.

export class Sound {
  constructor(muted = false) {
    this.ctx = null;
    this.muted = muted;
  }

  // Browsers only allow audio after a click, so this runs on first click.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    // Two seconds of white noise, reused by wind and whooshes.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Wind: looping noise through a band-pass filter, louder when fast.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();

    // Rope creak while hooked: quiet filtered noise that follows tension.
    const creakSrc = ctx.createBufferSource();
    creakSrc.buffer = this.noise;
    creakSrc.loop = true;
    this.creakFilter = ctx.createBiquadFilter();
    this.creakFilter.type = 'bandpass';
    this.creakFilter.frequency.value = 1800;
    this.creakFilter.Q.value = 12;
    this.creakGain = ctx.createGain();
    this.creakGain.gain.value = 0;
    creakSrc.connect(this.creakFilter).connect(this.creakGain).connect(this.master);
    creakSrc.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  update(speed, hooked) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 60);
    this.windGain.gain.setTargetAtTime(0.02 + s * s * 0.5, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + s * 1400, t, 0.1);
    this.creakGain.gain.setTargetAtTime(hooked ? 0.02 + s * 0.05 : 0, t, 0.05);
  }

  tone({ type = 'sine', freq = 440, to = null, dur = 0.2, gain = 0.3, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  burst({ freq = 2000, q = 1, dur = 0.15, gain = 0.3, type = 'bandpass', sweepTo = null, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  hookFire() {
    this.burst({ freq: 1200, sweepTo: 5000, q: 2, dur: 0.12, gain: 0.25 });
    this.tone({ type: 'triangle', freq: 500, to: 1400, dur: 0.1, gain: 0.12 });
  }

  attach() {
    this.tone({ type: 'sine', freq: 160, to: 70, dur: 0.18, gain: 0.5 });
    this.burst({ freq: 3000, q: 4, dur: 0.05, gain: 0.3 });
  }

  miss() {
    this.tone({ type: 'square', freq: 220, to: 180, dur: 0.08, gain: 0.05 });
  }

  release() {
    this.burst({ freq: 800, sweepTo: 300, q: 1, dur: 0.2, gain: 0.15 });
  }

  // Letting go with the hop: a springy upward whoosh.
  hop() {
    this.burst({ freq: 500, sweepTo: 2200, q: 1.2, dur: 0.22, gain: 0.2 });
    this.tone({ type: 'triangle', freq: 300, to: 700, dur: 0.15, gain: 0.12 });
  }

  jump() {
    this.burst({ freq: 600, q: 1, dur: 0.08, gain: 0.1, type: 'lowpass' });
  }

  land(speed) {
    const g = Math.min(0.6, 0.1 + speed / 40);
    this.tone({ type: 'sine', freq: 110, to: 50, dur: 0.15, gain: g });
    this.burst({ freq: 400, q: 0.7, dur: 0.12, gain: g * 0.6, type: 'lowpass' });
  }

  step() {
    this.tone({ type: 'sine', freq: 880, dur: 0.12, gain: 0.12 });
    this.tone({ type: 'sine', freq: 1320, dur: 0.18, gain: 0.1, delay: 0.07 });
  }

  checkpoint() {
    this.tone({ type: 'triangle', freq: 660, dur: 0.18, gain: 0.25 });
    this.tone({ type: 'triangle', freq: 990, dur: 0.3, gain: 0.25, delay: 0.09 });
  }

  finish() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ type: 'triangle', freq: f, dur: 0.5, gain: 0.25, delay: i * 0.09 })
    );
    this.tone({ type: 'sine', freq: 262, dur: 1.2, gain: 0.2, delay: 0.36 });
  }

  record() {
    [784, 988, 1175, 1568].forEach((f, i) =>
      this.tone({ type: 'square', freq: f, dur: 0.18, gain: 0.07, delay: 0.7 + i * 0.07 })
    );
  }

  medal(kind) {
    const base = { bronze: 523, silver: 659, gold: 784 }[kind] || 523;
    [1, 1.25, 1.5, 2].forEach((m, i) =>
      this.tone({ type: 'triangle', freq: base * m, dur: 0.35, gain: 0.16, delay: 0.9 + i * 0.08 })
    );
  }

  unlock() {
    [880, 1109, 1319, 1760].forEach((f, i) =>
      this.tone({ type: 'sine', freq: f, dur: 0.4, gain: 0.12, delay: 1.4 + i * 0.1 })
    );
  }

  fall() {
    this.tone({ type: 'sawtooth', freq: 400, to: 80, dur: 0.5, gain: 0.08 });
  }

  start() {
    this.tone({ type: 'sine', freq: 880, dur: 0.12, gain: 0.15 });
  }
}
