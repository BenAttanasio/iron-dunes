// Boot, container/layer setup, mode transitions, and the game loop.

import { GRID, WORLD_W, WORLD_H, CLANS, TANK_MODELS, WEAPONS, BASE_POSITIONS, TUNING } from './config.js';
import * as state from './state.js';
import { on, emit } from './events.js';
import { initInput } from './input.js';
import {
  generateMap, buildWorld, buildBases, buildResourceNodes, buildWaypointGraph,
  updateResourceNodes, nearbyNode, updateDecals, inBase,
  nodeInDrillRange, beginDrill, advanceDrill, cancelDrill,
  cargoTotal, clearCargo, makeCargo,
} from './world.js';
import {
  createTank, moveTank, updateTankVisual, fireWeapon,
  updateProjectiles, updateMines, updateParticles, updatePickups, updateBaseTurrets,
} from './entities.js';
import {
  spawnInitialPopulation, updateNPCs, updateWaves, resetWaves,
  updateNotoriety, resetNotoriety,
} from './npc.js';
import { applyUpgrades, updateSurvival, fallbackModelIndex } from './progression.js';
import { initAudio, updateAudio } from './audio.js';
import { initHUD, layoutHUD, updateHUD, setPaused, resetHUD } from './hud.js';
import { initMenu, showMenu, hideMenu } from './menu.js';
import { initServiceRecord, toggleServiceRecord, isServiceRecordOpen, closeServiceRecord } from './rankscreen.js';
import { loadAssets } from './assets.js';
import { addAmmo, addAmmoTyped, refillAmmo } from './ammo.js';
import { updateFloaters, clearFloaters, spawnFloater, spawnFloaterStack } from './floaters.js';
import * as records from './records.js';

const PIXI = window.PIXI;

// ============================================================
// APP
// ============================================================
const app = new PIXI.Application();
await app.init({
  width: window.innerWidth, height: window.innerHeight,
  // Dark warm brown: with camera overscan a sliver past the world rim can show,
  // and it should read as out-of-bounds shadow rather than more sand.
  backgroundColor: 0x3d2f18, antialias: false,
  resolution: window.devicePixelRatio || 1, autoDensity: true,
  canvas: document.getElementById('game'),
});
app.canvas.style.cursor = 'default';

// ------------------------------------------------------------
// Loading screen, in the same black/green panel language as the HUD. The texture
// generators read the imported detail art synchronously, so nothing may be built
// until loadAssets() resolves.
// ------------------------------------------------------------
const loading = new PIXI.Container();
{
  const bg = new PIXI.Graphics();
  bg.rect(0, 0, app.screen.width, app.screen.height); bg.fill(0x0a0e08);
  const title = new PIXI.Text({
    text: 'IRON DUNES',
    style: { fontSize: 44, fill: 0xccaa44, fontFamily: 'monospace', fontWeight: 'bold' },
  });
  title.anchor.set(0.5);
  title.x = app.screen.width / 2; title.y = app.screen.height / 2 - 62;
  const wordmark = new PIXI.Text({
    text: 'R O G U E   B A T T A L I O N S',
    style: { fontSize: 12, fill: 0x8a7433, fontFamily: 'monospace', fontWeight: 'bold' },
  });
  wordmark.anchor.set(0.5);
  wordmark.x = app.screen.width / 2; wordmark.y = app.screen.height / 2 - 32;
  const status = new PIXI.Text({
    text: 'LOADING ASSETS…',
    style: { fontSize: 13, fill: 0x66aa77, fontFamily: 'monospace' },
  });
  status.anchor.set(0.5);
  status.x = app.screen.width / 2; status.y = app.screen.height / 2 + 4;
  const barBg = new PIXI.Graphics();
  barBg.rect(app.screen.width / 2 - 150, app.screen.height / 2 + 26, 300, 8);
  barBg.fill(0x123012);
  const bar = new PIXI.Graphics();
  loading.addChild(bg, title, wordmark, status, barBg, bar);
  loading.bar = bar; loading.status = status;
  app.stage.addChild(loading);
}

