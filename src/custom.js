import { CUSTOM_KINDS } from './course.js';
import { THEME_IDS } from './themes.js';

// Custom levels: validation and share codes.
// A share code is "SKY1." + base64url(deflate(JSON)), or "SKY0." +
// base64url(JSON) on browsers without CompressionStream.

export const LIMITS = { blocks: 500, name: 24, xz: 3000, yMin: -200, yMax: 400, sizeMin: 0.5, sizeMax: 80 };

const round = (n) => Math.round(n * 100) / 100;

// Returns a clean copy of the level, or throws an Error saying what's wrong.
export function validateLevel(data) {
  if (!data || typeof data !== 'object') throw new Error('Not a level');
  if (data.v !== 1) throw new Error('Unknown level version');
  if (!Array.isArray(data.blocks)) throw new Error('Level has no blocks list');
  if (data.blocks.length > LIMITS.blocks) throw new Error(`Too many blocks (max ${LIMITS.blocks})`);
  const name = String(data.name ?? 'Untitled').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, LIMITS.name) || 'Untitled';
  let finishes = 0;
  const blocks = data.blocks.map((b, i) => {
    if (!Array.isArray(b) || b.length !== 7) throw new Error(`Block ${i + 1} is malformed`);
    const [k, ...nums] = b;
    if (!CUSTOM_KINDS[k]) throw new Error(`Block ${i + 1} has an unknown type`);
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error(`Block ${i + 1} has bad numbers`);
    const [x, y, z, sx, sy, sz] = nums;
    if (Math.abs(x) > LIMITS.xz || Math.abs(z) > LIMITS.xz || y < LIMITS.yMin || y > LIMITS.yMax) throw new Error(`Block ${i + 1} is too far away`);
    if ([sx, sy, sz].some((v) => v < LIMITS.sizeMin || v > LIMITS.sizeMax)) throw new Error(`Block ${i + 1} has a bad size`);
    if (k === 'f') finishes++;
    return [k, ...nums.map(round)];
  });
  if (finishes > 1) throw new Error('A level can only have one finish');
  const theme = THEME_IDS.includes(data.theme) ? data.theme : 'day';
  return { v: 1, name, theme, blocks };
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
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// Generic "TAG1." + base64url(deflate(JSON)) packing (or "TAG0." + plain
// base64url(JSON) on browsers without CompressionStream). Used for level
// codes (SKY) and account saves (SV).
export async function packJson(obj, tag) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    return `${tag}1.${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
  }
  return `${tag}0.${toBase64Url(json)}`;
}

// Throws Error('damaged') / a browser message if it can't be unpacked;
// returns null if the text isn't a TAG code at all.
export async function unpackJson(code, tag) {
  const text = String(code).trim().replace(/\s+/g, '');
  const m = new RegExp(`^${tag}([01])\\.([A-Za-z0-9_-]+)$`).exec(text);
  if (!m) return null;
  let bytes;
  try {
    bytes = fromBase64Url(m[2]);
    if (m[1] === '1') {
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed codes');
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
  } catch (e) {
    throw new Error(e.message.includes('browser') ? e.message : 'The code is damaged or incomplete');
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The code is damaged or incomplete');
  }
}

export async function encodeLevel(data) {
  return packJson(validateLevel(data), 'SKY');
}

export async function decodeLevel(code) {
  const data = await unpackJson(code, 'SKY');
  if (data === null) throw new Error("That doesn't look like a Skyhook level code");
  return validateLevel(data);
}

export function newLevelId() {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
