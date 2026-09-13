// NPC AI: intercept aiming, skill tiers, clan weapon doctrines, a
// patrol/attack/seek/harvest/retreat state machine over the waypoint graph,
// separation steering, the respawn wave director, and player notoriety.
//
// THE AIMING BUG THIS FILE EXISTS TO FIX
// --------------------------------------
// NPCs used to fire at `atan2(target.y - y, target.x - x)` — where the target *is*.
// With a speed-5 shell across a 200-380 px standoff that is 40-75 frames of flight,
// during which a Spectre at 2.8 px/frame has moved ~150 px. They were not "easy",
// they were mathematically incapable of hitting anything that was moving, so
// driving in a straight line was perfectly safe and no other system had any teeth:
// fuel didn't matter, cover didn't matter, and neither did your rank.
//
// `leadAngle` solves the intercept properly. The miss then comes *back*, but as a
// designed stat (AI_SKILLS) rather than a physics failure — a Green crew leads 30 %
// of the way and sprays, an Elite crew leads perfectly. Which crews you meet is
// driven by your own rank (AI_SKILL_MIX), so climbing the ladder is something you
// feel in the firefight rather than read in a panel.

import {
  GRID, CLANS, WEAPONS, BASE_POSITIONS, TUNING, AI_SKILLS, AI_SKILL_MIX, RANKS,
} from './config.js';
import * as state from './state.js';
import { emit, on } from './events.js';
import {
  isPassable, hasLOS, findPath, randomWaypoint, baseCenter, inBase,
  findHarvestNode, depleteNode, emitNoise,
} from './world.js';
import { createTank, moveTank, fireWeapon, canFire, spawnFX } from './entities.js';
import { getRankIndex, getRank } from './progression.js';

let npcCounter = 0;

// ============================================================
// NPC WEAPON DOCTRINES
// ============================================================
// Every hostile in the game used to fire one identical nerfed cannon, so all four
// clans played the same and it never mattered who you were shooting at. Each clan
// now fields the weapon its doctrine implies, tuned down from the player versions —
// a Martian Militia push feels nothing like a Dune Dragoon skirmish.
//
// EM Pulse is deliberately absent from every loadout: on the receiving end a
// disable is a punishment, not a fight.
const NPC_WEAPON_TWEAKS = {
  0: { damage: 10, speed: 5.0, size: 4,   reload: 900 },
  1: { damage: 26, speed: 4.2, size: 6,   reload: 2100, blastRadius: 70 },
  2: { damage: 7,  speed: 8.0, size: 3.2, reload: 460,  bounces: 6 },
  3: { damage: 14, speed: 3.2, size: 4,   reload: 1600, turnRate: 0.07, seekRange: 380 },
  4: { damage: 22, reload: 4200 },
};

const weaponCache = new Map();

function npcWeapon(clanId, weaponId) {
  const key = `${clanId}:${weaponId}`;
  let w = weaponCache.get(key);
  if (!w) {
    w = { ...WEAPONS[weaponId], ...(NPC_WEAPON_TWEAKS[weaponId] || {}), color: CLANS[clanId].color };
    weaponCache.set(key, w);
  }
  return w;
}

// ============================================================
// SKILL ASSIGNMENT
// ============================================================
// Which tier a fresh spawn gets, rolled against the mix row for the player's
// current quartile of the ladder.
function rollSkill(floor = 0) {
  const q = Math.min(
    AI_SKILL_MIX.length - 1,
    Math.floor(getRankIndex() / RANKS.length * AI_SKILL_MIX.length));
  const row = AI_SKILL_MIX[q];
  let total = 0;
  for (let i = floor; i < row.length; i++) total += row[i];
  if (total <= 0) return AI_SKILLS[Math.max(floor, AI_SKILLS.length - 1)];
  let r = Math.random() * total;
  for (let i = floor; i < row.length; i++) {
    r -= row[i];
    if (r <= 0) return AI_SKILLS[i];
  }
  return AI_SKILLS[floor];
}

