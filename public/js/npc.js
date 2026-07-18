// NPC AI: patrol/attack/seek/retreat state machine over the waypoint graph,
// separation steering, clan-vs-clan targeting, and the respawn wave director.

import { GRID, CLANS, WEAPONS, BASE_POSITIONS, TUNING } from './config.js';
import * as state from './state.js';
import { emit } from './events.js';
import { isPassable, hasLOS, findPath, randomWaypoint, baseCenter, inBase } from './world.js';
import { createTank, moveTank, fireWeapon } from './entities.js';
import { getRankIndex } from './progression.js';

const NPC_WEAPON = { ...WEAPONS[0], damage: 10, speed: 5, size: 3, reload: 900 };

let npcCounter = 0;

// ============================================================
// SPAWNING
// ============================================================
export function spawnNPC(clanId) {
  const base = BASE_POSITIONS[CLANS[clanId].baseCorner];
  let ex, ey, attempts = 0;
  do {
    ex = (base.x + Math.random() * 20 - 5) * GRID;
    ey = (base.y + Math.random() * 20 - 5) * GRID;
    attempts++;
  } while (attempts < 30 && !isPassable(ex, ey));
  if (!isPassable(ex, ey)) { ex = base.x * GRID + 3.5 * GRID; ey = base.y * GRID + 3.5 * GRID; }

  const tank = createTank({ clanId, model: null, x: ex, y: ey });
  tank.ai = {
    state: 'patrol',
    path: null, pathIdx: 0,
    target: null, lastKnown: null,
    seekUntil: 0,
    stagger: npcCounter++ % TUNING.AI_LOS_STAGGER,
    losOk: false,
    shootJitter: Math.random() * 600,
  };
  tank.spawnFade = 60;
  tank.container.alpha = 0;
  NPC_WEAPON.color = CLANS[clanId].color;
  return tank;
}

export function spawnInitialPopulation() {
  for (const clan of CLANS) {
    const count = clan.id === state.game.selectedClan ? TUNING.ALLY_COUNT : TUNING.POP_BASE;
    for (let i = 0; i < count; i++) spawnNPC(clan.id);
  }
}

// ============================================================
// TARGETING
// ============================================================
function acquireTarget(tank) {
  let best = null, bestD = Infinity;
  for (const t of state.tanks) {
    if (!t.alive || t.clanId === tank.clanId) continue;
    let range = TUNING.AI_AGGRO;
    if (t.isPlayer) range *= TUNING.AI_PLAYER_AGGRO_BONUS;
    const d = Math.hypot(t.x - tank.x, t.y - tank.y);
    if (d < range && d < bestD && hasLOS(tank.x, tank.y, t.x, t.y)) {
      best = t; bestD = d;
    }
  }
  return best;
}

// ============================================================
// STEERING
// ============================================================
function steer(tank, dirX, dirY) {
  // Separation from nearby tanks
  for (const t of state.tanks) {
    if (t === tank || !t.alive) continue;
    const dx = tank.x - t.x, dy = tank.y - t.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.1 && d < TUNING.AI_SEPARATION_DIST) {
      const push = (TUNING.AI_SEPARATION_DIST - d) / TUNING.AI_SEPARATION_DIST * 0.6;
      dirX += dx / d * push;
      dirY += dy / d * push;
    }
  }
  // Wall probes: look 45px ahead at ±30°, steer away from blocked side
  const len = Math.hypot(dirX, dirY);
  if (len > 0.01) {
    const a = Math.atan2(dirY, dirX);
    const leftBlocked = !isPassable(tank.x + Math.cos(a - 0.52) * 45, tank.y + Math.sin(a - 0.52) * 45);
    const rightBlocked = !isPassable(tank.x + Math.cos(a + 0.52) * 45, tank.y + Math.sin(a + 0.52) * 45);
    if (leftBlocked && !rightBlocked) {
      dirX = Math.cos(a + 0.6); dirY = Math.sin(a + 0.6);
    } else if (rightBlocked && !leftBlocked) {
      dirX = Math.cos(a - 0.6); dirY = Math.sin(a - 0.6);
    } else if (leftBlocked && rightBlocked && !isPassable(tank.x + Math.cos(a) * 45, tank.y + Math.sin(a) * 45)) {
      dirX = -Math.cos(a); dirY = -Math.sin(a);
    }
  }
  return [dirX, dirY];
}

function followPath(tank, dt, throttle = 1) {
  const ai = tank.ai;
  if (!ai.path || ai.pathIdx >= ai.path.length) return false;
  const wp = ai.path[ai.pathIdx];
  const dx = wp.x - tank.x, dy = wp.y - tank.y;
  if (Math.hypot(dx, dy) < 60) {
    ai.pathIdx++;
    return followPath(tank, dt, throttle);
  }
  const [sx, sy] = steer(tank, dx, dy);
  moveTank(tank, sx, sy, throttle, dt);
  return true;
}

function newPatrolPath(tank) {
  const wp = randomWaypoint();
  tank.ai.path = wp ? findPath(tank.x, tank.y, wp.x, wp.y) : null;
  tank.ai.pathIdx = 0;
}

