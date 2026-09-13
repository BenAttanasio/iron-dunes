// All game constants and tuning knobs. No behavior, no imports.

export const WORLD_W = 4000, WORLD_H = 4000;
export const GRID = 50;
export const GW = WORLD_W / GRID;   // 80
export const GH = WORLD_H / GRID;   // 80
export const TILE_SIZE = 512;

export const CELL = { OPEN: 0, WALL: 1, TREE: 2, ROCK: 3, DUNE: 4, BASE: 5, BRICK: 6 };

// Two colours per clan, because they do different jobs:
//   hull  - the painted tank body.
//   color - clan identity in the UI: radar blips, name labels, base tint, menu.
//           Brighter, because a 4 px blip has to stay legible.
//
// Hulls are pinned to the reference screenshot, whose pixels were sampled rather
// than guessed: its tanks are #6b9ea0 — a light, moderately desaturated TEAL, at
// roughly the same lightness as the sand around them (#c18e42). The separation is
// almost entirely HUE, not value. Dark muddy hulls read as scorch marks, and warm
// hulls disappear into the sand; cool mid-tones are what the original did.
// Dune Dragoons is the awkward one — gold is the sand's own hue — so it alone
// leans darker and earns its contrast by value instead.
// Hulls are swabbed from the reference screenshot — the most common non-outline
// colours in each region, not an average (averaging drags everything toward the
// black grout, which is how the red once came back as #45201b).
//
//   blue tank  #70b0b0     red brick  #b03030 / #d05050
//   green bush #107010     gold base  #b09050
//
// The critical one is the green: the reference green is almost PURE green, with
// its blue channel down at 16. A green with blue in it turns teal and stops being
// distinguishable from Blue Tide, which is exactly what happened before.
// `loadout` gives each clan a fighting personality. Every NPC in the game used to
// fire one nerfed cannon, so all four clans played identically and it never
// mattered who you were shooting at. Now the weapon tells you who you're fighting
// before you read the label:
//   primary   the weapon used in the standoff band (index into WEAPONS)
//   secondary a situational weapon, fired under `secondaryWhen` (see npc.js)
//   standoff  per-clan multiplier on the standoff band, so H.E.A.T. rushers
//             actually close and ricochet users hang back
export const CLANS = [
  { id: 0, color: 0xd85a5a, hull: 0xb84040, name: 'Martian Militia', short: 'MM', baseCorner: 'nw',
    loadout: { primary: 1, secondary: 0, secondaryWhen: 'far', standoff: 0.62, doctrine: 'H.E.A.T. rushers' } },
  { id: 1, color: 0x4fb43c, hull: 0x54a038, name: 'Peace Keepers',   short: 'PK', baseCorner: 'sw',
    loadout: { primary: 0, secondary: 4, secondaryWhen: 'retreat', standoff: 1.15, doctrine: 'mines and area denial' } },
  { id: 2, color: 0xd8ae4e, hull: 0x9c7a2c, name: 'Dune Dragoons',   short: 'DD', baseCorner: 'ne',
    loadout: { primary: 2, secondary: 0, secondaryWhen: 'noLOS', standoff: 1.3, doctrine: 'ricochet skirmishers' } },
  { id: 3, color: 0x7ec4c4, hull: 0x70b0b0, name: 'Blue Tide',       short: 'BT', baseCorner: 'se',
    loadout: { primary: 3, secondary: 0, secondaryWhen: 'close', standoff: 1.0, doctrine: 'homing missile crews' } },
];

// ============================================================
// AI SKILL TIERS
// ============================================================
// NPCs used to aim at where you *are*, which over a 200-380 px standoff with a
// speed-5 shell means 40-75 frames of flight — they physically could not hit a
// tank that was moving at all. They now solve the intercept (npc.js `leadAngle`),
// and the miss comes back as a designed stat instead of a physics failure.
//
//   lead     fraction of the full intercept solution actually applied
//   jitter   radians of aim error added on top
//   reload   multiplier on the weapon's own reload
//   strafe   how much they circle inside the standoff band (0 = statue)
//   cover    how hard they break line of sight while reloading
//   aggro    multiplier on detection range
export const AI_SKILLS = [
  { id: 0, name: 'Green',   tag: '',  lead: 0.30, jitter: 0.115, reload: 1.40, strafe: 0.25, cover: 0,    aggro: 0.85 },
  { id: 1, name: 'Regular', tag: '',  lead: 0.72, jitter: 0.055, reload: 1.05, strafe: 0.60, cover: 0.35, aggro: 1.00 },
  { id: 2, name: 'Veteran', tag: '»', lead: 0.95, jitter: 0.024, reload: 0.82, strafe: 1.00, cover: 0.80, aggro: 1.12 },
  { id: 3, name: 'Elite',   tag: '★', lead: 1.00, jitter: 0.009, reload: 0.66, strafe: 1.20, cover: 1.00, aggro: 1.25 },
];

