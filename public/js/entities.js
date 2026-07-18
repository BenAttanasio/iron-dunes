// Tanks (player + NPC share one shape), projectiles, mines, particles,
// pickups, base turrets, damage resolution, and movement physics.

import { GRID, WORLD_W, WORLD_H, CLANS, WEAPONS, TUNING } from './config.js';
import { getTexture, tankTextureKey } from './textures.js';
import * as state from './state.js';
import { emit } from './events.js';
import { isPassable, hasLOS, stampTrack, stampCrater } from './world.js';

const PIXI = window.PIXI;

// ============================================================
// TANK FACTORY
// ============================================================
export function createTank({ clanId, model, x, y, isPlayer = false }) {
  const clan = CLANS[clanId];
  const scale = model ? model.scale : 0.9;
  const cont = new PIXI.Container();
  const body = new PIXI.Sprite(getTexture(tankTextureKey(clan.color, scale)));
  body.anchor.set(0.5);
  const flash = new PIXI.Sprite(getTexture(`tankwhite:${scale}`));
  flash.anchor.set(0.5);
  flash.alpha = 0;
  const turret = new PIXI.Sprite(getTexture('turret'));
  turret.anchor.set(0.5, 0.8);
  if (!isPlayer) turret.scale.set(0.9);
  cont.addChild(body); cont.addChild(flash); cont.addChild(turret);

  const tank = {
    isPlayer, clanId, clan, model,
    x, y, vx: 0, vy: 0,
    angle: Math.random() * Math.PI * 2, turretAngle: 0,
    maxSpeed: model ? model.speed : TUNING.NPC_SPEED,
    turnRate: model ? model.turnRate : 0.15,
    hp: model ? model.hp : TUNING.NPC_HP,
    maxHp: model ? model.hp : TUNING.NPC_HP,
    armor: model ? model.armor : 1,
    dmgMult: model ? model.dmgMult : 1,
    fuel: 30, maxFuel: 40,
    materials: 30, maxMaterials: 40,
    weaponIndex: 0, lastShot: -99999,
    empTimer: 0, hitFlash: 0, recoil: 0,
    trackDist: 0, dustTimer: 0,
    alive: true, lastHitBy: null, inBase: false,
    container: cont, body, turret, flashSprite: flash,
    hpBar: null, label: null,
    ai: null,
  };

  if (!isPlayer) {
    const hpBg = new PIXI.Graphics();
    hpBg.rect(-20, -32, 40, 4); hpBg.fill({ color: 0x000000, alpha: 0.6 });
    cont.addChild(hpBg);
    const hpBar = new PIXI.Graphics();
    cont.addChild(hpBar);
    const label = new PIXI.Text({
      text: clan.short,
      style: { fontSize: 9, fill: 0xffffff, fontFamily: 'monospace' }
    });
    label.anchor.set(0.5); label.y = -39; label.alpha = 0.8;
    cont.addChild(label);
    tank.hpBar = hpBar; tank.label = label;
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
// MOVEMENT PHYSICS — shared by player and NPCs
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
      const off = 12 * (tank.model ? tank.model.scale : 0.9);
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
    if (Math.random() < 0.15 * dt) spawnParticle(tank.x, tank.y, 0x4488ff, 1 + Math.random() * 2, 15);
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
    tank.hpBar.rect(-20, -32, (tank.hp / tank.maxHp) * 40, 4);
    tank.hpBar.fill(tank.hp > tank.maxHp * 0.5 ? 0x44cc44 : tank.hp > tank.maxHp * 0.25 ? 0xcccc44 : 0xcc4444);
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
  if (tank.isPlayer) emit('player-hit', { damage: dmg });
  if (tank.hp <= 0) killTank(tank);
}

function killTank(tank) {
  const killer = tank.lastHitBy;
  spawnExplosion(tank.x, tank.y, 25);
  stampCrater(tank.x, tank.y, 1.2, true);
  emit('kill', { victim: tank, killer });
  if (tank.isPlayer) {
    tank.alive = false;
    tank.container.visible = false;
    emit('player-died', {});
    // main.js owns the rest of the death flow (mode change, countdown, respawn)
  } else {
    spawnPickup(tank.x, tank.y);
    removeTank(tank);
  }
}

export function applyEMP(tank, duration) {
  tank.empTimer = duration;
  emit('emp', { tank });
  spawnEMPEffect(tank.x, tank.y);
}

// ============================================================
// WEAPON FIRE
// ============================================================
export function canFire(tank, weapon) {
  if (state.game.time - tank.lastShot <= weapon.reload) return false;
  if (tank.empTimer > 0) return false;
  if (tank.isPlayer && (tank.fuel < weapon.fuelCost || tank.materials < weapon.matCost)) return false;
  return true;
}

export function fireWeapon(tank, weapon, angle) {
  if (!canFire(tank, weapon)) return false;
  tank.lastShot = state.game.time;
  if (tank.isPlayer) {
    tank.fuel -= weapon.fuelCost;
    tank.materials -= weapon.matCost;
    state.camera.trauma = Math.min(1, state.camera.trauma + 0.06);
  }
  spawnProjectile(tank.x, tank.y, angle, weapon, tank);
  if (weapon.type !== 'mine') {
    tank.recoil = 5;
    const fx = tank.x + Math.cos(angle) * 30, fy = tank.y + Math.sin(angle) * 30;
    const flash = new PIXI.Sprite(getTexture('flash'));
    flash.anchor.set(0.5);
    flash.x = fx; flash.y = fy;
    flash.blendMode = 'add';
    state.layers.particles.addChild(flash);
    state.particles.push({ graphic: flash, vx: 0, vy: 0, life: 4, maxLife: 4 });
  }
  emit('shot-fired', { tank, weapon });
  return true;
}

// ============================================================
// PROJECTILES
// ============================================================
export function spawnProjectile(x, y, angle, weapon, shooter) {
  const g = new PIXI.Graphics();
  const c = weapon.color;
  const clanId = shooter ? shooter.clanId : -1;

  if (weapon.type === 'mine') {
    g.circle(0, 0, weapon.size + 2); g.fill({ color: 0x000000, alpha: 0.3 });
    g.circle(0, 0, weapon.size); g.fill(0x664422);
    g.circle(0, 0, weapon.size * 0.5); g.fill(0x884400);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
      g.circle(Math.cos(a) * weapon.size * 0.7, Math.sin(a) * weapon.size * 0.7, 2); g.fill(0x553311);
    }
    const light = new PIXI.Graphics();
    light.circle(0, -weapon.size * 0.3, 1.5); light.fill(0xff3333);
    light.visible = false;
    g.addChild(light);
    g.x = x; g.y = y;
    state.layers.projectiles.addChild(g);
    state.mines.push({ graphic: g, light, x, y, damage: weapon.damage, clanId, ownerTank: shooter,
                       size: weapon.size, life: 600, armed: false, armTimer: 30, blink: 0 });
    emit('mine-planted', {});
    return;
  }

  g.circle(0, 0, weapon.size * 2); g.fill({ color: c, alpha: 0.15 });
  g.circle(0, 0, weapon.size); g.fill(c);
  g.circle(0, 0, weapon.size * 0.4); g.fill(0xffffff);
  g.x = x + Math.cos(angle) * 30; g.y = y + Math.sin(angle) * 30;
  state.layers.projectiles.addChild(g);

  const isNPC = shooter && !shooter.isPlayer && !shooter.isTurret;
  const dmgMult = shooter
    ? (shooter.isPlayer ? shooter.dmgMult : (shooter.isTurret ? 1 : TUNING.NPC_DAMAGE_MULT))
    : 1;
  state.projectiles.push({
    graphic: g, vx: Math.cos(angle) * weapon.speed, vy: Math.sin(angle) * weapon.speed,
    damage: weapon.damage * dmgMult,
    life: weapon.maxLife || 120, clanId, ownerTank: shooter,
    size: weapon.size, type: weapon.type, isNPC,
    bounces: weapon.bounces || 0, turnRate: weapon.turnRate || 0,
    blastRadius: weapon.blastRadius || 0, empDuration: weapon.empDuration || 0,
  });
}