// ============================================================
// CALLSIGNS
// ============================================================
// Every hostile used to be labelled with just its clan tag, which made a firefight
// read as four identical blobs. Each tank now carries its own handle, and from
// Veteran up the label wears the tier marker so you can tell at a glance whether
// the thing shooting at you actually knows how to lead.
const CALL_A = ['Iron', 'Dust', 'Razor', 'Viper', 'Ash', 'Rust', 'Ghost', 'Steel',
  'Cobra', 'Vulture', 'Scarab', 'Wraith', 'Hammer', 'Talon', 'Grit', 'Mirage',
  'Jackal', 'Havoc', 'Nomad', 'Cinder', 'Basilisk', 'Onyx'];
const CALL_B = ['fang', 'hound', 'wolf', 'crawler', 'runner', 'digger', 'breaker',
  'hunter', 'raider', 'drifter', 'sting', 'claw', 'shard', 'burner', 'jaw'];

function makeCallsign() {
  const a = CALL_A[Math.floor(Math.random() * CALL_A.length)];
  const b = CALL_B[Math.floor(Math.random() * CALL_B.length)];
  const roll = Math.random();
  if (roll < 0.45) return `${a}${b}${10 + Math.floor(Math.random() * 89)}`;
  if (roll < 0.8) return `${a}_${b}`;
  return `${a}${Math.floor(Math.random() * 999)}`;
}

// ============================================================
// SPAWNING
// ============================================================
export function spawnNPC(clanId, opts = {}) {
  const base = BASE_POSITIONS[CLANS[clanId].baseCorner];
  const bx = base.x * GRID + GRID / 2, by = base.y * GRID + GRID / 2;
  // Spread the ring outward as attempts fail rather than retrying the same tight
  // radius 30 times and then giving up ONTO THE BASE CENTRE — which is where the
  // bunker stands, so the old fallback reliably wedged tanks inside their own
  // base. The centre is now a genuine last resort, and the ring reaches far
  // enough out to clear the structure.
  let ex = bx, ey = by, placed = false;
  for (let attempts = 0; attempts < 40; attempts++) {
    const a = Math.random() * Math.PI * 2;
    const r = (1.5 + (attempts / 40) * 6) * GRID;
    const cx2 = bx + Math.cos(a) * r, cy2 = by + Math.sin(a) * r;
    if (isPassable(cx2, cy2)) { ex = cx2; ey = cy2; placed = true; break; }
  }
  if (!placed) {
    // Last resort: walk straight out along the axes until something is passable,
    // so we never hand back a point known to be inside the bunker.
    outer:
    for (let ring = 1; ring <= 10; ring++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const cx2 = bx + dx * ring * GRID, cy2 = by + dy * ring * GRID;
        if (isPassable(cx2, cy2)) { ex = cx2; ey = cy2; break outer; }
      }
    }
  }

  const tank = createTank({ clanId, model: null, x: ex, y: ey, callsign: makeCallsign() });
  const skill = opts.skill || rollSkill(opts.skillFloor || 0);
  const loadout = CLANS[clanId].loadout;

  tank.reloadMult = skill.reload;
  tank.ai = {
    state: 'patrol',
    path: null, pathIdx: 0,
    target: null, lastKnown: null,
    seekUntil: 0,
    stagger: npcCounter++ % TUNING.AI_LOS_STAGGER,
    losOk: false,
    shootJitter: Math.random() * 400,
    skill,
    primary: npcWeapon(clanId, loadout.primary),
    secondary: loadout.secondary != null ? npcWeapon(clanId, loadout.secondary) : null,
    secondaryWhen: loadout.secondaryWhen,
    standoffMin: TUNING.AI_STANDOFF_MIN * loadout.standoff,
    standoffMax: TUNING.AI_STANDOFF_MAX * loadout.standoff,
    strafeSign: Math.random() < 0.5 ? -1 : 1,
    strafeFlipAt: state.game.time + Math.random() * TUNING.AI_STRAFE_FLIP_MS,
    investigate: null,
    harvest: null,
    hunt: !!opts.hunt,
    huntUntil: opts.hunt ? state.game.time + TUNING.HUNTER_TTL_MS : 0,
  };
  if (tank.label) {
    const tag = skill.tag ? `${skill.tag} ` : '';
    tank.label.text = `${tag}${CLANS[clanId].short}·${tank.callsign}`;
    if (opts.hunt) tank.label.style.fill = 0xff6644;
  }
  tank.spawnFade = 60;
  tank.container.alpha = 0;
  return tank;
}