await loadAssets(frac => {
  loading.bar.clear();
  loading.bar.rect(app.screen.width / 2 - 150, app.screen.height / 2 + 26, 300 * frac, 8);
  loading.bar.fill(0x33ff66);
});
loading.status.text = 'BUILDING DESERT…';
// Yield a frame so the status actually paints before the synchronous world build.
await new Promise(r => requestAnimationFrame(r));

const worldContainer = new PIXI.Container();
const hudContainer = new PIXI.Container();
const menuContainer = new PIXI.Container();
// The service record gets its OWN top-level layer, above everything. It used to
// live inside menuContainer, which broke it in both directions and made it
// impossible to ever see: showMenu() starts with removeChildren(), so the first
// menu draw detached it from the stage permanently, and hideMenu() hides that
// container during play, so even before then it could not show over the game.
// Pressing U only appeared to "open the pause menu" because the handler pauses
// first and the record itself never rendered.
const recordContainer = new PIXI.Container();
app.stage.addChild(worldContainer);
app.stage.addChild(hudContainer);
app.stage.addChild(menuContainer);
app.stage.addChild(recordContainer);

// World sub-layers (order matters: decals under tanks under projectiles)
state.layers.decals = new PIXI.Container();
state.layers.tanks = new PIXI.Container();
state.layers.projectiles = new PIXI.Container();
state.layers.particles = new PIXI.Container();
// Payout numbers sit above every effect — they are the point of the dig, and a
// smoke puff must never be the thing that hides them.
state.layers.floaters = new PIXI.Container();

// Static world first, then dynamic layers on top
generateMap();
buildWorld(worldContainer);
buildBases(worldContainer);
worldContainer.addChild(state.layers.decals);
buildResourceNodes(worldContainer);
worldContainer.addChild(state.layers.tanks);
worldContainer.addChild(state.layers.projectiles);
worldContainer.addChild(state.layers.particles);
worldContainer.addChild(state.layers.floaters);
buildWaypointGraph();

initInput(app.canvas);
initHUD(app, hudContainer);
initMenu(app, menuContainer, startGame);
initServiceRecord(app, recordContainer);

app.stage.removeChild(loading);
loading.destroy({ children: true });

window.addEventListener('resize', () => {
  app.renderer.resize(window.innerWidth, window.innerHeight);
  layoutHUD();
});

// ============================================================
// MODE TRANSITIONS
// ============================================================
function clearDynamicEntities() {
  for (const t of [...state.tanks]) {
    t.container.parent?.removeChild(t.container);
  }
  state.tanks.length = 0;
  for (const p of state.projectiles) p.graphic.parent?.removeChild(p.graphic);
  state.projectiles.length = 0;
  for (const m of state.mines) m.graphic.parent?.removeChild(m.graphic);
  state.mines.length = 0;
  for (const p of state.particles) p.graphic.parent?.removeChild(p.graphic);
  state.particles.length = 0;
  for (const pk of state.pickups) pk.graphic.parent?.removeChild(pk.graphic);
  state.pickups.length = 0;
  state.noiseEvents.length = 0;
  clearFloaters();
  // Any node a dead crew was mid-drill on has to be released, or it stays claimed
  // forever and nobody can ever work it again.
  for (const rn of state.resourceNodes) rn.drilledBy = null;
}

function spawnPoint() {
  // BASE_POSITIONS holds the centre cell of the plaza.
  const base = BASE_POSITIONS[CLANS[state.game.selectedClan].baseCorner];
  return { x: base.x * GRID + GRID / 2, y: base.y * GRID + GRID / 2 };
}

