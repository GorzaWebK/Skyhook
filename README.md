# Skyhook

A first-person grappling hook game for the browser. Fire your hook at the orange anchor blocks, swing, let go to fling yourself forward, and race to the finish against your best time.

**Play:** https://gorzawebk.github.io/Skyhook/

PC only (keyboard and mouse). Phones and tablets with only a touchscreen see a short "play on a PC" notice. Everything is made in code: the 3D world, textures, sky, clouds and all sound effects. There are no image or audio files.

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
| C | Back to your last checkpoint straight away (the clock keeps running) |
| N / Enter | Next level (on the finish screen) |
| M | Mute |
| Esc | Pause (back to menu) |

The crosshair turns orange when you're aiming at something you can hook (red over smooth blocks you can't), and a ring marks the exact spot. Hook range is 55 m.

The full controls list sits behind the **Controls** button on the main menu.

## Features

- **Rope physics:** It's a rope, not a stick. It only pulls when it's stretched tight, and reeling in gives you real speed you keep when you let go.
- **Rope length:** The rope stays the length it was when it caught (up to the 55 m hook range) until you reel in.
- **Release hop:** Letting go gives a small jump up and forward in the direction you're facing. If you're falling, it stops the fall, so you can rescue a run that was about to drop. You only get it if you held the rope for at least 0.25 s, so you can't spam it.
- **Tutorial:** Open it from the **Tutorial** button on the main menu, which is highlighted until you've done it once. A prompt box takes you through ten steps on a gentle hand-built course: looking, moving, aiming, hooking, swinging, letting go, reeling in, checkpoints, smooth blocks and the finish. If you do a step early it still counts, and pressing **N** at the end starts Level 1.
- **30 levels:** Open them from the **Levels** button. Each level unlocks when you finish the one before. They get harder as you go:
  - more anchors (8 on level 1, 26 on level 30)
  - bigger gaps between anchors
  - smaller anchors
  - bigger zig-zags left, right, up and down
  - checkpoints further apart
  - from level 13, dark **smooth blocks** that your hook can't grab. They sit in your swing path and can block your aim.
  - from level 16, **moving anchors** (amber instead of orange) that slide sideways or bob up and down, with more of them on later levels. A hook stays stuck to the spot it bit, and the anchors only start moving when your timer starts, so every run gets the same timing.
- **Medals:** Every level has gold, silver and bronze target times. Gold is the autopilot's own time, silver is 30% slower and bronze 75% slower. The HUD shows the next medal to aim for, the finish screen shows what you earned, and the level select shows your medal on each level plus your totals.
- **Gun skins:** Nine colour styles for the grapple gun, picked from **Gun** on the main menu. The live gun stays visible next to the list, so you see the change straight away. They unlock with progress: Standard (free), Rookie Teal (finish the tutorial), Bronze Age (5 medals), Crimson (15 medals), Cobalt (5 silver-or-better), Toxic (15 silver-or-better), Architect (finish a level you built in the editor), Gilded (10 golds) and Phantom Chrome (gold on all 30 levels). The finish screen tells you when you've unlocked a new one.
- **Proven finishable:** Every level is checked by the autopilot (see below) to make sure it can be finished without falling.
- **Checkpoints and finish:** Tall columns of light. Flying through them anywhere counts.
- **Timer and best times:** The clock starts when you leave the start platform. Your best time and checkpoint splits for each level, and which levels you've unlocked, are saved in the browser.
- **Splits:** At each checkpoint you see how far ahead (green) or behind (red) your best run you are.
- **Falling:** Drop into the clouds and you go back to your last checkpoint while the clock keeps running. Before the first checkpoint, the run starts over.
- **Level editor:** Build your own courses from **Level editor** on the main menu.
  - **Building:** Fly around freely (WASD, Space up, Shift down) and place blocks where you aim: **1** anchor, **2** smooth block, **3** platform, **4** checkpoint, **5** finish.
  - **Editing:** Left click places, right click deletes, the mouse wheel or **[ ]** changes size, **R** rotates, **Q** copies the block you're aiming at, and **Z** undoes.
  - **Testing:** **T** test-plays your level and **T** again takes you back to editing.
  - **My Levels:** Every change saves automatically. My Levels lists your levels with Play, Edit, Share and Delete.
  - **Sharing:** **Share** gives a short code (it starts with `SKY1.`) that a friend can paste into **Import a code**.
  - Finishing a level you built yourself unlocks the **Architect** gun skin.
