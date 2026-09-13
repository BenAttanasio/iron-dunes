// Tanks (player + NPC share one shape), projectiles, mines, particles,
// pickups, base turrets, damage resolution, and movement physics.
//
// Movement (moveTank) is deliberately untouched — the driving feel is good.

import { GRID, WORLD_W, WORLD_H, CLANS, WEAPONS, TUNING } from './config.js';
import { getTexture, tankTextureKey } from './textures.js';
import * as state from './state.js';
import { emit } from './events.js';
import { isPassable, hasLOS, stampTrack, stampCrater, makeCargo, cargoTotal, cancelDrill } from './world.js';
import { startingAmmo, addAmmo, addAmmoTyped } from './ammo.js';

const PIXI = window.PIXI;

const MAX_PARTICLES = 700;

// ============================================================
// TANK FACTORY
// ============================================================
export function createTank({ clanId, model, x, y, isPlayer = false, callsign = null }) {
  const clan = CLANS[clanId];
  const scale = model ? model.scale : 0.9;
  const chassis = model ? model.chassis : 0;
  const cont = new PIXI.Container();
  const body = new PIXI.Sprite(getTexture(tankTextureKey(clan.hull, scale, chassis)));
  body.anchor.set(0.5);
  const flash = new PIXI.Sprite(getTexture(`tankwhite:${scale}:${chassis}`));
  flash.anchor.set(0.5);
  flash.alpha = 0;
  const turret = new PIXI.Sprite(getTexture('turret'));
  turret.anchor.set(0.5, 0.8);
  // The gun is one shared texture, so it has to be scaled to the hull it sits on
  // — left at a fixed size it looked stubby on a Bison and oversized on a
  // Spectre. NPCs keep the slight extra reduction they always had.
  turret.scale.set(isPlayer ? scale : scale * 0.9);
  cont.addChild(body); cont.addChild(flash); cont.addChild(turret);

  const tank = {
    isPlayer, clanId, clan, model, callsign,
    x, y, vx: 0, vy: 0,
    angle: Math.random() * Math.PI * 2, turretAngle: 0,
    maxSpeed: model ? model.speed : TUNING.NPC_SPEED,
    turnRate: model ? model.turnRate : 0.15,
    hp: model ? model.hp : TUNING.NPC_HP,
    maxHp: model ? model.hp : TUNING.NPC_HP,
    armor: model ? model.armor : 1,
    dmgMult: model ? model.dmgMult : 1,
    fuel: 30, maxFuel: 40,
    ammo: isPlayer ? startingAmmo() : null,   // NPCs shoot freely
    weaponIndex: 0,
    lastShot: -99999,                          // most recent shot of any weapon
    lastShotPer: new Array(WEAPONS.length).fill(-99999),
    empTimer: 0, hitFlash: 0, recoil: 0,
    trackDist: 0, dustTimer: 0, arcTimer: 0,
    alive: true, lastHitBy: null, inBase: false,
    container: cont, body, turret, flashSprite: flash,
    hpBar: null, label: null,
    ai: null,
    // Upgrade-derived multipliers. Rebuilt from scratch by applyUpgrades on every
    // spawn, so they must exist even on tanks that never see it (NPCs).
    reloadMult: 1, radarMult: 1, drillMult: 1,
    // Materials in the hold, waiting to be banked at a depot.
    cargo: makeCargo(), maxCargo: model ? model.cargo : 0,
    drill: null,
  };

  if (!isPlayer) {
    const hpBg = new PIXI.Graphics();
    hpBg.rect(-20, -34, 40, 4); hpBg.fill({ color: 0x000000, alpha: 0.6 });
    hpBg.rect(-20, -34, 40, 4); hpBg.stroke({ color: 0x000000, width: 1, alpha: 0.8 });
    cont.addChild(hpBg);
    const hpBar = new PIXI.Graphics();
    cont.addChild(hpBar);
    // Enemy "username" — the clan tag alone made every tank look identical.
    const label = new PIXI.Text({
      text: callsign ? `${clan.short}·${callsign}` : clan.short,
      style: {
        fontSize: 10, fill: clan.color, fontFamily: 'monospace', fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    });
    label.anchor.set(0.5); label.y = -46; label.alpha = 0.9;
    cont.addChild(label);
    tank.hpBar = hpBar; tank.label = label;
  } else {
    // Rank insignia rides above the player's own hull. Rank was previously a
    // number in a corner panel and nothing else; wearing it is what turns it into
    // an identity you can see in the same frame as the fight.
    const ins = new PIXI.Text({
      text: '', style: {
        fontSize: 11, fill: 0xffd257, fontFamily: 'monospace', fontWeight: 'bold',
        stroke: { color: 0x000000, width: 3 },
      },
    });
    ins.anchor.set(0.5); ins.y = -40; ins.alpha = 0.9;
    cont.addChild(ins);
    tank.insignia = ins;
  }

  cont.x = x; cont.y = y;
  state.layers.tanks.addChild(cont);
  state.tanks.push(tank);
  return tank;
}

export function removeTank(tank) {
  tank.alive = false;
  tank.container.parent?.removeChild(tank.container);
  const i = state.tanks.indexOf(tank);
  if (i >= 0) state.tanks.splice(i, 1);
}

// ============================================================
// MOVEMENT PHYSICS — shared by player and NPCs (unchanged)
// dirX/dirY: desired direction (not necessarily normalized); throttle 0..1
// ============================================================
export function moveTank(tank, dirX, dirY, throttle, dt) {
  const len = Math.hypot(dirX, dirY);
  let effMax = tank.maxSpeed;
  if (tank.isPlayer && tank.fuel <= 0) effMax *= TUNING.FUEL_EMPTY_SPEED_MULT;

  if (len > 0.01 && throttle > 0 && tank.empTimer <= 0) {
    const nx = dirX / len, ny = dirY / len;
    const accel = (effMax / TUNING.ACCEL_FRAMES) * dt * throttle;
    tank.vx += nx * accel;
    tank.vy += ny * accel;
    const spd = Math.hypot(tank.vx, tank.vy);
    if (spd > effMax * throttle) {
      tank.vx = tank.vx / spd * effMax * throttle;
      tank.vy = tank.vy / spd * effMax * throttle;
    }
    // Body swings toward movement heading (shortest arc)
    const target = Math.atan2(ny, nx);
    let diff = target - tank.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    tank.angle += diff * Math.min(1, tank.turnRate * dt);
  } else {
    const f = Math.pow(TUNING.FRICTION, dt);
    tank.vx *= f; tank.vy *= f;
    if (Math.hypot(tank.vx, tank.vy) < TUNING.STOP_EPSILON) { tank.vx = 0; tank.vy = 0; }
  }

  const r = TUNING.TANK_RADIUS;
  const stepX = tank.vx * dt, stepY = tank.vy * dt;
  if (stepX !== 0) {
    const nx2 = tank.x + stepX;
    if (isPassable(nx2 + r, tank.y) && isPassable(nx2 - r, tank.y) &&
        isPassable(nx2, tank.y + r) && isPassable(nx2, tank.y - r)) tank.x = nx2;
    else tank.vx = 0;
  }
  if (stepY !== 0) {
    const ny2 = tank.y + stepY;
    if (isPassable(tank.x + r, ny2) && isPassable(tank.x - r, ny2) &&
        isPassable(tank.x, ny2 + r) && isPassable(tank.x, ny2 - r)) tank.y = ny2;
    else tank.vy = 0;
  }
  tank.x = Math.max(GRID, Math.min(WORLD_W - GRID, tank.x));
  tank.y = Math.max(GRID, Math.min(WORLD_H - GRID, tank.y));

  // Track marks + dust
  const speed = Math.hypot(tank.vx, tank.vy);
  if (speed > 0.2) {
    tank.trackDist += speed * dt;
    if (tank.trackDist > TUNING.TRACK_SPACING) {
      tank.trackDist = 0;
      const px = -Math.sin(tank.angle), py = Math.cos(tank.angle);
      const off = 13 * (tank.model ? tank.model.scale : 0.9);
      stampTrack(tank.x + px * off, tank.y + py * off, tank.angle + Math.PI / 2);
      stampTrack(tank.x - px * off, tank.y - py * off, tank.angle + Math.PI / 2);
    }
    if (speed > tank.maxSpeed * TUNING.DUST_SPEED_FRAC) {
      tank.dustTimer -= dt;
      if (tank.dustTimer <= 0) {
        tank.dustTimer = 4;
        spawnDust(tank.x - Math.cos(tank.angle) * 18, tank.y - Math.sin(tank.angle) * 18);
      }
    }
  }
}

// Sync PIXI display from tank state; handles hit flash, recoil spring, EMP tick.
export function updateTankVisual(tank, dt) {
  if (tank.empTimer > 0) {
    tank.empTimer -= dt;
    tank.arcTimer -= dt;
    if (tank.arcTimer <= 0) {
      tank.arcTimer = 5 + Math.random() * 6;
      // Electrical arcs crawling over a disabled hull.
      spawnFX(tank.x + (Math.random() - 0.5) * 34, tank.y + (Math.random() - 0.5) * 34, {
        tex: Math.random() < 0.5 ? 'fx:arc' : 'fx:tendril',
        color: 0xffc24a, size: 26 + Math.random() * 16, life: 8 + Math.random() * 6,
        rot: Math.random() * Math.PI * 2, blend: 'add', fadeIn: 0.3,
      });
    }
  }
  if (tank.hitFlash > 0) tank.hitFlash -= dt;
  tank.flashSprite.alpha = tank.hitFlash > 0 ? 0.85 : 0;
  tank.flashSprite.rotation = tank.body.rotation;
  if (tank.recoil > 0) tank.recoil = Math.max(0, tank.recoil - 0.7 * dt);

  tank.container.x = tank.x; tank.container.y = tank.y;
  tank.body.rotation = tank.angle + Math.PI / 2;
  tank.turret.rotation = tank.turretAngle;
  const ra = tank.turretAngle - Math.PI / 2;
  tank.turret.x = -Math.cos(ra) * tank.recoil;
  tank.turret.y = -Math.sin(ra) * tank.recoil;

  if (tank.hpBar) {
    tank.hpBar.clear();
    tank.hpBar.rect(-20, -34, (tank.hp / tank.maxHp) * 40, 4);
    tank.hpBar.fill(tank.hp > tank.maxHp * 0.5 ? 0x44cc44 : tank.hp > tank.maxHp * 0.25 ? 0xcccc44 : 0xcc4444);
  }
  // Name labels fade out with distance so a crowded field doesn't turn to text soup.
  if (tank.label) {
    const p = state.player();
    if (p) {
      const d = Math.hypot(tank.x - p.x, tank.y - p.y);
      const t = 1 - (d - TUNING.LABEL_FADE_START) / (TUNING.LABEL_FADE_END - TUNING.LABEL_FADE_START);
      tank.label.alpha = Math.max(0, Math.min(0.9, t * 0.9));
      tank.label.visible = tank.label.alpha > 0.02;
    }
  }
}

// ============================================================
// DAMAGE
// ============================================================
export function applyDamage(tank, dmg, sourceTank) {
  if (!tank.alive) return;
  if (tank.isPlayer && state.game.spawnProtection > 0) return;
  tank.hp -= dmg / tank.armor;
  tank.hitFlash = TUNING.HIT_FLASH_FRAMES;
  if (sourceTank && sourceTank.clanId !== tank.clanId) tank.lastHitBy = sourceTank;
  if (tank.isPlayer) emit('player-hit', { damage: dmg, source: sourceTank });
  if (tank.hp <= 0) killTank(tank);
}

function killTank(tank) {
  const killer = tank.lastHitBy;
  spawnExplosion(tank.x, tank.y, 25);
  stampCrater(tank.x, tank.y, 1.2, true);
  if (tank.drill) cancelDrill(tank, 'died');
  // Whatever was in the hold spills. This is the cost that makes the run home
  // tense: an XP number nobody watches is not a consequence, a lost load is.
  const dropped = dropCargo(tank);
  emit('kill', { victim: tank, killer, cargoDropped: dropped });
  if (tank.isPlayer) {
    tank.alive = false;
    tank.container.visible = false;
    state.game.lastDeathCargo = dropped;
    emit('player-died', {});
    // main.js owns the rest of the death flow (mode change, countdown, respawn)
  } else {
    spawnPickup(tank.x, tank.y);
    removeTank(tank);
  }
}

// Scatter the hold as salvage crates. Only CARGO_DROP_FRAC survives the
// explosion — a full recovery would make dying free as long as you drove back.
function dropCargo(tank) {
  const total = cargoTotal(tank);
  if (total <= 0) return 0;
  const kept = Math.floor(total * TUNING.CARGO_DROP_FRAC);
  const c = tank.cargo;
  let left = kept;
  // Typed units drop as typed crates so a lost EM Pulse cache is recoverable as
  // one, not smeared into a generic pile.
  for (let i = 0; i < c.per.length && left > 0; i++) {
    const take = Math.min(c.per[i], left);
    if (take >= 1) { spawnPickup(tank.x, tank.y, 'material', Math.floor(take), i); left -= take; }
  }
  while (left >= 1) {
    const chunk = Math.min(left, 4);
    spawnPickup(tank.x, tank.y, 'material', Math.floor(chunk), null);
    left -= chunk;
  }
  tank.cargo = makeCargo();
  return kept;
}

export function applyEMP(tank, duration) {
  // Respect spawn protection: getting perma-locked the instant you redeploy is
  // not a fight, it's a punishment.
  if (tank.isPlayer && state.game.spawnProtection > 0) return;
  // Refresh rather than stack, so overlapping pulses can't chain a lockdown.
  tank.empTimer = Math.max(tank.empTimer, duration);
  emit('emp', { tank });
  spawnEMPEffect(tank.x, tank.y);
}

// ============================================================
// WEAPON FIRE
// ============================================================
function shotClockIndex(weapon) { return weapon.id ?? 0; }

// The AUTOLOADER upgrade and the NPC skill tiers both work by scaling reload, so
// every cooldown check has to go through here rather than reading weapon.reload.
// The HUD's cooldown wipe uses it too, or the bar would disagree with the gun.
export function reloadOf(tank, weapon) {
  return weapon.reload * (tank?.reloadMult ?? 1);
}

export function canFire(tank, weapon) {
  const last = tank.lastShotPer ? tank.lastShotPer[shotClockIndex(weapon)] : tank.lastShot;
  if (state.game.time - last <= reloadOf(tank, weapon)) return false;
  if (tank.empTimer > 0) return false;
  // NPCs shoot freely; only the player is on an ammo economy.
  if (tank.isPlayer) {
    if (tank.fuel < weapon.fuelCost) return false;
    if (weapon.maxAmmo && (tank.ammo?.[shotClockIndex(weapon)] ?? 0) < 1) return false;
  }
  return true;
}


export function fireWeapon(tank, weapon, angle) {
  if (!canFire(tank, weapon)) return false;
  tank.lastShot = state.game.time;
  if (tank.lastShotPer) tank.lastShotPer[shotClockIndex(weapon)] = state.game.time;
  if (tank.isPlayer) {
    tank.fuel = Math.max(0, tank.fuel - weapon.fuelCost);
    if (weapon.maxAmmo) tank.ammo[shotClockIndex(weapon)] -= 1;
    state.camera.trauma = Math.min(1, state.camera.trauma + (weapon.type === 'emp' ? 0.3 : 0.06));
  }

  spawnProjectile(tank.x, tank.y, angle, weapon, tank);

  if (weapon.type !== 'mine') {
    tank.recoil = weapon.type === 'emp' ? 8 : 5;
    muzzleFlash(tank.x + Math.cos(angle) * 30, tank.y + Math.sin(angle) * 30, angle, weapon);
  }
  emit('shot-fired', { tank, weapon });
  return true;
}

function muzzleFlash(x, y, angle, weapon) {
  spawnFX(x, y, {
    tex: 'fx:muzzle_flash', color: weapon.color, size: 34 + weapon.size * 3,
    life: 5, rot: angle + Math.PI / 2, blend: 'add', grow: 0.09,
  });
  spawnFX(x, y, {
    tex: 'fx:glow_hot', color: 0xfff0c0, size: 26, life: 6, blend: 'add', grow: -0.02,
  });
  for (let i = 0; i < 3; i++) {
    const a = angle + (Math.random() - 0.5) * 0.9;
    const s = 1.5 + Math.random() * 2.5;
    spawnFX(x, y, {
      tex: 'fx:sparks_a', color: 0xffd070, size: 12 + Math.random() * 10,
      life: 10 + Math.random() * 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      rot: a, spin: 0.1, blend: 'add',
    });
  }
}

// ============================================================
// EM PULSE — a shot that bursts where it lands
// ============================================================
// Called with the burst point, not the shooter: the round travels, so the
// detonation happens wherever it stopped.
function detonatePulse(x, y, weapon, shooter, clanId) {
  const R = weapon.pulseRadius;

  // Two expanding rings and a spray of pixels. The rings stay thin and the solid
  // glows stay small — a big additive disc just white-washes the whole screen and
  // you lose the fight you were in the middle of.
  spawnFX(x, y, {
    tex: 'fx:shockwave_ring', color: 0xffc23a, size: 70, life: 24,
    blend: 'add', grow: (R * 2 - 70) / 24 / 70, alpha: 0.75,
  });
  spawnFX(x, y, {
    tex: 'fx:shockwave_wide', color: 0xffe07a, size: 50, life: 16,
    blend: 'add', grow: (R * 1.15 - 50) / 16 / 50, alpha: 0.4,
  });
  spawnFX(x, y, {
    tex: 'fx:sunburst', color: 0xffd450, size: R * 0.45, life: 13,
    blend: 'add', spin: 0.02, alpha: 0.55,
  });
  spawnFX(x, y, {
    tex: 'fx:rays_32', color: 0xffe680, size: R * 0.85, life: 11,
    blend: 'add', spin: -0.015, alpha: 0.4,
  });
  spawnFX(x, y, {
    tex: 'fx:sparkle_burst', color: 0xffcc33, size: R * 1.25, life: 24,
    blend: 'add', spin: 0.008, alpha: 0.8,
  });
  // The "pixels" — this is the part that should read, so there are a lot of them
  // and they carry most of the alpha budget.
  for (let i = 0; i < 130; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 4 + Math.random() * 14;
    spawnFX(x, y, {
      tex: Math.random() < 0.5 ? 'fx:sparks_b' : 'fx:star_5pt',   // scatter pixels
      color: Math.random() < 0.5 ? 0xffa800 : 0xffe94a,
      size: 7 + Math.random() * 15, life: 16 + Math.random() * 26,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.3,
      drag: 0.945, blend: 'add',
    });
  }

  // Only the nearest few targets go down, and the further out you are the shorter
  // it lasts — one pulse should not neutralise a whole field.
  const hits = [];
  for (const t of state.tanks) {
    if (!t.alive || t === shooter || t.clanId === clanId) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d <= R) hits.push({ t, d });
  }
  hits.sort((a, b) => a.d - b.d);
  for (const { t, d } of hits.slice(0, weapon.maxTargets)) {
    const k = 1 - d / R;
    applyDamage(t, weapon.damage, shooter);
    if (t.alive) applyEMP(t, weapon.empMinDuration + (weapon.empDuration - weapon.empMinDuration) * k);
  }
  emit('pulse', { x, y, radius: R, hit: Math.min(hits.length, weapon.maxTargets) });
}

