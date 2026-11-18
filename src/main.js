import { isHookable } from './course.js';
import { LEVELS, buildLevel } from './levels.js';
import { raycast, eyePosition, aimDirection, FIXED_DT } from './physics.js';
import { createRun, restartRun, tick, hook, unhook } from './run.js';
import { createBot, botInput } from './bot.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { storage } from './storage.js';

const params = new URLSearchParams(location.search);
const botMode = params.has('bot');
const unlockAll = params.get('unlock') === 'all';

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), timer: $('timer'), best: $('best'), split: $('split'), speed: $('speed'),
  cp: $('cp'), levelLabel: $('level-label'), crosshair: $('crosshair'), toast: $('toast'),
  menu: $('menu'), screens: document.querySelectorAll('.screen'),
  playBtn: $('play-btn'), restartBtn: $('restart-btn'), levelsBtn: $('levels-btn'), controlsBtn: $('controls-btn'),
  courseName: $('course-name'), menuBest: $('menu-best'),
  levelGrid: $('level-grid'), levelProgress: $('level-progress'),
  sens: $('sens'), sensVal: $('sens-val'), mute: $('mute'),
  finish: $('finish'), finishTitle: $('finish-title'), finishTime: $('finish-time'),
  finishNote: $('finish-note'), finishHint: $('finish-hint'),
};