- **Daily challenge:** A new level every day (the day changes at midnight UTC), the same for everyone, from the gold **Daily challenge** button on the main menu. The difficulty varies between roughly level 9 and level 23, and the sky rotates between day, sunset, night and storm. It has medals, ghosts, its own daily online leaderboard (on the Leaderboards page, one step back from Level 1) and a streak counter for consecutive days played. Two years of daily layouts were picked ahead of time by `scripts/find-daily.mjs` and checked to be finishable by the autopilot.
- **Ghost replays:** Your best run on each level is recorded, and next time you race a see-through copy of yourself (cyan, "Your best"). Online, a new best also uploads your recording, so everyone can race the **world record holder's ghost** (gold, with their name). Choose Off, Your best, World record or Both under **Settings → Ghost**.
- **Community levels:** Publish a level you've built (and finished once) from **My Levels → Publish**. Everyone can browse published levels under **Community levels** (Newest or Top voted), play them and upvote them (or press **V** after finishing one). You can update or remove your own. You can publish at most once a minute.
- **Online leaderboards:** A top 10 for every level, with your world rank shown on the finish screen and a **Leaderboards** page (with your player name) on the main menu. It uses the shared Firebase project (see "Online leaderboards" below).
- **Grapple gun:** You hold a grapple gun in a gloved hand, drawn in first person and built from shapes in code. It sways as you look around, bobs as you walk, leans when you strafe, kicks when you fire, and its glowing spool spins when you reel in.
- **Rope shot:** The hook visibly flies from the gun's muzzle to the block at 250 m/s, with the rope wiggling behind it, and catches when it lands. Let go before it lands and the shot is cancelled. The rope snaps taut when it catches and sags when it goes slack.
- **Music:** A generated soundtrack (A minor, 100 BPM) that builds with your speed. A calm pad and bass play in the menu or when standing still. An arpeggio joins when you move, kick and hi-hats when you swing fast, and snare and a busier bass when you're flying. It has its own volume slider in the menu, and **M** mutes everything.
- **Sky themes:** Levels 1–10 are set in daytime, 11–20 at sunset and 21–30 at night (with stars and a moon). A fourth theme, **Storm**, has dark clouds, rain, lightning and thunder. You can pick any of the four for your own levels in the editor.
- **Speed effects:** Thin speed lines and darker screen edges fade in when you fly fast (they can be switched off in Settings). Sparks fly where the hook bites.
- **Feel:** The view widens with speed, the camera shakes on hard landings and when the hook catches, and wind and rope-creak sounds follow your speed.
- **Profile: stats:** Lifetime stats on the **Profile** page: play time, distance travelled and swung, hooks fired and landed, top speed, longest swing, hops, jumps, falls, checkpoints, finishes, medals and best daily streak.
- **Settings page:** graphics quality (High, Medium, Low), a frames-per-second counter, mouse sensitivity, invert mouse, field of view, separate sound effects and music volumes, mute, camera shake on/off and speed effects on/off. All are saved.

## How it's built