// ============================================================
// PROJECTILES
// ============================================================
export function spawnProjectile(x, y, angle, weapon, shooter) {
  const clanId = shooter ? shooter.clanId : -1;

  if (weapon.type === 'mine') {
    const g = new PIXI.Sprite(getTexture('shot:mine'));
    g.anchor.set(0.5);
    const light = new PIXI.Graphics();
    light.circle(0, -3, 1.8); light.fill(0xff3333);
    light.visible = false;
    g.addChild(light);
    g.x = x; g.y = y;
    state.layers.projectiles.addChild(g);
    state.mines.push({ graphic: g, light, x, y, damage: weapon.damage, clanId, ownerTank: shooter,
                       size: weapon.size, life: 600, armed: false, armTimer: 30, blink: 0 });
    emit('mine-planted', {});
    return;
  }

  const g = new PIXI.Sprite(getTexture(`shot:${weapon.type}`));
  g.anchor.set(0.5);
  g.scale.set(weapon.size / 6);
  g.rotation = angle + Math.PI / 2;
  g.x = x + Math.cos(angle) * 30;
  g.y = y + Math.sin(angle) * 30;
  state.layers.projectiles.addChild(g);

  const isNPC = shooter && !shooter.isPlayer && !shooter.isTurret;
  const dmgMult = shooter
    ? (shooter.isPlayer ? shooter.dmgMult : (shooter.isTurret ? 1 : TUNING.NPC_DAMAGE_MULT))
    : 1;
  state.projectiles.push({
    graphic: g, vx: Math.cos(angle) * weapon.speed, vy: Math.sin(angle) * weapon.speed,
    damage: weapon.damage * dmgMult,
    life: weapon.maxLife || 120, clanId, ownerTank: shooter,
    size: weapon.size, type: weapon.type, isNPC, color: weapon.color,
    bounces: weapon.bounces || 0, turnRate: weapon.turnRate || 0,
    seekRange: weapon.seekRange || 300,
    blastRadius: weapon.blastRadius || 0, empDuration: weapon.empDuration || 0,
    pulse: weapon.pulseRadius ? weapon : null,   // detonate on impact
    trail: weapon.trail || null, trailPts: [], smokeTimer: 0,
  });
}

