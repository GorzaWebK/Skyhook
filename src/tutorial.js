// Tutorial steps. Each step is ticked off by a "flag" the game tracks, and
// the flags only ever grow, so doing something early still counts.
export const TUTORIAL_STEPS = [
  { text: 'Move the <b>mouse</b> to look around.', done: (f) => f.look > 1.5 },
  { text: 'Walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>. Press <kbd>Space</kbd> to jump.', done: (f) => f.walked > 2.5 || f.jumped },
  { text: 'Look up at the <b class="t-orange">orange block</b> ahead. The crosshair turns orange when it is in reach.', done: (f) => f.aimedAnchor },
  { text: 'Hold <kbd>Left click</kbd> to fire your grapple at it. Keep holding.', done: (f) => f.hooked },
  { text: 'Keep holding and walk off the edge to swing. Hold <kbd>W</kbd> to pump your swing.', done: (f) => f.swung },
  { text: 'Let go of <kbd>Left click</kbd> near the top of the swing to fling forward. You get a little hop every time you let go.', done: (f) => f.flung },
  { text: 'Hook the next block and hold <kbd>Right click</kbd> (or <kbd>Shift</kbd>) to reel in and pull yourself up.', done: (f) => f.reeled > 4 },
  { text: 'Fly through the <b class="t-cyan">blue column of light</b> to save a checkpoint. Fall into the clouds and you come back to it.', done: (f) => f.checkpoint },
  { text: '<b>Dark smooth blocks</b> can’t be hooked: the crosshair turns red over them. Swing around them.', done: (f) => f.pastSmooth },
  { text: 'Chain your swings and fly through the <b class="t-gold">golden column</b> to finish!', done: () => false },
];

export function createTutorialFlags() {
  return {
    look: 0, walked: 0, jumped: false, aimedAnchor: false, hooked: false,
    swung: false, flung: false, reeled: 0, checkpoint: false, pastSmooth: false,
  };
}