export function formatTime(t) {
  if (t == null) return '--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const canvas = $('game');
const renderer = new Renderer(canvas);
const settings = storage.getSettings();
const sound = new Sound(settings.muted);
const input = new Input(canvas);
const progress = storage.getProgress();

// --- Level state --------------------------------------------------------------

let level = null; // entry from LEVELS
let course = null;
let run = null;
let bot = null;
let best = null; // { time, splits } or null
let splits = [];

// 'menu' | 'playing' | 'finished'
let state = 'menu';
let toastTimer = 0;
let splitTimer = 0;
let lastRelease = null;

function unlockedCount() {
  return unlockAll ? LEVELS.length : Math.max(1, Math.min(LEVELS.length, progress.unlocked));
}

function isUnlocked(index) {
  return index < unlockedCount();
}

function loadLevel(index) {
  level = LEVELS[index];
  course = buildLevel(level);
  run = createRun(course);
  bot = botMode ? createBot(run) : null;
  best = storage.getBest(level.id);
  splits = [];
  renderer.buildCourse(course);
  progress.last = index;
  storage.setProgress(progress);
  ui.finish.classList.add('hidden');
  ui.split.className = '';
  ui.levelLabel.textContent = `Level ${level.number} · ${level.name}`;
  refreshBest();
  updateCheckpointLabel();
}

function refreshBest() {
  ui.best.textContent = best ? `Best ${formatTime(best.time)}` : 'No best time yet';
  ui.menuBest.textContent = best ? formatTime(best.time) : '--';
  ui.courseName.textContent = `Level ${level.number}: ${level.name}`;
}

function showToast(text, color) {
  ui.toast.textContent = text;
  ui.toast.style.color = color || '';
  ui.toast.classList.add('show');
  toastTimer = 1.4;
}

function showSplit(delta) {
  ui.split.textContent = `${delta <= 0 ? '-' : '+'}${Math.abs(delta).toFixed(2)}`;
  ui.split.className = `show ${delta <= 0 ? 'ahead' : 'behind'}`;
  splitTimer = 2.5;
}

function updateCheckpointLabel() {
  const n = course.checkpoints.length;
  ui.cp.textContent = n ? `Checkpoint ${run.checkpoint + 1} / ${n}` : '';
}

function restart() {
  restartRun(run);
  splits = [];
  if (bot) Object.assign(bot, createBot(run));
  renderer.setCheckpointReached(-1);
  ui.finish.classList.add('hidden');
  ui.split.className = '';
  updateCheckpointLabel();
  if (state === 'finished') state = 'playing';
}

// --- Menu screens -------------------------------------------------------------

function showScreen(name) {
  for (const s of ui.screens) s.classList.toggle('hidden', s.id !== `screen-${name}`);
  if (name === 'levels') buildLevelGrid();
  if (name === 'main') refreshMainScreen();
}

function refreshMainScreen() {
  const inProgress = run.started && !run.finished;
  ui.playBtn.textContent = inProgress ? 'RESUME' : 'PLAY';
  ui.restartBtn.classList.toggle('hidden', !inProgress);
  refreshBest();
}

function buildLevelGrid() {
  const done = LEVELS.filter((l) => storage.getBest(l.id)).length;
  ui.levelProgress.textContent = `${done} / ${LEVELS.length} complete`;
  ui.levelGrid.innerHTML = '';
  for (const l of LEVELS) {
    const unlocked = isUnlocked(l.index);
    const b = storage.getBest(l.id);
    const tile = document.createElement('button');
    tile.className = `level-tile${unlocked ? '' : ' locked'}${b ? ' done' : ''}${l.index === level.index ? ' current' : ''}`;
    tile.disabled = !unlocked;
    tile.dataset.level = String(l.index);
    tile.innerHTML = `
      <span class="lt-num">${l.number}</span>
      <span class="lt-name">${l.name}</span>
      <span class="lt-best">${unlocked ? (b ? formatTime(b.time) : 'Not finished') : 'Locked'}</span>`;
    tile.addEventListener('click', () => {
      if (!isUnlocked(l.index)) return;
      loadLevel(l.index);
      startPlaying();
    });
    ui.levelGrid.appendChild(tile);
  }
}

function setState(next) {
  state = next;
  ui.menu.classList.toggle('hidden', state !== 'menu');
  ui.hud.classList.toggle('hidden', state === 'menu');
  if (state !== 'finished') ui.finish.classList.add('hidden');
  if (state === 'menu') showScreen('main');
}

// --- Game events --------------------------------------------------------------

function finishLevel(e) {
  sound.finish();
  const isRecord = !best || e.time < best.time;
  ui.finishTitle.textContent = `Level ${level.number} complete!`;
  ui.finishTime.textContent = formatTime(e.time);
  if (isRecord) {
    ui.finishNote.textContent = best ? `New best! ${(best.time - e.time).toFixed(3)}s faster` : 'First finish! That is your best time to beat.';
    ui.finishNote.className = 'record';
    best = { time: e.time, splits: [...splits] };
    storage.setBest(level.id, best);
    refreshBest();
    sound.record();
  } else {
    ui.finishNote.textContent = `Best: ${formatTime(best.time)} (+${(e.time - best.time).toFixed(3)}s)`;
    ui.finishNote.className = '';
  }
  const hasNext = level.index + 1 < LEVELS.length;
  if (hasNext && progress.unlocked < level.index + 2) {
    progress.unlocked = level.index + 2;
    storage.setProgress(progress);
  }
  ui.finishHint.innerHTML = hasNext
    ? '<kbd>N</kbd> next level · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu'
    : 'You beat every level! · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu';
  state = 'finished';
  ui.finish.classList.remove('hidden');
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'start':
        sound.start();
        break;
      case 'checkpoint': {
        splits[e.index] = run.time;
        renderer.setCheckpointReached(e.index);
        updateCheckpointLabel();
        sound.checkpoint();
        showToast('Checkpoint');
        const bestSplit = best?.splits?.[e.index];
        if (bestSplit != null) showSplit(run.time - bestSplit);
        break;
      }
      case 'finish':
        finishLevel(e);
        break;
      case 'fall':
        sound.fall();
        renderer.addShake(0.4);
        showToast(run.checkpoint >= 0 ? 'Back to checkpoint' : 'Try again', '#ffffff');
        if (run.checkpoint < 0) splits = [];
        break;
      case 'land':
        sound.land(e.speed);
        if (e.speed > 15) renderer.addShake(Math.min(0.6, e.speed / 60));
        break;
      case 'jump':
        sound.jump();
        break;
    }
  }
}

// --- Input wiring -------------------------------------------------------------

function currentAim() {
  return aimDirection(run.player.yaw, run.player.pitch);
}