// Every way an EM Pulse round can stop routes through here.
function endProjectile(p) {
  if (p.pulse) detonatePulse(p.graphic.x, p.graphic.y, p.pulse, p.ownerTank, p.clanId);
  else if (p.blastRadius > 0) blast(p);
  else impactPuff(p);
}

function blast(p) {
  spawnExplosion(p.graphic.x, p.graphic.y, 15);
  stampCrater(p.graphic.x, p.graphic.y, 1);
  spawnFX(p.graphic.x, p.graphic.y, {
    tex: 'fx:shockwave', color: 0xffa030, size: 40, life: 16, blend: 'add',
    grow: (p.blastRadius * 2 - 40) / 16 / 40,
  });
  for (const t of state.tanks) {
    if (!t.alive || t.clanId === p.clanId) continue;
    if (Math.hypot(p.graphic.x - t.x, p.graphic.y - t.y) < p.blastRadius) {
      applyDamage(t, p.damage, p.ownerTank);
    }
  }
}

function removeProjectile(i) {
  const p = state.projectiles[i];
  p.graphic.parent?.removeChild(p.graphic);
  state.projectiles.splice(i, 1);
}

// One shared Graphics for every ribbon — redrawn each frame, so trails cost one
// draw call regardless of how many shots are in the air.
let trailGfx = null;
function ensureTrailGfx() {
  if (trailGfx && trailGfx.parent) return trailGfx;
  trailGfx = new PIXI.Graphics();
  trailGfx.blendMode = 'add';
  state.layers.projectiles.addChildAt(trailGfx, 0);
  return trailGfx;
}