// Skill distribution as the player climbs. Row = quartile of the rank ladder,
// columns = relative weight of [Green, Regular, Veteran, Elite]. This is the main
// dial that makes rank *felt*: at Recruit the desert is full of rookies who spray,
// by General it is full of crews that lead perfectly.
export const AI_SKILL_MIX = [
  [70, 28,  2,  0],   // Recruit .. Sergeant
  [35, 45, 18,  2],   // Staff Sergeant .. Lieutenant
  [12, 40, 38, 10],   // Captain .. Colonel
  [ 3, 22, 47, 28],   // Brigadier General .. Warlord
];

// Chassis shapes. The four models used to differ only by `scale`, so every tank in
// the game — and every card on the select screen — was the same silhouette at four
// sizes. Each now has its own plate layout, so you can tell a Bison from a Spectre
// on the battlefield without reading a label.
//   trackW  width of the track columns
//   hullIn  how far the hull slab is inset from the sides
//   turret  turret ring radius
//   rows    number of track plates per side
export const CHASSIS = [
  { trackW: 11, hullIn: 16.0, turret: 12.4, rows: 3 },  // light, plain
  { trackW: 14, hullIn: 18.5, turret: 14.6, rows: 4 },  // heavy, broad tracks
  { trackW: 9,  hullIn: 14.5, turret: 11.4, rows: 2 },  // sleek, long open flanks
  { trackW: 13, hullIn: 17.5, turret: 13.6, rows: 4 },  // blocky, most panels
];

// `slots` is the cap on how many upgrade points this model can ever spend. The
// ladder hands out one point per promotion (17 by Warlord), so the numbers are
// sized against that: only the Forge can actually absorb the whole climb, which is
// what "max upgrade potential" is supposed to mean. They used to be 4/5/4/9, which
// capped every model but the Forge before the halfway mark and made the entire
// officer half of the ladder grant nothing.
//
// `cargo` is how many material units the tank can haul (see the cargo economy in
// GAME_DESIGN.md) — the light hulls trade capacity for speed.
//
// `reqRank` gates the model behind a rung of the ladder. Every model used to be
// available at Recruit, so the select screen had nothing to look forward to.
export const TANK_MODELS = [
  { id: 0, name: 'Sundance', desc: 'Glass cannon', chassis: 0, reqRank: 0,
    speed: 2.2, hp: 70,  dmgMult: 1.4, armor: 0.7, slots: 11, cargo: 14, scale: 0.95, turnRate: 0.18,
    stats: { speed: 6, armor: 3, power: 9, slots: 6 } },
  { id: 1, name: 'Bison', desc: 'Defense specialist', chassis: 1, reqRank: 3,
    speed: 1.4, hp: 130, dmgMult: 0.9, armor: 1.4, slots: 13, cargo: 26, scale: 1.15, turnRate: 0.12,
    stats: { speed: 3, armor: 9, power: 5, slots: 8 } },
  { id: 2, name: 'Spectre', desc: 'Velocity advantage', chassis: 2, reqRank: 6,
    speed: 2.8, hp: 80,  dmgMult: 0.9, armor: 0.8, slots: 11, cargo: 12, scale: 0.9, turnRate: 0.24,
    stats: { speed: 9, armor: 4, power: 5, slots: 6 } },
  { id: 3, name: 'Forge', desc: 'Max upgrade potential', chassis: 3, reqRank: 9,
    speed: 1.8, hp: 90,  dmgMult: 1.0, armor: 1.0, slots: 17, cargo: 20, scale: 1.0, turnRate: 0.16,
    stats: { speed: 5, armor: 5, power: 6, slots: 10 } },
];

