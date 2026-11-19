import { isHookable, insideBox, buildTutorialCourse, buildCustomCourse } from './course.js';
import { Editor, TOOLS } from './editor.js';
import { encodeLevel, decodeLevel, newLevelId } from './custom.js';
import { onlineEnabled, submitScore, getLeaderboard, cleanName } from './online.js';
import { TUTORIAL_STEPS, createTutorialFlags } from './tutorial.js';
import { LEVELS, MEDALS, buildLevel, medalFor, nextMedal } from './levels.js';
import { raycast, eyePosition, aimDirection, FIXED_DT, TUNING } from './physics.js';
import { createRun, restartRun, tick, hook, unhook } from './run.js';
import { createBot, botInput } from './bot.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Music } from './music.js';
import { Input } from './input.js';
import { storage } from './storage.js';
import { SKINS, getSkin, isSkinUnlocked, skinRequirement } from './skins.js';
import { applySkin } from './viewmodel.js';

const params = new URLSearchParams(location.search);
const botMode = params.has('bot');
const unlockAll = params.get('unlock') === 'all';

const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), timer: $('timer'), best: $('best'), target: $('target'), split: $('split'), speed: $('speed'),
  cp: $('cp'), levelLabel: $('level-label'), crosshair: $('crosshair'), toast: $('toast'),
  menu: $('menu'), screens: document.querySelectorAll('.screen'),
  playBtn: $('play-btn'), restartBtn: $('restart-btn'), levelsBtn: $('levels-btn'), controlsBtn: $('controls-btn'),
  tutorialBtn: $('tutorial-btn'), newHint: $('new-hint'), editorBtn: $('editor-btn'),
  mlNew: $('ml-new'), mlImportToggle: $('ml-import-toggle'), mlImport: $('ml-import'), importCode: $('import-code'),
  importBtn: $('import-btn'), importMsg: $('import-msg'), mlList: $('ml-list'),
  mlShare: $('ml-share'), mlShareTitle: $('ml-share-title'), mlShareCode: $('ml-share-code'), mlShareMsg: $('ml-share-msg'),
  editName: $('edit-name'), editStatus: $('edit-status'), editResume: $('edit-resume'), editTest: $('edit-test'),
  editShare: $('edit-share'), editShareBox: $('edit-share-box'), editShareCode: $('edit-share-code'),
  editShareMsg: $('edit-share-msg'), editExit: $('edit-exit'),
  boardsBtn: $('boards-btn'), boardPrev: $('board-prev'), boardNext: $('board-next'), boardLevel: $('board-level'),
  boardName: $('board-name'), boardList: $('board-list'), finishBoard: $('finish-board'),
  epName: $('ep-name'), epTools: $('ep-tools'), epSize: $('ep-size'), epStatus: $('ep-status'), skinsBtn: $('skins-btn'), skinGrid: $('skin-grid'),
  tutorial: $('tutorial'), tutStep: $('tut-step'), tutText: $('tut-text'),
  courseName: $('course-name'), menuBest: $('menu-best'),
  levelGrid: $('level-grid'), levelProgress: $('level-progress'),
  sens: $('sens'), sensVal: $('sens-val'), mute: $('mute'), musicVol: $('music-vol'),
  finish: $('finish'), finishTitle: $('finish-title'), finishTime: $('finish-time'),
  finishNote: $('finish-note'), finishHint: $('finish-hint'), finishMedal: $('finish-medal'),
  medalTotals: $('medal-totals'),
};

