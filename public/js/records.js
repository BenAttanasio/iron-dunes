// Hall of Records — career bests, persisted alongside XP.
//
// A no-end-state sandbox gives you nothing to chase once the loop is comfortable.
// These are the numbers that make a run mean something after the fact: they cost
// nothing to keep (it is all localStorage already) and they are the only place the
// game acknowledges a good life rather than just a good rank.
//
// Each record declares how it is beaten (`higher`) and how it renders, so the
// screen in rankscreen.js is a pure map over this table.

import * as state from './state.js';
import { on } from './events.js';
import * as save from './save.js';

function fmtInt(n) { return `${Math.floor(n)}`; }
function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function fmtDist(px) { return `${Math.round(px / 10)} m`; }

export const RECORDS = [
  { id: 'bestKillsLife', name: 'Most kills in one life', fmt: fmtInt },
  { id: 'bestLifeMS',    name: 'Longest life',           fmt: fmtTime },
  { id: 'bestPush',      name: 'Deepest push from base', fmt: fmtDist },
  { id: 'bestBankRun',   name: 'Biggest cargo run',      fmt: n => `${fmtInt(n)} units` },
  { id: 'bestXP',        name: 'Peak XP',                fmt: fmtInt },
  { id: 'topRank',       name: 'Highest rank reached',   fmt: null },  // resolved by the UI
  { id: 'totalKills',    name: 'Career kills',           fmt: fmtInt },
  { id: 'totalVeins',    name: 'Deposits drilled dry',   fmt: fmtInt },
  { id: 'totalBanked',   name: 'Materials banked',       fmt: n => `${fmtInt(n)} units` },
  { id: 'totalDeaths',   name: 'Tanks lost',             fmt: fmtInt },
];

let records = { ...save.get('records') };

// Per-life counters, reset on spawn.
let life = { kills: 0, startedAt: 0, banked: 0 };

export function getRecord(id) { return records[id] || 0; }
export function allRecords() { return { ...records }; }

function commit() {
  save.set('records', { ...records });
}

// Beat a "best" record. Returns true if it was actually a new best, so callers can
// celebrate it.
function best(id, value) {
  if (!(value > (records[id] || 0))) return false;
  records[id] = value;
  commit();
  return true;
}

function bump(id, by = 1) {
  records[id] = (records[id] || 0) + by;
  commit();
}

export function startLife() {
  life = { kills: 0, startedAt: state.game.time, banked: 0 };
}

// Called every frame while alive — cheap enough, and "longest life" has to be true
// even if the session ends without dying.
export function updateLife() {
  const p = state.player();
  if (!p || !p.alive || state.game.mode !== 'playing') return;
  if (life.startedAt) best('bestLifeMS', state.game.time - life.startedAt);
  const home = state.bases.find(b => b.clanId === p.clanId);
  if (home) {
    best('bestPush', Math.hypot(p.x - (home.x + home.w / 2), p.y - (home.y + home.h / 2)));
  }
}

on('kill', ({ killer }) => {
  if (!killer || !killer.isPlayer) return;
  life.kills++;
  bump('totalKills');
  best('bestKillsLife', life.kills);
});

on('vein-depleted', () => bump('totalVeins'));

on('cargo-banked', ({ units }) => {
  life.banked += units;
  bump('totalBanked', units);
  best('bestBankRun', life.banked);
});

on('xp-gained', ({ total }) => best('bestXP', total));
on('rank-up', ({ index }) => best('topRank', index));

on('player-died', () => {
  bump('totalDeaths');
  // The run is over; the next spawn starts a fresh life.
  life.banked = 0;
});

on('player-respawned', startLife);

// Keep the peak-XP record honest for saves that predate this module.
best('bestXP', save.get('xp') || 0);
