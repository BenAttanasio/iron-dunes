// Boot, container/layer setup, mode transitions, and the game loop.

import { GRID, WORLD_W, WORLD_H, CLANS, TANK_MODELS, WEAPONS, BASE_POSITIONS, TUNING } from './config.js';
import * as state from './state.js';
import { on, emit } from './events.js';
import { initInput } from './input.js';
import {
  generateMap, buildWorld, buildBases, buildResourceNodes, buildWaypointGraph,
  digAt, updateResourceNodes, nearbyNode, updateDecals, inBase,
} from './world.js';
import {
  createTank, moveTank, updateTankVisual, fireWeapon,
  updateProjectiles, updateMines, updateParticles, updatePickups, updateBaseTurrets,
  spawnExplosion,
} from './entities.js';
import { spawnInitialPopulation, updateNPCs, updateWaves, resetWaves } from './npc.js';
import { applyUpgrades, updateSurvival } from './progression.js';
import { initAudio, updateAudio } from './audio.js';
import { initHUD, layoutHUD, updateHUD, setPaused, resetHUD } from './hud.js';
import { initMenu, showMenu, hideMenu } from './menu.js';

const PIXI = window.PIXI;

// ============================================================
// APP
// ============================================================
const app = new PIXI.Application();
await app.init({
  width: window.innerWidth, height: window.innerHeight,
  backgroundColor: 0xb8a472, antialias: false,
  resolution: window.devicePixelRatio || 1, autoDensity: true,
  canvas: document.getElementById('game'),
});
app.canvas.style.cursor = 'default';

const worldContainer = new PIXI.Container();
const hudContainer = new PIXI.Container();
const menuContainer = new PIXI.Container();
app.stage.addChild(worldContainer);
app.stage.addChild(hudContainer);
app.stage.addChild(menuContainer);

// World sub-layers (order matters: decals under tanks under projectiles)
state.layers.decals = new PIXI.Container();
state.layers.tanks = new PIXI.Container();
state.layers.projectiles = new PIXI.Container();
state.layers.particles = new PIXI.Container();

// Static world first, then dynamic layers on top
generateMap();
buildWorld(worldContainer);
buildBases(worldContainer);
worldContainer.addChild(state.layers.decals);
buildResourceNodes(worldContainer);
worldContainer.addChild(state.layers.tanks);
worldContainer.addChild(state.layers.projectiles);
worldContainer.addChild(state.layers.particles);
buildWaypointGraph();

initInput(app.canvas);
initHUD(app, hudContainer);
initMenu(app, menuContainer, startGame);

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
}

function spawnPoint() {
  const base = BASE_POSITIONS[CLANS[state.game.selectedClan].baseCorner];
  return { x: base.x * GRID + 3.5 * GRID, y: base.y * GRID + 3.5 * GRID };
}

function startGame() {
  initAudio(); // first user gesture — safe to create AudioContext
  clearDynamicEntities();

  const model = TANK_MODELS[state.game.selectedTank];
  const sp = spawnPoint();
  const player = createTank({
    clanId: state.game.selectedClan, model, x: sp.x, y: sp.y, isPlayer: true,
  });
  applyUpgrades(player);
  player.angle = -Math.PI / 2;

  spawnInitialPopulation();
  resetWaves();
  resetHUD();

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
  p.materials = TUNING.RESPAWN_MATERIALS;
  p.empTimer = 0;
  p.alive = true;
  p.container.visible = true;
  state.game.spawnProtection = TUNING.SPAWN_PROTECT_MS;
  state.game.mode = 'playing';
  state.camera.x = sp.x - app.screen.width / 2;
  state.camera.y = sp.y - app.screen.height / 2;
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
    state.game.mode = 'playing';
    setPaused(false);
  }
});

on('return-to-menu', () => {
  clearDynamicEntities();
  state.game.mode = 'menu';
  setPaused(false);
  worldContainer.visible = false;
  hudContainer.visible = false;
  showMenu();
});

// ============================================================
// PLAYER UPDATE
// ============================================================
function updatePlayer(dt) {
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

  // Dig
  if (state.input.digPressed) {
    state.input.digPressed = false;
    digAt(p);
  }

  // Depot regen
  p.inBase = inBase(p);
  if (p.inBase) {
    if (p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 0.1 * dt);
    if (p.fuel < p.maxFuel) p.fuel = Math.min(p.maxFuel, p.fuel + 0.05 * dt);
    if (p.materials < p.maxMaterials) p.materials = Math.min(p.maxMaterials, p.materials + 0.03 * dt);
  }

  // Fire
  if ((state.input.mouseDown || keys[' ']) && p.empTimer <= 0) {
    fireWeapon(p, WEAPONS[p.weaponIndex], p.turretAngle - Math.PI / 2);
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

  const targetX = p.x + lookX - sw / 2;
  const targetY = p.y + lookY - sh / 2;
  const k = Math.min(1, TUNING.CAM_LERP * dt);
  state.camera.x += (targetX - state.camera.x) * k;
  state.camera.y += (targetY - state.camera.y) * k;
  state.camera.x = Math.max(0, Math.min(Math.max(0, WORLD_W - sw), state.camera.x));
  state.camera.y = Math.max(0, Math.min(Math.max(0, WORLD_H - sh), state.camera.y));

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
    updatePlayer(dt);
    updateSurvival(deltaMS);
  } else if (mode === 'dead' && state.game.time >= state.game.respawnAt) {
    respawnPlayer();
  }

  // The world keeps living even while the player is down
  updateNPCs(dt);
  updateWaves(deltaMS);
  updateBaseTurrets(dt);
  updateProjectiles(dt);
  updateMines(dt);
  updateParticles(dt);
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