function blast(p) {
  spawnExplosion(p.graphic.x, p.graphic.y, 15);
  stampCrater(p.graphic.x, p.graphic.y, 1);
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

export function updateProjectiles(dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];

    if (p.type === 'homing') {
      let closest = null, closestDist = 300;
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
    p.life -= dt;

    if (p.type === 'ricochet' && p.bounces > 0) {
      if (!isPassable(p.graphic.x, p.graphic.y)) {
        const prevX = p.graphic.x - p.vx * dt, prevY = p.graphic.y - p.vy * dt;
        if (isPassable(prevX, p.graphic.y)) p.vy = -p.vy;
        else if (isPassable(p.graphic.x, prevY)) p.vx = -p.vx;
        else { p.vx = -p.vx; p.vy = -p.vy; }
        p.bounces--;
        p.graphic.x += p.vx * dt; p.graphic.y += p.vy * dt;
        spawnParticle(p.graphic.x, p.graphic.y, 0x66ffff, 2, 10);
        emit('ricochet', { x: p.graphic.x, y: p.graphic.y });
      }
    }

    if (p.type !== 'ricochet' && !isPassable(p.graphic.x, p.graphic.y)) {
      if (p.blastRadius > 0) blast(p);
      else spawnExplosion(p.graphic.x, p.graphic.y, 4);
      removeProjectile(i);
      continue;
    }

    if (p.life <= 0) {
      if (p.blastRadius > 0) blast(p);
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
// PARTICLES
// ============================================================
export function spawnParticle(x, y, color, size, life) {
  const g = new PIXI.Graphics(); g.circle(0, 0, size); g.fill(color);
  g.x = x; g.y = y;
  state.layers.particles.addChild(g);
  const a = Math.random() * Math.PI * 2, spd = 1 + Math.random() * 3;
  state.particles.push({ graphic: g, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life, maxLife: life });
}

function spawnDust(x, y) {
  const g = new PIXI.Graphics();
  g.circle(0, 0, 3 + Math.random() * 3);
  g.fill({ color: 0xc4a456, alpha: 0.4 });
  g.x = x + (Math.random() - 0.5) * 10; g.y = y + (Math.random() - 0.5) * 10;
  state.layers.particles.addChild(g);
  state.particles.push({ graphic: g, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, life: 20, maxLife: 20, grow: 0.06 });
}

export function spawnExplosion(x, y, count) {
  const colors = [0xff4400, 0xffaa00, 0xffcc44, 0xff6600];
  for (let i = 0; i < count; i++)
    spawnParticle(x, y, colors[Math.floor(Math.random() * 4)], 2 + Math.random() * 4, 15 + Math.random() * 20);
  emit('explosion', { x, y, big: count >= 15 });
  // Screen shake scaled by distance to the player
  const p = state.player();
  if (p) {
    const d = Math.hypot(x - p.x, y - p.y);
    const amount = (count >= 15 ? 0.25 : 0.1) * Math.max(0, 1 - d / 600);
    state.camera.trauma = Math.min(1, state.camera.trauma + amount);
  }
}

export function spawnEMPEffect(x, y) {
  for (let i = 0; i < 12; i++)
    spawnParticle(x, y, 0x4488ff, 1 + Math.random() * 2, 20 + Math.random() * 15);
}

export function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.graphic.x += p.vx * dt; p.graphic.y += p.vy * dt;
    if (p.grow) p.graphic.scale.set(p.graphic.scale.x + p.grow * dt);
    p.life -= dt;
    p.graphic.alpha = Math.max(0, p.life / p.maxLife);
    if (p.life <= 0) {
      p.graphic.parent?.removeChild(p.graphic);
      state.particles.splice(i, 1);
    }
  }
}

// ============================================================
// PICKUPS — visible crates dropped by destroyed tanks
// ============================================================
export function spawnPickup(x, y) {
  const type = Math.random() < 0.5 ? 'fuel' : 'material';
  const s = new PIXI.Sprite(getTexture(`crate:${type}`));
  s.anchor.set(0.5);
  s.x = x; s.y = y;
  state.layers.projectiles.addChild(s);
  state.pickups.push({ graphic: s, x, y, type, amount: 2 + Math.floor(Math.random() * 3), life: TUNING.PICKUP_DESPAWN_FRAMES });
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
        if (pk.type === 'fuel') t.fuel = Math.min(t.maxFuel, t.fuel + pk.amount);
        else t.materials = Math.min(t.maxMaterials, t.materials + pk.amount);
        if (t.isPlayer) emit('pickup', { type: pk.type, amount: pk.amount });
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
  speed: 6, damage: TUNING.TURRET_DAMAGE, size: 3, type: 'bullet',
  reload: 0, fuelCost: 0, matCost: 0,
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
          spawnProjectile(t.x, t.y, aim,
            { ...TURRET_WEAPON, color: base.clan.color },
            { clanId: base.clanId, isPlayer: false, isTurret: true });
        }
      }
    }
  }
}