export function formatTime(t) {
  if (t == null) return '--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const MEDAL_NAME = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

export function medalBadge(m, big = false) {
  return m ? `<span class="medal medal-${m}${big ? ' big' : ''}" title="${MEDAL_NAME[m]}"></span>` : '';
}

// Medals earned across all levels. A gold also counts as a silver and a
// bronze ("silver or better").
export function medalCounts() {
  const c = { gold: 0, silver: 0, bronze: 0 };
  for (const l of LEVELS) {
    const m = medalFor(l, storage.getBest(l.id)?.time);
    if (!m) continue;
    for (const tier of MEDALS.slice(MEDALS.indexOf(m))) c[tier]++;
  }
  return c;
}

function skinStats() {
  return { medals: medalCounts(), tutorialDone: !!progress.tutorialDone, editorFinished: !!progress.editorFinished };
}

function unlockedSkinIds() {
  const stats = skinStats();
  return new Set(SKINS.filter((sk) => isSkinUnlocked(sk, stats)).map((sk) => sk.id));
}

const canvas = $('game');
const renderer = new Renderer(canvas);
const settings = storage.getSettings();
const sound = new Sound(settings.muted);
const input = new Input(canvas);
let music = null; // created on the first click (browsers block audio before that)

function startAudio() {
  sound.init();
  if (!music && sound.ctx) {
    music = new Music(sound.ctx, sound.master, settings.musicVolume ?? 0.6);
    music.start();
  }
}
const progress = storage.getProgress();
if (!settings.playerName) {
  settings.playerName = `Player${1000 + Math.floor(Math.random() * 9000)}`;
  storage.setSettings(settings);
}

function equipSkin(id) {
  const skin = getSkin(id);
  settings.skin = skin.id;
  storage.setSettings(settings);
  applySkin(skin.colors);
}
equipSkin(unlockedSkinIds().has(settings.skin) ? settings.skin : 'standard');

function buildSkinGrid() {
  const stats = skinStats();
  ui.skinGrid.innerHTML = '';
  for (const sk of SKINS) {
    const unlocked = isSkinUnlocked(sk, stats);
    const equipped = settings.skin === sk.id;
    const c = sk.colors;
    const card = document.createElement('button');
    card.className = `skin-card${unlocked ? '' : ' locked'}${equipped ? ' equipped' : ''}`;
    card.disabled = !unlocked;
    card.dataset.skin = sk.id;
    card.innerHTML = `
      <span class="skin-swatch" style="--body:${c.body};--dark:${c.dark};--accent:${c.accent};--glow:${c.glow}">
        <i class="sw-body"></i><i class="sw-rail"></i><i class="sw-ring"></i><i class="sw-grip"></i>
      </span>
      <span class="skin-name">${sk.name}</span>
      <span class="skin-status">${equipped ? 'Equipped' : unlocked ? 'Click to equip' : skinRequirement(sk, stats)}</span>`;
    card.addEventListener('click', () => {
      if (!isSkinUnlocked(sk, skinStats())) return;
      equipSkin(sk.id);
      buildSkinGrid();
    });
    ui.skinGrid.appendChild(card);
  }
}

// Call before and after progress changes; announces newly unlocked skins.
function announceNewSkins(before) {
  const fresh = SKINS.filter((sk) => !before.has(sk.id) && unlockedSkinIds().has(sk.id));
  if (!fresh.length) return '';
  sound.unlock();
  return `<div class="fm-skin">New gun skin unlocked: <b>${fresh.map((sk) => sk.name).join(', ')}</b>! Equip it from <b>Gun</b> in the menu.</div>`;
}

// --- Level state --------------------------------------------------------------

const TUTORIAL = { id: 'tutorial', number: 0, index: -1, name: 'Tutorial', tutorial: true };

let level = null; // entry from LEVELS, or TUTORIAL
let course = null;
let run = null;
let bot = null;
let best = null; // { time, splits } or null
let splits = [];

// 'menu' | 'playing' | 'finished' | 'editor'
let state = 'menu';
// 'level' (official levels and tutorial) | 'custom' (playing a custom level)
// | 'test' (test-playing from the editor) | 'editor'
let mode = 'level';
let resumeTo = 'play'; // what to do when the pointer lock is (re)gained
let customLevel = null; // the custom level being played or edited
let editorCam = null; // where the editor camera was before a test run
let toastTimer = 0;
let splitTimer = 0;
let lastRelease = null;
let tut = null; // { flags, step } while playing the tutorial

function unlockedCount() {
  return unlockAll ? LEVELS.length : Math.max(1, Math.min(LEVELS.length, progress.unlocked));
}

function isUnlocked(index) {
  return index < unlockedCount();
}

function levelTitle(l) {
  if (l.custom) return `${mode === 'test' ? 'Testing' : 'Custom'}: ${l.name}`;
  return l.tutorial ? 'Tutorial' : `Level ${l.number}: ${l.name}`;
}

function loadDef(def) {
  level = def;
  course = def.tutorial ? buildTutorialCourse() : def.custom ? buildCustomCourse(def.data) : buildLevel(def);
  run = createRun(course);
  bot = botMode ? createBot(run) : null;
  best = storage.getBest(def.id);
  splits = [];
  renderer.buildCourse(course);
  if (!def.tutorial && !def.custom) {
    progress.last = def.index;
    storage.setProgress(progress);
  }
  tut = def.tutorial ? { flags: createTutorialFlags(), step: 0 } : null;
  ui.tutorial.classList.toggle('hidden', !tut);
  if (tut) showTutorialStep();
  ui.finish.classList.add('hidden');
  ui.finishBoard.classList.add('hidden');
  ui.split.className = '';
  ui.levelLabel.textContent = def.custom
    ? (mode === 'test' ? `Testing · ${def.name} (T to edit)` : `Custom · ${def.name}`)
    : def.tutorial ? 'Tutorial' : `Level ${def.number} · ${def.name}`;
  refreshBest();
  updateCheckpointLabel();
}

function loadLevel(index) {
  mode = 'level';
  customLevel = null;
  loadDef(LEVELS[index]);
}

// --- Custom levels and the editor ---------------------------------------------

const editor = new Editor(renderer);

function customDef(lvl) {
  return { id: `custom-${lvl.id}`, custom: true, data: lvl.data, name: lvl.data.name, index: -1, number: 0 };
}

function saveCustom(lvl) {
  const list = storage.getCustomLevels().filter((l) => l.id !== lvl.id);
  list.unshift(lvl);
  storage.setCustomLevels(list);
}

function playCustom(lvl) {
  mode = 'custom';
  customLevel = lvl;
  loadDef(customDef(lvl));
  startPlaying();
}

function openEditor(lvl) {
  mode = 'editor';
  customLevel = lvl;
  editor.open(lvl); // builds the level's course in the renderer
  course = editor.course;
  run = createRun(course);
  level = customDef(lvl);
  const p = run.player;
  if (editorCam && editorCam.id === lvl.id) {
    p.pos.copy(editorCam.pos);
    p.yaw = editorCam.yaw;
    p.pitch = editorCam.pitch;
  } else {
    p.pos.set(0, 8, 18);
    p.yaw = 0;
    p.pitch = -0.3;
  }
  ui.finish.classList.add('hidden');
  ui.tutorial.classList.add('hidden');
  tut = null;
  bot = null;
  updateEditorPanel();
  resumeTo = 'editor';
  startAudio();
  if (botMode) setState('editor');
  else input.requestLock();
}

function startTest() {
  const p = run.player;
  editorCam = { id: customLevel.id, pos: p.pos.clone(), yaw: p.yaw, pitch: p.pitch };
  editor.hidePreview();
  mode = 'test';
  loadDef(customDef(customLevel));
  setState('playing');
}

function backToEditor() {
  openEditor(customLevel);
  setState('editor');
}

editor.onChange = () => {
  if (!customLevel) return;
  saveCustom(customLevel);
  updateEditorPanel();
};

function editorSummary(lvl) {
  const blocks = lvl.data.blocks;
  const count = (k) => blocks.filter((b) => b[0] === k).length;
  return { blocks: blocks.length, anchors: count('a'), checkpoints: count('c'), hasFinish: count('f') > 0 };
}

function updateEditorPanel() {
  if (!customLevel) return;
  ui.epName.textContent = customLevel.data.name;
  ui.epTools.innerHTML = TOOLS.map((t, i) =>
    `<div class="ep-tool${i === editor.tool ? ' on' : ''}"><i style="background:${t.color}"></i><kbd>${i + 1}</kbd> ${t.name}</div>`).join('');
  const sz = editor.size();
  ui.epSize.textContent = `${sz[0]} × ${sz[1]} × ${sz[2]}`;
  const sum = editorSummary(customLevel);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  ui.epStatus.innerHTML = `${plural(sum.blocks, 'block')} · ${plural(sum.anchors, 'anchor')} · ${plural(sum.checkpoints, 'checkpoint')}<br>` +
    (sum.hasFinish ? '<span class="ok">Finish placed</span>' : '<span class="warn">No finish yet: press 5 and place one</span>') +
    ` · ${customLevel.tested ? '<span class="ok">Finished once</span>' : '<span class="warn">Not finished yet</span>'}`;
  ui.editStatus.innerHTML = ui.epStatus.innerHTML;
}

async function showShareCode(lvl, box, textarea, msg) {
  box.classList.remove('hidden');
  msg.className = 'msg';
  msg.textContent = 'Making code...';
  try {
    const code = await encodeLevel(lvl.data);
    textarea.value = code;
    textarea.select();
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch { /* clipboard blocked: the code is selected for manual copy */ }
    msg.className = 'msg good';
    msg.textContent = (copied ? 'Copied to clipboard! ' : 'Select and copy the code. ') +
      (lvl.tested ? '' : "Tip: finish it once yourself so you know it's possible.");
  } catch (e) {
    msg.className = 'msg err';
    msg.textContent = e.message;
  }
}

function buildMyLevels() {
  const list = storage.getCustomLevels();
  ui.mlList.innerHTML = list.length ? '' : '<div class="ml-empty">No levels yet. Press <b>+ New level</b> to build one, or import a code from a friend.</div>';
  for (const lvl of list) {
    const sum = editorSummary(lvl);
    const b = storage.getBest(`custom-${lvl.id}`);
    const row = document.createElement('div');
    row.className = 'ml-row';
    row.dataset.id = lvl.id;
    row.innerHTML = `
      <div class="ml-info">
        <div class="ml-name"></div>
        <div class="ml-meta">${sum.blocks} blocks · ${lvl.own ? 'made by you' : 'imported'} · ${sum.hasFinish ? (b ? `best ${formatTime(b.time)}` : 'not finished yet') : 'no finish yet'}</div>
      </div>
      <button class="btn" data-act="play" ${sum.hasFinish ? '' : 'disabled title="Add a finish first"'}>Play</button>
      <button class="btn" data-act="edit">Edit</button>
      <button class="btn" data-act="share">Share</button>
      <button class="btn" data-act="delete">Delete</button>`;
    row.querySelector('.ml-name').textContent = lvl.data.name; // user text: never as HTML
    row.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'play') playCustom(lvl);
      if (act === 'edit') openEditor(lvl);
      if (act === 'share') {
        ui.mlShareTitle.textContent = `Share code: ${lvl.data.name}`;
        showShareCode(lvl, ui.mlShare, ui.mlShareCode, ui.mlShareMsg);
      }
      if (act === 'delete') {
        if (e.target.dataset.confirm) {
          storage.setCustomLevels(storage.getCustomLevels().filter((l) => l.id !== lvl.id));
          buildMyLevels();
        } else {
          e.target.dataset.confirm = '1';
          e.target.textContent = 'Sure?';
        }
      }
    });
    ui.mlList.appendChild(row);
  }
}