// ============================================================
// UPGRADE TRACKS
// ============================================================
// Rank used to auto-apply +3 max HP and +1% damage per point — a Forge that climbed
// the entire 11,700-XP ladder ended up with +27 HP and +9% damage, which is
// imperceptible. Points are now spent by the player, one of three offered choices
// per promotion, and each one is worth noticing.
//
// `apply(tank, n)` runs on spawn with the number of points sunk into that track.
export const UPGRADES = [
  { id: 'armor',  name: 'ARMOUR PLATING', desc: '+14 max HP',        max: 8,
    apply: (t, n) => { t.maxHp += 14 * n; } },
  { id: 'power',  name: 'GUN CALIBRATION', desc: '+8% damage',       max: 8,
    apply: (t, n) => { t.dmgMult *= 1 + 0.08 * n; } },
  { id: 'reload', name: 'AUTOLOADER',     desc: '-7% reload time',   max: 6,
    apply: (t, n) => { t.reloadMult *= Math.pow(0.93, n); } },
  { id: 'engine', name: 'ENGINE TUNE',    desc: '+6% top speed',     max: 6,
    apply: (t, n) => { t.maxSpeed *= 1 + 0.06 * n; } },
  { id: 'fuel',   name: 'FUEL BLADDER',   desc: '+8 max fuel',       max: 6,
    apply: (t, n) => { t.maxFuel += 8 * n; } },
  { id: 'cargo',  name: 'CARGO RACK',     desc: '+6 cargo capacity', max: 6,
    apply: (t, n) => { t.maxCargo += 6 * n; } },
  { id: 'radar',  name: 'RADAR ARRAY',    desc: '+12% radar range',  max: 5,
    apply: (t, n) => { t.radarMult *= 1 + 0.12 * n; } },
  { id: 'drill',  name: 'DRILL HEAD',     desc: '-12% drill time',   max: 5,
    apply: (t, n) => { t.drillMult *= Math.pow(0.88, n); } },
];

// ============================================================
// RESOURCE VEINS
// ============================================================
// Digging used to be one instant keypress on a 3-6 unit deposit, 34 of them on the
// map, respawning every 30 s — nothing was ever contested and skipping one cost
// you nothing. Deposits now come in tiers you drill for real time, and the drilling
// is loud: `noise` is the radius within which every hostile is pulled toward you.
export const VEIN_TIERS = [
  { id: 'common', label: 'DEPOSIT', min: 3,  max: 6,  drillMS: 2400, noise: 560,  xp: 6,  scale: 1.0, typedChance: 0.35 },
  { id: 'rich',   label: 'RICH VEIN', min: 12, max: 17, drillMS: 7200, noise: 1000, xp: 22, scale: 1.55, typedChance: 1.0 },
];

