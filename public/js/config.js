// All game constants and tuning knobs. No behavior, no imports.

export const WORLD_W = 4000, WORLD_H = 4000;
export const GRID = 50;
export const GW = WORLD_W / GRID;   // 80
export const GH = WORLD_H / GRID;   // 80
export const TILE_SIZE = 512;

export const CELL = { OPEN: 0, WALL: 1, TREE: 2, ROCK: 3, DUNE: 4, BASE: 5, BRICK: 6 };

export const CLANS = [
  { id: 0, color: 0xcc3333, name: 'Martian Militia',  short: 'MM',  baseCorner: 'nw' },
  { id: 1, color: 0x33cc66, name: 'Peace Keepers',    short: 'PK',  baseCorner: 'sw' },
  { id: 2, color: 0xccaa33, name: 'Dune Dragoons',    short: 'DD',  baseCorner: 'ne' },
  { id: 3, color: 0x3366cc, name: 'Blue Tide',        short: 'BT',  baseCorner: 'se' },
];

export const TANK_MODELS = [
  { id: 0, name: 'Sundance', desc: 'Glass cannon',
    speed: 2.2, hp: 70,  dmgMult: 1.4, armor: 0.7, slots: 4, scale: 0.95, turnRate: 0.18,
    stats: { speed: 6, armor: 3, power: 9, slots: 4 } },
  { id: 1, name: 'Bison', desc: 'Defense specialist',
    speed: 1.4, hp: 130, dmgMult: 0.9, armor: 1.4, slots: 5, scale: 1.15, turnRate: 0.12,
    stats: { speed: 3, armor: 9, power: 5, slots: 5 } },
  { id: 2, name: 'Spectre', desc: 'Velocity advantage',
    speed: 2.8, hp: 80,  dmgMult: 0.9, armor: 0.8, slots: 4, scale: 0.9, turnRate: 0.24,
    stats: { speed: 9, armor: 4, power: 5, slots: 4 } },
  { id: 3, name: 'Forge', desc: 'Max upgrade potential',
    speed: 1.8, hp: 90,  dmgMult: 1.0, armor: 1.0, slots: 9, scale: 1.0, turnRate: 0.16,
    stats: { speed: 5, armor: 5, power: 6, slots: 9 } },
];

// reload is in milliseconds of game time.
export const WEAPONS = [
  { id: 0, name: 'Cannon',    key: '1', color: 0xffcc00, speed: 7, damage: 30, size: 4, reload: 400,
    fuelCost: 0, matCost: 2, type: 'bullet', desc: 'High damage, precision' },
  { id: 1, name: 'H.E.A.T.',  key: '2', color: 0xff6600, speed: 5, damage: 8,  size: 8, reload: 800,
    fuelCost: 3, matCost: 3, type: 'blast', desc: 'Area blast, drains resources', blastRadius: 80 },
  { id: 2, name: 'Ricochet',  key: '3', color: 0x66ffff, speed: 9, damage: 20, size: 3, reload: 300,
    fuelCost: 0, matCost: 1, type: 'ricochet', desc: 'Short range, bounces', bounces: 3, maxLife: 50 },
  { id: 3, name: 'Homing',    key: '4', color: 0xff44ff, speed: 5, damage: 12, size: 3, reload: 500,
    fuelCost: 0, matCost: 2, type: 'homing', desc: 'Heat-seeking, low damage', turnRate: 0.06 },
  { id: 4, name: 'Mine',      key: '5', color: 0x884400, speed: 0, damage: 40, size: 6, reload: 1000,
    fuelCost: 0, matCost: 3, type: 'mine', desc: 'Area denial' },
  { id: 5, name: 'EM Pulse',  key: '6', color: 0x4488ff, speed: 6, damage: 5,  size: 5, reload: 1200,
    fuelCost: 4, matCost: 0, type: 'emp', desc: 'Electronics disruption', empDuration: 120 },
];

export const BASE_POSITIONS = {
  nw: { x: 4, y: 4 },
  ne: { x: 75, y: 4 },
  sw: { x: 4, y: 75 },
  se: { x: 75, y: 75 },
};