function newCustomLevel() {
  const n = storage.getCustomLevels().filter((l) => l.own).length + 1;
  const lvl = { id: newLevelId(), own: true, tested: false, data: { v: 1, name: `My Level ${n}`, blocks: [] } };
  saveCustom(lvl);
  return lvl;
}

function exitEditor() {
  editor.hidePreview();
  loadLevel(isUnlocked(progress.last) ? progress.last : 0);
  showScreen('mylevels');
}

function loadTutorial() {
  loadDef(TUTORIAL);
}

// --- Tutorial -----------------------------------------------------------------

function showTutorialStep() {
  ui.tutStep.textContent = `Step ${tut.step + 1} / ${TUTORIAL_STEPS.length}`;
  ui.tutText.innerHTML = TUTORIAL_STEPS[tut.step].text;
  ui.tutorial.classList.remove('pop');
  void ui.tutorial.offsetWidth; // restart the pop animation
  ui.tutorial.classList.add('pop');
}

function updateTutorial(target) {
  const f = tut.flags;
  const p = run.player;
  if (target?.box.kind === 'anchor') f.aimedAnchor = true;
  if (p.hook) f.hooked = true;
  if (p.hook && !insideBox(p.pos, course.startZone) && p.vel.length() > 10) f.swung = true;
  if (run.checkpoint >= 0) f.checkpoint = true;
  if (run.checkpoint >= 0 && p.pos.z < course.tutorial.smoothBlock.min.z - 4) f.pastSmooth = true;
  let advanced = false;
  while (tut.step < TUTORIAL_STEPS.length - 1 && TUTORIAL_STEPS[tut.step].done(f)) {
    tut.step++;
    advanced = true;
  }
  if (advanced) {
    sound.step();
    showTutorialStep();
  }
}

