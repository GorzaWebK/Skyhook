import { isHookable, insideBox, buildTutorialCourse, buildCustomCourse } from './course.js';
import { Editor, TOOLS } from './editor.js';
import { encodeLevel, decodeLevel, newLevelId } from './custom.js';
import { onlineEnabled, submitScore, getLeaderboard, getRecordGhost, cleanName, publishLevel, unpublishLevel, listLevels, voteLevel } from './online.js';
import { GhostRecorder, encodeGhost, decodeGhost, ghostAt, GHOST_RATE } from './ghost.js';
import { updateMovers } from './course.js';
import * as THREE from 'three';
import { StatsTracker, statsRows } from './stats.js';
import { ACHIEVEMENTS, newAchievements } from './achievements.js';
import { Flyover } from './flyover.js';
import { THEMES } from './themes.js';
import { dailyFor, buildDaily, timeUntilNext, dailyStreak, dateKey } from './daily.js';
import { weeklyFor, buildWeekly, timeUntilWeekEnd, weekNumber } from './weekly.js';
import { TUTORIAL_STEPS, createTutorialFlags } from './tutorial.js';
import { LEVELS, MEDALS, buildLevel, medalFor, nextMedal } from './levels.js';
import { raycast, eyePosition, aimDirection, FIXED_DT, TUNING } from './physics.js';
import { createRun, restartRun, respawn, tick, hook, unhook } from './run.js';
import { createBot, botInput } from './bot.js';
import { Renderer } from './render.js';
import { Sound } from './audio.js';
import { Music } from './music.js';
import { Input } from './input.js';
import { storage } from './storage.js';
import { SKINS, getSkin, isSkinUnlocked, skinRequirement, achievementName } from './skins.js';
import { ROPES, TRAILS, getRope, getTrail, isCosmeticUnlocked } from './cosmetics.js';
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
  dailyBtn: $('daily-btn'), dailyInfo: $('daily-info'), weeklyBtn: $('weekly-btn'), weeklyInfo: $('weekly-info'), mlMsg: $('ml-msg'),
  communityBtn: $('community-btn'), communityList: $('community-list'), communityMsg: $('community-msg'),
  tabNew: $('tab-new'), tabTop: $('tab-top'),
  mlNew: $('ml-new'), mlImportToggle: $('ml-import-toggle'), mlImport: $('ml-import'), importCode: $('import-code'),
  importBtn: $('import-btn'), importMsg: $('import-msg'), mlList: $('ml-list'),
  mlShare: $('ml-share'), mlShareTitle: $('ml-share-title'), mlShareCode: $('ml-share-code'), mlShareMsg: $('ml-share-msg'),
  editName: $('edit-name'), editStatus: $('edit-status'), editResume: $('edit-resume'), editTest: $('edit-test'),
  editShare: $('edit-share'), editShareBox: $('edit-share-box'), editShareCode: $('edit-share-code'),
  editShareMsg: $('edit-share-msg'), editExit: $('edit-exit'), editTheme: $('edit-theme'),
  boardsBtn: $('boards-btn'), boardPrev: $('board-prev'), boardNext: $('board-next'), boardLevel: $('board-level'),
  boardName: $('board-name'), boardList: $('board-list'), finishBoard: $('finish-board'),
  epName: $('ep-name'), epTools: $('ep-tools'), epSize: $('ep-size'), epStatus: $('ep-status'), skinsBtn: $('skins-btn'), skinGrid: $('skin-grid'),
  ropeGrid: $('rope-grid'), trailGrid: $('trail-grid'),
  tutorial: $('tutorial'), tutStep: $('tut-step'), tutText: $('tut-text'),
  courseName: $('course-name'), menuBest: $('menu-best'),
  levelGrid: $('level-grid'), levelProgress: $('level-progress'),
  sens: $('sens'), sensVal: $('sens-val'), mute: $('mute'), musicVol: $('music-vol'), musicVal: $('music-val'),
  invert: $('invert'), fov: $('fov'), fovVal: $('fov-val'), sfxVol: $('sfx-vol'), sfxVal: $('sfx-val'),
  shake: $('shake'), speedfx: $('speedfx'), settingsBtn: $('settings-btn'), ghostMode: $('ghost-mode'),
  achPopup: $('ach-popup'), achGrid: $('ach-grid'), achSummary: $('ach-summary'),
  profileBtn: $('profile-btn'), statsGrid: $('stats-grid'), tabStats: $('tab-stats'), tabAch: $('tab-ach'),
  profileStats: $('profile-stats'), profileAch: $('profile-ach'),
  flyoverHint: $('flyover-hint'), flyoverSetting: $('flyover-setting'),
  watchBtn: $('watch-btn'), boardWatch: $('board-watch'), replayBar: $('replay-bar'),
  quality: $('quality'), showFps: $('show-fps'), fps: $('fps'), phoneNotice: $('phone-notice'), phoneContinue: $('phone-continue'),
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
  return { medals: medalCounts(), tutorialDone: !!progress.tutorialDone, editorFinished: !!progress.editorFinished, achieved: storage.getAchievements() };
}

function unlockedSkinIds() {
  const stats = skinStats();
  return new Set(SKINS.filter((sk) => isSkinUnlocked(sk, stats)).map((sk) => sk.id));
}

const canvas = $('game');
const renderer = new Renderer(canvas);
const settings = storage.getSettings();
// Defaults for settings added later (older saves don't have them).
Object.assign(settings, {
  invertY: false, fov: 85, sfxVolume: 1, musicVolume: 0.6, shake: true, speedFx: true, ghost: 'best',
  quality: 'high', showFps: false, flyover: true,
  ...settings,
});
const sound = new Sound(settings.muted);
sound.sfxVolume = settings.sfxVolume;
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
const stats = new StatsTracker(storage.getStats());
function saveStats() {
  if (!stats.dirty) return;
  storage.setStats(stats.s);
  stats.dirty = false;
  stats.sinceSave = 0;
}
window.addEventListener('beforeunload', saveStats);
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

function equipRope(id) {
  settings.rope = getRope(id).id;
  storage.setSettings(settings);
  renderer.setRopeStyle(getRope(settings.rope));
}
function equipTrail(id) {
  settings.trail = getTrail(id).id;
  storage.setSettings(settings);
  renderer.setTrailStyle(getTrail(settings.trail));
}
{
  const got = storage.getAchievements();
  equipRope(isCosmeticUnlocked(getRope(settings.rope), got) ? settings.rope : 'black');
  equipTrail(isCosmeticUnlocked(getTrail(settings.trail), got) ? settings.trail : 'none');
}