function drawTrails() {
  const g = ensureTrailGfx();
  g.clear();
  for (const p of state.projectiles) {
    const pts = p.trailPts;
    if (!p.trail || pts.length < 3) continue;
    const n = pts.length;
    const half = p.trail.w / 2;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[Math.min(i + 1, n - 1)];
      let dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const t = 1 - i / (n - 1);
      const w = half * t * t;             // quadratic taper reads smoother than linear
      left.push(a.x + nx * w, a.y + ny * w);
      right.push(a.x - nx * w, a.y - ny * w);
    }
    g.moveTo(left[0], left[1]);
    for (let i = 2; i < left.length; i += 2) g.lineTo(left[i], left[i + 1]);
    for (let i = right.length - 2; i >= 0; i -= 2) g.lineTo(right[i], right[i + 1]);
    g.closePath();
    g.fill({ color: p.trail.color, alpha: 0.5 });
  }
}

export function updateProjectiles(dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];

    if (p.type === 'homing') {
      let closest = null, closestDist = p.seekRange;
      for (const t of state.tanks) {
        if (!t.alive || t.clanId === p.clanId) continue;
        const d = Math.hypot(t.x - p.graphic.x, t.y - p.graphic.y);
        if (d < closestDist) { closest = t; closestDist = d; }
      }
      if (closest) {
        const desired = Math.atan2(closest.y - p.graphic.y, closest.x - p.graphic.x);
        const current = Math.atan2(p.vy, p.vx);
        let diff = desired - current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), p.turnRate * dt);
        const newAngle = current + turn;
        const spd = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(newAngle) * spd;
        p.vy = Math.sin(newAngle) * spd;
      }
    }

    p.graphic.x += p.vx * dt;
    p.graphic.y += p.vy * dt;
    p.graphic.rotation = Math.atan2(p.vy, p.vx) + Math.PI / 2;
    p.life -= dt;

    // Trail history + textured smoke for the missiles
    if (p.trail) {
      p.trailPts.unshift({ x: p.graphic.x, y: p.graphic.y });
      if (p.trailPts.length > TUNING.TRAIL_POINTS) p.trailPts.pop();
      if (p.trail.smoke > 0) {
        p.smokeTimer -= dt;
        if (p.smokeTimer <= 0) {
          p.smokeTimer = TUNING.SMOKE_INTERVAL;
          spawnFX(p.graphic.x, p.graphic.y, {
            tex: Math.random() < 0.5 ? 'fx:smoke_a' : 'fx:smoke_b',
            color: p.type === 'homing' ? 0xd8d0d8 : 0x6e5a4a,
            size: 12 + Math.random() * 8, life: 26 + Math.random() * 18,
            vx: -p.vx * 0.06 + (Math.random() - 0.5) * 0.3,
            vy: -p.vy * 0.06 + (Math.random() - 0.5) * 0.3,
            rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.03,
            grow: 0.035, alpha: p.trail.smoke,
          });
        }
      }
    }

    let bounced = false;
    if (p.type === 'ricochet' && p.bounces > 0 && !isPassable(p.graphic.x, p.graphic.y)) {
      // Rewind to the last known-good spot before reflecting. Reflecting in place
      // left the round sitting inside the wall, so it ping-ponged there and burned
      // every bounce in a few frames without ever visibly bouncing.
      const prevX = p.graphic.x - p.vx * dt, prevY = p.graphic.y - p.vy * dt;
      p.graphic.x = prevX; p.graphic.y = prevY;

      const blockedX = !isPassable(prevX + p.vx * dt, prevY);
      const blockedY = !isPassable(prevX, prevY + p.vy * dt);
      if (blockedX) p.vx = -p.vx;
      if (blockedY) p.vy = -p.vy;
      if (!blockedX && !blockedY) { p.vx = -p.vx; p.vy = -p.vy; }  // inside corner

      p.graphic.x += p.vx * dt; p.graphic.y += p.vy * dt;
      // If even the reflected step is blocked, back off to the safe spot and let
      // the next frame retry rather than tunnelling into geometry.
      if (!isPassable(p.graphic.x, p.graphic.y)) { p.graphic.x = prevX; p.graphic.y = prevY; }

      p.bounces--;
      bounced = true;
      p.trailPts.length = 0;                    // don't smear the ribbon across the bounce
      spawnFX(p.graphic.x, p.graphic.y, {
        tex: 'fx:star_5pt', color: 0xbdfaff, size: 22, life: 8, blend: 'add',
        rot: Math.random() * Math.PI,
      });
      for (let k = 0; k < 4; k++) {
        const a = Math.random() * Math.PI * 2;
        spawnFX(p.graphic.x, p.graphic.y, {
          tex: 'fx:sparks_a', color: 0x9ff4ff, size: 9 + Math.random() * 7, life: 9,
          vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5, rot: a, blend: 'add',
        });
      }
      emit('ricochet', { x: p.graphic.x, y: p.graphic.y });
    }

    // Anything that didn't just bounce stops at terrain. Guarding on `bounced`
    // matters: without it a round that spent its last bounce was deleted in the
    // same frame it bounced.
    if (!bounced && !isPassable(p.graphic.x, p.graphic.y)) {
      endProjectile(p);
      removeProjectile(i);
      continue;
    }

    if (p.life <= 0) {
      // A pulse that reaches the end of its flight still bursts; a plain shell
      // just fizzles out.
      if (p.pulse || p.blastRadius > 0) endProjectile(p);
      removeProjectile(i);
      continue;
    }

    // Hit detection vs all tanks of other clans
    let hit = false;
    for (const t of state.tanks) {
      if (!t.alive || t.clanId === p.clanId) continue;
      if (Math.hypot(p.graphic.x - t.x, p.graphic.y - t.y) < 22) {
        applyDamage(t, p.damage, p.ownerTank);
        if (p.empDuration > 0) applyEMP(t, p.empDuration);
        spawnExplosion(p.graphic.x, p.graphic.y, 8);
        if (p.blastRadius > 0) {
          for (const t2 of state.tanks) {
            if (!t2.alive || t2 === t || t2.clanId === p.clanId) continue;
            if (Math.hypot(p.graphic.x - t2.x, p.graphic.y - t2.y) < p.blastRadius) {
              applyDamage(t2, p.damage * 0.5, p.ownerTank);
            }
          }
        }
        removeProjectile(i);
        hit = true;
        break;
      }
    }
    if (hit) continue;
  }
  drawTrails();
}