// Rank ladder. PLACEHOLDER values pending the original bonus.com ladder
// (see docs/GAME_DESIGN.md). Data-driven: rename/re-threshold freely.
// `unlocks` entries are opaque strings resolved in progression.js;
// unknown strings are ignored.
export const RANKS = [
  { name: 'Recruit',        xp: 0,    insignia: '·'    },
  { name: 'Private',        xp: 100,  insignia: '··'   },
  { name: 'Corporal',       xp: 250,  insignia: '^'    },
  { name: 'Sergeant',       xp: 500,  insignia: '^^'   },
  { name: 'Lieutenant',     xp: 900,  insignia: '^^^'  },
  { name: 'Captain',        xp: 1500, insignia: '*'    },
  { name: 'Major',          xp: 2400, insignia: '**'   },
  { name: 'Colonel',        xp: 3600, insignia: '***'  },
  { name: 'General',        xp: 5200, insignia: '#'    },
  { name: 'Warlord',        xp: 7500, insignia: '##'   },
];

export const TUNING = {
  // Movement feel (dt units: 1 = one 60fps frame)
  ACCEL_FRAMES: 12,          // frames from rest to max speed
  FRICTION: 0.88,            // per-frame velocity multiplier with no input
  STOP_EPSILON: 0.05,
  TANK_RADIUS: 15,

  // Fuel
  FUEL_DRAIN: 0.005,         // per dt-frame while moving
  FUEL_EMPTY_SPEED_MULT: 0.5,
  FUEL_WARN_FRAC: 0.25,
  FUEL_WARN_CLEAR_FRAC: 0.30,

  // Camera
  CAM_LERP: 0.10,
  CAM_LOOKAHEAD: 0.18,       // fraction of mouse offset from screen center
  CAM_LOOKAHEAD_MAX: 110,
  CAM_VEL_LEAD: 10,
  SHAKE_MAX_PX: 14,
  TRAUMA_DECAY: 0.025,

  // Juice
  TRACK_SPACING: 7,          // px of travel per track stamp
  TRACK_CAP: 500,
  TRACK_FADE_MS: 8000,
  CRATER_CAP: 80,
  DUST_SPEED_FRAC: 0.5,

  // Combat
  NPC_DAMAGE_MULT: 0.7,      // NPC-fired projectile nerf (from prototype)
  HIT_FLASH_FRAMES: 5,
  SPAWN_PROTECT_MS: 2000,

  // NPC AI
  AI_AGGRO: 500,
  AI_PLAYER_AGGRO_BONUS: 1.15,
  AI_STANDOFF_MIN: 200,
  AI_STANDOFF_MAX: 380,
  AI_AIM_TOLERANCE: 0.2,
  AI_LOS_STAGGER: 15,        // frames between LOS re-checks per NPC
  AI_RETREAT_HP: 0.3,
  AI_RETREAT_HEAL_MULT: 3,
  AI_SEEK_TIMEOUT_MS: 6000,
  AI_SEPARATION_DIST: 55,
  NPC_SPEED: 1.6,
  NPC_HP: 60,

  // Population / waves
  POP_BASE: 5,
  POP_PER_RANKS: 3,          // +1 pop per this many player ranks
  POP_CAP: 9,
  ALLY_COUNT: 3,
  WAVE_INTERVAL_MS: 20000,
  WAVE_MAX_SPAWN: 3,

  // Resources
  DIG_RANGE: 45,
  PROMPT_RANGE: 60,
  MOUND_VISIBLE_RANGE: 250,
  NODE_RESPAWN_FRAMES: 1800,
  PICKUP_RADIUS: 30,
  PICKUP_DESPAWN_FRAMES: 900,

  // Radar
  RADAR_RANGE: 1200,
  RADAR_SWEEP_RAD_S: 1.2,

  // XP
  XP_KILL: 25,
  XP_DISCOVER: 3,
  XP_COLLECT: 5,
  XP_SURVIVAL_TICK: 1,
  XP_SURVIVAL_INTERVAL_MS: 10000,
  DEATH_PENALTY_FRAC: 0.15,  // of current rank band; never demotes

  // Base defense
  TURRET_RANGE: 400,
  TURRET_DAMAGE: 15,

  // Respawn
  RESPAWN_MS: 5000,
  RESPAWN_FUEL: 15,
  RESPAWN_MATERIALS: 15,
};

export const SAVE_KEY = 'tankwars.save.v1';

export const COLORS = {
  HUD_PANEL: 0x0a0f0a,
  HUD_BORDER: 0x00aa00,
  HUD_GREEN: 0x00cc44,
  HUD_GREEN_BRIGHT: 0x33ff66,
  HUD_TEXT: 0xccffcc,
  SAND_BASE: 0xc89858,
};