- Plain JavaScript + [Vite](https://vite.dev), [three.js](https://threejs.org) for 3D, and the Web Audio API for sound.
- Levels are generated from a seed and a difficulty (`src/course.js`, `src/levels.js`), so the same seed always gives the same layout.
- `scripts/find-seeds.mjs` picks a seed for each level that the autopilot can finish, and records the autopilot's time (the gold medal time). Both are written to `src/level-seeds.js`. Rerun it after changing the generator, physics or bot.
- Physics and game rules (`src/physics.js`, `src/run.js`) contain no drawing code. They run on a fixed 120 Hz timestep, so the game plays the same at any frame rate and can be tested in Node.
- An autopilot (`src/bot.js`) flies the levels. The tests use it to prove all 30 can be finished. Add `?bot=1` to the URL to watch it play.
- Testing helpers: `?level=N` opens level N (if unlocked), `?tutorial=1` opens the tutorial, `?daily=1` opens today's daily, and `?unlock=all` unlocks every level for that visit without saving.

| File | What it does |
| --- | --- |
| `src/main.js` | Game loop, menus, HUD |
| `src/physics.js` | Movement, rope, collisions, hook raycast |
| `src/run.js` | Timer, checkpoints, finish, respawn |
| `src/course.js` | Level generator and difficulty settings |
| `src/levels.js` | The 30 levels: names and seeds |
| `src/editor.js` | Level editor: placing, deleting, undo, flying |
| `src/custom.js` | Custom level checks and share codes |
| `src/online.js` | Online leaderboards and world record ghosts (Firebase) |
| `src/ghost.js` | Recording, compressing and playing back ghosts |
| `src/online-config.js` | Firebase web config (null = online off) |
| `firebase/database.rules.json` | Skyhook's security rules on their own |
| `firebase/database.rules.full.json` | Complete rules file for the Firebase console (Foundry Arena + Skyhook) |
| `src/daily.js` | Daily challenge: today's level, countdown, streak |
| `src/stats.js` | Lifetime stats |
| `src/skins.js` | Gun skins and their unlock rules |
| `src/tutorial.js` | Tutorial steps and when each one is ticked off |
| `src/render.js` | three.js scene, sky, clouds, hook head |
| `src/viewmodel.js` | First-person arm and grapple gun |
| `src/rope.js` | Rope drawn as a camera-facing strip |
| `src/themes.js` | Sky themes (day, sunset, night, storm) |
| `src/effects.js` | Sparks, rain and speed lines |
| `src/textures.js` | Textures drawn on a canvas |
| `src/audio.js` | Synthesised sound effects |
| `src/music.js` | Generated music that follows your speed |
| `src/input.js` | Keyboard, mouse and pointer lock |
| `src/storage.js` | Best times and settings (localStorage) |
| `src/bot.js` | Autopilot used by tests |

## Running locally

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # physics + level tests (Node), includes the autopilot finishing all 30 levels
npm run e2e        # build, then full browser test with Playwright + Chromium
npm run test:online  # leaderboard + security rules tests on local Firebase emulators (needs Java)
npm run build      # production build into dist/
```

## Online leaderboards

- Scores are stored in the Firebase Realtime Database of the shared `foundry-arena` project, at `skyhook/scores/<level>/<player id>`. Players sign in anonymously behind the scenes.
- Each player has one entry per level: their best time. With a new best, the run's ghost recording is saved at `skyhook/ghosts/<level>/<player id>` in the same write, so a ghost always matches its score. The security rules only allow you to write your own entry and only to improve your time. They also check names (1–16 letters, digits, spaces or `_ . -`), times (3 s or more) and level names, and allow no extra fields.
- Community levels are at `skyhook/levels/<id>` (`uid`, `name`, `author`, `code`, `blocks`, `at`), votes at `skyhook/levelVotes/<id>/<player id>`, and `skyhook/publishers/<player id>` holds the time of each player's last publish. The rules allow one publish per minute and only valid level codes, and only the owner can change or remove a level.
- `firebase/database.rules.json` has Skyhook's rules on their own. `firebase/database.rules.full.json` is the **complete file for the Firebase console**: Foundry Arena's rules, unchanged, plus Skyhook's `skyhook` section. Whenever either game's rules change, the full file must be updated and pasted into the console again.
- The web config is in `src/online-config.js`. Set it to `null` to switch online off.
- `npm run test:online` runs the rules and leaderboard tests against the local Firebase emulators (Java is needed for the database emulator). `RULES_FILE=firebase/database.rules.full.json npm run test:online` tests the complete console file, including checks that Foundry Arena's paths still behave the same.
- The automated browser tests run with online switched off, so they never touch the live database.

## Deploying

Every push to `main` runs the tests, builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`. In the repo settings, **Settings → Pages → Source** must be set to **GitHub Actions**.

## Roadmap ideas

- Ghost replay of your best run (and the world record)
- Moving anchors and obstacles