function impactPuff(p) {
  spawnFX(p.graphic.x, p.graphic.y, {
    tex: 'fx:burst_a', color: p.color || 0xffbb55, size: 18 + p.size * 2, life: 9,
    blend: 'add', grow: 0.06, rot: Math.random() * Math.PI * 2,
  });
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    spawnFX(p.graphic.x, p.graphic.y, {
      tex: 'fx:sparks_a', color: 0xd8b070, size: 8 + Math.random() * 8, life: 12,
      vx: Math.cos(a) * 1.8, vy: Math.sin(a) * 1.8, rot: a, drag: 0.9,
    });
  }
}

// ============================================================
// MINES
// ============================================================
export function updateMines(dt) {
  for (let i = state.mines.length - 1; i >= 0; i--) {
    const m = state.mines[i];
    m.life -= dt;
    if (m.armTimer > 0) {
      m.armTimer -= dt;
      if (m.armTimer <= 0) emit('mine-armed', {});
      continue;
    }
    m.armed = true;
    m.blink += dt;
    m.light.visible = (m.blink % 60) < 8;

    let triggered = false;
    for (const t of state.tanks) {
      if (!t.alive || t.clanId === m.clanId) continue;
      if (Math.hypot(m.x - t.x, m.y - t.y) < 30) {
        applyDamage(t, m.damage, m.ownerTank);
        triggered = true;
        break;
      }
    }
    if (triggered || m.life <= 0) {
      spawnExplosion(m.x, m.y, 15);
      stampCrater(m.x, m.y, 1);
      m.graphic.parent?.removeChild(m.graphic);
      state.mines.splice(i, 1);
    }
  }
}

