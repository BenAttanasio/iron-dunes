// Procedural WebAudio SFX — no asset files. Lazy AudioContext (created on
// first user gesture via initAudio), master gain mute, event-driven recipes,
// and a speed-following engine loop.

import { TUNING } from './config.js';
import * as state from './state.js';
import { on } from './events.js';
import * as save from './save.js';

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = save.get('muted');
let activeOneShots = 0;
const lastPlayed = new Map();   // recipe name -> ctx.currentTime, for throttling

// Engine loop nodes
let engineOscA = null, engineOscB = null, engineGain = null, engineFilter = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return; // no audio support; every play() below no-ops
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);

  const len = ctx.sampleRate;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  startEngine();
}

export function isMuted() { return muted; }

export function setMuted(m) {
  muted = m;
  save.set('muted', m);
  if (master) master.gain.value = m ? 0 : 0.5;
}

function throttled(name, minInterval = 0.04) {
  if (!ctx) return true;
  if (activeOneShots >= 8) return true;
  const last = lastPlayed.get(name) || -1;
  if (ctx.currentTime - last < minInterval) return true;
  lastPlayed.set(name, ctx.currentTime);
  return false;
}

function envGain(vol, dur, attack = 0.005) {
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(master);
  activeOneShots++;
  setTimeout(() => { activeOneShots--; }, dur * 1000 + 100);
  return g;
}

function tone({ type = 'sine', freq, freqEnd, dur, vol = 0.2, attack = 0.005 }) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
  o.connect(envGain(vol, dur, attack));
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ dur, filterType = 'lowpass', freq = 1000, freqEnd, vol = 0.2, attack = 0.005 }) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  const t = ctx.currentTime;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
  src.connect(f);
  f.connect(envGain(vol, dur, attack));
  src.start(t);
  src.stop(t + dur + 0.05);
}

// ---------- engine loop ----------
function startEngine() {
  engineOscA = ctx.createOscillator(); engineOscA.type = 'sawtooth'; engineOscA.frequency.value = 55;
  engineOscB = ctx.createOscillator(); engineOscB.type = 'sawtooth'; engineOscB.frequency.value = 57;
  engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 300;
  engineGain = ctx.createGain(); engineGain.gain.value = 0;
  engineOscA.connect(engineFilter); engineOscB.connect(engineFilter);
  engineFilter.connect(engineGain); engineGain.connect(master);
  engineOscA.start(); engineOscB.start();
}

let stutterPhase = 0;

// Called each frame from main; follows player speed, stutters when out of fuel.
export function updateAudio(dt) {
  if (!ctx || !engineGain) return;
  const p = state.player();
  const playing = state.game.mode === 'playing' && p && p.alive;
  if (!playing) { engineGain.gain.value += (0 - engineGain.gain.value) * 0.1; return; }
  const spd = Math.hypot(p.vx, p.vy) / Math.max(0.1, p.maxSpeed);
  let target = 0.02 + spd * 0.04;
  if (p.fuel <= 0 && spd > 0.05) {
    stutterPhase += dt;
    if ((stutterPhase % 20) < 8) target *= 0.2;
  }
  engineGain.gain.value += (target - engineGain.gain.value) * 0.15;
  const pitch = 55 + spd * 30;
  engineOscA.frequency.value = pitch;
  engineOscB.frequency.value = pitch + 2;
}

// ---------- low fuel alarm ----------
let lowFuelActive = false;
let alarmTimer = null;

function lowFuelLoop() {
  if (!lowFuelActive || !ctx) return;
  tone({ type: 'square', freq: 880, dur: 0.09, vol: 0.05 });
  setTimeout(() => { if (lowFuelActive) tone({ type: 'square', freq: 660, dur: 0.09, vol: 0.05 }); }, 150);
  alarmTimer = setTimeout(lowFuelLoop, 2000);
}

export function setLowFuelAlarm(active) {
  if (active === lowFuelActive) return;
  lowFuelActive = active;
  clearTimeout(alarmTimer);
  if (active) lowFuelLoop();
}