function startGame() {
  initAudio(); // first user gesture — safe to create AudioContext
  closeServiceRecord();
  clearDynamicEntities();

  // Models are rank-gated now, so a save pointing at something out of reach (or a
  // v1 save from before gating existed) has to fall back rather than deploy a
  // locked hull.
  state.game.selectedTank = fallbackModelIndex(state.game.selectedTank);
  const model = TANK_MODELS[state.game.selectedTank];
  const sp = spawnPoint();
  const player = createTank({
    clanId: state.game.selectedClan, model, x: sp.x, y: sp.y, isPlayer: true,
  });
  applyUpgrades(player);
  player.fuel = 30;
  player.angle = -Math.PI / 2;

  spawnInitialPopulation();
  resetWaves();
  resetNotoriety();
  resetHUD();
  records.startLife();

  state.camera.x = sp.x - app.screen.width / 2;
  state.camera.y = sp.y - app.screen.height / 2;
  state.camera.trauma = 0;
  state.game.spawnProtection = 0;

  state.game.mode = 'playing';
  hideMenu();
  worldContainer.visible = true;
  hudContainer.visible = true;
  setPaused(false);
  app.canvas.style.cursor = 'crosshair';
  emit('message', { text: 'Deployed. Dig resources, hunt hostiles, rank up.', color: 0x66ffaa });
}

function respawnPlayer() {
  const p = state.player();
  if (!p) return;
  const sp = spawnPoint();
  p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = 0;
  applyUpgrades(p);           // restores full (upgraded) HP
  p.fuel = TUNING.RESPAWN_FUEL;
  // Top magazines up to a floor rather than resetting them — dying shouldn't
  // hand back EM pulses you'd already spent.
  refillAmmo(p, TUNING.RESPAWN_AMMO_FRAC);
  p.empTimer = 0;
  p.alive = true;
  p.drill = null;
  p.cargo = makeCargo();      // the old load is out there as crates now
  p.container.visible = true;
  state.game.spawnProtection = TUNING.SPAWN_PROTECT_MS;
  state.game.mode = 'playing';
  state.camera.x = sp.x - app.screen.width / 2;
  state.camera.y = sp.y - app.screen.height / 2;
  emit('player-respawned', {});
}

on('player-died', () => {
  state.game.mode = 'dead';
  state.game.respawnAt = state.game.time + TUNING.RESPAWN_MS;
  state.camera.trauma = 1;
});

on('pause-toggle', () => {
  if (state.game.mode === 'playing') {
    state.game.mode = 'paused';
    setPaused(true);
  } else if (state.game.mode === 'paused') {
    closeServiceRecord();
    state.game.mode = 'playing';
    setPaused(false);
  }
});

// Esc backs out one layer at a time rather than always toggling pause: from the
// service record it closes that, and only then does it un-pause.
on('escape', () => {
  if (isServiceRecordOpen()) { closeServiceRecord(); return; }
  if (state.game.mode === 'playing' || state.game.mode === 'paused') emit('pause-toggle', {});
});

on('open-service-record', () => {
  // Opening it from live play pauses, so nobody gets shot while reading a table.
  if (state.game.mode === 'playing') {
    state.game.mode = 'paused';
    setPaused(true);
  }
  toggleServiceRecord();
});

on('return-to-menu', () => {
  closeServiceRecord();
  clearDynamicEntities();
  state.game.mode = 'menu';
  setPaused(false);
  worldContainer.visible = false;
  hudContainer.visible = false;
  showMenu();
});