// Rope colour and hook trail cards on the Gun page.
function buildCosmeticGrid(grid, items, current, equip, swatch) {
  const got = storage.getAchievements();
  grid.innerHTML = '';
  for (const item of items) {
    const unlocked = isCosmeticUnlocked(item, got);
    const card = document.createElement('button');
    card.className = `skin-card${unlocked ? '' : ' locked'}${current() === item.id ? ' equipped' : ''}`;
    card.disabled = !unlocked;
    card.dataset.item = item.id;
    card.innerHTML = `${swatch(item)}<span class="skin-name">${item.name}</span>
      <span class="skin-status">${current() === item.id ? 'Equipped' : unlocked ? 'Click to equip' : `Achievement: ${achievementName(item.req.id)}`}</span>`;
    card.addEventListener('click', () => {
      if (!isCosmeticUnlocked(item, storage.getAchievements())) return;
      equip(item.id);
      buildGunPage();
    });
    grid.appendChild(card);
  }
}

const ropeSwatch = (r) => `<span class="skin-swatch rope-swatch"><i style="background:${r.rainbow ? 'linear-gradient(90deg,#f33,#fc3,#3f6,#3cf,#93f)' : r.color}"></i></span>`;
const trailSwatch = (t) => {
  if (t.id === 'none') return '<span class="skin-swatch trail-swatch"><b>—</b></span>';
  const cols = t.rainbow ? ['#f33', '#fc3', '#3f6', '#3cf', '#93f'] : t.colors;
  const dots = Array.from({ length: 9 }, (_, i) => `<i style="left:${8 + i * 9}%;width:${4 + i}px;height:${4 + i}px;background:${cols[i % cols.length]};opacity:${0.25 + i * 0.08}"></i>`).join('');
  return `<span class="skin-swatch trail-swatch">${dots}</span>`;
};

function buildGunPage() {
  buildSkinGrid();
  buildCosmeticGrid(ui.ropeGrid, ROPES, () => settings.rope, equipRope, ropeSwatch);
  buildCosmeticGrid(ui.trailGrid, TRAILS, () => settings.trail, equipTrail, trailSwatch);
}

// What an achievement unlocks (for the pop-up).
function rewardsFor(achId) {
  return [
    ...SKINS.filter((x) => x.req.type === 'achievement' && x.req.id === achId).map((x) => `${x.name} gun`),
    ...ROPES.filter((x) => x.req.id === achId).map((x) => `${x.name} rope`),
    ...TRAILS.filter((x) => x.req.id === achId).map((x) => `${x.name} trail`),
  ];
}

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
      buildGunPage();
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
let flyover = null; // the level flyover while it plays
let flyoverPending = false; // play the flyover when this level starts
const noFlyover = window.__SKYHOOK_NO_FLYOVER === true || params.has('bot');

// --- Ghosts -------------------------------------------------------------------
const recorder = new GhostRecorder();
let myGhost = null; // samples of your best run on this level
let recordGhost = null; // { samples, name, you } world record holder's run
let ghostToken = 0;

function refreshGhosts() {
  const mode = settings.ghost;
  const list = [];
  const showRecord = (mode === 'record' || mode === 'both') && recordGhost && !recordGhost.you;
  if (myGhost && (mode === 'best' || mode === 'both' || (mode === 'record' && !showRecord))) {
    list.push({ samples: myGhost, color: '#5ff0ff', label: 'Your best' });
  }
  if (showRecord) list.push({ samples: recordGhost.samples, color: '#ffd36b', label: `WR · ${recordGhost.name}` });
  renderer.setGhosts(state === 'editor' ? [] : list);
}

function isOnlineBoard(def) {
  return !def.custom && !def.tutorial;
}

async function loadGhosts(def) {
  const token = ++ghostToken;
  myGhost = null;
  recordGhost = null;
  refreshGhosts();
  const code = storage.getGhost(def.id);
  if (code) {
    try {
      const samples = await decodeGhost(code);
      if (token === ghostToken) {
        myGhost = samples;
        if (state === 'menu') refreshMainScreen();
      }
    } catch { /* corrupt or old: ignore */ }
  }
  refreshGhosts();
  if (onlineEnabled && isOnlineBoard(def) && settings.ghost !== 'off') {
    try {
      const rec = await getRecordGhost(def.id);
      if (rec && token === ghostToken) {
        recordGhost = { samples: await decodeGhost(rec.code), name: rec.name, you: rec.you };
        refreshGhosts();
      }
    } catch { /* offline or no record: just no world record ghost */ }
  }
}

// After a new personal best: keep the recording as your ghost.
// Returns a promise of the encoded ghost (for uploading).
function saveBestGhost(levelId) {
  const samples = recorder.samples.slice();
  if (samples.length < 2) return Promise.resolve(null);
  myGhost = samples;
  return encodeGhost(samples).then((code) => {
    storage.setGhost(levelId, code);
    return code;
  }).catch(() => null);
}

function unlockedCount() {
  return unlockAll ? LEVELS.length : Math.max(1, Math.min(LEVELS.length, progress.unlocked));
}

function isUnlocked(index) {
  return index < unlockedCount();
}

function levelTitle(l) {
  if (l.daily) return `Daily challenge #${l.number} (${l.date})`;
  if (l.weekly) return `Weekly tournament #${l.number} (${l.week})`;
  if (l.custom) return `${mode === 'test' ? 'Testing' : l.community ? 'Community' : 'Custom'}: ${l.name}`;
  return l.tutorial ? 'Tutorial' : `Level ${l.number}: ${l.name}`;
}