// ============================================================
// UPDATE
// ============================================================
export function updateNPCs(dt) {
  const frame = Math.floor(state.game.frame);
  for (const tank of state.tanks) {
    if (tank.isPlayer || !tank.alive) continue;
    const ai = tank.ai;

    if (tank.spawnFade > 0) {
      tank.spawnFade -= dt;
      tank.container.alpha = Math.min(1, 1 - tank.spawnFade / 60);
    }

    if (tank.empTimer > 0) continue; // DISABLED state: no move, no shoot

    // Staggered perception: target/LOS re-check
    if (frame % TUNING.AI_LOS_STAGGER === ai.stagger) {
      const t = acquireTarget(tank);
      if (t) {
        ai.target = t;
        ai.losOk = true;
        ai.lastKnown = { x: t.x, y: t.y };
        if (ai.state === 'patrol' || ai.state === 'seek') ai.state = 'attack';
      } else if (ai.state === 'attack') {
        ai.losOk = false;
        if (ai.target && ai.target.alive) {
          ai.state = 'seek';
          ai.seekUntil = state.game.time + TUNING.AI_SEEK_TIMEOUT_MS;
          ai.path = ai.lastKnown ? findPath(tank.x, tank.y, ai.lastKnown.x, ai.lastKnown.y) : null;
          ai.pathIdx = 0;
        } else {
          ai.state = 'patrol';
          ai.target = null;
        }
      }
    }

    // Retreat check
    if (tank.hp < tank.maxHp * TUNING.AI_RETREAT_HP && ai.state !== 'retreat') {
      ai.state = 'retreat';
      const bc = baseCenter(tank.clanId);
      ai.path = findPath(tank.x, tank.y, bc.x, bc.y);
      ai.pathIdx = 0;
    }

    switch (ai.state) {
      case 'patrol': {
        if (!followPath(tank, dt, 0.8)) newPatrolPath(tank);
        break;
      }
      case 'attack': {
        const t = ai.target;
        if (!t || !t.alive) { ai.state = 'patrol'; ai.target = null; break; }
        const d = Math.hypot(t.x - tank.x, t.y - tank.y);
        const toward = Math.atan2(t.y - tank.y, t.x - tank.x);
        ai.lastKnown = { x: t.x, y: t.y };

        // Turret tracks target smoothly
        const desired = toward + Math.PI / 2;
        let tdiff = desired - tank.turretAngle;
        while (tdiff > Math.PI) tdiff -= Math.PI * 2;
        while (tdiff < -Math.PI) tdiff += Math.PI * 2;
        tank.turretAngle += tdiff * Math.min(1, 0.25 * dt);

        // Standoff maneuvering
        if (d > TUNING.AI_STANDOFF_MAX) {
          const [sx, sy] = steer(tank, Math.cos(toward), Math.sin(toward));
          moveTank(tank, sx, sy, 1, dt);
        } else if (d < TUNING.AI_STANDOFF_MIN) {
          const [sx, sy] = steer(tank, -Math.cos(toward), -Math.sin(toward));
          moveTank(tank, sx, sy, 0.7, dt);
        } else {
          moveTank(tank, 0, 0, 0, dt);
        }

        // Fire when aimed and clear
        if (Math.abs(tdiff) < TUNING.AI_AIM_TOLERANCE && ai.losOk &&
            state.game.time - tank.lastShot > NPC_WEAPON.reload + ai.shootJitter) {
          if (hasLOS(tank.x, tank.y, t.x, t.y)) {
            fireWeapon(tank, { ...NPC_WEAPON, color: tank.clan.color }, toward);
            ai.shootJitter = Math.random() * 600;
          }
        }
        break;
      }
      case 'seek': {
        const done = !followPath(tank, dt, 1);
        if (done || state.game.time > ai.seekUntil) {
          ai.state = 'patrol';
          ai.target = null;
          newPatrolPath(tank);
        }
        break;
      }
      case 'retreat': {
        if (inBase(tank)) {
          moveTank(tank, 0, 0, 0, dt);
          tank.hp = Math.min(tank.maxHp, tank.hp + 0.1 * TUNING.AI_RETREAT_HEAL_MULT * dt);
        } else if (!followPath(tank, dt, 1)) {
          const bc = baseCenter(tank.clanId);
          ai.path = findPath(tank.x, tank.y, bc.x, bc.y);
          ai.pathIdx = 0;
        }
        if (tank.hp > tank.maxHp * 0.8) {
          ai.state = 'patrol';
          newPatrolPath(tank);
        }
        break;
      }
    }
  }
}

// ============================================================
// WAVE DIRECTOR — keeps the world populated
// ============================================================
let waveTimer = 0;

export function resetWaves() { waveTimer = 0; }

export function updateWaves(deltaMS) {
  waveTimer += deltaMS;
  if (waveTimer < TUNING.WAVE_INTERVAL_MS) return;
  waveTimer = 0;

  const rankBonus = Math.floor(getRankIndex() / TUNING.POP_PER_RANKS);
  for (const clan of CLANS) {
    const isAllied = clan.id === state.game.selectedClan;
    const target = isAllied
      ? TUNING.ALLY_COUNT
      : Math.min(TUNING.POP_CAP, TUNING.POP_BASE + rankBonus);
    const current = state.tanks.filter(t => !t.isPlayer && t.alive && t.clanId === clan.id).length;
    const deficit = target - current;
    if (deficit > 0) {
      const count = Math.min(TUNING.WAVE_MAX_SPAWN, deficit);
      for (let i = 0; i < count; i++) spawnNPC(clan.id);
      emit('wave-spawned', { clan, count });
      emit('message', { text: `${clan.name} reinforcements deployed`, color: clan.color });
    }
  }
}