function refreshBest() {
  const medal = medalFor(level, best?.time);
  ui.best.innerHTML = best ? `Best ${formatTime(best.time)}${medalBadge(medal)}` : 'No best time yet';
  ui.menuBest.innerHTML = best ? `${formatTime(best.time)}${medalBadge(medal)}` : '--';
  ui.courseName.textContent = levelTitle(level);
  const next = nextMedal(level, best?.time);
  ui.target.innerHTML = level.medals && next
    ? `${medalBadge(next)} ${MEDAL_NAME[next]} ${formatTime(level.medals[next])}`
    : level.medals ? 'All medals earned!' : '';
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
  ui.finishBoard.classList.add('hidden');
  if (tut) {
    tut = { flags: createTutorialFlags(), step: 0 };
    showTutorialStep();
  }
  splits = [];
  if (bot) Object.assign(bot, createBot(run));
  renderer.setCheckpointReached(-1);
  ui.finish.classList.add('hidden');
  ui.split.className = '';
  updateCheckpointLabel();
  if (state === 'finished') state = 'playing';
}

// --- Online leaderboards ------------------------------------------------------

let boardIndex = 0;

function boardRowsHtml(board, limit) {
  if (!board.rows.length) return '<div class="board-empty">No times yet. Be the first!</div>';
  const rows = board.rows.slice(0, limit).map((r, i) => {
    const row = document.createElement('div');
    row.className = `board-row${r.you ? ' you' : ''}`;
    row.innerHTML = `<span class="br-rank">${i + 1}</span><span class="br-name"></span><span class="br-time">${formatTime(r.time)}</span>`;
    row.querySelector('.br-name').textContent = r.name + (r.you ? ' (you)' : ''); // names are user text
    return row.outerHTML;
  });
  if (board.me && board.me.rank > limit) {
    rows.push(`<div class="board-row you"><span class="br-rank">${board.me.rank}</span><span class="br-name">You</span><span class="br-time">${formatTime(board.me.time)}</span></div>`);
  }
  return rows.join('');
}

