// XP ledger, rank ladder, and the upgrade economy. Data-driven from RANKS and
// UPGRADES in config.js — see docs/GAME_DESIGN.md.
//
// Upgrade points used to be derived from rank and applied automatically at +3 max
// HP / +1 % damage each, which meant a Forge that climbed the entire 11,700-XP
// ladder gained +27 HP and +9 % damage — homeopathic, and nothing about it was a
// choice. A promotion now grants one *unspent* point, and the player picks where it
// goes from three offered tracks. The model's `slots` is the cap on total spend.

import { RANKS, TANK_MODELS, UPGRADES, TUNING } from './config.js';
import * as state from './state.js';
import { on, emit } from './events.js';
import * as save from './save.js';

let xp = save.get('xp');
let survivalAccum = 0;

export function getXP() { return xp; }

export function getRankIndex() {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) idx = i;
  return idx;
}

export function getRank() { return RANKS[getRankIndex()]; }

export function isMaxRank() { return getRankIndex() >= RANKS.length - 1; }

// Progress fraction through the current rank band (1 at max rank).
export function getRankProgress() {
  const idx = getRankIndex();
  if (idx >= RANKS.length - 1) return 1;
  const floor = RANKS[idx].xp, next = RANKS[idx + 1].xp;
  return (xp - floor) / (next - floor);
}

// XP still needed for the next promotion (0 at max rank).
export function xpToNext() {
  const idx = getRankIndex();
  if (idx >= RANKS.length - 1) return 0;
  return Math.max(0, Math.ceil(RANKS[idx + 1].xp - xp));
}

// ============================================================
// UPGRADE POINTS — one build sheet PER HULL
// ============================================================
// Points earned is simply the rank index: one per promotion. There is no "granted
// vs pending" ledger to keep in sync, because nothing is consumed globally —
// EVERY model gets to spend your earned points independently, up to its own
// `slots` cap.
//
// The first cut of this shared one build sheet across all four hulls and truncated
// it to the model's cap at apply time. That was quietly broken: the truncation ran
// in UPGRADES array order, so on a small hull the tracks declared last silently did
// nothing — a player could sink points into AUTOLOADER and get no autoloader, with
// no way to find out. Per-hull sheets remove the truncation entirely, and make
// `slots` mean something honest: how much of your career this hull can express.
// Switching hulls now costs you nothing, it just changes the ceiling.
function allSheets() { return save.get('upgrades') || {}; }

function sheetFor(model) {
  const id = model?.id ?? 0;
  return allSheets()[id] || {};
}

export function pointsEarned() { return getRankIndex(); }

// The cap on what this hull can ever hold: its slots, or your career, whichever
// is smaller.
export function pointsAvailable(model) {
  return Math.min(model?.slots ?? 0, pointsEarned());
}

export function getSpentPoints(model = currentModel()) {
  return Object.values(sheetFor(model)).reduce((s, n) => s + n, 0);
}

export function getUpgradeLevel(trackId, model = currentModel()) {
  return sheetFor(model)[trackId] || 0;
}

// Unspent points for this hull.
export function getPendingPoints(model = currentModel()) {
  return Math.max(0, pointsAvailable(model) - getSpentPoints(model));
}

// How many more points this hull can absorb, ever.
export function slotsRemaining(model = currentModel()) {
  return Math.max(0, (model?.slots ?? 0) - getSpentPoints(model));
}

function currentModel() {
  return TANK_MODELS[state.game.selectedTank] || TANK_MODELS[0];
}

export function canSpendOn(trackId, model = currentModel()) {
  const track = UPGRADES.find(u => u.id === trackId);
  if (!track) return false;
  if (getPendingPoints(model) < 1) return false;
  if (getUpgradeLevel(trackId, model) >= track.max) return false;
  return true;
}

export function spendPoint(trackId, model = currentModel()) {
  if (!canSpendOn(trackId, model)) return false;
  const sheets = { ...allSheets() };
  const sheet = { ...(sheets[model.id] || {}) };
  sheet[trackId] = (sheet[trackId] || 0) + 1;
  sheets[model.id] = sheet;
  save.set('upgrades', sheets);
  save.flush();                            // a spend is the one edit worth flushing
  const p = state.player();
  if (p && p.alive && p.model && p.model.id === model.id) {
    applyUpgrades(p, { keepDamage: true });
  }
  emit('upgrade-spent', { trackId, level: sheet[trackId], model });
  return true;
}