// ============================================================
// PARTICLES — textured sprites from the Reactorcore pack
// ============================================================
// opts: tex, color, size, life, vx, vy, rot, spin, grow, drag, blend, alpha, fadeIn
export function spawnFX(x, y, opts) {
  if (state.particles.length >= MAX_PARTICLES) {
    const old = state.particles.shift();
    old.graphic.parent?.removeChild(old.graphic);
  }
  const s = new PIXI.Sprite(getTexture(opts.tex || 'fx:glow_soft'));
  s.anchor.set(0.5);
  s.x = x; s.y = y;
  s.tint = opts.color ?? 0xffffff;
  s.rotation = opts.rot ?? 0;
  const size = opts.size ?? 16;
  s.scale.set(size / s.texture.width);
  if (opts.blend) s.blendMode = opts.blend;
  const alpha = opts.alpha ?? 1;
  s.alpha = opts.fadeIn ? 0 : alpha;
  state.layers.particles.addChild(s);

  const life = opts.life ?? 20;
  state.particles.push({
    graphic: s,
    vx: opts.vx ?? 0, vy: opts.vy ?? 0,
    spin: opts.spin ?? 0, grow: opts.grow ?? 0, drag: opts.drag ?? 1,
    life, maxLife: life, alpha, fadeIn: opts.fadeIn ?? 0,
  });
}

