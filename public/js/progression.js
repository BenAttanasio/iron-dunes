// XP ledger and rank ladder. Data-driven from RANKS in config.js —
// see docs/GAME_DESIGN.md for the design (original bonus.com ladder pending).

import { RANKS, TUNING } from './config.js';
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

// Progress fraction through the current rank band (1 at max rank).
export function getRankProgress() {
  const idx = getRankIndex();
  if (idx >= RANKS.length - 1) return 1;
  const floor = RANKS[idx].xp, next = RANKS[idx + 1].xp;
  return (xp - floor) / (next - floor);
}

function gainXP(amount) {
  const before = getRankIndex();
  xp += amount;
  save.set('xp', xp);
  emit('xp-gained', { amount, total: xp });
  const after = getRankIndex();
  if (after > before) emit('rank-up', { rank: RANKS[after] });
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

// Upgrade points from rank-ups, capped by the tank model's slot count.
// Each point: +3 max HP and +1% damage (see GAME_DESIGN.md).
export function getUpgradePoints(model) {
  return Math.min(model.slots, getRankIndex());
}

export function applyUpgrades(tank) {
  if (!tank.model) return;
  const pts = getUpgradePoints(tank.model);
  tank.maxHp = tank.model.hp + pts * 3;
  tank.hp = tank.maxHp;
  tank.dmgMult = tank.model.dmgMult * (1 + pts * 0.01);
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
on('dig', ({ node }) => { if (node.amount <= 0) gainXP(TUNING.XP_COLLECT); });
on('player-died', applyDeathPenalty);
