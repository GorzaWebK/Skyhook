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
| R | Restart the course |
| M | Mute |
| Esc | Pause (back to menu) |

The crosshair turns orange when you're aiming at something you can hook, and a ring marks the exact spot. Hook range is 55 m.

## Features

- **Rope physics:** It's a rope, not a stick. It only pulls when it's stretched tight, and reeling in gives you real speed you keep when you let go.
- **Short, punchy ropes:** The rope is capped at 28 m. Hook something further away and it pulls you in to 28 m automatically.
- **Release hop:** Letting go gives a small jump up and forward in the direction you're facing. If you're falling, it stops the fall, so you can rescue a run that was about to drop. You only get it if you held the rope for at least 0.25 s, so you can't spam it.
- **Course "First Flight":** 16 anchors, 2 checkpoints and a finish. Checkpoints and the finish are tall columns of light, and flying through them anywhere counts.
- **Timer and best time:** The clock starts when you leave the start platform. Your best time and checkpoint splits are saved in the browser.
- **Splits:** At each checkpoint you see how far ahead (green) or behind (red) your best run you are.
- **Falling:** Drop into the clouds and you go back to your last checkpoint while the clock keeps running. Before the first checkpoint, the run starts over.
- **Feel:** The view widens with speed, the camera shakes on hard landings and when the hook catches, and wind and rope-creak sounds follow your speed.
- **Settings:** Mouse sensitivity and mute, both saved.

## How it's built

- Plain JavaScript + [Vite](https://vite.dev), [three.js](https://threejs.org) for 3D, and the Web Audio API for sound.
- Courses are generated from a seed (`src/course.js`), so the same seed always gives the same course.
- Physics and game rules (`src/physics.js`, `src/run.js`) contain no drawing code. They run on a fixed 120 Hz timestep, so the game plays the same at any frame rate and can be tested in Node.
- An autopilot (`src/bot.js`) flies the course. The tests use it to prove the course can be finished. Add `?bot=1` to the URL to watch it play.

| File | What it does |
| --- | --- |
| `src/main.js` | Game loop, menus, HUD |
| `src/physics.js` | Movement, rope, collisions, hook raycast |
| `src/run.js` | Timer, checkpoints, finish, respawn |
| `src/course.js` | Course generator |
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
npm test           # physics + course tests (Node), includes the autopilot finishing the course
npm run e2e        # build, then full browser test with Playwright + Chromium
npm run build      # production build into dist/
```

## Deploying

Every push to `main` runs the tests, builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`. In the repo settings, **Settings → Pages → Source** must be set to **GitHub Actions**.

## Roadmap ideas

- Ghost replay of your best run (and the world record)
- Online leaderboards
- Daily course from a shared seed
- More courses, moving anchors and obstacles
- Course editor and sharing
- Music generated in code