input.handlers.hookDown = () => {
  if (state !== 'playing') return;
  sound.hookFire();
  if (hook(run, currentAim())) {
    sound.attach();
    renderer.addShake(0.15);
  } else {
    sound.miss();
  }
};
input.handlers.hookUp = () => {
  const r = unhook(run);
  if (r.released) lastRelease = { ...r, velY: run.player.vel.y };
  if (r.hopped) sound.hop();
  else if (r.released) sound.release();
};
input.handlers.key = (code) => {
  if (code === 'KeyR' && state !== 'menu') restart();
  if ((code === 'KeyN' || code === 'Enter') && state === 'finished' && level.index + 1 < LEVELS.length) {
    loadLevel(level.index + 1);
    state = 'playing';
  }
  if (code === 'KeyM') {
    settings.muted = !settings.muted;
    ui.mute.checked = settings.muted;
    sound.setMuted(settings.muted);
    storage.setSettings(settings);
  }
};
input.handlers.lockChange = (locked) => {
  if (locked) {
    if (state === 'menu') {
      if (run.finished) restart();
      setState('playing');
    }
  } else if (!botMode) {
    setState('menu');
  }
};

function startPlaying() {
  sound.init();
  if (botMode) {
    if (run.finished) restart();
    setState('playing');
    return;
  }
  input.requestLock();
}

ui.playBtn.addEventListener('click', startPlaying);
ui.restartBtn.addEventListener('click', () => {
  restart();
  startPlaying();
});
ui.levelsBtn.addEventListener('click', () => showScreen('levels'));
ui.controlsBtn.addEventListener('click', () => showScreen('controls'));
for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => showScreen('main'));

ui.sens.value = settings.sensitivity;
ui.sensVal.textContent = `${Number(settings.sensitivity).toFixed(2)}x`;
ui.sens.addEventListener('input', () => {
  settings.sensitivity = Number(ui.sens.value);
  ui.sensVal.textContent = `${settings.sensitivity.toFixed(2)}x`;
  storage.setSettings(settings);
});
ui.mute.checked = settings.muted;
ui.mute.addEventListener('change', () => {
  settings.muted = ui.mute.checked;
  sound.setMuted(settings.muted);
  storage.setSettings(settings);
});

// --- Main loop ----------------------------------------------------------------

const requested = Number(params.get('level')) - 1;
const startIndex = Number.isInteger(requested) && requested >= 0 && requested < LEVELS.length && isUnlocked(requested)
  ? requested
  : isUnlocked(progress.last) ? progress.last : 0;
loadLevel(startIndex);
showScreen('main');

let last = performance.now();
let accumulator = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const p = run.player;

  if (state === 'playing' || state === 'finished') {
    const [mx, my] = input.consumeMouse();
    const k = 0.0022 * settings.sensitivity;
    p.yaw -= mx * k;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - my * k));

    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      const move = bot ? botInput(bot) : input.movement();
      handleEvents(tick(run, move, FIXED_DT));
      accumulator -= FIXED_DT;
    }
  } else {
    accumulator = 0;
  }

  // What would the hook grab right now?
  const target = state === 'menu' ? null : raycast(course, eyePosition(p), currentAim());
  ui.crosshair.className = p.hook ? 'hooked' : target && isHookable(target.box) ? 'in-range' : target ? 'blocked' : '';

  ui.timer.textContent = formatTime(run.time);
  const speed = p.vel.length();
  ui.speed.firstChild.textContent = Math.round(speed);
  sound.update(state === 'menu' ? 0 : speed, !!p.hook);

  if (toastTimer > 0 && (toastTimer -= dt) <= 0) ui.toast.classList.remove('show');
  if (splitTimer > 0 && (splitTimer -= dt) <= 0) ui.split.classList.remove('show');

  renderer.render(p, target && isHookable(target.box) ? target : null, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (botMode) startPlaying();

// Handle for automated browser tests.
window.__skyhook = {
  get run() { return run; },
  get course() { return course; },
  get level() { return level; },
  get state() { return state; },
  get lastRelease() { return lastRelease; },
  renderer, restart, loadLevel, formatTime,
};
