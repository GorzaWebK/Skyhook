// Ghost replays: record a run (20 times a second) and play it back.
//
// A sample is [x, y, z, hooked, hx, hy, hz]: the player's position and, if
// the rope is attached, the hook point. Stored compressed as
// "G1." + base64url(deflate(JSON of delta-encoded centimetres)).

export const GHOST_RATE = 20; // samples per second
const FIELDS = 7;

export class GhostRecorder {
  constructor() {
    this.samples = [];
    this.nextTime = 0;
  }

  reset() {
    this.samples = [];
    this.nextTime = 0;
  }

  // Call every physics step with the run clock.
  record(time, player) {
    if (time + 1e-9 < this.nextTime) return;
    const h = player.hook;
    this.samples.push([
      player.pos.x, player.pos.y, player.pos.z,
      h ? 1 : 0, h ? h.point.x : 0, h ? h.point.y : 0, h ? h.point.z : 0,
    ]);
    this.nextTime = this.samples.length / GHOST_RATE;
  }
}

// Where the ghost is at time t: { pos: [x, y, z], hook: [x, y, z] | null }.
export function ghostAt(samples, t) {
  if (!samples?.length) return null;
  const f = Math.max(0, t * GHOST_RATE);
  const i = Math.min(samples.length - 1, Math.floor(f));
  const j = Math.min(samples.length - 1, i + 1);
  const k = Math.min(1, f - i);
  const a = samples[i];
  const b = samples[j];
  const lerp = (n) => a[n] + (b[n] - a[n]) * k;
  return {
    pos: [lerp(0), lerp(1), lerp(2)],
    hook: a[3] ? [a[4], a[5], a[6]] : null,
    done: f >= samples.length - 1,
  };
}

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function encodeGhost(samples) {
  const flat = [];
  const prev = new Array(FIELDS).fill(0);
  for (const s of samples) {
    for (let f = 0; f < FIELDS; f++) {
      const v = f === 3 ? s[f] : Math.round(s[f] * 100); // centimetres
      flat.push(v - prev[f]);
      prev[f] = v;
    }
  }
  const json = new TextEncoder().encode(JSON.stringify(flat));
  if (typeof CompressionStream !== 'undefined') return `G1.${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  return `G0.${toBase64Url(json)}`;
}

export async function decodeGhost(code) {
  const m = /^G([01])\.([A-Za-z0-9_-]+)$/.exec(String(code));
  if (!m) throw new Error('Not a ghost');
  let bytes = fromBase64Url(m[2]);
  if (m[1] === '1') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const flat = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(flat) || flat.length % FIELDS !== 0 || flat.length > FIELDS * GHOST_RATE * 3600) throw new Error('Bad ghost');
  const samples = [];
  const prev = new Array(FIELDS).fill(0);
  for (let i = 0; i < flat.length; i += FIELDS) {
    const s = [];
    for (let f = 0; f < FIELDS; f++) {
      const d = flat[i + f];
      if (typeof d !== 'number' || !Number.isFinite(d)) throw new Error('Bad ghost');
      prev[f] += d;
      s.push(f === 3 ? prev[f] : prev[f] / 100);
    }
    samples.push(s);
  }
  return samples;
}