// ------------------------------------------------------------
// DIG PAYOUT FEEDBACK
// ------------------------------------------------------------
// The old dig gave you a sound and nothing else — with a spread refill you could
// not perceive what you'd earned, and if your magazines were near full you got
// literally nothing while the reward chime still played. Now every haul says what
// it was, in world space, above the hole it came out of.
on('dig', ({ node, amount, tank }) => {
  if (!tank || !tank.isPlayer) return;
  if (node.type === 'fuel') {
    spawnFloater(node.x, node.y - 18, `+${Math.round(amount)} FUEL`, { color: 0xffcc44, size: 15 });
  } else if (node.weaponId != null) {
    spawnFloater(node.x, node.y - 18, `+${Math.round(amount)} ${WEAPONS[node.weaponId].name.toUpperCase()} CACHE`,
      { color: WEAPONS[node.weaponId].color, size: 15 });
    spawnFloater(node.x, node.y - 34, 'HAUL IT HOME', { color: 0x88aa88, size: 10, life: 74 });
  } else {
    spawnFloater(node.x, node.y - 18, `+${Math.round(amount)} MATERIALS`, { color: 0x66ccff, size: 15 });
    spawnFloater(node.x, node.y - 34, 'HAUL IT HOME', { color: 0x88aa88, size: 10, life: 74 });
  }
});

on('drill-full', ({ node, tank }) => {
  if (!tank || !tank.isPlayer) return;
  spawnFloater(node.x, node.y - 18,
    node.type === 'fuel' ? 'TANKS FULL' : 'CARGO HOLD FULL', { color: 0xff7744, size: 14 });
});

on('pickup', ({ x, y, gained, type, amount }) => {
  if (type === 'fuel') {
    spawnFloater(x, y - 14, `+${amount} FUEL`, { color: 0xffcc44, size: 12 });
    return;
  }
  if (!gained) return;
  const lines = [];
  for (let i = 0; i < gained.length; i++) {
    if (gained[i] >= 1) {
      lines.push({ text: `+${Math.floor(gained[i])} ${WEAPONS[i].name.toUpperCase()}`, color: WEAPONS[i].color });
    }
  }
  if (lines.length) spawnFloaterStack(x, y - 14, lines, { size: 11, life: 50 });
});

on('vein-depleted', ({ node, tank, xp }) => {
  if (!tank || !tank.isPlayer) return;
  spawnFloater(node.x, node.y - 52, `+${xp} XP`, { color: 0x66ffaa, size: 12, life: 70 });
});

// ============================================================
// PLAYER UPDATE
// ============================================================
function updatePlayer(dt, deltaMS) {
  const p = state.player();
  if (!p || !p.alive) return;

  // Movement input
  let mx = 0, my = 0;
  const keys = state.input.keys;
  if (keys['w'] || keys['arrowup']) my -= 1;
  if (keys['s'] || keys['arrowdown']) my += 1;
  if (keys['a'] || keys['arrowleft']) mx -= 1;
  if (keys['d'] || keys['arrowright']) mx += 1;
  moveTank(p, mx, my, (mx || my) ? 1 : 0, dt);

  // Fuel drain while actually moving
  if (Math.hypot(p.vx, p.vy) > 0.2 && p.fuel > 0) {
    p.fuel = Math.max(0, p.fuel - TUNING.FUEL_DRAIN * dt);
  }

  // Turret follows mouse
  const wmx = state.input.mouseX + state.camera.x;
  const wmy = state.input.mouseY + state.camera.y;
  p.turretAngle = Math.atan2(wmy - p.y, wmx - p.x) + Math.PI / 2;

  updateDrilling(p, deltaMS);

  // Depot regen
  p.inBase = inBase(p);
  if (p.inBase) {
    if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 0.1 * dt);
    if (p.fuel < p.maxFuel) p.fuel = Math.min(p.maxFuel, p.fuel + 0.05 * dt);
    // Slow rearm across all magazines. Deliberately slower than it looks like it
    // should be: at 0.012 a full restock took ~14 s of parking, which was faster
    // than going and digging for it and made the resource loop pointless.
    addAmmo(p, 0.004 * dt);
    bankCargo(p, deltaMS);
  }

  // Fire
  if ((state.input.mouseDown || keys[' ']) && p.empTimer <= 0) {
    fireWeapon(p, WEAPONS[p.weaponIndex], p.turretAngle - Math.PI / 2);
  }
}