// Six weapons carried over from the original.
//
// AMMO IS PER WEAPON. Every weapon has its own magazine — spending a Cannon round
// does not cost you a Ricochet round. `maxAmmo` is therefore the dial that makes
// each weapon feel different: 60 ricochets vs 3 EM pulses says more than any
// damage number does. Materials collected in the field refill every magazine at
// once (see addAmmo in entities.js), each by a share of its own maximum, so a big
// haul restocks the cheap weapons heavily and the heavy ones barely.
//
// `fuelCost` is separate and still shared with driving — the two heaviest weapons
// burn fuel on top of their own ammo.
//
// `trail` drives the ribbon behind each projectile (entities.js): width in px at the
// muzzle, life in frames, tint, and how much textured smoke it coughs out.
export const WEAPONS = [
  {
    id: 0, name: 'Cannon', key: '1', color: 0xffcc00,
    speed: 7, damage: 30, size: 5, reload: 400, maxLife: 130,
    maxAmmo: 30, fuelCost: 0, type: 'bullet',
    desc: 'Standard shell. The baseline.',
    trail: { w: 3.5, life: 9, color: 0xffd979, smoke: 0 },
  },
  {
    id: 1, name: 'H.E.A.T.', key: '2', color: 0xff6600,
    speed: 4.5, damage: 52, size: 6.5, reload: 1100, maxLife: 120,
    maxAmmo: 6, fuelCost: 4, type: 'blast', blastRadius: 90,
    desc: 'Heaviest hit. Very few shots.',
    trail: { w: 6, life: 22, color: 0xff8a2e, smoke: 0.55 },
  },
  {
    id: 2, name: 'Ricochet', key: '3', color: 0x66ffff,
    // Bouncing is the whole identity, so it gets enough bounces and enough life
    // to actually rattle around — at 4 bounces over open desert you never saw one.
    speed: 9, damage: 12, size: 3.5, reload: 220, maxLife: 150,
    maxAmmo: 60, fuelCost: 0, type: 'ricochet', bounces: 10,
    desc: 'Cheap and plentiful. Bounces off everything. Weak.',
    trail: { w: 2.5, life: 6, color: 0x9ff4ff, smoke: 0 },
  },
  {
    id: 3, name: 'Homing', key: '4', color: 0xff44ff,
    speed: 3.6, damage: 22, size: 4, reload: 550, maxLife: 220,
    maxAmmo: 20, fuelCost: 0, type: 'homing', turnRate: 0.10, seekRange: 420,
    desc: 'Slow seeker. Hits less hard than H.E.A.T.',
    trail: { w: 5, life: 30, color: 0xffc0f6, smoke: 0.85 },
  },
  {
    id: 4, name: 'Mine', key: '5', color: 0x884400,
    speed: 0, damage: 45, size: 7, reload: 1000,
    maxAmmo: 12, fuelCost: 0, type: 'mine',
    desc: 'Drop and drive. Area denial.',
    trail: null,
  },
  {
    id: 5, name: 'EM Pulse', key: '6', color: 0xffaa22,
    // A shot, not a self-detonation: it flies out and bursts where it lands.
    speed: 5.5, damage: 3, size: 7, reload: 3000, maxLife: 110,
    maxAmmo: 3, fuelCost: 12, type: 'emp',
    desc: 'Huge burst where it lands. Disables. Eats fuel.',
    // Duration falls off with range from the burst and only the nearest few
    // targets are affected, so one pulse can't lock down a whole field.
    pulseRadius: 420, empDuration: 150, empMinDuration: 36, maxTargets: 5,
    trail: { w: 6, life: 18, color: 0xffc24a, smoke: 0.3 },
  },
];

// Grid-cell CENTRE of each base. The plaza spans +/-3 cells around it.
export const BASE_POSITIONS = {
  nw: { x: 5, y: 5 },
  ne: { x: 74, y: 5 },
  sw: { x: 5, y: 74 },
  se: { x: 74, y: 74 },
};

// Fixed so the desert is the same every session and worth learning.
export const WORLD_SEED = 20260831;