async function showBoard() {
  const l = LEVELS[boardIndex];
  ui.boardLevel.textContent = `Level ${l.number}: ${l.name}`;
  ui.boardList.innerHTML = '<div class="board-empty">Loading...</div>';
  try {
    const board = await getLeaderboard(l.id, 10);
    if (LEVELS[boardIndex] !== l) return; // switched level while loading
    ui.boardList.innerHTML = boardRowsHtml(board, 10);
  } catch (e) {
    ui.boardList.innerHTML = `<div class="board-empty err">Couldn't load the leaderboard (${e.message}).</div>`;
  }
}

// After finishing an official level: save the time, then show where you are.
async function submitAndShow(l, time) {
  if (!onlineEnabled) return;
  ui.finishBoard.classList.remove('hidden');
  ui.finishBoard.innerHTML = '<div class="board-title">Online leaderboard</div><div class="board-empty">Saving your time...</div>';
  try {
    await submitScore(l.id, settings.playerName, time);
    const board = await getLeaderboard(l.id, 5);
    if (level !== l) return;
    const rank = board.me ? `You're <b>#${board.me.rank}</b> in the world` : '';
    ui.finishBoard.innerHTML = `<div class="board-title">Online leaderboard · ${rank}</div>${boardRowsHtml(board, 5)}`;
  } catch (e) {
    ui.finishBoard.innerHTML = `<div class="board-title">Online leaderboard</div><div class="board-empty err">Couldn't reach the leaderboard (${e.message}).</div>`;
  }
}

// --- Menu screens -------------------------------------------------------------

function showScreen(name) {
  for (const s of ui.screens) s.classList.toggle('hidden', s.id !== `screen-${name}`);
  if (name === 'levels') buildLevelGrid();
  if (name === 'skins') buildSkinGrid();
  if (name === 'boards') {
    boardIndex = level && !level.custom && !level.tutorial ? level.index : 0;
    ui.boardName.value = settings.playerName;
    showBoard();
  }
  if (name === 'mylevels') {
    buildMyLevels();
    ui.mlShare.classList.add('hidden');
  }
  if (name === 'editor-menu') {
    ui.editName.value = customLevel?.data.name ?? '';
    ui.editShareBox.classList.add('hidden');
    ui.editResume.textContent = mode === 'test' ? 'RESUME TEST' : 'RESUME EDITING';
    ui.editTest.textContent = mode === 'test' ? 'Back to editor (T)' : 'Test level (T)';
    updateEditorPanel();
  }
  if (name === 'main') refreshMainScreen();
}

function refreshMainScreen() {
  const inProgress = run.started && !run.finished;
  ui.playBtn.textContent = inProgress ? 'RESUME' : 'PLAY';
  ui.restartBtn.classList.toggle('hidden', !inProgress);
  ui.tutorialBtn.classList.toggle('highlight', !progress.tutorialDone);
  ui.newHint.classList.toggle('hidden', !!progress.tutorialDone);
  refreshBest();
}