// ------------------------------------------------------------
// DRILLING
// ------------------------------------------------------------
// Hold E next to a deposit. Moving breaks it off — that is the whole point: the
// drill is the window in which you are stationary, loud, and worth shooting.
let fullWarned = false;

function updateDrilling(p, deltaMS) {
  const moving = Math.hypot(p.vx, p.vy) > TUNING.DRILL_MOVE_CANCEL;

  if (p.drill) {
    if (!state.input.digHeld) { cancelDrill(p, 'released'); return; }
    if (moving) { cancelDrill(p, 'moved'); return; }
    if (p.empTimer > 0) { cancelDrill(p, 'emp'); return; }
    advanceDrill(p, deltaMS);
    return;
  }

  if (!state.input.digHeld) { fullWarned = false; return; }
  if (moving || p.empTimer > 0) return;
  const rn = nodeInDrillRange(p);
  if (!rn) return;

  // Refuse to start a drill that cannot pay out. A rich vein outlasts one hold, so
  // without this you can spend another seven seconds on a vein you already
  // stripped to your capacity, and only find out at the end.
  const noRoom = rn.type === 'material'
    ? cargoTotal(p) >= p.maxCargo
    : p.fuel >= p.maxFuel;
  if (noRoom) {
    if (!fullWarned) {
      fullWarned = true;
      emit('drill-full', { node: rn, tank: p });
    }
    return;
  }
  fullWarned = false;
  beginDrill(p, rn);
}

// ------------------------------------------------------------
// BANKING — cargo becomes ammo, but only at your own depot
// ------------------------------------------------------------
// Materials used to restock every magazine the instant you dug them, which meant
// the haul was invisible and the trip home meant nothing. They are cargo now, and
// this is the counter they cash out at — worth CARGO_BANK_BONUS more than the same
// units picked up as field salvage, so hauling is the rewarded path.
let bankAccum = 0;

function bankCargo(p, deltaMS) {
  const total = cargoTotal(p);
  if (total <= 0) { bankAccum = 0; return; }
  bankAccum += TUNING.CARGO_BANK_PER_S * (deltaMS / 1000);
  if (bankAccum < 1) return;

  let units = Math.min(Math.floor(bankAccum), total);
  bankAccum -= units;
  const banked = units;

  // Typed cargo cashes out first — it is the part the player went out of their way
  // for, and seeing the EM Pulse magazine move is the payoff.
  const c = p.cargo;
  for (let i = 0; i < c.per.length && units > 0; i++) {
    if (c.per[i] <= 0) continue;
    const take = Math.min(c.per[i], units);
    c.per[i] -= take;
    units -= take;
    const gained = addAmmoTyped(p, i, take, TUNING.CARGO_BANK_BONUS);
    announceGains(p, gained);
  }
  if (units > 0 && c.spread > 0) {
    const take = Math.min(c.spread, units);
    c.spread -= take;
    const gained = addAmmo(p, take, TUNING.CARGO_BANK_BONUS);
    announceGains(p, gained);
  }
  emit('cargo-banked', { units: banked, remaining: cargoTotal(p) });
}

// Roll per-weapon deltas into readable floaters. Fractions accumulate across ticks
// so a slow trickle still eventually shows a whole round rather than nothing.
const gainAccum = new Array(WEAPONS.length).fill(0);

function announceGains(p, gained) {
  if (!gained) return;
  for (let i = 0; i < gained.length; i++) {
    gainAccum[i] += gained[i];
    if (gainAccum[i] < 1) continue;
    const whole = Math.floor(gainAccum[i]);
    gainAccum[i] -= whole;
    spawnFloater(p.x + (Math.random() - 0.5) * 24, p.y - 30, `+${whole} ${WEAPONS[i].name.toUpperCase()}`,
      { color: WEAPONS[i].color, size: 12 });
    emit('ammo-gained', { index: i });
  }
}