// Rank ladder. PLACEHOLDER values pending the original bonus.com ladder
// (see docs/GAME_DESIGN.md). Data-driven: rename/re-threshold freely.
// `unlocks` entries are opaque strings resolved in progression.js;
// unknown strings are ignored.
export const RANKS = [
  { name: 'Recruit',             xp: 0,     insignia: '·'     },
  { name: 'Private',             xp: 100,   insignia: '··'    },
  { name: 'Corporal',            xp: 250,   insignia: '^'     },
  { name: 'Sergeant',            xp: 450,   insignia: '^^'    },
  { name: 'Staff Sergeant',      xp: 700,   insignia: '^^^'   },
  { name: 'Sergeant First Class', xp: 1000, insignia: '^^^-'  },
  { name: 'Master Sergeant',     xp: 1350,  insignia: '^^^--' },
  { name: 'Sergeant Major',      xp: 1750,  insignia: '^^^*'  },
  { name: 'Lieutenant',          xp: 2200,  insignia: '|'     },
  { name: 'Captain',             xp: 2700,  insignia: '||'    },
  { name: 'Major',               xp: 3300,  insignia: '*'     },
  { name: 'Lieutenant Colonel',  xp: 4000,  insignia: '**'    },
  { name: 'Colonel',             xp: 4800,  insignia: '***'   },
  { name: 'Brigadier General',   xp: 5700,  insignia: '#'     },
  { name: 'Major General',       xp: 6800,  insignia: '##'    },
  { name: 'Lieutenant General',  xp: 8100,  insignia: '###'   },
  { name: 'General',             xp: 9700,  insignia: '####'  },
  { name: 'Warlord',             xp: 11700, insignia: '#####' },
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
  HUD_TOP: 96,               // top bar height; the camera centres below it
  CAM_OVERSCAN: 100,         // px the camera may run past the world edge, so a
                             // tank in a corner never hides under the HUD bar
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
  AI_LEAD_ITERATIONS: 3,     // intercept solve refinement passes
  AI_STRAFE_FLIP_MS: 2200,   // how often a circling NPC reverses direction
  AI_COVER_PROBE: 95,        // px sampled when breaking line of sight to reload
  AI_INVESTIGATE_MS: 9000,   // how long a noise contact stays interesting

  // NPC harvesting — hostiles work the deposits too, so a vein you want is
  // something you may have to take. Capped hard: if every patroller mined, the
  // player would starve.
  AI_HARVEST_CHANCE: 0.5,    // roll per clan per director tick
  AI_HARVEST_RANGE: 1500,    // how far an NPC will path to a deposit
  AI_HARVEST_MIN_PLAYER_DIST: 420,  // never start one right on top of the player
  AI_HARVEST_MS: 5200,

  // Notoriety — kill a clan often enough and it starts hunting you personally.
  NOTORIETY_PER_KILL: 10,
  NOTORIETY_DECAY_PER_S: 0.22,
  NOTORIETY_HUNT_AT: 45,     // squad dispatched at this level
  NOTORIETY_MAX: 120,
  HUNTER_SQUAD_SIZE: 3,
  HUNTER_SKILL_FLOOR: 2,     // hunters are Veteran or better
  HUNTER_TTL_MS: 60000,

  // Population / waves
  POP_BASE: 5,
  POP_PER_RANKS: 5,          // +1 pop per this many player ranks
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
  NODE_COUNT: 34,
  RICH_VEIN_FRACTION: 0.22,  // share of deposits that are rich veins
  DRILL_MOVE_CANCEL: 0.45,   // speed above which drilling breaks off
  DRILL_NOISE_INTERVAL_MS: 1400,

  // Cargo economy. Materials are hauled, not consumed on the spot: you bank them
  // at your depot for ammo, and you drop them where you die. This is what makes
  // the trip home tense and gives death a cost you can actually see.
  CARGO_BANK_PER_S: 6,       // units converted per second while parked
  CARGO_BANK_BONUS: 1.5,     // ammo multiplier for banking vs. field salvage
  CARGO_DROP_FRAC: 0.75,     // share of your load that survives as loot crates

  // Radar
  RADAR_RANGE: 1200,
  RADAR_SWEEP_RAD_S: 1.2,

  // XP
  XP_KILL: 25,
  XP_DISCOVER: 3,
  XP_COLLECT: 5,             // fallback; VEIN_TIERS[].xp overrides per tier
  XP_BANK_PER_UNIT: 1.5,     // banking cargo at the depot is the paid-out half
  XP_SURVIVAL_TICK: 1,
  XP_SURVIVAL_INTERVAL_MS: 10000,
  DEATH_PENALTY_FRAC: 0.15,  // of current rank band; never demotes

  // Base defense
  TURRET_RANGE: 400,
  TURRET_DAMAGE: 15,

  // Ammo. One "material unit" refills this fraction of every weapon's magazine,
  // so a 3-unit deposit is ~9 cannon rounds but only ~0.9 of an EM pulse.
  AMMO_PER_MATERIAL: 0.10,
  START_AMMO_FRAC: 0.6,      // magazine fill on deploy
  RESPAWN_AMMO_FRAC: 0.35,   // and after dying

  // Respawn
  RESPAWN_MS: 5000,
  RESPAWN_FUEL: 15,

  // Projectile trails
  TRAIL_POINTS: 14,          // position history length per projectile
  SMOKE_INTERVAL: 3,         // frames between textured smoke puffs on trailing shots

  // Enemy name labels
  LABEL_FADE_START: 700,     // px — labels start fading past this
  LABEL_FADE_END: 1100,      // px — fully hidden past this

  // Tab map overlay
  MAP_FADE_FRAMES: 6,
};

export const SAVE_KEY = 'tankwars.save.v1';   // key is stable; `v` inside migrates

export const COLORS = {
  HUD_PANEL: 0x0a0f0a,
  HUD_BORDER: 0x00aa00,
  HUD_GREEN: 0x00cc44,
  HUD_GREEN_BRIGHT: 0x33ff66,
  HUD_TEXT: 0xccffcc,
  SAND_BASE: 0xc18e42,   // sampled from the reference screenshot
};