function loadDef(def) {
  level = def;
  course = def.tutorial ? buildTutorialCourse() : def.custom ? buildCustomCourse(def.data) : def.daily ? buildDaily(def) : def.weekly ? buildWeekly(def) : buildLevel(def);
  run = createRun(course);
  bot = botMode ? createBot(run) : null;
  best = storage.getBest(def.id);
  splits = [];
  renderer.buildCourse(course);
  renderer.setTheme(course.theme || 'day');
  flyover = null;
  renderer.cameraOverride = null;
  flyoverPending = !def.tutorial && mode !== 'test';
  recorder.reset();
  loadGhosts(def);
  if (!def.tutorial && !def.custom && !def.daily && !def.weekly) {
    progress.last = def.index;
    storage.setProgress(progress);
  }
  tut = def.tutorial ? { flags: createTutorialFlags(), step: 0 } : null;
  ui.tutorial.classList.toggle('hidden', !tut);
  if (tut) showTutorialStep();
  ui.finish.classList.add('hidden');
  ui.finishBoard.classList.add('hidden');
  ui.split.className = '';
  ui.levelLabel.textContent = def.daily ? `Daily challenge #${def.number}` : def.weekly ? `Weekly tournament #${def.number}` : def.custom
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
  return { id: `custom-${lvl.id}`, custom: true, community: !!lvl.community, data: lvl.data, name: lvl.data.name, index: -1, number: 0 };
}

function saveCustom(lvl) {
  if (lvl.community) return; // community levels you play aren't added to My Levels
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
  renderer.setTheme(lvl.data.theme || 'day');
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
    `<div class="ep-tool${i === editor.tool ? ' on' : ''}"><i style="background:${t.color}"></i><kbd>${(i + 1) % 10}</kbd> ${t.name}</div>`).join('');
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
      ${onlineEnabled && lvl.own ? `<button class="btn" data-act="publish" ${lvl.tested && sum.hasFinish ? '' : 'disabled title="Finish it once yourself first"'}>${lvl.publishedId ? 'Update online' : 'Publish'}</button>` : ''}
      <button class="btn" data-act="delete">Delete</button>`;
    row.querySelector('.ml-name').textContent = lvl.data.name; // user text: never as HTML
    row.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (act === 'play') playCustom(lvl);
      if (act === 'edit') openEditor(lvl);
      if (act === 'publish') publishCustom(lvl);
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

// --- Community levels --------------------------------------------------------

let communityLevels = [];
let communitySort = 'new';

function friendlyError(e) {
  return /permission/i.test(e.message) ? "Couldn't publish. You can publish once a minute, so try again shortly." : e.message;
}

async function publishCustom(lvl) {
  ui.mlMsg.className = 'msg';
  ui.mlMsg.textContent = `Publishing "${lvl.data.name}"...`;
  try {
    const code = await encodeLevel(lvl.data);
    lvl.publishedId = await publishLevel({
      id: lvl.publishedId, name: lvl.data.name, author: settings.playerName, code, blocks: lvl.data.blocks.length,
    });
    saveCustom(lvl);
    ui.mlMsg.className = 'msg good';
    ui.mlMsg.textContent = `"${lvl.data.name}" is published! Find it under Community levels.`;
    checkAchievements({ flags: { published: true } });
    buildMyLevels();
  } catch (e) {
    ui.mlMsg.className = 'msg err';
    ui.mlMsg.textContent = friendlyError(e);
  }
}

async function loadCommunity() {
  ui.communityMsg.textContent = 'Loading...';
  ui.communityList.innerHTML = '';
  try {
    communityLevels = await listLevels(40);
    ui.communityMsg.textContent = communityLevels.length ? '' : 'No levels published yet. Build one in the Level editor and publish it!';
    renderCommunity();
  } catch (e) {
    ui.communityMsg.textContent = `Couldn't load community levels (${e.message}).`;
  }
}