export function spawnInitialPopulation() {
  for (const clan of CLANS) {
    const count = clan.id === state.game.selectedClan ? TUNING.ALLY_COUNT : TUNING.POP_BASE;
    for (let i = 0; i < count; i++) spawnNPC(clan.id);
  }
}

// ============================================================
// INTERCEPT AIMING
// ============================================================
// Iteratively solve for where the target will be when the shell arrives. Three
// passes converges well inside a pixel for anything moving at tank speeds.
// Velocities and projectile speed are both in px-per-dt-frame, so `t` is in
// frames and the units line up without conversion.
//
// `lead` scales the correction: 0 aims at the target's current position (the old
// broken behaviour), 1 is a perfect intercept. That is the dial AI_SKILLS turns.
function leadAngle(shooter, target, projSpeed, lead) {
  let t = 0;
  let px = target.x, py = target.y;
  for (let i = 0; i < TUNING.AI_LEAD_ITERATIONS; i++) {
    t = Math.hypot(px - shooter.x, py - shooter.y) / projSpeed;
    px = target.x + target.vx * t * lead;
    py = target.y + target.vy * t * lead;
  }
  return Math.atan2(py - shooter.y, px - shooter.x);
}

// ============================================================
// TARGETING
// ============================================================
function acquireTarget(tank) {
  const ai = tank.ai;
  let best = null, bestD = Infinity;
  for (const t of state.tanks) {
    if (!t.alive || t.clanId === tank.clanId) continue;
    let range = TUNING.AI_AGGRO * ai.skill.aggro;
    if (t.isPlayer) {
      range *= TUNING.AI_PLAYER_AGGRO_BONUS;
      // A hunter has your position by definition — that is what being hunted is.
      if (ai.hunt) range = Infinity;
    }
    const d = Math.hypot(t.x - tank.x, t.y - tank.y);
    if (d < range && d < bestD && (range === Infinity || hasLOS(tank.x, tank.y, t.x, t.y))) {
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

// The goal is kept even when findPath fails. findPath returns null whenever the
// nearest waypoint is unreachable from the tank's own — which is exactly what
// happens to a tank wedged in a base corner behind the bunker. Without a goal to
// fall back on, patrol had nothing to steer toward and the tank stood still
// forever (see the unstick fallback in the patrol case).
function newPatrolPath(tank) {
  const wp = randomWaypoint();
  tank.ai.path = wp ? findPath(tank.x, tank.y, wp.x, wp.y) : null;
  tank.ai.pathIdx = 0;
  tank.ai.goal = wp || null;
}

function pathTo(tank, x, y) {
  tank.ai.path = findPath(tank.x, tank.y, x, y);
  tank.ai.pathIdx = 0;
}

// ------------------------------------------------------------
// COVER — peek, shoot, hide
// ------------------------------------------------------------
// While the gun is recharging, a skilled crew should not be standing in the open
// waiting for it. Sample eight headings and prefer one that breaks line of sight to
// the target while staying in the standoff band; when the gun comes back the
// normal attack logic walks it out again. Green crews skip this entirely.
function seekCover(tank, target, dt) {
  const ai = tank.ai;
  let bestX = 0, bestY = 0, bestScore = -Infinity;
  const R = TUNING.AI_COVER_PROBE;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = tank.x + Math.cos(a) * R, py = tank.y + Math.sin(a) * R;
    if (!isPassable(px, py)) continue;
    const d = Math.hypot(px - target.x, py - target.y);
    let score = hasLOS(px, py, target.x, target.y) ? 0 : 10;
    // Still want to stay in the fight, not flee the map.
    if (d < ai.standoffMin) score -= 3;
    if (d > ai.standoffMax * 1.4) score -= 5;
    score += Math.random() * 0.5;
    if (score > bestScore) { bestScore = score; bestX = Math.cos(a); bestY = Math.sin(a); }
  }
  if (bestScore <= -Infinity) return false;
  const [sx, sy] = steer(tank, bestX, bestY);
  moveTank(tank, sx, sy, 0.85, dt);
  return true;
}

// ============================================================
// NOISE — drilling pulls hostiles in
// ============================================================
function consumeNoise() {
  if (!state.noiseEvents.length) return;
  for (const n of state.noiseEvents) {
    for (const tank of state.tanks) {
      if (tank.isPlayer || !tank.alive || !tank.ai) continue;
      if (n.source && n.source.clanId === tank.clanId) continue;
      if (tank.ai.state === 'attack' || tank.ai.state === 'retreat') continue;
      if (Math.hypot(tank.x - n.x, tank.y - n.y) > n.radius) continue;
      // Closer contacts are more likely to bite, so a common deposit doesn't drag
      // the whole map in the way a rich vein should.
      const d = Math.hypot(tank.x - n.x, tank.y - n.y);
      if (Math.random() > 1 - d / n.radius * 0.55) continue;
      tank.ai.investigate = { x: n.x, y: n.y, until: state.game.time + TUNING.AI_INVESTIGATE_MS };
      if (tank.ai.harvest) releaseHarvest(tank);
      tank.ai.state = 'seek';
      tank.ai.seekUntil = state.game.time + TUNING.AI_INVESTIGATE_MS;
      pathTo(tank, n.x, n.y);
    }
  }
  state.noiseEvents.length = 0;
}

// ============================================================
// HARVESTING — hostiles work the deposits too
// ============================================================
function releaseHarvest(tank) {
  const h = tank.ai.harvest;
  if (h && h.node && h.node.drilledBy === tank) h.node.drilledBy = null;
  tank.ai.harvest = null;
}

function assignHarvest(clanId) {
  const p = state.player();
  const crew = state.tanks.filter(t =>
    !t.isPlayer && t.alive && t.clanId === clanId && t.ai &&
    t.ai.state === 'patrol' && !t.ai.harvest && !t.ai.hunt);
  if (!crew.length) return;
  const digger = crew[Math.floor(Math.random() * crew.length)];
  const node = findHarvestNode(
    digger.x, digger.y, TUNING.AI_HARVEST_RANGE,
    p && p.alive ? p : null, TUNING.AI_HARVEST_MIN_PLAYER_DIST);
  if (!node) return;
  node.drilledBy = digger;
  digger.ai.harvest = { node, elapsed: 0, arrived: false };
  digger.ai.state = 'harvest';
  pathTo(digger, node.x, node.y);
}

function updateHarvest(tank, dt, deltaMS) {
  const ai = tank.ai;
  const h = ai.harvest;
  const node = h.node;
  if (!node.alive || node.drilledBy !== tank) {
    releaseHarvest(tank);
    ai.state = 'patrol';
    newPatrolPath(tank);
    return;
  }
  const d = Math.hypot(node.x - tank.x, node.y - tank.y);
  if (!h.arrived) {
    if (d < TUNING.DIG_RANGE) {
      h.arrived = true;
      moveTank(tank, 0, 0, 0, dt);
    } else if (!followPath(tank, dt, 0.9)) {
      // Path ran out short of the deposit — walk the last stretch directly.
      if (d > TUNING.DIG_RANGE * 3) { releaseHarvest(tank); ai.state = 'patrol'; newPatrolPath(tank); return; }
      const [sx, sy] = steer(tank, node.x - tank.x, node.y - tank.y);
      moveTank(tank, sx, sy, 0.9, dt);
    }
    return;
  }

  moveTank(tank, 0, 0, 0, dt);
  h.elapsed += deltaMS;
  // Their drilling is loud too — a rival working a vein is something you can hear
  // coming and go take off them.
  if (Math.floor(h.elapsed / TUNING.DRILL_NOISE_INTERVAL_MS) >
      Math.floor((h.elapsed - deltaMS) / TUNING.DRILL_NOISE_INTERVAL_MS)) {
    emitNoise(node.x, node.y, node.tier.noise * 0.6, tank);
  }
  if (state.game.frame % 7 < 1) {
    spawnFX(node.x + (Math.random() - 0.5) * 22, node.y + (Math.random() - 0.5) * 22, {
      tex: 'fx:cloud', color: 0xd0b070, size: 12 + Math.random() * 8, life: 22,
      vy: -0.3, grow: 0.03, alpha: 0.4,
    });
  }
  if (h.elapsed >= TUNING.AI_HARVEST_MS) {
    const claimed = node;
    releaseHarvest(tank);
    depleteNode(claimed, tank);
    emit('npc-harvested', { clan: tank.clan, node: claimed, tank });
    ai.state = 'patrol';
    newPatrolPath(tank);
  }
}

// ============================================================
// FIRING
// ============================================================
function shouldFireSecondary(tank, target, d, losOk) {
  const ai = tank.ai;
  if (!ai.secondary) return false;
  switch (ai.secondaryWhen) {
    case 'far':     return d > ai.standoffMax;
    case 'close':   return d < ai.standoffMin * 0.8;
    case 'noLOS':   return !losOk;
    case 'retreat': return ai.state === 'retreat';
    default:        return false;
  }
}

function tryFire(tank, target, weapon, losOk) {
  const ai = tank.ai;
  if (!canFire(tank, weapon)) return false;
  if (state.game.time - tank.lastShot < ai.shootJitter) return false;

  if (weapon.type === 'mine') {
    // Mines are dropped where you stand, not aimed. Peace Keepers lay them while
    // falling back, which turns their retreat into a real threat.
    fireWeapon(tank, weapon, tank.turretAngle - Math.PI / 2);
    ai.shootJitter = 200 + Math.random() * 400;
    return true;
  }
  if (!losOk) return false;

  const aim = leadAngle(tank, target, weapon.speed, ai.skill.lead)
    + (Math.random() - 0.5) * 2 * ai.skill.jitter;

  // Still gated on the turret having actually swung round — a shot that leaves at
  // the right angle from a barrel pointing elsewhere looks broken.
  let tdiff = (aim + Math.PI / 2) - tank.turretAngle;
  while (tdiff > Math.PI) tdiff -= Math.PI * 2;
  while (tdiff < -Math.PI) tdiff += Math.PI * 2;
  if (Math.abs(tdiff) > TUNING.AI_AIM_TOLERANCE) return false;

  fireWeapon(tank, weapon, aim);
  ai.shootJitter = Math.random() * 300;
  return true;
}

// ============================================================
// UPDATE
// ============================================================
export function updateNPCs(dt, deltaMS) {
  consumeNoise();
  const frame = Math.floor(state.game.frame);

  for (const tank of state.tanks) {
    if (tank.isPlayer || !tank.alive) continue;
    const ai = tank.ai;
    if (!ai) continue;

    if (tank.spawnFade > 0) {
      tank.spawnFade -= dt;
      tank.container.alpha = Math.min(1, 1 - tank.spawnFade / 60);
    }

    if (tank.empTimer > 0) continue; // DISABLED state: no move, no shoot

    // Hunters give up eventually rather than stalking you forever.
    if (ai.hunt && state.game.time > ai.huntUntil) {
      ai.hunt = false;
      if (tank.label) tank.label.style.fill = tank.clan.color;
    }

    // Staggered perception: target/LOS re-check
    if (frame % TUNING.AI_LOS_STAGGER === ai.stagger) {
      const t = acquireTarget(tank);
      if (t) {
        ai.target = t;
        ai.losOk = hasLOS(tank.x, tank.y, t.x, t.y);
        if (ai.losOk) ai.lastKnown = { x: t.x, y: t.y };
        if (ai.state === 'patrol' || ai.state === 'seek' || ai.state === 'harvest') {
          if (ai.harvest) releaseHarvest(tank);
          ai.state = 'attack';
          announceContact(tank, t);
        }
      } else if (ai.state === 'attack') {
        ai.losOk = false;
        if (ai.target && ai.target.alive) {
          ai.state = 'seek';
          ai.seekUntil = state.game.time + TUNING.AI_SEEK_TIMEOUT_MS;
          if (ai.lastKnown) pathTo(tank, ai.lastKnown.x, ai.lastKnown.y);
        } else {
          ai.state = 'patrol';
          ai.target = null;
        }
      }
    }

    // Retreat check
    if (tank.hp < tank.maxHp * TUNING.AI_RETREAT_HP && ai.state !== 'retreat') {
      if (ai.harvest) releaseHarvest(tank);
      ai.state = 'retreat';
      const bc = baseCenter(tank.clanId);
      pathTo(tank, bc.x, bc.y);
    }

    // Strafe direction flip
    if (state.game.time > ai.strafeFlipAt) {
      ai.strafeSign *= -1;
      ai.strafeFlipAt = state.game.time + TUNING.AI_STRAFE_FLIP_MS * (0.6 + Math.random() * 0.8);
    }

    switch (ai.state) {
      case 'patrol': {
        // A hunter doesn't wander — it comes to you.
        if (ai.hunt) {
          const p = state.player();
          if (p && p.alive) {
            if (!ai.path || ai.pathIdx >= ai.path.length || frame % 90 === ai.stagger) {
              pathTo(tank, p.x, p.y);
            }
            if (!followPath(tank, dt, 1)) {
              const [sx, sy] = steer(tank, p.x - tank.x, p.y - tank.y);
              moveTank(tank, sx, sy, 1, dt);
            }
            break;
          }
        }
        if (!followPath(tank, dt, 0.8)) {
          newPatrolPath(tank);
          // No path available — the tank is in a pocket the waypoint graph does
          // not reach into, typically the corner behind its own bunker. Steering
          // bodily at the goal still moves it, and steer()'s wall probes walk it
          // around the obstruction until it rejoins the graph. Before this, a
          // failed path meant moveTank was never called and the tank was parked
          // for the rest of the match.
          if (!tank.ai.path && tank.ai.goal) {
            const [sx, sy] = steer(tank, tank.ai.goal.x - tank.x, tank.ai.goal.y - tank.y);
            moveTank(tank, sx, sy, 0.8, dt);
          }
        }
        break;
      }

      case 'harvest': {
        updateHarvest(tank, dt, deltaMS);
        break;
      }

      case 'attack': {
        const t = ai.target;
        if (!t || !t.alive) { ai.state = 'patrol'; ai.target = null; break; }
        const d = Math.hypot(t.x - tank.x, t.y - tank.y);
        ai.losOk = hasLOS(tank.x, tank.y, t.x, t.y);
        if (ai.losOk) ai.lastKnown = { x: t.x, y: t.y };

        // Turret leads the target, so the barrel is already tracking the intercept
        // point by the time the reload finishes.
        const primary = ai.primary;
        const aimAt = leadAngle(tank, t, primary.speed, ai.skill.lead);
        const desired = aimAt + Math.PI / 2;
        let tdiff = desired - tank.turretAngle;
        while (tdiff > Math.PI) tdiff -= Math.PI * 2;
        while (tdiff < -Math.PI) tdiff += Math.PI * 2;
        tank.turretAngle += tdiff * Math.min(1, 0.25 * dt);

        const toward = Math.atan2(t.y - tank.y, t.x - tank.x);
        const reloading = !canFire(tank, primary);

        if (reloading && ai.skill.cover > 0.5 && ai.losOk && seekCover(tank, t, dt)) {
          // Broke off to reload behind something.
        } else if (d > ai.standoffMax) {
          const [sx, sy] = steer(tank, Math.cos(toward), Math.sin(toward));
          moveTank(tank, sx, sy, 1, dt);
        } else if (d < ai.standoffMin) {
          const [sx, sy] = steer(tank, -Math.cos(toward), -Math.sin(toward));
          moveTank(tank, sx, sy, 0.7, dt);
        } else if (ai.skill.strafe > 0.01) {
          // Inside the band they used to stand perfectly still, which made a
          // firefight two statues trading shells and made them trivial to lead in
          // return. Now they circle.
          const px = -Math.sin(toward) * ai.strafeSign, py = Math.cos(toward) * ai.strafeSign;
          const [sx, sy] = steer(tank, px, py);
          moveTank(tank, sx, sy, Math.min(1, ai.skill.strafe), dt);
        } else {
          moveTank(tank, 0, 0, 0, dt);
        }

        if (shouldFireSecondary(tank, t, d, ai.losOk)) {
          tryFire(tank, t, ai.secondary, ai.losOk);
        }
        tryFire(tank, t, primary, ai.losOk);
        break;
      }

      case 'seek': {
        const done = !followPath(tank, dt, 1);
        if (done || state.game.time > ai.seekUntil) {
          ai.investigate = null;
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
          pathTo(tank, bc.x, bc.y);
          // Same unstick as patrol: a wounded tank that cannot path home has to
          // keep moving, or it bleeds out standing in the open.
          if (!tank.ai.path) {
            const [sx, sy] = steer(tank, bc.x - tank.x, bc.y - tank.y);
            moveTank(tank, sx, sy, 1, dt);
          }
        }
        // Mine-layers seed their own retreat path.
        if (ai.secondary && ai.secondaryWhen === 'retreat' && ai.target && ai.target.alive) {
          tryFire(tank, ai.target, ai.secondary, false);
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
// KILL FEED REACTIONS
// ============================================================
// Once you outrank the desert, hostiles should talk about you. Throttled hard —
// this is flavour, and the feed only holds three lines.
let lastContactCall = -99999;

function announceContact(tank, target) {
  if (!target.isPlayer) return;
  const idx = getRankIndex();
  if (idx < 8) return;                                   // Lieutenant and up only
  if (state.game.time - lastContactCall < 22000) return;
  if (Math.random() > 0.35) return;
  lastContactCall = state.game.time;
  const rank = getRank().name.toUpperCase();
  const lines = [
    `${tank.clan.short}: ${rank} sighted — all units converge`,
    `${tank.clan.short}: contact, it's the ${rank}`,
    `${tank.clan.short}: ${rank} in our sector — engaging`,
  ];
  emit('message', { text: lines[Math.floor(Math.random() * lines.length)], color: tank.clan.color });
}

// ============================================================
// NOTORIETY — kill a clan enough and it comes looking for you
// ============================================================
on('kill', ({ victim, killer }) => {
  if (!killer || !killer.isPlayer || victim.isPlayer) return;
  const n = state.game.notoriety;
  n[victim.clanId] = Math.min(TUNING.NOTORIETY_MAX, n[victim.clanId] + TUNING.NOTORIETY_PER_KILL);
});

export function updateNotoriety(deltaMS) {
  const n = state.game.notoriety;
  const decay = TUNING.NOTORIETY_DECAY_PER_S * (deltaMS / 1000);
  for (const clan of CLANS) {
    if (clan.id === state.game.selectedClan) { n[clan.id] = 0; continue; }
    n[clan.id] = Math.max(0, n[clan.id] - decay);
    if (n[clan.id] < TUNING.NOTORIETY_HUNT_AT) continue;
    if (state.game.time < state.game.huntersUntil[clan.id]) continue;

    // Dispatch. Notoriety pays for the squad rather than resetting, so a sustained
    // rampage keeps them coming instead of buying one wave of silence.
    n[clan.id] -= TUNING.NOTORIETY_HUNT_AT;
    state.game.huntersUntil[clan.id] = state.game.time + TUNING.HUNTER_TTL_MS;
    for (let i = 0; i < TUNING.HUNTER_SQUAD_SIZE; i++) {
      spawnNPC(clan.id, { hunt: true, skillFloor: TUNING.HUNTER_SKILL_FLOOR });
    }
    emit('message', { text: `${clan.name.toUpperCase()} HUNTER SQUAD DISPATCHED`, color: 0xff6644 });
    emit('hunters-dispatched', { clan });
  }
}

export function resetNotoriety() {
  state.game.notoriety = [0, 0, 0, 0];
  state.game.huntersUntil = [0, 0, 0, 0];
  lastContactCall = -99999;
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
    // One digger per clan at a time, at most.
    const digging = state.tanks.some(t => !t.isPlayer && t.alive && t.clanId === clan.id && t.ai?.harvest);
    if (!digging && Math.random() < TUNING.AI_HARVEST_CHANCE) assignHarvest(clan.id);
  }
}