// The three tracks offered for the current point. Deterministic in the hull and
// the number of points already sunk into it, so the same offer is waiting after a
// reload rather than being rerolled by closing the screen.
export function currentOffers(model = currentModel()) {
  const eligible = UPGRADES.filter(u => getUpgradeLevel(u.id, model) < u.max);
  if (eligible.length <= 3) return eligible;
  // Cheap deterministic shuffle — no Math.random, so the offer is stable.
  let seed = ((getSpentPoints(model) * 2654435761) ^ ((model?.id ?? 0) * 40503) + 12345) >>> 0;
  const pool = [...eligible];
  const out = [];
  for (let i = 0; i < 3; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out;
}

// ============================================================
// TANK MODEL UNLOCKS
// ============================================================
export function isModelUnlocked(model) {
  return getRankIndex() >= (model.reqRank || 0);
}

export function unlockedModels() {
  return TANK_MODELS.filter(isModelUnlocked);
}

// Highest-index model the player is actually allowed to drive, used to repair a
// save that points at something now out of reach.
export function fallbackModelIndex(preferred) {
  const m = TANK_MODELS[preferred];
  if (m && isModelUnlocked(m)) return preferred;
  const open = unlockedModels();
  return open.length ? open[open.length - 1].id : 0;
}

// ============================================================
// XP
// ============================================================
function gainXP(amount) {
  if (amount <= 0) return;
  const before = getRankIndex();
  xp += amount;
  save.set('xp', xp);
  emit('xp-gained', { amount, total: xp });
  const after = getRankIndex();
  if (after > before) {
    emit('rank-up', { rank: RANKS[after], index: after, pending: getPendingPoints() });
  }
}

export function awardXP(amount, label) {
  gainXP(amount);
  if (label) emit('xp-award', { amount, label });
}

// Lose a fraction of the current rank band; never demote below the rank floor.
function applyDeathPenalty() {
  const idx = getRankIndex();
  const floor = RANKS[idx].xp;
  const next = idx < RANKS.length - 1 ? RANKS[idx + 1].xp : floor + 1000;
  const loss = Math.round(TUNING.DEATH_PENALTY_FRAC * (next - floor));
  const actual = Math.min(loss, xp - floor);
  xp -= actual;
  save.set('xp', xp);
  state.game.lastDeathXpLoss = actual;
  emit('xp-lost', { amount: actual });
}

// ============================================================
// APPLYING UPGRADES TO A TANK
// ============================================================
// Runs on spawn (and again when a point is spent mid-life). Every derived stat is
// rebuilt from the model so this is idempotent — applying twice must not compound.
export function applyUpgrades(tank, { keepDamage = false } = {}) {
  if (!tank.model) return;
  const m = tank.model;
  const hpBefore = tank.hp, maxBefore = tank.maxHp;

  tank.maxHp = m.hp;
  tank.dmgMult = m.dmgMult;
  tank.maxSpeed = m.speed;
  tank.maxFuel = 40;
  tank.maxCargo = m.cargo;
  tank.reloadMult = 1;
  tank.radarMult = 1;
  tank.drillMult = 1;

  // The sheet is this hull's own and is capped at spend time, so everything in it
  // applies in full — no truncation, no track silently doing nothing.
  const sheet = sheetFor(m);
  for (const track of UPGRADES) {
    const n = Math.min(sheet[track.id] || 0, track.max);
    if (n > 0) track.apply(tank, n);
  }

  if (keepDamage && maxBefore > 0) {
    // Mid-life re-apply (a point was just spent): keep the damage taken rather
    // than handing out a free full heal.
    tank.hp = Math.min(tank.maxHp, hpBefore + Math.max(0, tank.maxHp - maxBefore));
  } else {
    tank.hp = tank.maxHp;
  }
  tank.fuel = Math.min(tank.fuel ?? tank.maxFuel, tank.maxFuel);
}

// Survival XP: ticks while playing, alive, and outside the home base.
export function updateSurvival(deltaMS) {
  const p = state.player();
  if (!p || !p.alive || p.inBase) return;
  survivalAccum += deltaMS;
  if (survivalAccum >= TUNING.XP_SURVIVAL_INTERVAL_MS) {
    survivalAccum -= TUNING.XP_SURVIVAL_INTERVAL_MS;
    gainXP(TUNING.XP_SURVIVAL_TICK);
  }
}

on('kill', ({ killer }) => {
  if (killer && killer.isPlayer) gainXP(TUNING.XP_KILL);
});
on('discover', () => gainXP(TUNING.XP_DISCOVER));
on('vein-depleted', ({ xp: amount }) => gainXP(amount ?? TUNING.XP_COLLECT));
on('cargo-banked', ({ units }) => gainXP(Math.round(units * TUNING.XP_BANK_PER_UNIT)));
on('player-died', applyDeathPenalty);
