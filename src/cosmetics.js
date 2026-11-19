// Rope colours and hook trails. Most are unlocked by achievements.
// req: { type: 'free' } or { type: 'achievement', id }

export const ROPES = [
  { id: 'black', name: 'Classic', color: '#1c1f27', req: { type: 'free' } },
  { id: 'white', name: 'Chalk', color: '#e9edf3', req: { type: 'free' } },
  { id: 'orange', name: 'Safety Orange', color: '#ff7a1a', req: { type: 'achievement', id: 'first-swing' } },
  { id: 'cyan', name: 'Ice', color: '#5ff0ff', req: { type: 'achievement', id: 'graduate' } },
  { id: 'purple', name: 'Ultraviolet', color: '#a46bff', req: { type: 'achievement', id: 'published' } },
  { id: 'green', name: 'Neon', color: '#7dff3d', req: { type: 'achievement', id: 'speed-50' } },
  { id: 'red', name: 'Ember', color: '#ff3b3b', req: { type: 'achievement', id: 'week-warrior' } },
  { id: 'gold', name: 'Gold', color: '#ffc928', req: { type: 'achievement', id: 'gold-10' } },
  { id: 'rainbow', name: 'Rainbow', color: '#ff00ff', rainbow: true, req: { type: 'achievement', id: 'gold-all' } },
];

// Trails behind the flying hook.
export const TRAILS = [
  { id: 'none', name: 'None', req: { type: 'free' } },
  { id: 'comet', name: 'Comet', colors: ['#bff8ff', '#5ff0ff'], size: 7, req: { type: 'achievement', id: 'km-1' } },
  { id: 'smoke', name: 'Smoke', colors: ['#cfd3da', '#7d838e'], size: 9, jitter: 0.25, req: { type: 'achievement', id: 'gravity' } },
  { id: 'fire', name: 'Fire', colors: ['#fff1a8', '#ff6a00', '#c41a00'], size: 8, jitter: 0.12, req: { type: 'achievement', id: 'speed-70' } },
  { id: 'sparkle', name: 'Sparkle', colors: ['#ffffff', '#ffd36b'], size: 5, jitter: 0.4, req: { type: 'achievement', id: 'gold-10' } },
  { id: 'ember', name: 'Ember', colors: ['#ffb36b', '#ff3b3b'], size: 6, jitter: 0.2, req: { type: 'achievement', id: 'week-warrior' } },
  { id: 'rainbow', name: 'Rainbow', rainbow: true, size: 7, req: { type: 'achievement', id: 'gold-all' } },
];

export function isCosmeticUnlocked(item, achieved) {
  return item.req.type === 'free' || !!achieved[item.req.id];
}

export const getRope = (id) => ROPES.find((r) => r.id === id) || ROPES[0];
export const getTrail = (id) => TRAILS.find((t) => t.id === id) || TRAILS[0];
