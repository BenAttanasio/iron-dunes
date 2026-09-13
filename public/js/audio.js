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
  loadSamples();
}

// ---------- sampled one-shots (Kenney Impact Sounds, CC0) ----------
// Layered over the synth, never replacing it: recorded impacts beat oscillators,
// but the engine loop has to track speed and stutter on empty fuel, which only a
// synthesized source can do. Every play is a no-op until the buffers land, and
// stays a no-op forever if the files are missing.
const SAMPLE_SETS = {
  dig:    ['dig_0', 'dig_1', 'dig_2', 'dig_3'],
  armour: ['armour_0', 'armour_1', 'armour_2'],
  ping:   ['ping_0', 'ping_1', 'ping_2'],
  thud:   ['thud_0', 'thud_1'],
  wreck:  ['wreck_0', 'wreck_1'],
  pickup: ['pickup_0', 'pickup_1'],
};
const buffers = new Map();   // set name -> [AudioBuffer]

async function loadSamples() {
  await Promise.all(Object.entries(SAMPLE_SETS).map(async ([set, names]) => {
    const decoded = [];
    for (const n of names) {
      try {
        const res = await fetch(`assets/sfx/${n}.ogg`);
        if (!res.ok) continue;
        decoded.push(await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch { /* leave it out; the synth layer still fires */ }
    }
    if (decoded.length) buffers.set(set, decoded);
  }));
}

// rate varies pitch so repeated hits don't machine-gun the same clip.
function sample(set, vol = 0.5, rate = 1) {
  const bank = buffers.get(set);
  if (!ctx || !bank || !bank.length) return;
  const src = ctx.createBufferSource();
  src.buffer = bank[Math.floor(Math.random() * bank.length)];
  src.playbackRate.value = rate * (0.9 + Math.random() * 0.2);
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g); g.connect(master);
  src.start();
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
  updateDrillSound();
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

// ---------- drill loop ----------
// The drill is a channel you have to sit through, so it needs a sound that runs
// for its whole duration and climbs as it fills. A one-shot on completion would
// leave the tense part of the loop silent.
let drillOsc = null, drillGain = null, drillFilter = null, drillNoise = null;
let drillProgress = 0;

function startDrillSound() {
  if (!ctx || drillOsc) return;
  drillOsc = ctx.createOscillator();
  drillOsc.type = 'sawtooth';
  drillOsc.frequency.value = 68;
  drillNoise = ctx.createBufferSource();
  drillNoise.buffer = noiseBuffer;
  drillNoise.loop = true;
  drillFilter = ctx.createBiquadFilter();
  drillFilter.type = 'bandpass';
  drillFilter.frequency.value = 420;
  drillFilter.Q.value = 1.2;
  drillGain = ctx.createGain();
  drillGain.gain.value = 0;
  drillOsc.connect(drillFilter);
  drillNoise.connect(drillFilter);
  drillFilter.connect(drillGain);
  drillGain.connect(master);
  drillOsc.start(); drillNoise.start();
}

function stopDrillSound() {
  if (!drillOsc) return;
  try { drillOsc.stop(); drillNoise.stop(); } catch { /* already stopped */ }
  drillOsc.disconnect(); drillNoise.disconnect();
  drillFilter.disconnect(); drillGain.disconnect();
  drillOsc = drillNoise = drillFilter = drillGain = null;
}

function updateDrillSound() {
  const p = state.player();
  const drilling = p && p.drill && state.game.mode === 'playing';
  if (!drilling) {
    if (drillGain) {
      drillGain.gain.value += (0 - drillGain.gain.value) * 0.25;
      if (drillGain.gain.value < 0.001) stopDrillSound();
    }
    return;
  }
  startDrillSound();
  if (!drillGain) return;
  drillProgress = Math.min(1, p.drill.elapsed / p.drill.total);
  // Rising pitch across the channel — the payoff is audible before you see it.
  drillOsc.frequency.value = 68 + drillProgress * 46;
  drillFilter.frequency.value = 420 + drillProgress * 900;
  const target = 0.05 + drillProgress * 0.05;
  drillGain.gain.value += (target - drillGain.gain.value) * 0.2;
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
    case 'pulse':
    case 'emp':
      // Big, slow, expensive-sounding: this is a three-shots-a-life button.
      if (throttled('emp')) return;
      tone({ freq: 2400, freqEnd: 60, dur: 0.7, vol: 0.3 * vol });
      tone({ type: 'triangle', freq: 1400, freqEnd: 110, dur: 0.55, vol: 0.18 * vol });
      tone({ type: 'sawtooth', freq: 90, freqEnd: 34, dur: 0.8, vol: 0.22 * vol });
      noise({ dur: 0.6, filterType: 'bandpass', freq: 2600, freqEnd: 300, vol: 0.24 * vol });
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
  // Recorded metal on top of the synth boom gives the blast an actual transient.
  sample(big ? 'wreck' : 'thud', (big ? 0.5 : 0.28) * vol, big ? 0.85 : 1.1);
});

on('ricochet', () => {
  if (!ctx || throttled('bounce')) return;
  tone({ type: 'square', freq: 1800, freqEnd: 900, dur: 0.05, vol: 0.1 });
  sample('ping', 0.3, 1.5);
});

// A completed drill: the payoff transient at the end of the channel. Rich veins
// get the bigger, brighter version — the sound should tell you which one you just
// finished without looking.
on('dig', ({ node, tank }) => {
  if (!ctx || !tank?.isPlayer || throttled('dig', 0.1)) return;
  const rich = node.tier.id === 'rich';
  for (let i = 0; i < 3; i++)
    setTimeout(() => noise({ dur: 0.06, freq: 1200, vol: 0.15 }), i * 80);
  sample('dig', 0.45);
  setTimeout(() => sample('dig', 0.32, 1.15), 130);
  // Rising arpeggio on completion, longer and higher for a rich vein.
  const notes = rich ? [523, 659, 784, 1046, 1318] : [523, 784];
  notes.forEach((f, i) =>
    setTimeout(() => tone({ type: 'triangle', freq: f, dur: 0.11, vol: 0.11 }), i * 70));
});

on('drill-start', ({ node }) => {
  if (!ctx) return;
  tone({ type: 'square', freq: 180, freqEnd: 260, dur: 0.1, vol: 0.08 });
  if (node.tier.id === 'rich') {
    setTimeout(() => tone({ type: 'square', freq: 260, freqEnd: 340, dur: 0.1, vol: 0.08 }), 90);
  }
});

on('drill-cancel', ({ tank, reason }) => {
  if (!ctx || !tank.isPlayer || reason === 'released') return;
  tone({ type: 'square', freq: 300, freqEnd: 110, dur: 0.14, vol: 0.09 });
});

on('discover', () => {
  if (!ctx) return;
  tone({ type: 'triangle', freq: 660, freqEnd: 880, dur: 0.15, vol: 0.12 });
});

// Banking cargo: a steady counting tick while the hold empties, so the payout has
// a rhythm rather than resolving in silence.
on('cargo-banked', ({ remaining }) => {
  if (!ctx || throttled('bank', 0.09)) return;
  tone({ type: 'triangle', freq: 700, freqEnd: 950, dur: 0.06, vol: 0.07 });
  if (remaining <= 0) {
    [784, 1046].forEach((f, i) =>
      setTimeout(() => tone({ type: 'triangle', freq: f, dur: 0.12, vol: 0.1 }), i * 90));
  }
});

on('upgrade-spent', () => {
  if (!ctx) return;
  // Mechanical: something was bolted on, not a menu blip.
  tone({ type: 'square', freq: 160, dur: 0.06, vol: 0.12 });
  setTimeout(() => { tone({ type: 'square', freq: 240, dur: 0.06, vol: 0.12 }); sample('thud', 0.3, 1.4); }, 80);
  setTimeout(() => tone({ type: 'triangle', freq: 880, freqEnd: 1180, dur: 0.16, vol: 0.1 }), 170);
});

on('hunters-dispatched', () => {
  if (!ctx) return;
  // Low, ugly, and unmistakable — this is the game telling you it noticed.
  tone({ type: 'sawtooth', freq: 150, freqEnd: 70, dur: 0.7, vol: 0.2 });
  setTimeout(() => tone({ type: 'sawtooth', freq: 130, freqEnd: 60, dur: 0.8, vol: 0.18 }), 240);
  noise({ dur: 0.6, filterType: 'bandpass', freq: 320, vol: 0.12 });
});
on('pickup', () => {
  if (!ctx || throttled('pickup', 0.1)) return;
  tone({ type: 'triangle', freq: 520, freqEnd: 780, dur: 0.1, vol: 0.12 });
  sample('pickup', 0.35, 1.3);
});

on('player-hit', () => {
  if (!ctx || throttled('hit', 0.08)) return;
  tone({ type: 'triangle', freq: 300, dur: 0.08, vol: 0.2 });
  noise({ dur: 0.05, freq: 2000, vol: 0.1 });
  sample('armour', 0.45, 0.95);   // something just hit your plating
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
  stopDrillSound();
});
