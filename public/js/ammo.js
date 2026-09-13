// Per-weapon magazines.
//
// Every weapon carries its own ammo: spending a Cannon round must never eat into
// your Ricochet or EM Pulse stock. Materials refill magazines either as a *spread*
// (a share of every weapon's own maximum) or as a *typed* cache that dumps the
// whole haul into one weapon.
//
// Spread-only was the original behaviour and it made every dig identical and
// mostly invisible: at AMMO_PER_MATERIAL 0.10 a 3-unit deposit was 9 cannon rounds
// but 0.9 of an EM Pulse, so the interesting half of the arsenal never visibly
// restocked. Typed caches are what make finding one an event.
//
// Its own module because both entities.js (firing, pickups) and world.js (digging)
// need it, and importing one from the other would make a cycle.

import { WEAPONS, TUNING } from './config.js';

export function startingAmmo(frac = TUNING.START_AMMO_FRAC) {
  // Floats, not integers: a partial refill has to accumulate toward the next EM
  // pulse rather than rounding away to nothing every time.
  return WEAPONS.map(w => w.maxAmmo * frac);
}

export function refillAmmo(tank, frac) {
  if (!tank.ammo) return;
  for (let i = 0; i < WEAPONS.length; i++) {
    tank.ammo[i] = Math.max(tank.ammo[i], WEAPONS[i].maxAmmo * frac);
  }
}

// Spread delivery across every magazine. Returns per-weapon deltas so the HUD can
// show what actually landed rather than a generic chime.
export function addAmmo(tank, units, mult = 1) {
  if (!tank.ammo) return null;
  const gained = new Array(WEAPONS.length).fill(0);
  for (let i = 0; i < WEAPONS.length; i++) {
    const max = WEAPONS[i].maxAmmo;
    const before = tank.ammo[i];
    tank.ammo[i] = Math.min(max, before + max * TUNING.AMMO_PER_MATERIAL * units * mult);
    gained[i] = tank.ammo[i] - before;
  }
  return gained;
}

// Typed delivery: the whole haul goes into one weapon. A unit is worth several
// times more here than it is spread across six magazines, which is the entire
// point of finding a cache of one specific thing.
const TYPED_UNIT_VALUE = 0.42;   // fraction of that weapon's magazine per unit

export function addAmmoTyped(tank, weaponId, units, mult = 1) {
  if (!tank.ammo) return null;
  const gained = new Array(WEAPONS.length).fill(0);
  const i = Math.max(0, Math.min(WEAPONS.length - 1, weaponId | 0));
  const max = WEAPONS[i].maxAmmo;
  const before = tank.ammo[i];
  tank.ammo[i] = Math.min(max, before + max * TYPED_UNIT_VALUE * units * mult);
  gained[i] = tank.ammo[i] - before;
  return gained;
}

export function ammoOf(tank, index) {
  return Math.floor(tank.ammo?.[index] ?? 0);
}

// Total rounds carried, for the HUD readout.
export function totalAmmo(tank) {
  return tank.ammo ? tank.ammo.reduce((s, n) => s + Math.floor(n), 0) : 0;
}

export function totalMaxAmmo() {
  return WEAPONS.reduce((s, w) => s + w.maxAmmo, 0);
}