// Kept for callers that just want a coloured speck.
export function spawnParticle(x, y, color, size, life) {
  const a = Math.random() * Math.PI * 2, spd = 1 + Math.random() * 3;
  spawnFX(x, y, {
    tex: 'fx:glow_soft', color, size: size * 4, life,
    vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, blend: 'add', drag: 0.96,
  });
}

function spawnDust(x, y) {
  spawnFX(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, {
    tex: Math.random() < 0.5 ? 'fx:cloud' : 'fx:smoke_a',
    color: 0xd0b070, size: 14 + Math.random() * 10, life: 24,
    vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
    rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.02,
    grow: 0.03, alpha: 0.4,
  });
}

const EXPLOSION_TEX = ['fx:explosion_a', 'fx:explosion_b', 'fx:explosion_c'];

export function spawnExplosion(x, y, count) {
  const big = count >= 15;
  const scale = big ? 1 : 0.5;

  // Core fireball
  spawnFX(x, y, {
    tex: EXPLOSION_TEX[Math.floor(Math.random() * 3)],
    color: 0xffb347, size: 40 * scale, life: big ? 22 : 14,
    rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.02,
    blend: 'add', grow: 0.075,
  });
  spawnFX(x, y, {
    tex: 'fx:glow_hot', color: 0xfff2c0, size: 30 * scale, life: big ? 12 : 7,
    blend: 'add', grow: 0.1,
  });
  if (big) {
    spawnFX(x, y, {
      tex: 'fx:shockwave_ring', color: 0xffd9a0, size: 30, life: 18, blend: 'add', grow: 0.36,
    });
    spawnFX(x, y, {
      tex: 'fx:fire_broad', color: 0xff7a20, size: 44, life: 20,
      rot: Math.random() * Math.PI * 2, blend: 'add', grow: 0.05,
    });
  }

  // Sparks and embers
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, spd = (1 + Math.random() * 4) * scale;
    spawnFX(x, y, {
      tex: Math.random() < 0.6 ? 'fx:sparks_a' : 'fx:embers',
      color: [0xff4400, 0xffaa00, 0xffcc44, 0xff6600][Math.floor(Math.random() * 4)],
      size: (10 + Math.random() * 14) * scale, life: 15 + Math.random() * 20,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      rot: a, spin: (Math.random() - 0.5) * 0.2, drag: 0.95, blend: 'add',
    });
  }

  // Rolling smoke, and debris only for the big ones
  const puffs = big ? 6 : 2;
  for (let i = 0; i < puffs; i++) {
    const a = Math.random() * Math.PI * 2;
    spawnFX(x, y, {
      tex: Math.random() < 0.5 ? 'fx:smoke_b' : 'fx:cloud',
      color: 0x4a4038, size: (20 + Math.random() * 18) * scale, life: 40 + Math.random() * 30,
      vx: Math.cos(a) * 0.5, vy: Math.sin(a) * 0.5,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.02,
      grow: 0.05, alpha: 0.55,
    });
  }
  if (big) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2, spd = 2 + Math.random() * 4;
      spawnFX(x, y, {
        tex: Math.random() < 0.5 ? 'fx:debris_a' : 'fx:debris_b',
        color: 0x3a3028, size: 12 + Math.random() * 12, life: 30 + Math.random() * 20,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.3, drag: 0.93,
      });
    }
    spawnFX(x, y, {
      tex: 'fx:debris_scatter', color: 0x2e2620, size: 70, life: 34, alpha: 0.7,
      rot: Math.random() * Math.PI * 2, grow: 0.03,
    });
  }

  emit('explosion', { x, y, big });
  // Screen shake scaled by distance to the player
  const p = state.player();
  if (p) {
    const d = Math.hypot(x - p.x, y - p.y);
    const amount = (big ? 0.25 : 0.1) * Math.max(0, 1 - d / 600);
    state.camera.trauma = Math.min(1, state.camera.trauma + amount);
  }
}

export function spawnEMPEffect(x, y) {
  spawnFX(x, y, { tex: 'fx:impact_ring', color: 0xffc24a, size: 30, life: 14, blend: 'add', grow: 0.22 });
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, spd = 1 + Math.random() * 2.5;
    spawnFX(x, y, {
      tex: 'fx:sparks_b', color: 0xffd257, size: 9 + Math.random() * 9,
      life: 18 + Math.random() * 14, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      rot: a, spin: 0.15, drag: 0.94, blend: 'add',
    });
  }
}

