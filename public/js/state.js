// Shared mutable game state. Leaf module: imports nothing.
// Data only — all logic lives in the systems that operate on it.

export const game = {
  mode: 'menu',        // 'menu' | 'playing' | 'paused' | 'dead'
  time: 0,             // ms of gameplay; frozen while paused/menu
  frame: 0,            // dt-frames elapsed (for staggered work)
  selectedClan: 0,
  selectedTank: 0,
  respawnAt: 0,        // game.time at which the dead player redeploys
  spawnProtection: 0,  // ms remaining of post-respawn invulnerability
  lastDeathXpLoss: 0,  // shown on the death screen
  fuelWarned: false,
};

export const camera = { x: 0, y: 0, trauma: 0 };

// tanks[0] is the player while playing (tank.isPlayer === true).
export const tanks = [];
export const projectiles = [];
export const mines = [];
export const particles = [];
export const pickups = [];
export const resourceNodes = [];
export const bases = [];

export const input = {
  keys: {},
  mouseX: 0, mouseY: 0,
  mouseDown: false,
  digPressed: false,   // one-shot, consumed by the player update
};

// PIXI containers, filled in by main.js at boot.
export const layers = {};

export function player() {
  return tanks.length && tanks[0].isPlayer ? tanks[0] : null;
}