// ============================================================
// CAMERA
// ============================================================
function updateCamera(dt) {
  const p = state.player();
  if (!p) return;
  const sw = app.screen.width, sh = app.screen.height;

  const lookX = Math.max(-TUNING.CAM_LOOKAHEAD_MAX, Math.min(TUNING.CAM_LOOKAHEAD_MAX,
    (state.input.mouseX - sw / 2) * TUNING.CAM_LOOKAHEAD)) + p.vx * TUNING.CAM_VEL_LEAD;
  const lookY = Math.max(-TUNING.CAM_LOOKAHEAD_MAX, Math.min(TUNING.CAM_LOOKAHEAD_MAX,
    (state.input.mouseY - sh / 2) * TUNING.CAM_LOOKAHEAD)) + p.vy * TUNING.CAM_VEL_LEAD;

  // Centre the tank in the area *below* the HUD bar, not in the raw viewport.
  const targetX = p.x + lookX - sw / 2;
  const targetY = p.y + lookY - (sh + TUNING.HUD_TOP) / 2;
  const k = Math.min(1, TUNING.CAM_LERP * dt);
  state.camera.x += (targetX - state.camera.x) * k;
  state.camera.y += (targetY - state.camera.y) * k;
  // A little overscan past the world edge: without it the camera pins in a corner
  // and the player ends up tucked under the top bar.
  const OS = TUNING.CAM_OVERSCAN;
  state.camera.x = Math.max(-OS, Math.min(Math.max(-OS, WORLD_W - sw + OS), state.camera.x));
  state.camera.y = Math.max(-OS, Math.min(Math.max(-OS, WORLD_H - sh + OS), state.camera.y));

  // Trauma shake
  state.camera.trauma = Math.max(0, state.camera.trauma - TUNING.TRAUMA_DECAY * dt);
  const shake = state.camera.trauma * state.camera.trauma * TUNING.SHAKE_MAX_PX;
  const sx = (Math.random() * 2 - 1) * shake;
  const sy = (Math.random() * 2 - 1) * shake;

  worldContainer.x = -Math.round(state.camera.x + sx);
  worldContainer.y = -Math.round(state.camera.y + sy);
}

// ============================================================
// GAME LOOP
// ============================================================
app.ticker.add(ticker => {
  const mode = state.game.mode;
  if (mode === 'menu' || mode === 'paused') return;

  const dt = Math.min(ticker.deltaTime, 3);
  const deltaMS = Math.min(ticker.deltaMS, 50);
  state.game.time += deltaMS;
  state.game.frame += dt;
  if (state.game.spawnProtection > 0) state.game.spawnProtection -= deltaMS;

  if (mode === 'playing') {
    updatePlayer(dt, deltaMS);
    updateSurvival(deltaMS);
    records.updateLife();
  } else if (mode === 'dead' && state.game.time >= state.game.respawnAt) {
    respawnPlayer();
  }

  // The world keeps living even while the player is down
  updateNPCs(dt, deltaMS);
  updateWaves(deltaMS);
  updateNotoriety(deltaMS);
  updateBaseTurrets(dt);
  updateProjectiles(dt);
  updateMines(dt);
  updateParticles(dt);
  updateFloaters(dt);
  updatePickups(dt);
  updateResourceNodes(dt);
  updateDecals();

  for (const t of state.tanks) {
    if (t.alive || t.isPlayer) updateTankVisual(t, dt);
  }

  updateCamera(dt);
  const p = state.player();
  updateHUD(dt, mode === 'playing' && p && p.alive ? nearbyNode(p) : null);
  updateAudio(dt);
});

// ============================================================
// BOOT
// ============================================================
worldContainer.visible = false;
hudContainer.visible = false;
showMenu();

// Debug/testing: /?autostart deploys immediately with saved selections
if (location.search.includes('autostart')) startGame();
