import { generateCourse, COURSES } from './course.js';
import { raycast, eyePosition, aimDirection, FIXED_DT } from './physics.js';
import { createRun, restartRun, tick, hook, unhook } from './run.js';
import { createBot, botInput } from './bot.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { storage } from './storage.js';

const params = new URLSearchParams(location.search);
const botMode = params.has('bot');

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), timer: $('timer'), best: $('best'), split: $('split'), speed: $('speed'),
  cp: $('cp'), crosshair: $('crosshair'), toast: $('toast'),
  menu: $('menu'), playBtn: $('play-btn'), courseName: $('course-name'), menuBest: $('menu-best'),
  sens: $('sens'), sensVal: $('sens-val'), mute: $('mute'),
  finish: $('finish'), finishTime: $('finish-time'), finishNote: $('finish-note'),
};

export function formatTime(t) {
  if (t == null) return '--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const courseInfo = COURSES[0];
const course = generateCourse(courseInfo.seed);
const run = createRun(course);
const bot = botMode ? createBot(run) : null;

const canvas = $('game');
const renderer = new Renderer(canvas);
renderer.buildCourse(course);

const settings = storage.getSettings();
const sound = new Sound(settings.muted);
const input = new Input(canvas);

// 'menu' | 'playing' | 'finished'
let state = 'menu';
let splits = [];
let best = storage.getBest(courseInfo.id); // { time, splits } or null
let toastTimer = 0;
let splitTimer = 0;

function refreshBest() {
  ui.best.textContent = best ? `Best ${formatTime(best.time)}` : 'No best time yet';
  ui.menuBest.textContent = best ? formatTime(best.time) : '--';
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
  ui.cp.textContent = `Checkpoint ${run.checkpoint + 1} / ${course.checkpoints.length}`;
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

function setState(next) {
  state = next;
  ui.menu.classList.toggle('hidden', state !== 'menu');
  ui.hud.classList.toggle('hidden', state === 'menu');
  if (state !== 'finished') ui.finish.classList.add('hidden');
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
      case 'finish': {
        sound.finish();
        const isRecord = !best || e.time < best.time;
        ui.finishTime.textContent = formatTime(e.time);
        if (isRecord) {
          ui.finishNote.textContent = best ? `New best! ${(best.time - e.time).toFixed(3)}s faster` : 'First finish! That is your best time to beat.';
          ui.finishNote.className = 'record';
          best = { time: e.time, splits: [...splits] };
          storage.setBest(courseInfo.id, best);
          refreshBest();
          sound.record();
        } else {
          ui.finishNote.textContent = `Best: ${formatTime(best.time)} (+${(e.time - best.time).toFixed(3)}s)`;
          ui.finishNote.className = '';
        }
        if (best?.splits && !isRecord) showSplit(e.time - best.time);
        state = 'finished';
        ui.finish.classList.remove('hidden');
        break;
      }
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

// --- Input wiring -----------------------------------------------------------

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
let lastRelease = null;
input.handlers.hookUp = () => {
  const r = unhook(run);
  if (r.released) lastRelease = { ...r, velY: run.player.vel.y };
  if (r.hopped) sound.hop();
  else if (r.released) sound.release();
};
input.handlers.key = (code) => {
  if (code === 'KeyR' && state !== 'menu') restart();
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
canvas.addEventListener('click', () => {
  if (state === 'menu') startPlaying();
});

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

// --- Main loop --------------------------------------------------------------

ui.courseName.textContent = `Course: ${courseInfo.name}`;
refreshBest();
updateCheckpointLabel();

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
  ui.crosshair.className = p.hook ? 'hooked' : target ? 'in-range' : '';

  ui.timer.textContent = formatTime(run.time);
  const speed = p.vel.length();
  ui.speed.firstChild.textContent = Math.round(speed);
  sound.update(state === 'menu' ? 0 : speed, !!p.hook);

  if (toastTimer > 0 && (toastTimer -= dt) <= 0) ui.toast.classList.remove('show');
  if (splitTimer > 0 && (splitTimer -= dt) <= 0) ui.split.classList.remove('show');

  renderer.render(p, target, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (botMode) startPlaying();

// Handle for automated browser tests.
window.__skyhook = { run, course, renderer, get state() { return state; }, get lastRelease() { return lastRelease; }, restart, formatTime };
