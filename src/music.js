// Generated soundtrack: a looping chord progression in A minor whose layers
// build up with "intensity" (how fast you're going). Everything is
// synthesised with the Web Audio API; there are no audio files.
//
// It works with a normal AudioContext (scheduled ahead on a timer) or an
// OfflineAudioContext (call schedule(untilTime) once, then render), which is
// how the tests check that it actually makes sound.

const BPM = 100;
const STEP = 60 / BPM / 4; // one 16th note, in seconds

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Am - F - C - G, one bar each. bass = root note, pad = chord voicing.
const CHORDS = [
  { bass: 45, pad: [57, 60, 64], arp: [57, 60, 64, 69, 72] }, // Am
  { bass: 41, pad: [57, 60, 65], arp: [53, 57, 60, 65, 69] }, // F
  { bass: 48, pad: [55, 60, 64], arp: [55, 60, 64, 67, 72] }, // C
  { bass: 43, pad: [55, 59, 62], arp: [55, 59, 62, 67, 71] }, // G
];

// A fixed, pleasant arpeggio pattern (indexes into the chord's arp notes).
const ARP_PATTERN = [0, 2, 1, 3, 2, 4, 3, 1, 0, 2, 4, 3, 1, 3, 2, 4];

export class Music {
  constructor(ctx, destination, volume = 0.6) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.5 * volume;
    this.out.connect(destination);

    // Shared low-pass for the pad: opens up as intensity rises.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 700;
    this.padFilter.Q.value = 0.7;
    this.padFilter.connect(this.out);

    // Simple echo for the arpeggio.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(wet).connect(this.out);

    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.intensity = 0; // target, 0..1
    this.level = 0; // smoothed, follows intensity
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.notesPlayed = 0;
  }

  setVolume(v) {
    this.out.gain.setTargetAtTime(0.5 * v, this.ctx.currentTime, 0.1);
  }

  setIntensity(x) {
    this.intensity = Math.max(0, Math.min(1, x));
  }

  start() {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(this.ctx.currentTime + 0.25), 50);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  schedule(until) {
    // After the tab was in the background, skip ahead rather than cram notes.
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    while (this.nextTime < until) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  playStep(step, t) {
    this.level += (this.intensity - this.level) * 0.06;
    const L = this.level;
    const s = step % 16;
    const chord = CHORDS[Math.floor(step / 16) % CHORDS.length];

    this.padFilter.frequency.setTargetAtTime(600 + L * 2600, t, 0.4);

    if (s === 0) this.pad(chord.pad, t, STEP * 16);
    if (s === 0 || s === 8) this.bass(chord.bass, t, 0.5);
    if (L > 0.5 && (s === 6 || s === 14)) this.bass(chord.bass + 12, t, 0.25);

    // Arpeggio: sparse when calm, 8ths when moving, 16ths when flying.
    const arpEvery = L > 0.65 ? 1 : L > 0.15 ? 2 : 4;
    if (s % arpEvery === 0) {
      const note = chord.arp[ARP_PATTERN[s] % chord.arp.length] + 12;
      this.pluck(note, t, 0.05 + 0.1 * Math.min(1, L * 1.5));
    }

    if (L > 0.3 && (s === 0 || s === 8 || (L > 0.75 && s === 10))) this.kick(t, 0.3 + 0.5 * L);
    if (L > 0.55 && (s === 4 || s === 12)) this.snare(t, 0.12 + 0.18 * L);
    if (L > 0.4 && (s % 2 === 0 || L > 0.8)) this.hat(t, (s % 4 === 2 ? 0.06 : 0.03) * (0.5 + L));
  }

  env(gainNode, t, attack, peak, release) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  pad(notes, t, dur) {
    for (const n of notes) {
      for (const detune of [-7, 7]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = detune;
        const g = this.ctx.createGain();
        this.env(g, t, 0.6, 0.05, dur);
        o.connect(g).connect(this.padFilter);
        o.start(t);
        o.stop(t + dur + 0.8);
        this.notesPlayed++;
      }
    }
  }

  bass(n, t, dur) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midi(n);
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, 0.28, dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.1);
    this.notesPlayed++;
  }

  pluck(n, t, peak) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midi(n);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3500, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    const g = this.ctx.createGain();
    this.env(g, t, 0.005, peak, 0.22);
    o.connect(f).connect(g);
    g.connect(this.out);
    g.connect(this.echo);
    o.start(t);
    o.stop(t + 0.3);
    this.notesPlayed++;
  }

  kick(t, peak) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    this.env(g, t, 0.003, peak, 0.18);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.25);
    this.notesPlayed++;
  }

  noiseHit(t, type, freq, peak, dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    this.env(g, t, 0.002, peak, dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
    src.stop(t + dur + 0.05);
    this.notesPlayed++;
  }

  snare(t, peak) {
    this.noiseHit(t, 'bandpass', 1800, peak, 0.14);
  }

  hat(t, peak) {
    this.noiseHit(t, 'highpass', 7000, peak, 0.04);
  }
}
