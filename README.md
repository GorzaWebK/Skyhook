# Skyhook

A first-person grappling hook game for the browser. Fire your hook at the orange anchor blocks, swing, let go to fling yourself forward, and race to the finish against your best time.

**Play:** https://gorzawebk.github.io/Skyhook/

PC only (keyboard and mouse). Everything is made in code: the 3D world, textures, sky, clouds and all sound effects. There are no image or audio files.

> "Skyhook" is a working title. (Repo: GorzaWebK/Skyhook, formerly New-game.)

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look and aim |
| Left click (hold) | Fire the hook and stay attached. Let go to fling (with a small hop). |
| Right click / Shift (hold) | Reel the rope in |
| W A S D | Steer in the air and pump your swing |
| Space | Jump |
| R | Restart the level |
| N / Enter | Next level (on the finish screen) |
| M | Mute |
| Esc | Pause (back to menu) |

The crosshair turns orange when you're aiming at something you can hook (red over smooth blocks you can't), and a ring marks the exact spot. Hook range is 55 m.

The full controls list sits behind the **Controls** button on the main menu.

## Features

- **Rope physics:** It's a rope, not a stick. It only pulls when it's stretched tight, and reeling in gives you real speed you keep when you let go.
- **Rope length:** The rope stays the length it was when it caught (up to the 55 m hook range) until you reel in.
- **Release hop:** Letting go gives a small jump up and forward in the direction you're facing. If you're falling, it stops the fall, so you can rescue a run that was about to drop. You only get it if you held the rope for at least 0.25 s, so you can't spam it.
- **30 levels:** Open them from the **Levels** button. Each level unlocks when you finish the one before. They get harder as you go:
  - more anchors (8 on level 1, 26 on level 30)
  - bigger gaps between anchors
  - smaller anchors
  - bigger zig-zags left, right, up and down
  - checkpoints further apart
  - from level 13, dark **smooth blocks** that your hook can't grab. They sit in your swing path and can block your aim.
- **Proven finishable:** Every level is checked by the autopilot (see below) to make sure it can be finished without falling.
- **Checkpoints and finish:** Tall columns of light. Flying through them anywhere counts.
- **Timer and best times:** The clock starts when you leave the start platform. Your best time and checkpoint splits for each level, and which levels you've unlocked, are saved in the browser.
- **Splits:** At each checkpoint you see how far ahead (green) or behind (red) your best run you are.
- **Falling:** Drop into the clouds and you go back to your last checkpoint while the clock keeps running. Before the first checkpoint, the run starts over.
- **Feel:** The view widens with speed, the camera shakes on hard landings and when the hook catches, and wind and rope-creak sounds follow your speed.
- **Settings:** Mouse sensitivity and mute, both saved.

## How it's built

- Plain JavaScript + [Vite](https://vite.dev), [three.js](https://threejs.org) for 3D, and the Web Audio API for sound.
- Levels are generated from a seed and a difficulty (`src/course.js`, `src/levels.js`), so the same seed always gives the same layout.
- `scripts/find-seeds.mjs` picks a seed for each level that the autopilot can finish and writes them to `src/level-seeds.js`. Rerun it after changing the generator, physics or bot.
- Physics and game rules (`src/physics.js`, `src/run.js`) contain no drawing code. They run on a fixed 120 Hz timestep, so the game plays the same at any frame rate and can be tested in Node.
- An autopilot (`src/bot.js`) flies the levels. The tests use it to prove all 30 can be finished. Add `?bot=1` to the URL to watch it play.
- Testing helpers: `?level=N` opens level N (if unlocked), and `?unlock=all` unlocks every level for that visit without saving.

| File | What it does |
| --- | --- |
| `src/main.js` | Game loop, menus, HUD |
| `src/physics.js` | Movement, rope, collisions, hook raycast |
| `src/run.js` | Timer, checkpoints, finish, respawn |
| `src/course.js` | Level generator and difficulty settings |
| `src/levels.js` | The 30 levels: names and seeds |
| `src/render.js` | three.js scene, sky, clouds, rope |
| `src/textures.js` | Textures drawn on a canvas |
| `src/audio.js` | Synthesised sound effects |
| `src/input.js` | Keyboard, mouse and pointer lock |
| `src/storage.js` | Best times and settings (localStorage) |
| `src/bot.js` | Autopilot used by tests |

## Running locally

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # physics + level tests (Node), includes the autopilot finishing all 30 levels
npm run e2e        # build, then full browser test with Playwright + Chromium
npm run build      # production build into dist/
```

## Deploying

Every push to `main` runs the tests, builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`. In the repo settings, **Settings → Pages → Source** must be set to **GitHub Actions**.

## Roadmap ideas

- Ghost replay of your best run (and the world record)
- Online leaderboards
- Daily course from a shared seed
- Moving anchors and obstacles
- Course editor and sharing
- Music generated in code