export function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    const g = p.graphic;
    g.x += p.vx * dt; g.y += p.vy * dt;
    if (p.drag !== 1) { p.vx *= Math.pow(p.drag, dt); p.vy *= Math.pow(p.drag, dt); }
    if (p.spin) g.rotation += p.spin * dt;
    if (p.grow) {
      const s = Math.max(0.001, g.scale.x + p.grow * dt);
      g.scale.set(s);
    }
    p.life -= dt;

    const t = p.life / p.maxLife;                  // 1 -> 0 over the lifetime
    if (p.fadeIn && t > 1 - p.fadeIn) {
      g.alpha = p.alpha * ((1 - t) / p.fadeIn);    // brief ramp in
    } else {
      g.alpha = p.alpha * Math.max(0, t);
    }

    if (p.life <= 0) {
      g.parent?.removeChild(g);
      state.particles.splice(i, 1);
    }
  }
}

// ============================================================
// PICKUPS — visible crates dropped by destroyed tanks
// ============================================================
// Kill salvage pays out as AMMO on the spot, not as cargo. That is deliberate: it
// is the safety valve that stops the hauling economy from ever bricking you far
// from base with an empty magazine. Hauling is the efficient path, fighting is the
// desperate one, and both work.
export function spawnPickup(x, y, forceType = null, amount = null, weaponId = null) {
  const type = forceType || (Math.random() < 0.5 ? 'fuel' : 'material');
  const s = new PIXI.Sprite(getTexture(`crate:${type}`));
  s.anchor.set(0.5);
  // Scatter so a dropped hold reads as wreckage, not one crate stacked six deep.
  const a = Math.random() * Math.PI * 2, r = amount != null ? 8 + Math.random() * 26 : 0;
  s.x = x + Math.cos(a) * r; s.y = y + Math.sin(a) * r;
  if (weaponId != null) s.tint = WEAPONS[weaponId].color;
  state.layers.projectiles.addChild(s);
  state.pickups.push({
    graphic: s, x: s.x, y: s.y, type, weaponId,
    amount: amount != null ? amount : 2 + Math.floor(Math.random() * 3),
    life: TUNING.PICKUP_DESPAWN_FRAMES,
  });
}

export function updatePickups(dt) {
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const pk = state.pickups[i];
    pk.life -= dt;
    if (pk.life < 120) pk.graphic.alpha = pk.life / 120;
    let taken = false;
    for (const t of state.tanks) {
      if (!t.alive) continue;
      if (Math.hypot(pk.x - t.x, pk.y - t.y) < TUNING.PICKUP_RADIUS) {
        let gained = null;
        if (pk.type === 'fuel') t.fuel = Math.min(t.maxFuel, t.fuel + pk.amount);
        else if (pk.weaponId != null) gained = addAmmoTyped(t, pk.weaponId, pk.amount);
        else gained = addAmmo(t, pk.amount);
        if (t.isPlayer) {
          emit('pickup', { type: pk.type, amount: pk.amount, weaponId: pk.weaponId, gained, x: pk.x, y: pk.y });
          spawnFX(pk.x, pk.y, {
            tex: 'fx:halo_ring',
            color: pk.type === 'fuel' ? 0xffcc44 : (pk.weaponId != null ? WEAPONS[pk.weaponId].color : 0x55aaee),
            size: 22, life: 14, blend: 'add', grow: 0.14,
          });
        }
        taken = true;
        break;
      }
    }
    if (taken || pk.life <= 0) {
      pk.graphic.parent?.removeChild(pk.graphic);
      state.pickups.splice(i, 1);
    }
  }
}

// ============================================================
// BASE DEFENSE TURRETS — engage nearest hostile clan tank with LOS
// ============================================================
const TURRET_WEAPON = {
  id: 0, speed: 6, damage: TUNING.TURRET_DAMAGE, size: 4, type: 'bullet',
  reload: 0, fuelCost: 0, maxLife: 130,
  trail: { w: 3, life: 8, color: 0xffd979, smoke: 0 },
};

export function updateBaseTurrets(dt) {
  for (const base of state.bases) {
    for (const t of base.turrets) {
      let closest = null, closestDist = TUNING.TURRET_RANGE;
      for (const tgt of state.tanks) {
        if (!tgt.alive || tgt.clanId === base.clanId) continue;
        const d = Math.hypot(tgt.x - t.x, tgt.y - t.y);
        if (d < closestDist && hasLOS(t.x, t.y, tgt.x, tgt.y)) { closest = tgt; closestDist = d; }
      }
      if (closest) {
        const aim = Math.atan2(closest.y - t.y, closest.x - t.x);
        t.barrel.rotation = aim + Math.PI / 2;
        t.shootTimer -= dt;
        if (t.shootTimer <= 0) {
          t.shootTimer = 60 + Math.random() * 30;
          const w = { ...TURRET_WEAPON, color: base.clan.color };
          spawnProjectile(t.x, t.y, aim, w, { clanId: base.clanId, isPlayer: false, isTurret: true });
          muzzleFlash(t.x + Math.cos(aim) * 24, t.y + Math.sin(aim) * 24, aim, w);
        }
      }
    }
  }
}