function buildLevelGrid() {
  const done = LEVELS.filter((l) => storage.getBest(l.id)).length;
  ui.levelProgress.textContent = `${done} / ${LEVELS.length} complete`;
  const counts = { gold: 0, silver: 0, bronze: 0 };
  for (const l of LEVELS) {
    const m = medalFor(l, storage.getBest(l.id)?.time);
    if (m) counts[m]++;
  }
  ui.medalTotals.innerHTML = MEDALS.map((m) => `${medalBadge(m)} ${counts[m]}`).join(' &nbsp; ');
  ui.levelGrid.innerHTML = '';
  for (const l of LEVELS) {
    const unlocked = isUnlocked(l.index);
    const b = storage.getBest(l.id);
    const medal = medalFor(l, b?.time);
    const tile = document.createElement('button');
    tile.className = `level-tile${unlocked ? '' : ' locked'}${b ? ' done' : ''}${l.index === level.index ? ' current' : ''}`;
    tile.disabled = !unlocked;
    tile.dataset.level = String(l.index);
    tile.innerHTML = `
      <span class="lt-num">${l.number}${medalBadge(medal)}</span>
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
  ui.hud.classList.toggle('editing', state === 'editor');
  renderer.showViewModel = state !== 'editor';
  if (state !== 'editor') editor.hidePreview();
  if (state !== 'finished') ui.finish.classList.add('hidden');
  if (state === 'menu') showScreen('main');
}

// --- Game events --------------------------------------------------------------

function finishTutorial(e) {
  sound.finish();
  const skinsBefore = unlockedSkinIds();
  progress.tutorialDone = true;
  storage.setProgress(progress);
  if (!best || e.time < best.time) {
    best = { time: e.time, splits: [...splits] };
    storage.setBest(level.id, best);
    refreshBest();
  }
  ui.finishTitle.textContent = 'Tutorial complete!';
  ui.finishTime.textContent = formatTime(e.time);
  ui.finishNote.textContent = "You've got the basics. Time for the real thing.";
  ui.finishNote.className = 'record';
  ui.finishHint.innerHTML = '<kbd>N</kbd> start Level 1 · <kbd>R</kbd> try again · <kbd>Esc</kbd> menu';
  ui.finishMedal.innerHTML = announceNewSkins(skinsBefore);
  ui.tutorial.classList.add('hidden');
  state = 'finished';
  ui.finish.classList.remove('hidden');
}

function finishCustom(e) {
  sound.finish();
  const skinsBefore = unlockedSkinIds();
  const isRecord = !best || e.time < best.time;
  if (isRecord) {
    best = { time: e.time, splits: [...splits] };
    storage.setBest(level.id, best);
    refreshBest();
  }
  customLevel.tested = true;
  saveCustom(customLevel);
  // Finishing a level you built yourself (with a real course in it) unlocks
  // the Architect gun skin.
  if (customLevel.own && editorSummary(customLevel).blocks >= 5 && !progress.editorFinished) {
    progress.editorFinished = true;
    storage.setProgress(progress);
  }
  ui.finishTitle.textContent = mode === 'test' ? 'Test run complete!' : `${level.name} complete!`;
  ui.finishTime.textContent = formatTime(e.time);
  ui.finishNote.textContent = isRecord ? 'New best on this level!' : `Best: ${formatTime(best.time)}`;
  ui.finishNote.className = isRecord ? 'record' : '';
  ui.finishMedal.innerHTML = announceNewSkins(skinsBefore);
  ui.finishHint.innerHTML = mode === 'test'
    ? '<kbd>T</kbd> back to editor · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu'
    : '<kbd>R</kbd> fly again · <kbd>Esc</kbd> menu';
  state = 'finished';
  ui.finish.classList.remove('hidden');
}

function finishLevel(e) {
  if (level.tutorial) return finishTutorial(e);
  if (level.custom) return finishCustom(e);
  sound.finish();
  const isRecord = !best || e.time < best.time;
  const skinsBefore = unlockedSkinIds();
  const oldMedal = medalFor(level, best?.time);
  const runMedal = medalFor(level, e.time);
  const newMedal = runMedal && (!oldMedal || MEDALS.indexOf(runMedal) < MEDALS.indexOf(oldMedal));
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
  const bestMedal = medalFor(level, best.time);
  const next = nextMedal(level, best.time);
  ui.finishMedal.innerHTML = runMedal
    ? `${medalBadge(runMedal, true)}<div class="fm-text">${newMedal ? `New ${MEDAL_NAME[runMedal]} medal!` : `${MEDAL_NAME[runMedal]} time`}</div>`
    : `<div class="fm-text dim">No medal this time</div>`;
  ui.finishMedal.innerHTML += next
    ? `<div class="fm-next">Next: ${medalBadge(next)} ${MEDAL_NAME[next]} at ${formatTime(level.medals[next])}</div>`
    : bestMedal === 'gold' ? '<div class="fm-next">You have gold on this level!</div>' : '';
  if (newMedal) sound.medal(runMedal);
  submitAndShow(level, e.time);
  ui.finishMedal.innerHTML += announceNewSkins(skinsBefore);
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
      case 'attach':
        sound.attach();
        renderer.addShake(0.15);
        renderer.ropeSnap();
        break;
      case 'jump':
        sound.jump();
        if (tut) tut.flags.jumped = true;
        break;
    }
  }
}

// --- Input wiring -------------------------------------------------------------

function currentAim() {
  return aimDirection(run.player.yaw, run.player.pitch);
}

input.handlers.hookDown = () => {
  if (state === 'editor') {
    editor.place(run.player);
    sound.attach();
    return;
  }
  if (state !== 'playing') return;
  renderer.fire();
  if (hook(run, currentAim())) {
    sound.hookFire();
  } else {
    sound.miss();
  }
};
input.handlers.hookUp = () => {
  const r = unhook(run);
  if (r.released) lastRelease = { ...r, velY: run.player.vel.y };
  if (tut && r.released && run.started && !run.player.grounded) tut.flags.flung = true;
  if (r.hopped) sound.hop();
  else if (r.released) sound.release();
};
input.handlers.altDown = () => {
  if (state === 'editor' && editor.remove(run.player)) sound.release();
};
input.handlers.wheel = (dir) => {
  if (state === 'editor') editor.cycleSize(dir);
};

function editorKey(code) {
  const digit = /^Digit([1-5])$/.exec(code);
  if (digit) editor.setTool(Number(digit[1]) - 1);
  if (code === 'BracketRight') editor.cycleSize(1);
  if (code === 'BracketLeft') editor.cycleSize(-1);
  if (code === 'KeyR') editor.rotate();
  if (code === 'KeyQ') editor.copy(run.player);
  if (code === 'KeyZ' && editor.undo()) sound.release();
  if (code === 'KeyT') startTest();
}

input.handlers.key = (code) => {
  if (state === 'editor') return editorKey(code);
  if (code === 'KeyT' && mode === 'test' && state !== 'menu') return backToEditor();
  if (code === 'KeyR' && state !== 'menu') restart();
  if ((code === 'KeyN' || code === 'Enter') && state === 'finished' && !level.custom && level.index + 1 < LEVELS.length) {
    loadLevel(level.index + 1); // the tutorial's index is -1, so this goes to level 1
    state = 'playing';
  }
  if (code === 'KeyM') {
    settings.muted = !settings.muted;
    ui.musicVol.value = settings.musicVolume ?? 0.6;
ui.musicVol.addEventListener('input', () => {
  settings.musicVolume = Number(ui.musicVol.value);
  music?.setVolume(settings.musicVolume);
  storage.setSettings(settings);
});
ui.mute.checked = settings.muted;
    sound.setMuted(settings.muted);
    storage.setSettings(settings);
  }
};
input.handlers.lockChange = (locked) => {
  if (locked) {
    if (state === 'menu') {
      if (resumeTo === 'editor') return setState('editor');
      if (run.finished) restart();
      setState('playing');
    }
  } else if (!botMode) {
    const inEditor = state === 'editor' || mode === 'test';
    resumeTo = state === 'editor' ? 'editor' : 'play';
    setState('menu');
    if (inEditor) showScreen('editor-menu');
  }
};

function startPlaying() {
  if (mode !== 'editor') resumeTo = 'play';
  startAudio();
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
ui.skinsBtn.addEventListener('click', () => showScreen('skins'));
ui.editorBtn.addEventListener('click', () => showScreen('mylevels'));
ui.boardsBtn.classList.toggle('hidden', !onlineEnabled);
ui.boardsBtn.addEventListener('click', () => showScreen('boards'));
ui.boardPrev.addEventListener('click', () => {
  boardIndex = (boardIndex + LEVELS.length - 1) % LEVELS.length;
  showBoard();
});
ui.boardNext.addEventListener('click', () => {
  boardIndex = (boardIndex + 1) % LEVELS.length;
  showBoard();
});
ui.boardName.addEventListener('change', () => {
  settings.playerName = cleanName(ui.boardName.value);
  ui.boardName.value = settings.playerName;
  storage.setSettings(settings);
});
ui.mlNew.addEventListener('click', () => openEditor(newCustomLevel()));
ui.mlImportToggle.addEventListener('click', () => {
  ui.mlImport.classList.toggle('hidden');
  ui.importMsg.textContent = '';
});
ui.importBtn.addEventListener('click', async () => {
  try {
    const data = await decodeLevel(ui.importCode.value);
    saveCustom({ id: newLevelId(), own: false, tested: false, data });
    ui.importMsg.className = 'msg good';
    ui.importMsg.textContent = `Imported "${data.name}" (${data.blocks.length} blocks).`;
    ui.importCode.value = '';
    buildMyLevels();
  } catch (e) {
    ui.importMsg.className = 'msg err';
    ui.importMsg.textContent = e.message;
  }
});
ui.editResume.addEventListener('click', () => {
  if (mode === 'test') {
    resumeTo = 'play';
    input.requestLock();
  } else {
    resumeTo = 'editor';
    input.requestLock();
  }
});
ui.editTest.addEventListener('click', () => {
  if (mode === 'test') {
    openEditor(customLevel);
  } else {
    startTest();
    setState('menu'); // startTest set playing; wait for the pointer lock
    resumeTo = 'play';
    input.requestLock();
  }
});
ui.editShare.addEventListener('click', () => showShareCode(customLevel, ui.editShareBox, ui.editShareCode, ui.editShareMsg));
ui.editExit.addEventListener('click', exitEditor);
ui.editName.addEventListener('input', () => {
  if (!customLevel) return;
  customLevel.data.name = ui.editName.value.replace(/[<>]/g, '').slice(0, 24) || 'Untitled';
  saveCustom(customLevel);
  updateEditorPanel();
});
ui.tutorialBtn.addEventListener('click', () => {
  loadTutorial();
  startPlaying();
});
for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => showScreen('main'));

ui.sens.value = settings.sensitivity;
ui.sensVal.textContent = `${Number(settings.sensitivity).toFixed(2)}x`;
ui.sens.addEventListener('input', () => {
  settings.sensitivity = Number(ui.sens.value);
  ui.sensVal.textContent = `${settings.sensitivity.toFixed(2)}x`;
  storage.setSettings(settings);
});
ui.musicVol.value = settings.musicVolume ?? 0.6;
ui.musicVol.addEventListener('input', () => {
  settings.musicVolume = Number(ui.musicVol.value);
  music?.setVolume(settings.musicVolume);
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
if (params.has('tutorial')) loadTutorial();
else loadLevel(startIndex);
showScreen('main');

let last = performance.now();
let accumulator = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const p = run.player;

  let mx = 0;
  let my = 0;
  let move = { forward: 0, right: 0, reel: false };
  if (state === 'editor') {
    [mx, my] = input.consumeMouse();
    const k = 0.0022 * settings.sensitivity;
    p.yaw -= mx * k;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - my * k));
    const m = input.movement();
    editor.fly(p, { forward: m.forward, right: m.right, up: input.keys.has('Space'), down: input.keys.has('ShiftLeft') || input.keys.has('ControlLeft') }, dt);
    editor.updatePreview(p);
    accumulator = 0;
  } else if (state === 'playing' || state === 'finished') {
    [mx, my] = input.consumeMouse();
    const k = 0.0022 * settings.sensitivity;
    p.yaw -= mx * k;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - my * k));
    if (tut) tut.flags.look += (Math.abs(mx) + Math.abs(my)) * k;
    const before = tut ? { x: p.pos.x, z: p.pos.z, len: p.hook?.length, hook: p.hook } : null;

    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      move = bot ? botInput(bot) : input.movement();
      handleEvents(tick(run, move, FIXED_DT));
      accumulator -= FIXED_DT;
    }
    if (tut) {
      if (p.grounded) tut.flags.walked += Math.hypot(p.pos.x - before.x, p.pos.z - before.z);
      if (p.hook && p.hook === before.hook) tut.flags.reeled += Math.max(0, before.len - p.hook.length);
    }
  } else {
    accumulator = 0;
  }

  // What would the hook grab right now?
  const target = state === 'menu' || state === 'editor' ? null : raycast(course, eyePosition(p), currentAim());
  ui.crosshair.className = state === 'editor' ? 'editor' : p.hook || p.pending ? 'hooked' : target && isHookable(target.box) ? 'in-range' : target ? 'blocked' : '';
  if (tut && state === 'playing') updateTutorial(target);

  ui.timer.textContent = formatTime(run.time);
  const speed = p.vel.length();
  ui.speed.firstChild.textContent = Math.round(speed);
  sound.update(state === 'menu' ? 0 : speed, !!p.hook);
  // Music builds up with speed (and a little while swinging).
  music?.setIntensity(state === 'playing' ? Math.min(1, Math.max(0, (speed - 4) / 40) + (p.hook ? 0.1 : 0)) : 0);

  if (toastTimer > 0 && (toastTimer -= dt) <= 0) ui.toast.classList.remove('show');
  if (splitTimer > 0 && (splitTimer -= dt) <= 0) ui.split.classList.remove('show');

  if (!bot && state === 'playing') move = input.movement();
  renderer.render(p, target && isHookable(target.box) ? target : null, dt, {
    mouseDX: mx, mouseDY: my, right: move.right, reeling: move.reel,
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (botMode) startPlaying();

// Handle for automated browser tests.
window.__skyhook = {
  get run() { return run; },
  get course() { return course; },
  get level() { return level; },
  get tutorial() { return tut; },
  get state() { return state; },
  get lastRelease() { return lastRelease; },
  renderer, restart, loadLevel, loadTutorial, formatTime, TUNING, medalCounts,
  get skin() { return settings.skin; },
  get mode() { return mode; },
  get customLevel() { return customLevel; },
  editor, openEditor, newCustomLevel, startTest, backToEditor, encodeLevel, decodeLevel,
  online: { submitScore, getLeaderboard },
  get music() { return music; },
  Music,
};