// ---------- event recipes ----------
on('shot-fired', ({ tank, weapon }) => {
  if (!ctx) return;
  // Distance attenuation for NPC shots
  const p = state.player();
  let vol = 1;
  if (p && tank && !tank.isPlayer) {
    const d = Math.hypot(tank.x - p.x, tank.y - p.y);
    vol = Math.max(0, 1 - d / 1000) * 0.6;
    if (vol < 0.05) return;
  }
  switch (weapon.type) {
    case 'blast':
      if (throttled('heat')) return;
      noise({ dur: 0.15, freq: 900, vol: 0.25 * vol });
      noise({ dur: 0.35, freq: 500, freqEnd: 120, vol: 0.2 * vol });
      tone({ freq: 130, freqEnd: 55, dur: 0.12, vol: 0.3 * vol });
      break;
    case 'ricochet':
      if (throttled('rico')) return;
      tone({ type: 'square', freq: 1400, freqEnd: 500, dur: 0.07, vol: 0.12 * vol });
      break;
    case 'homing':
      if (throttled('homing')) return;
      noise({ dur: 0.25, filterType: 'bandpass', freq: 600, vol: 0.2 * vol });
      break;
    case 'mine':
      if (throttled('mine')) return;
      tone({ type: 'square', freq: 200, dur: 0.03, vol: 0.15 * vol });
      break;
    case 'emp':
      if (throttled('emp')) return;
      tone({ freq: 2200, freqEnd: 90, dur: 0.4, vol: 0.2 * vol });
      tone({ type: 'triangle', freq: 1100, freqEnd: 200, dur: 0.3, vol: 0.1 * vol });
      break;
    default: // cannon
      if (throttled('cannon')) return;
      noise({ dur: 0.15, freq: 900, vol: 0.25 * vol });
      tone({ freq: 130, freqEnd: 55, dur: 0.12, vol: 0.3 * vol });
  }
});

on('explosion', ({ x, y, big }) => {
  if (!ctx || throttled('explosion', 0.08)) return;
  const p = state.player();
  let vol = 1;
  if (p) {
    const d = Math.hypot(x - p.x, y - p.y);
    vol = Math.max(0, 1 - d / 1200);
    if (vol < 0.05) return;
  }
  noise({ dur: big ? 0.5 : 0.3, freq: 400, freqEnd: 90, vol: (big ? 0.35 : 0.2) * vol });
  if (big) tone({ freq: 55, dur: 0.4, vol: 0.25 * vol });
});

on('ricochet', () => {
  if (!ctx || throttled('bounce')) return;
  tone({ type: 'square', freq: 1800, freqEnd: 900, dur: 0.05, vol: 0.1 });
});

on('dig', () => {
  if (!ctx || throttled('dig', 0.1)) return;
  for (let i = 0; i < 3; i++)
    setTimeout(() => noise({ dur: 0.06, freq: 1200, vol: 0.15 }), i * 80);
});
on('discover', () => {
  if (!ctx) return;
  tone({ type: 'triangle', freq: 660, freqEnd: 880, dur: 0.15, vol: 0.12 });
});
on('pickup', () => {
  if (!ctx || throttled('pickup', 0.1)) return;
  tone({ type: 'triangle', freq: 520, freqEnd: 780, dur: 0.1, vol: 0.12 });
});

on('player-hit', () => {
  if (!ctx || throttled('hit', 0.08)) return;
  tone({ type: 'triangle', freq: 300, dur: 0.08, vol: 0.2 });
  noise({ dur: 0.05, freq: 2000, vol: 0.1 });
});

on('mine-armed', () => {
  if (!ctx || throttled('armed', 0.2)) return;
  tone({ type: 'square', freq: 880, dur: 0.05, vol: 0.08 });
  setTimeout(() => tone({ type: 'square', freq: 880, dur: 0.05, vol: 0.08 }), 100);
});

on('emp', () => {
  if (!ctx || throttled('empd', 0.2)) return;
  tone({ freq: 1800, freqEnd: 60, dur: 0.5, vol: 0.15 });
});

on('rank-up', () => {
  if (!ctx) return;
  [523, 659, 784, 1046].forEach((f, i) =>
    setTimeout(() => tone({ type: 'square', freq: f, dur: 0.12, vol: 0.12 }), i * 90));
});

on('player-died', () => {
  if (!ctx) return;
  noise({ dur: 0.7, freq: 500, freqEnd: 60, vol: 0.4 });
  tone({ freq: 70, freqEnd: 30, dur: 0.6, vol: 0.3 });
  setLowFuelAlarm(false);
});