function renderCommunity() {
  ui.tabNew.classList.toggle('on', communitySort === 'new');
  ui.tabTop.classList.toggle('on', communitySort === 'top');
  const list = [...communityLevels].sort(communitySort === 'top' ? (a, b) => b.votes - a.votes || b.at - a.at : (a, b) => b.at - a.at);
  ui.communityList.innerHTML = '';
  for (const l of list) {
    const row = document.createElement('div');
    row.className = 'ml-row';
    row.dataset.id = l.id;
    const best = storage.getBest(`custom-community-${l.id}`);
    row.innerHTML = `
      <div class="ml-info"><div class="ml-name"></div><div class="ml-meta"></div></div>
      <button class="btn vote${l.voted ? ' on' : ''}" data-act="vote" ${l.mine ? 'disabled title="Your level"' : ''}>▲ ${l.votes}</button>
      <button class="btn" data-act="play">Play</button>
      ${l.mine ? '<button class="btn" data-act="remove">Remove</button>' : ''}`;
    row.querySelector('.ml-name').textContent = l.name; // user text: never as HTML
    row.querySelector('.ml-meta').textContent = `by ${l.author}${l.mine ? ' (you)' : ''} · ${l.blocks} blocks${best ? ` · your best ${formatTime(best.time)}` : ''}`;
    row.addEventListener('click', async (e) => {
      const act = e.target.dataset?.act;
      try {
        if (act === 'play') {
          const data = await decodeLevel(l.code);
          playCustom({ id: `community-${l.id}`, community: true, communityId: l.id, own: l.mine, voted: l.voted, tested: false, data });
        }
        if (act === 'vote') {
          l.voted = !l.voted;
          l.votes += l.voted ? 1 : -1;
          renderCommunity();
          await voteLevel(l.id, l.voted);
        }
        if (act === 'remove') {
          if (!e.target.dataset.confirm) {
            e.target.dataset.confirm = '1';
            e.target.textContent = 'Sure?';
            return;
          }
          await unpublishLevel(l.id);
          const mine = storage.getCustomLevels().find((m) => m.publishedId === l.id);
          if (mine) {
            delete mine.publishedId;
            saveCustom(mine);
          }
          loadCommunity();
        }
      } catch (err) {
        ui.communityMsg.textContent = err.message;
      }
    });
    ui.communityList.appendChild(row);
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

function playDaily() {
  mode = 'level';
  customLevel = null;
  loadDef(dailyFor());
  startPlaying();
}

function playWeekly() {
  mode = 'level';
  customLevel = null;
  loadDef(weeklyFor());
  startPlaying();
}

const TROPHY = { 1: '🥇', 2: '🥈', 3: '🥉' };

function refreshWeeklyButton() {
  const w = weeklyFor();
  const b = storage.getBest(w.id);
  const trophies = Object.values(progress.trophies || {});
  ui.weeklyInfo.innerHTML = `#${w.number} · ends in ${timeUntilWeekEnd()} · ` + (b ? `best ${formatTime(b.time)}` : 'not played yet') +
    (trophies.length ? ` · trophies ${trophies.map((r) => TROPHY[r]).join('')}` : '');
}

// When a week ends, players who finished in the top 3 get a trophy (checked
// the next time they open the game, once per week).
async function checkTrophies() {
  if (!onlineEnabled) return;
  const prev = weeklyFor(weekNumber() - 1);
  progress.trophies ||= {};
  if (progress.trophyChecked === prev.week) return;
  try {
    const board = await getLeaderboard(prev.id, 3);
    progress.trophyChecked = prev.week;
    const mine = board.rows.findIndex((r) => r.you);
    if (mine >= 0) {
      progress.trophies[prev.week] = mine + 1;
      showToast(`${TROPHY[mine + 1]} You placed #${mine + 1} in last week's tournament!`, '#ffd36b');
      sound.record();
    }
    storage.setProgress(progress);
    if (state === 'menu') refreshMainScreen();
  } catch { /* offline: try again next time */ }
}

function refreshDailyButton() {
  const d = dailyFor();
  const b = storage.getBest(d.id);
  const medal = medalFor(d, b?.time);
  const streak = dailyStreak(progress.dailyDone || []);
  ui.dailyInfo.innerHTML = `#${d.number} · ${THEMES[d.theme].name} · ` +
    (b ? `best ${formatTime(b.time)}${medalBadge(medal)}` : 'not played yet') +
    ` · new one in ${timeUntilNext()}` + (streak ? ` · 🔥 ${streak}-day streak` : '');
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
  resetRunFacts();
  stats.resetPosition();
  recorder.reset();
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

// Board -2 is this week's tournament, -1 today's daily, 0-39 the levels.
function boardDef(i) {
  return i === -2 ? weeklyFor() : i === -1 ? dailyFor() : LEVELS[i];
}

async function showBoard() {
  const l = boardDef(boardIndex);
  ui.boardLevel.textContent = l.weekly ? `This week's tournament #${l.number}` : l.daily ? `Today's daily challenge #${l.number}` : `Level ${l.number}: ${l.name}`;
  ui.boardList.innerHTML = '<div class="board-empty">Loading...</div>';
  try {
    const board = await getLeaderboard(l.id, 10);
    if (boardDef(boardIndex).id !== l.id) return; // switched level while loading
    ui.boardList.innerHTML = boardRowsHtml(board, 10);
  } catch (e) {
    ui.boardList.innerHTML = `<div class="board-empty err">Couldn't load the leaderboard (${e.message}).</div>`;
  }
}

// After finishing an official level: save the time, then show where you are.
async function submitAndShow(l, time, ghostPromise = null) {
  if (!onlineEnabled) return;
  ui.finishBoard.classList.remove('hidden');
  ui.finishBoard.innerHTML = '<div class="board-title">Online leaderboard</div><div class="board-empty">Saving your time...</div>';
  try {
    await submitScore(l.id, settings.playerName, time, ghostPromise ? await ghostPromise : null);
    const board = await getLeaderboard(l.id, 5);
    if (level !== l) return;
    const rank = board.me ? `You're <b>#${board.me.rank}</b> in the world` : '';
    if (board.me?.rank === 1) checkAchievements({ flags: { worldRecord: true } });
    ui.finishBoard.innerHTML = `<div class="board-title">Online leaderboard · ${rank}</div>${boardRowsHtml(board, 5)}`;
  } catch (e) {
    ui.finishBoard.innerHTML = `<div class="board-title">Online leaderboard</div><div class="board-empty err">Couldn't reach the leaderboard (${e.message}).</div>`;
  }
}

// --- Profile: stats and achievements -------------------------------------------

function showProfileTab(tab) {
  ui.tabStats.classList.toggle('on', tab === 'stats');
  ui.tabAch.classList.toggle('on', tab === 'achievements');
  ui.profileStats.classList.toggle('hidden', tab !== 'stats');
  ui.profileAch.classList.toggle('hidden', tab !== 'achievements');
  if (tab === 'stats') {
    saveStats();
    ui.statsGrid.innerHTML = statsRows(stats.s, medalCounts())
      .map(([label, value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join('');
  }
  if (tab === 'achievements') buildAchievements?.();
}
let buildAchievements = null;

// --- Achievements -------------------------------------------------------------

const achieved = storage.getAchievements(); // id -> date earned
let runFacts = null; // facts about the current run, for skill achievements
const popupQueue = [];
let popupTimer = 0;

function resetRunFacts() {
  runFacts = {
    levelNumber: level?.custom || level?.daily || level?.weekly || level?.tutorial ? 0 : level?.number ?? 0,
    community: !!level?.community, own: !!customLevel?.own,
    falls: 0, retries: 0, reeled: false, hooks: 0,
  };
}

function achievementContext(runDone, flags) {
  const finished = new Set(LEVELS.filter((l) => storage.getBest(l.id)).map((l) => l.id));
  return { stats: stats.s, medals: medalCounts(), progress, finished, run: runDone, flags };
}

// Check for newly earned achievements. silent: award without pop-ups.
function checkAchievements({ run: runDone = null, flags = {}, silent = false } = {}) {
  const fresh = newAchievements(achievementContext(runDone, flags), achieved);
  if (!fresh.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  for (const a of fresh) {
    achieved[a.id] = today;
    if (!silent) popupQueue.push(a);
  }
  storage.setAchievements(achieved);
  if (!silent) afterAchievements?.();
  return fresh;
}
let afterAchievements = null; // set later (cosmetics unlocks)

function updatePopups(dt) {
  if (popupTimer > 0) {
    popupTimer -= dt;
    if (popupTimer <= 0) ui.achPopup.classList.remove('show');
    return;
  }
  const a = popupQueue.shift();
  if (!a) return;
  const rewards = rewardsFor(a.id);
  ui.achPopup.innerHTML = `<span class="ap-icon">${a.icon}</span><div><div class="ap-title">Achievement unlocked</div><div class="ap-name">${a.name}</div><div class="ap-desc">${a.desc}</div>${rewards.length ? `<div class="ap-reward">Unlocks: ${rewards.join(', ')}</div>` : ''}</div>`;
  ui.achPopup.classList.add('show');
  sound.achievement();
  popupTimer = 3.6;
}

buildAchievements = () => {
  const c = achievementContext(null, {});
  const got = ACHIEVEMENTS.filter((a) => achieved[a.id]).length;
  ui.achSummary.textContent = `${got} / ${ACHIEVEMENTS.length} unlocked`;
  ui.achGrid.innerHTML = ACHIEVEMENTS.map((a) => {
    const done = !!achieved[a.id];
    const pr = !done && a.progress ? a.progress(c) : null;
    return `<div class="ach${done ? ' done' : ''}">
      <span class="ach-icon">${a.icon}</span>
      <div class="ach-text"><b>${a.name}</b><span>${a.desc}</span>
      ${done ? `<em>Unlocked ${achieved[a.id]}</em>` : pr ? `<i class="ach-bar"><i style="width:${Math.round((pr[0] / pr[1]) * 100)}%"></i></i><em>${pr[0]} / ${pr[1]}</em>` : '<em>Locked</em>'}</div>
    </div>`;
  }).join('');
};

// --- Menu screens -------------------------------------------------------------

function showScreen(name) {
  for (const s of ui.screens) s.classList.toggle('hidden', s.id !== `screen-${name}`);
  if (name === 'levels') buildLevelGrid();
  if (name === 'skins') buildGunPage();
  if (name === 'profile') showProfileTab('stats');
  if (name === 'boards') {
    boardIndex = level?.weekly ? -2 : level?.daily ? -1 : level && !level.custom && !level.tutorial ? level.index : 0;
    ui.boardName.value = settings.playerName;
    showBoard();
  }
  if (name === 'community') loadCommunity();
  if (name === 'mylevels') {
    ui.mlMsg.textContent = '';
    buildMyLevels();
    ui.mlShare.classList.add('hidden');
  }
  if (name === 'editor-menu') {
    ui.editName.value = customLevel?.data.name ?? '';
    ui.editTheme.value = customLevel?.data.theme || 'day';
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
  ui.watchBtn.classList.toggle('hidden', !myGhost || inProgress);
  ui.tutorialBtn.classList.toggle('highlight', !progress.tutorialDone);
  refreshDailyButton();
  refreshWeeklyButton();
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
  if (next === 'menu') saveStats();
  if (next !== 'playing' && flyover) endFlyover();
  if (state === 'replay' && next !== 'replay') stopReplay();
  state = next;
  ui.menu.classList.toggle('hidden', state !== 'menu');
  ui.hud.classList.toggle('hidden', state === 'menu' || state === 'replay');
  ui.replayBar.classList.toggle('hidden', state !== 'replay');
  ui.hud.classList.toggle('editing', state === 'editor');
  renderer.showViewModel = state !== 'editor';
  if (state === 'editor') renderer.setGhosts([]);
  if (state !== 'editor') editor.hidePreview();
  if (state !== 'finished') ui.finish.classList.add('hidden');
  if (state === 'menu') showScreen('main');
}

// --- Replay viewer --------------------------------------------------------------
// Watch a recorded run (your best, or the world record) from a chase camera.

let replay = null; // { samples, label, t, duration, paused, speed, cam }

function startReplay(samples, label, color) {
  if (!samples?.length) return;
  if (document.pointerLockElement) document.exitPointerLock();
  replay = { samples, label, color, t: 0, duration: (samples.length - 1) / GHOST_RATE, paused: false, speed: 1, cam: null };
  renderer.setGhosts([{ samples, color, label }]);
  setState('replay');
}

function stopReplay() {
  replay = null;
  renderer.cameraOverride = null;
  updateMovers(course, run.time);
  refreshGhosts();
}

function replayKey(code) {
  if (code === 'Escape' || code === 'KeyQ') return setState('menu');
  if (code === 'Space') {
    if (replay.t >= replay.duration) replay.t = 0;
    replay.paused = !replay.paused;
  }
  if (code === 'ArrowLeft') replay.t = Math.max(0, replay.t - 2);
  if (code === 'ArrowRight') replay.t = Math.min(replay.duration, replay.t + 2);
  if (code === 'Digit1') replay.speed = 0.5;
  if (code === 'Digit2') replay.speed = 1;
  if (code === 'Digit3') replay.speed = 2;
}

function updateReplay(dt) {
  if (!replay.paused) replay.t = Math.min(replay.duration, replay.t + dt * replay.speed);
  if (replay.t >= replay.duration) replay.paused = true;
  updateMovers(course, replay.t); // moving anchors as they were during the run
  const now = ghostAt(replay.samples, replay.t);
  const ahead = ghostAt(replay.samples, Math.min(replay.duration, replay.t + 0.35));
  const pos = new THREE.Vector3(...now.pos);
  const dir = new THREE.Vector3(...ahead.pos).sub(pos).setY(0);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
  dir.normalize();
  // Chase camera: behind and above, smoothed so it doesn't jitter.
  const want = pos.clone().addScaledVector(dir, -8).add(new THREE.Vector3(0, 3, 0));
  if (!replay.cam) replay.cam = { pos: want.clone(), look: pos.clone() };
  const k = Math.min(1, dt * 4);
  replay.cam.pos.lerp(want, k);
  replay.cam.look.lerp(pos.clone().addScaledVector(dir, 4), k);
  renderer.cameraOverride = replay.cam;
  renderer.updateGhosts(replay.t);
  ui.replayBar.innerHTML = `<b>Replay · ${replay.label}</b> <span class="rb-time">${formatTime(replay.t)} / ${formatTime(replay.duration)}</span>` +
    `<span class="rb-track"><i style="width:${(replay.t / replay.duration) * 100}%"></i></span>` +
    `<span class="rb-keys">${replay.t >= replay.duration ? 'Finished · <kbd>Space</kbd> watch again' : `<kbd>Space</kbd> ${replay.paused ? 'play' : 'pause'}`} · <kbd>←</kbd><kbd>→</kbd> skip · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> speed (${replay.speed}x) · <kbd>Esc</kbd> back</span>`;
}

function watchBest() {
  startReplay(myGhost, 'Your best', '#5ff0ff');
}

async function watchRecord(def) {
  if (level.id !== def.id) {
    mode = 'level';
    customLevel = null;
    loadDef(def);
  }
  try {
    const rec = await getRecordGhost(def.id);
    if (!rec) return showToast('No world record ghost yet', '#ffffff');
    startReplay(await decodeGhost(rec.code), `World record · ${rec.name}`, '#ffd36b');
  } catch (e) {
    showToast("Couldn't load the world record", '#ff9a9a');
  }
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
  checkAchievements();
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
  const beatGhost = isRecord && !!myGhost;
  if (isRecord) {
    best = { time: e.time, splits: [...splits] };
    storage.setBest(level.id, best);
    refreshBest();
    saveBestGhost(level.id);
  }
  customLevel.tested = true;
  saveCustom(customLevel);
  // Finishing a level you built yourself (with a real course in it) unlocks
  // the Architect gun skin.
  if (customLevel.own && editorSummary(customLevel).blocks >= 5 && !progress.editorFinished) {
    progress.editorFinished = true;
    storage.setProgress(progress);
  }
  checkAchievements({ run: runFacts, flags: { beatGhost } });
  ui.finishTitle.textContent = mode === 'test' ? 'Test run complete!' : `${level.name} complete!`;
  ui.finishTime.textContent = formatTime(e.time);
  ui.finishNote.textContent = isRecord ? 'New best on this level!' : `Best: ${formatTime(best.time)}`;
  ui.finishNote.className = isRecord ? 'record' : '';
  ui.finishMedal.innerHTML = announceNewSkins(skinsBefore);
  ui.finishHint.innerHTML = mode === 'test'
    ? '<kbd>T</kbd> back to editor · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu'
    : customLevel.community && !customLevel.own
      ? 'Liked it? <kbd>V</kbd> upvote · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu'
      : '<kbd>R</kbd> fly again · <kbd>Esc</kbd> menu';
  state = 'finished';
  ui.finish.classList.remove('hidden');
}

function finishLevel(e) {
  if (level.tutorial) return finishTutorial(e);
  if (level.custom) return finishCustom(e);
  sound.finish();
  const isRecord = !best || e.time < best.time;
  let ghostSave = null;
  const beatGhost = isRecord && !!myGhost;
  const skinsBefore = unlockedSkinIds();
  const oldMedal = medalFor(level, best?.time);
  const runMedal = medalFor(level, e.time);
  const newMedal = runMedal && (!oldMedal || MEDALS.indexOf(runMedal) < MEDALS.indexOf(oldMedal));
  ui.finishTitle.textContent = level.daily ? `Daily challenge #${level.number} complete!` : level.weekly ? `Weekly tournament #${level.number} complete!` : `Level ${level.number} complete!`;
  ui.finishTime.textContent = formatTime(e.time);
  if (isRecord) {
    ui.finishNote.textContent = best ? `New best! ${(best.time - e.time).toFixed(3)}s faster` : 'First finish! That is your best time to beat.';
    ui.finishNote.className = 'record';
    best = { time: e.time, splits: [...splits] };
    storage.setBest(level.id, best);
    refreshBest();
    sound.record();
    ghostSave = saveBestGhost(level.id);
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
  checkAchievements({ run: runFacts, flags: { beatGhost } });
  submitAndShow(level, e.time, ghostSave);
  ui.finishMedal.innerHTML += announceNewSkins(skinsBefore);
  if (level.weekly) {
    ui.finishHint.innerHTML = `Top 3 when the week ends win a trophy · ends in ${timeUntilWeekEnd()} · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu`;
    state = 'finished';
    ui.finish.classList.remove('hidden');
    return;
  }
  if (level.daily) {
    const done = new Set(progress.dailyDone || []);
    done.add(level.date);
    progress.dailyDone = [...done].sort().slice(-400);
    storage.setProgress(progress);
    const streak = dailyStreak(progress.dailyDone);
    ui.finishHint.innerHTML = `${streak > 1 ? `🔥 ${streak}-day streak! · ` : ''}New daily in ${timeUntilNext()} · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu`;
    state = 'finished';
    ui.finish.classList.remove('hidden');
    return;
  }
  const hasNext = level.index + 1 < LEVELS.length;
  if (hasNext && progress.unlocked < level.index + 2) {
    progress.unlocked = level.index + 2;
    storage.setProgress(progress);
  }
  ui.finishHint.innerHTML = hasNext
    ? '<kbd>N</kbd> next level · <kbd>R</kbd> fly again · <kbd>P</kbd> watch replay · <kbd>Esc</kbd> menu'
    : 'You beat every level! · <kbd>R</kbd> fly again · <kbd>Esc</kbd> menu';
  state = 'finished';
  ui.finish.classList.remove('hidden');
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'start':
        resetRunFacts();
        recorder.reset();
        sound.start();
        break;
      case 'checkpoint': {
        stats.add('checkpoints');
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
        stats.add('finishes');
        stats.add(level.custom ? 'customFinishes' : level.daily || level.weekly ? 'dailyFinishes' : level.tutorial ? 'finishes' : 'levelFinishes', level.tutorial ? 0 : 1);
        finishLevel(e);
        stats.max('bestStreak', dailyStreak(progress.dailyDone || []));
        saveStats();
        break;
      case 'fall':
        stats.add('falls');
        stats.resetPosition();
        sound.fall();
        renderer.addShake(0.4);
        showToast(run.checkpoint >= 0 ? 'Back to checkpoint' : 'Try again', '#ffffff');
        if (runFacts) runFacts.falls++;
        if (run.checkpoint < 0) {
          resetRunFacts();
          splits = [];
          recorder.reset();
        }
        break;
      case 'land':
        sound.land(e.speed);
        if (e.speed > 15) renderer.addShake(Math.min(0.6, e.speed / 60));
        break;
      case 'attach':
        if (stats.s.hooksLanded === 0) setTimeout(() => checkAchievements(), 0);
        stats.add('hooksLanded');
        if (run.player.hook) renderer.hookSparks(run.player.hook.point, run.player.hook.box);
        sound.attach();
        renderer.addShake(0.15);
        renderer.ropeSnap();
        break;
      case 'crumble':
        sound.crumble();
        showToast('It crumbled!', '#c99bff');
        break;
      case 'zap':
        sound.zap();
        break;
      case 'jump':
        stats.add('jumps');
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

function maybeStartFlyover() {
  if (!flyoverPending || noFlyover || !settings.flyover || run.started) return;
  flyoverPending = false;
  flyover = new Flyover(course, run.player);
  ui.flyoverHint.textContent = `${levelTitle(level)} · Space or click to skip`;
  ui.flyoverHint.classList.add('show');
  ui.hud.classList.add('flying');
}

function endFlyover() {
  flyover = null;
  renderer.cameraOverride = null;
  ui.flyoverHint.classList.remove('show');
  ui.hud.classList.remove('flying');
  input.consumeMouse();
}

input.handlers.hookDown = () => {
  if (flyover) return endFlyover();
  if (state === 'editor') {
    editor.place(run.player);
    sound.attach();
    return;
  }
  if (state !== 'playing') return;
  renderer.fire();
  if (hook(run, currentAim())) {
    stats.add('hooksFired');
    if (runFacts) runFacts.hooks++;
    sound.hookFire();
  } else {
    sound.miss();
  }
};
input.handlers.hookUp = () => {
  const r = unhook(run);
  if (r.released) lastRelease = { ...r, velY: run.player.vel.y };
  if (tut && r.released && run.started && !run.player.grounded) tut.flags.flung = true;
  if (r.hopped) {
    stats.add('hops');
    sound.hop();
  } else if (r.released) sound.release();
};
input.handlers.altDown = () => {
  if (state === 'editor' && editor.remove(run.player)) sound.release();
};
input.handlers.wheel = (dir) => {
  if (state === 'editor') editor.cycleSize(dir);
};

function editorKey(code) {
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) editor.setTool((Number(digit[1]) + 9) % 10); // 1-9, then 0 for the 10th tool
  if (code === 'BracketRight') editor.cycleSize(1);
  if (code === 'BracketLeft') editor.cycleSize(-1);
  if (code === 'KeyR') editor.rotate();
  if (code === 'KeyQ') editor.copy(run.player);
  if (code === 'KeyZ' && editor.undo()) sound.release();
  if (code === 'KeyT') startTest();
}

input.handlers.key = (code) => {
  if (state === 'replay') return replayKey(code);
  if (code === 'KeyP' && state === 'finished' && myGhost) return watchBest();
  if (flyover && state === 'playing') return endFlyover();
  if (state === 'editor') return editorKey(code);
  if (code === 'KeyT' && mode === 'test' && state !== 'menu') return backToEditor();
  if (code === 'KeyR' && state !== 'menu') restart();
  if ((code === 'KeyN' || code === 'Enter') && state === 'finished' && !level.custom && !level.daily && !level.weekly && level.index + 1 < LEVELS.length) {
    loadLevel(level.index + 1); // the tutorial's index is -1, so this goes to level 1
    state = 'playing';
  }
  if (code === 'KeyM') toggleMute();
  if (code === 'KeyV' && state === 'finished' && customLevel?.community && !customLevel.own && !customLevel.voted) {
    customLevel.voted = true;
    voteLevel(customLevel.communityId, true).then(() => showToast('Upvoted!', '#7dff9a')).catch(() => showToast("Couldn't vote", '#ff9a9a'));
  }
  if (code === 'KeyC' && state === 'playing' && run.started && !run.finished) backToCheckpoint();
};
function toggleMute() {
  settings.muted = !settings.muted;
  ui.mute.checked = settings.muted;
  sound.setMuted(settings.muted);
  storage.setSettings(settings);
}

// Instant retry: back to the last checkpoint (or the start) straight away.
function backToCheckpoint() {
  const hadCheckpoint = run.checkpoint >= 0;
  if (runFacts) runFacts.retries++;
  if (!hadCheckpoint) resetRunFacts();
  respawn(run);
  if (!hadCheckpoint) {
    recorder.reset();
    splits = [];
    renderer.setCheckpointReached(-1);
  }
  if (bot) Object.assign(bot, createBot(run));
  sound.fall();
  showToast(hadCheckpoint ? 'Back to checkpoint' : 'Back to the start', '#ffffff');
}

input.handlers.lockChange = (locked) => {
  if (locked) {
    if (state === 'menu') {
      if (resumeTo === 'editor') return setState('editor');
      if (run.finished) restart();
      setState('playing');
      maybeStartFlyover();
    }
  } else if (!botMode && state !== 'replay') { // a replay releases the mouse on purpose
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
ui.dailyBtn.addEventListener('click', playDaily);
ui.weeklyBtn.addEventListener('click', playWeekly);
ui.boardsBtn.classList.toggle('hidden', !onlineEnabled);
ui.communityBtn.classList.toggle('hidden', !onlineEnabled);
ui.communityBtn.addEventListener('click', () => showScreen('community'));
ui.tabNew.addEventListener('click', () => { communitySort = 'new'; renderCommunity(); });
ui.tabTop.addEventListener('click', () => { communitySort = 'top'; renderCommunity(); });
ui.boardsBtn.addEventListener('click', () => showScreen('boards'));
ui.watchBtn.addEventListener('click', watchBest);
ui.boardWatch.addEventListener('click', () => watchRecord(boardDef(boardIndex)));
ui.boardPrev.addEventListener('click', () => {
  boardIndex = boardIndex <= -2 ? LEVELS.length - 1 : boardIndex - 1; // wraps through the daily (-1) and weekly (-2)
  showBoard();
});
ui.boardNext.addEventListener('click', () => {
  boardIndex = boardIndex >= LEVELS.length - 1 ? -2 : boardIndex + 1;
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
ui.editTheme.innerHTML = Object.entries(THEMES).map(([id, t]) => `<option value="${id}">${t.name}</option>`).join('');
ui.editTheme.addEventListener('change', () => {
  if (!customLevel) return;
  customLevel.data.theme = ui.editTheme.value;
  saveCustom(customLevel);
  renderer.setTheme(customLevel.data.theme);
});
renderer.onThunder = () => sound.thunder();
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

function bindRange(input, label, key, format, apply) {
  input.value = settings[key];
  const show = () => { if (label) label.textContent = format(settings[key]); };
  show();
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    show();
    apply?.(settings[key]);
    storage.setSettings(settings);
  });
}
function bindCheck(input, key, apply) {
  input.checked = !!settings[key];
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    apply?.(settings[key]);
    storage.setSettings(settings);
  });
}
const pct = (v) => `${Math.round(v * 100)}%`;
bindRange(ui.sens, ui.sensVal, 'sensitivity', (v) => `${v.toFixed(2)}x`);
bindRange(ui.fov, ui.fovVal, 'fov', (v) => `${v}°`, (v) => { renderer.baseFov = v; });
bindRange(ui.sfxVol, ui.sfxVal, 'sfxVolume', pct, (v) => sound.setEffectsVolume(v));
bindRange(ui.musicVol, ui.musicVal, 'musicVolume', pct, (v) => music?.setVolume(v));
bindCheck(ui.invert, 'invertY');
bindCheck(ui.mute, 'muted', (v) => sound.setMuted(v));
bindCheck(ui.shake, 'shake', (v) => { renderer.shakeEnabled = v; });
bindCheck(ui.speedfx, 'speedFx', (v) => { renderer.speedFx = v; });
renderer.baseFov = settings.fov;
renderer.shakeEnabled = settings.shake;
renderer.speedFx = settings.speedFx;
ui.settingsBtn.addEventListener('click', () => showScreen('settings'));
ui.profileBtn.addEventListener('click', () => showScreen('profile'));
ui.tabStats.addEventListener('click', () => showProfileTab('stats'));
ui.tabAch.addEventListener('click', () => showProfileTab('achievements'));
ui.quality.value = settings.quality;
renderer.setQuality(settings.quality);
ui.quality.addEventListener('change', () => {
  settings.quality = ui.quality.value;
  renderer.setQuality(settings.quality);
  storage.setSettings(settings);
});
bindCheck(ui.showFps, 'showFps', (v) => ui.fps.classList.toggle('hidden', !v));
bindCheck(ui.flyoverSetting, 'flyover');
ui.fps.classList.toggle('hidden', !settings.showFps);

// Phones and tablets with only a touchscreen can't play (no mouse to aim).
const touchOnly = window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
if (touchOnly && !params.has('bot')) ui.phoneNotice.classList.remove('hidden');
ui.phoneContinue.addEventListener('click', () => ui.phoneNotice.classList.add('hidden'));
ui.ghostMode.value = settings.ghost;
ui.ghostMode.addEventListener('change', () => {
  settings.ghost = ui.ghostMode.value;
  storage.setSettings(settings);
  if (level) loadGhosts(level);
});

// --- Main loop ----------------------------------------------------------------

const requested = Number(params.get('level')) - 1;
const startIndex = Number.isInteger(requested) && requested >= 0 && requested < LEVELS.length && isUnlocked(requested)
  ? requested
  : isUnlocked(progress.last) ? progress.last : 0;
if (params.has('tutorial')) loadTutorial();
else if (params.has('daily')) loadDef(dailyFor());
else if (params.has('weekly')) loadDef(weeklyFor());
else loadLevel(startIndex);
showScreen('main');
resetRunFacts();
checkAchievements({ silent: true }); // anything already earned before achievements existed
checkTrophies();

let last = performance.now();
let accumulator = 0;
let fpsFrames = 0;
let fpsTime = 0;

function frame(now) {
  const realDt = (now - last) / 1000;
  const dt = Math.min(0.1, realDt);
  last = now;
  fpsFrames++;
  fpsTime += realDt;
  if (fpsTime >= 0.5) {
    if (settings.showFps) ui.fps.textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
    fpsFrames = 0;
    fpsTime = 0;
  }
  const p = run.player;

  let mx = 0;
  let my = 0;
  let move = { forward: 0, right: 0, reel: false };
  if (state === 'editor') {
    [mx, my] = input.consumeMouse();
    const k = 0.0022 * settings.sensitivity;
    p.yaw -= mx * k;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - (settings.invertY ? -my : my) * k));
    const m = input.movement();
    editor.fly(p, { forward: m.forward, right: m.right, up: input.keys.has('Space'), down: input.keys.has('ShiftLeft') || input.keys.has('ControlLeft') }, dt);
    editor.updatePreview(p);
    accumulator = 0;
  } else if (state === 'replay') {
    updateReplay(dt);
    accumulator = 0;
  } else if (flyover && state === 'playing') {
    // Flyover: no physics, no player control.
    input.consumeMouse();
    renderer.cameraOverride = flyover.update(dt);
    if (!renderer.cameraOverride) endFlyover();
    accumulator = 0;
  } else if (state === 'playing' || state === 'finished') {
    [mx, my] = input.consumeMouse();
    const k = 0.0022 * settings.sensitivity;
    p.yaw -= mx * k;
    p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - (settings.invertY ? -my : my) * k));
    if (tut) tut.flags.look += (Math.abs(mx) + Math.abs(my)) * k;
    const before = tut ? { x: p.pos.x, z: p.pos.z, len: p.hook?.length, hook: p.hook } : null;

    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      move = bot ? botInput(bot) : input.movement();
      handleEvents(tick(run, move, FIXED_DT));
      if (run.started && !run.finished) recorder.record(run.time, p);
      if (state === 'playing' && !run.finished && !bot) stats.step(p, FIXED_DT, run.time);
      if (runFacts && move.reel && p.hook) runFacts.reeled = true;
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

  if (stats.sinceSave > 5) {
    saveStats();
    checkAchievements(); // distance, speed, play time...
  }
  updatePopups(dt);
  if (toastTimer > 0 && (toastTimer -= dt) <= 0) ui.toast.classList.remove('show');
  if (splitTimer > 0 && (splitTimer -= dt) <= 0) ui.split.classList.remove('show');

  if (state !== 'replay') renderer.updateGhosts(run.time);
  renderer.courseTime = state === 'replay' ? replay.t : run.time;
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
  renderer, restart, loadLevel, loadTutorial, playDaily, dailyFor, playWeekly, weeklyFor, checkTrophies,
  get progress() { return progress; }, formatTime, TUNING, medalCounts,
  get skin() { return settings.skin; },
  get cosmetics() { return { rope: settings.rope, trail: settings.trail }; },
  get mode() { return mode; },
  get communityLevels() { return communityLevels; },
  get customLevel() { return customLevel; },
  editor, openEditor, newCustomLevel, startTest, backToEditor, encodeLevel, decodeLevel,
  online: { submitScore, getLeaderboard },
  get music() { return music; },
  get stats() { return stats.s; },
  get replay() { return replay; },
  watchBest, watchRecord,
  get flyover() { return flyover; },
  get achieved() { return achieved; },
  checkAchievements,
  saveStats,
  get ghosts() { return { mine: myGhost, record: recordGhost, recorded: recorder.samples.length }; },
  Music,
};
