// Map generation, passability/LOS queries, waypoint graph for AI pathing,
// world rendering (sand, obstacles, bases), decal pools, and resource nodes.
//
// The map is an OPEN desert. Earlier versions filled the grid with wall and carved
// narrow lanes out of it, which lined every driving lane with impassable rock and
// then scattered more rock into the lanes themselves. Now we start from open ground
// and deliberately *place* obstacles, then run a clearance pass that guarantees no
// corridor is ever narrower than MIN_CORRIDOR cells. Everything is seeded, so the
// world is identical every session and worth learning.

import {
  WORLD_W, WORLD_H, GRID, GW, GH, TILE_SIZE, CELL, CLANS, BASE_POSITIONS,
  TUNING, WORLD_SEED, WEAPONS, VEIN_TIERS,
} from './config.js';
import { generateSandTile, getTexture, darken, N } from './textures.js';
import * as state from './state.js';
import { emit } from './events.js';

const PIXI = window.PIXI;

// ============================================================
// SEEDED RANDOM
// ============================================================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(WORLD_SEED);
const rnd = () => rng();
const rndInt = (n) => Math.floor(rng() * n);
const rndRange = (a, b) => a + rng() * (b - a);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// ============================================================
// MAP GRID
// ============================================================
export const mapGrid = [];
export const landmarks = [];   // {x, y, r, kind} in grid space — clusters worth pathing to
export const scenery = [];     // {x, y, kind, scale, rot} in world px — decorative, no collision

const MIN_CORRIDOR = 3;        // grid cells (150 px) — a tank is 30 px wide
const BASE_R = 3;              // bases are (2*BASE_R+1)^2 cells

function inBounds(x, y) { return x >= 0 && x < GW && y >= 0 && y < GH; }
function cellAt(x, y) { return inBounds(x, y) ? mapGrid[y][x] : CELL.WALL; }
function setCell(x, y, t) { if (inBounds(x, y)) mapGrid[y][x] = t; }

function passableCell(x, y) {
  const c = cellAt(x, y);
  return c === CELL.OPEN || c === CELL.BASE || c === CELL.DUNE;
}

function carveRect(x1, y1, x2, y2, type) {
  for (let y = Math.max(0, y1); y <= Math.min(GH - 1, y2); y++)
    for (let x = Math.max(0, x1); x <= Math.min(GW - 1, x2); x++)
      mapGrid[y][x] = type;
}

function carveCircle(cx, cy, r, type) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) setCell(cx + dx, cy + dy, type);
}

function carveLine(x1, y1, x2, y2, halfW, type) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) || 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x1 + (x2 - x1) * t);
    const cy = Math.round(y1 + (y2 - y1) * t);
    for (let dy = -halfW; dy <= halfW; dy++)
      for (let dx = -halfW; dx <= halfW; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= halfW + 1) setCell(cx + dx, cy + dy, type);
  }
}

// ------------------------------------------------------------
// Authored chokepoints. Everything else on the map is scattered cover; these
// three are the deliberate places where the terrain squeezes you.
// ------------------------------------------------------------
const CHOKEPOINTS = [
  // A ruined compound around the centre: brick ring with four gates. The middle of
  // the map becomes an arena you have to commit to entering.
  { kind: 'ruinRing', x: 40, y: 40, r: 10, gateHalf: 2.2, cell: CELL.BRICK },
  // Two rock ridges pinching the north and south approaches. Both have two wide
  // gaps and both stop well short of the map edge, so nothing is ever cut off.
  { kind: 'ridge', x1: 22, y1: 25, x2: 58, y2: 25, gaps: [32, 48], cell: CELL.ROCK },
  { kind: 'ridge', x1: 22, y1: 55, x2: 58, y2: 55, gaps: [32, 48], cell: CELL.ROCK },
];

function buildChokepoints() {
  for (const cp of CHOKEPOINTS) {
    if (cp.kind === 'ruinRing') {
      for (let a = 0; a < Math.PI * 2; a += 0.035) {
        // four gates at the cardinal bearings
        const nearest = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(a - nearest) < cp.gateHalf / cp.r) continue;
        for (const rr of [cp.r, cp.r + 1]) {
          setCell(Math.round(cp.x + Math.cos(a) * rr), Math.round(cp.y + Math.sin(a) * rr), cp.cell);
        }
      }
      landmarks.push({ x: cp.x, y: cp.y, r: cp.r, kind: 'ruins' });
    } else {
      const len = Math.hypot(cp.x2 - cp.x1, cp.y2 - cp.y1);
      for (let i = 0; i <= len; i++) {
        const t = i / len;
        const x = Math.round(cp.x1 + (cp.x2 - cp.x1) * t);
        const y = Math.round(cp.y1 + (cp.y2 - cp.y1) * t);
        if (cp.gaps.some(g => Math.abs(x - g) <= 2)) continue;   // 5-cell gate
        setCell(x, y, cp.cell);
        setCell(x, y + 1, cp.cell);
      }
      landmarks.push({ x: (cp.x1 + cp.x2) / 2, y: cp.y1, r: 3, kind: 'ridge' });
    }
  }
}

// ------------------------------------------------------------
// Landmark clusters, placed on a jittered lattice so they never crowd each other.
// ------------------------------------------------------------
const CLUSTER_KINDS = [
  { kind: 'grove',   cell: CELL.TREE,  weight: 4, rMin: 1.4, rMax: 3.0 },
  { kind: 'outcrop', cell: CELL.ROCK,  weight: 3, rMin: 1.2, rMax: 2.6 },
  { kind: 'ruin',    cell: CELL.BRICK, weight: 1, rMin: 1.0, rMax: 1.8 },
  { kind: 'dunes',   cell: CELL.DUNE,  weight: 3, rMin: 2.5, rMax: 4.5 },  // passable
];

function pickClusterKind() {
  const total = CLUSTER_KINDS.reduce((s, k) => s + k.weight, 0);
  let r = rnd() * total;
  for (const k of CLUSTER_KINDS) { r -= k.weight; if (r <= 0) return k; }
  return CLUSTER_KINDS[0];
}

function nearAnyBase(gx, gy, pad) {
  for (const p of Object.values(BASE_POSITIONS)) {
    const cx = p.x + BASE_R, cy = p.y + BASE_R;
    if (Math.abs(gx - cx) < BASE_R + pad && Math.abs(gy - cy) < BASE_R + pad) return true;
  }
  return false;
}

function placeClusters() {
  const SPACING = 7;           // lattice pitch in cells
  const JITTER = 2.2;
  const EDGE = 5;

  for (let ly = EDGE; ly < GH - EDGE; ly += SPACING) {
    for (let lx = EDGE; lx < GW - EDGE; lx += SPACING) {
      if (rnd() > 0.55) continue;                       // ~45% of slots stay empty desert
      const gx = Math.round(lx + rndRange(-JITTER, JITTER));
      const gy = Math.round(ly + rndRange(-JITTER, JITTER));
      if (gx < EDGE || gy < EDGE || gx >= GW - EDGE || gy >= GH - EDGE) continue;
      if (nearAnyBase(gx, gy, 4)) continue;             // keep the spawn aprons clear

      // Don't drop cover on top of an authored chokepoint.
      if (landmarks.some(l => Math.hypot(l.x - gx, l.y - gy) < l.r + 4)) continue;

      const spec = pickClusterKind();
      const r = rndRange(spec.rMin, spec.rMax);
      // Blobby, not circular: modulate the radius by noise around the ring.
      for (let dy = -Math.ceil(r) - 1; dy <= Math.ceil(r) + 1; dy++) {
        for (let dx = -Math.ceil(r) - 1; dx <= Math.ceil(r) + 1; dx++) {
          const d = Math.hypot(dx, dy);
          const wobble = 0.65 + N.fbm((gx + dx) * 0.35, (gy + dy) * 0.35, 2) * 0.85;
          if (d <= r * wobble) setCell(gx + dx, gy + dy, spec.cell);
        }
      }
      landmarks.push({ x: gx, y: gy, r: Math.ceil(r), kind: spec.kind });
    }
  }
}

// ------------------------------------------------------------
// Clearance: no passable cell may sit in a gap under MIN_CORRIDOR cells wide on
// BOTH axes. This is the hard guarantee that you can never get wedged.
// ------------------------------------------------------------
function runLength(x, y, dx, dy) {
  let n = 1;
  for (let i = 1; i < 8; i++) { if (!passableCell(x + dx * i, y + dy * i)) break; n++; }
  for (let i = 1; i < 8; i++) { if (!passableCell(x - dx * i, y - dy * i)) break; n++; }
  return n;
}

function widenPinches() {
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let y = 2; y < GH - 2; y++) {
      for (let x = 2; x < GW - 2; x++) {
        if (!passableCell(x, y)) continue;
        const h = runLength(x, y, 1, 0);
        const v = runLength(x, y, 0, 1);
        if (h >= MIN_CORRIDOR || v >= MIN_CORRIDOR) continue;
        // Widen along whichever axis is already closer to clear.
        const [dx, dy] = h >= v ? [1, 0] : [0, 1];
        for (const s of [1, -1]) {
          for (let i = 1; i <= MIN_CORRIDOR; i++) {
            const nx = x + dx * i * s, ny = y + dy * i * s;
            if (passableCell(nx, ny)) break;
            setCell(nx, ny, CELL.OPEN);
            changed++;
            break;   // one cell per side per pass, so shapes erode gently
          }
        }
      }
    }
    if (!changed) break;
  }
}

// Flood fill from a base; if the centre is unreachable, cut a corridor to it.
function ensureConnected() {
  const cx = Math.floor(GW / 2), cy = Math.floor(GH / 2);
  for (const p of Object.values(BASE_POSITIONS)) {
    const sx = p.x + BASE_R, sy = p.y + BASE_R;
    const seen = new Uint8Array(GW * GH);
    const queue = [[sx, sy]];
    seen[sy * GW + sx] = 1;
    let reached = false;
    while (queue.length) {
      const [x, y] = queue.pop();
      if (Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) { reached = true; break; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny) || seen[ny * GW + nx] || !passableCell(nx, ny)) continue;
        seen[ny * GW + nx] = 1;
        queue.push([nx, ny]);
      }
    }
    if (!reached) carveLine(sx, sy, cx, cy, MIN_CORRIDOR - 1, CELL.OPEN);
  }
}

// ------------------------------------------------------------
// Decorative, non-blocking scenery so open ground still reads as a place.
// ------------------------------------------------------------
function placeScenery() {
  scenery.length = 0;
  const KINDS = ['stone', 'stone', 'scrub', 'scrub', 'scrub', 'bones', 'wreck'];
  for (let i = 0; i < 260; i++) {
    const gx = 3 + rndInt(GW - 6), gy = 3 + rndInt(GH - 6);
    if (cellAt(gx, gy) !== CELL.OPEN && cellAt(gx, gy) !== CELL.DUNE) continue;
    if (nearAnyBase(gx, gy, 1)) continue;
    scenery.push({
      x: gx * GRID + rndRange(8, GRID - 8),
      y: gy * GRID + rndRange(8, GRID - 8),
      kind: pick(KINDS),
      scale: rndRange(0.6, 1.15),
      rot: rndRange(0, Math.PI * 2),
    });
  }
}

export function generateMap() {
  rng = mulberry32(WORLD_SEED);
  landmarks.length = 0;

  // 1. Open desert everywhere, with an impassable dune wall around the rim.
  for (let y = 0; y < GH; y++) {
    mapGrid[y] = [];
    for (let x = 0; x < GW; x++) mapGrid[y][x] = CELL.OPEN;
  }
  carveRect(0, 0, GW - 1, 1, CELL.WALL);
  carveRect(0, GH - 2, GW - 1, GH - 1, CELL.WALL);
  carveRect(0, 0, 1, GH - 1, CELL.WALL);
  carveRect(GW - 2, 0, GW - 1, GH - 1, CELL.WALL);

  // 2. Base plazas.
  for (const p of Object.values(BASE_POSITIONS)) {
    carveRect(p.x - BASE_R, p.y - BASE_R, p.x + BASE_R, p.y + BASE_R, CELL.BASE);
  }

  // 3. Authored chokepoints, then scattered cover around them.
  buildChokepoints();
  placeClusters();

  // 4. Guarantee the result is drivable.
  widenPinches();
  ensureConnected();
  // Bases must never be eroded into by the clearance pass.
  for (const p of Object.values(BASE_POSITIONS)) {
    carveRect(p.x - BASE_R, p.y - BASE_R, p.x + BASE_R, p.y + BASE_R, CELL.BASE);
  }

  placeScenery();
}

// ============================================================
// QUERIES
// ============================================================
export function isPassable(wx, wy) {
  return passableCell(Math.floor(wx / GRID), Math.floor(wy / GRID));
}

function cellBlocksLOS(gx, gy) {
  if (!inBounds(gx, gy)) return true;
  const c = mapGrid[gy][gx];
  return c === CELL.WALL || c === CELL.TREE || c === CELL.ROCK || c === CELL.BRICK;
}

// DDA grid walk; blocking = anything that stops a projectile.
export function hasLOS(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(dist / (GRID * 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const gx = Math.floor((x1 + (x2 - x1) * t) / GRID);
    const gy = Math.floor((y1 + (y2 - y1) * t) / GRID);
    if (cellBlocksLOS(gx, gy)) return false;
  }
  return true;
}

// Wide passability ray for waypoint edges (center + perpendicular offsets).
function clearCorridor(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  if (dist < 1) return true;
  const nx = -(y2 - y1) / dist, ny = (x2 - x1) / dist;
  const steps = Math.ceil(dist / 25);
  for (const off of [0, 20, -20]) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!isPassable(x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off)) return false;
    }
  }
  return true;
}

// ============================================================
// WAYPOINT GRAPH
// ============================================================
export const waypoints = [];   // {x, y, edges: [indices]}

const WP_SPACING = 6;          // cells between lattice samples
const WP_MAX_EDGE = 700;       // px; keeps the pairwise corridor checks cheap

export function buildWaypointGraph() {
  waypoints.length = 0;
  const add = (gx, gy) => {
    const x = gx * GRID + GRID / 2, y = gy * GRID + GRID / 2;
    if (!isPassable(x, y)) return;
    waypoints.push({ x, y, edges: [] });
  };

  for (const p of Object.values(BASE_POSITIONS)) add(p.x, p.y);
  // Lattice over open ground — in an open desert this covers far better than the
  // old lane-endpoint sampling did.
  for (let gy = 4; gy < GH - 4; gy += WP_SPACING)
    for (let gx = 4; gx < GW - 4; gx += WP_SPACING) add(gx, gy);
  // Ring nodes just outside each cluster so AI can route around cover.
  for (const l of landmarks) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
      add(Math.round(l.x + Math.cos(a) * (l.r + 2)), Math.round(l.y + Math.sin(a) * (l.r + 2)));
    }
  }

  // Dedupe near-identical nodes
  for (let i = waypoints.length - 1; i >= 0; i--) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(waypoints[i].x - waypoints[j].x, waypoints[i].y - waypoints[j].y) < 80) {
        waypoints.splice(i, 1); break;
      }
    }
  }
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i], b = waypoints[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < WP_MAX_EDGE && clearCorridor(a.x, a.y, b.x, b.y)) {
        a.edges.push(j); b.edges.push(i);
      }
    }
  }
}

function nearestWaypoint(x, y, requireCorridor = true) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = Math.hypot(waypoints[i].x - x, waypoints[i].y - y);
    if (d < bestD && (!requireCorridor || clearCorridor(x, y, waypoints[i].x, waypoints[i].y))) {
      best = i; bestD = d;
    }
  }
  if (best === -1 && requireCorridor) return nearestWaypoint(x, y, false);
  return best;
}

// BFS over the waypoint graph. Returns array of {x,y} points ending at (tx,ty),
// or null if either end can't reach the graph.
export function findPath(fx, fy, tx, ty) {
  const from = nearestWaypoint(fx, fy);
  const to = nearestWaypoint(tx, ty);
  if (from === -1 || to === -1) return null;
  const prev = new Array(waypoints.length).fill(-2);
  prev[from] = -1;
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === to) break;
    for (const nb of waypoints[cur].edges) {
      if (prev[nb] === -2) { prev[nb] = cur; queue.push(nb); }
    }
  }
  if (prev[to] === -2) return null;
  const path = [];
  for (let n = to; n !== -1; n = prev[n]) path.unshift({ x: waypoints[n].x, y: waypoints[n].y });
  path.push({ x: tx, y: ty });
  return path;
}

export function randomWaypoint() {
  return waypoints[Math.floor(Math.random() * waypoints.length)];
}

// ============================================================
// WORLD RENDERING
// ============================================================
export function buildWorld(worldContainer) {
  // Sand
  for (let x = 0; x < WORLD_W; x += TILE_SIZE) {
    for (let y = 0; y < WORLD_H; y += TILE_SIZE) {
      const tileW = Math.min(TILE_SIZE, WORLD_W - x);
      const tileH = Math.min(TILE_SIZE, WORLD_H - y);
      const tile = new PIXI.Sprite(PIXI.Texture.from(generateSandTile(tileW, tileH, x, y)));
      tile.x = x; tile.y = y;
      worldContainer.addChild(tile);
    }
  }

  // Dune fields: passable, purely a change of footing underfoot. One soft blob
  // per cell rather than a flat rect, so a field unions into an organic drift
  // instead of a translucent box with stair-stepped edges.
  const duneTex = getTexture('dunepatch');
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (mapGrid[y][x] !== CELL.DUNE) continue;
      const s = new PIXI.Sprite(duneTex);
      s.anchor.set(0.5);
      s.x = x * GRID + GRID / 2 + (N.noise2d(x * 4.1, y * 2.3) - 0.5) * GRID * 0.5;
      s.y = y * GRID + GRID / 2 + (N.noise2d(x * 2.7, y * 5.9) - 0.5) * GRID * 0.5;
      s.scale.set((GRID * 2.1 / duneTex.width) * (0.8 + N.noise2d(x, y) * 0.5));
      s.alpha = 0.5 + N.noise2d(x * 3, y * 3) * 0.3;
      worldContainer.addChild(s);
    }
  }

  // Rim wall: the impassable escarpment at the map edge. Drawn as one dark mass
  // with a lit lip only on the cells that actually face open ground — putting a
  // highlight/shadow on every cell turned the band into wooden planking.
  const rimGfx = new PIXI.Graphics();
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (mapGrid[y][x] !== CELL.WALL) continue;
      const wx = x * GRID, wy = y * GRID;
      const nv = N.fbm(x * 0.28, y * 0.28, 3);
      const r = Math.floor(58 + nv * 30), g = Math.floor(44 + nv * 24), b = Math.floor(24 + nv * 14);
      rimGfx.rect(wx - 1, wy - 1, GRID + 2, GRID + 2);
      rimGfx.fill((r << 16) | (g << 8) | b);
    }
  }
  // Sunlit crest along the inner face, then the shadow it throws onto the sand.
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (mapGrid[y][x] !== CELL.WALL) continue;
      const wx = x * GRID, wy = y * GRID;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (cellAt(x + dx, y + dy) === CELL.WALL || !inBounds(x + dx, y + dy)) continue;
        const lit = dy > 0 || dx > 0;   // light comes from the upper-left
        rimGfx.rect(
          wx + (dx > 0 ? GRID - 6 : 0), wy + (dy > 0 ? GRID - 6 : 0),
          dx !== 0 ? 6 : GRID, dy !== 0 ? 6 : GRID);
        rimGfx.fill({ color: lit ? 0xd8b070 : 0x2a1f0e, alpha: lit ? 0.35 : 0.4 });
        // Cast shadow onto the open ground beyond.
        rimGfx.rect(wx + dx * GRID, wy + dy * GRID, dx !== 0 ? GRID * 0.3 : GRID, dy !== 0 ? GRID * 0.3 : GRID);
        rimGfx.fill({ color: 0x2a1c08, alpha: 0.16 });
      }
    }
  }
  worldContainer.addChild(rimGfx);

  // Decorative scenery — under the obstacle sprites, no collision.
  for (const s of scenery) {
    const sp = new PIXI.Sprite(getTexture(`prop:${s.kind}`));
    sp.anchor.set(0.5);
    sp.x = s.x; sp.y = s.y;
    sp.scale.set(s.scale);
    if (s.kind !== 'scrub') sp.rotation = s.rot;
    sp.alpha = 0.95;
    worldContainer.addChild(sp);
  }

  // Obstacles. One sprite per cell on a 50 px grid lines up into a visible
  // lattice, so every instance gets a large positional offset, its own variant,
  // rotation, scale and flip. Jitter is deterministic (hashed from the cell), so
  // the world still rebuilds identically.
  // Offsets stay inside roughly a third of a cell: collision is per-cell, so a
  // sprite flung further than that visually sits on ground you can drive over.
  const jitter = (x, y, salt, amt = 0.34) =>
    (N.noise2d(x * 3.7 + salt, y * 5.3 + salt * 2) - 0.5) * GRID * amt;
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const cell = mapGrid[y][x];
      const wx = x * GRID + GRID / 2, wy = y * GRID + GRID / 2;
      const n = N.noise2d(x * 1.9, y * 2.7);
      if (cell === CELL.TREE) {
        const s = new PIXI.Sprite(getTexture(`tree:${(x * 7 + y * 3) % 3}`));
        s.anchor.set(0.5);
        s.x = wx + jitter(x, y, 1); s.y = wy + jitter(x, y, 2);
        s.scale.set(0.75 + n * 0.65);
        if ((x + y) % 2) s.scale.x *= -1;
        worldContainer.addChild(s);
      } else if (cell === CELL.ROCK) {
        const s = new PIXI.Sprite(getTexture(`rock:${(x * 5 + y * 11) % 3}`));
        s.anchor.set(0.5);
        // Rocks are small enough to wander a bit further without lying about cover.
        s.x = wx + jitter(x, y, 3, 0.5); s.y = wy + jitter(x, y, 4, 0.5);
        s.scale.set(0.7 + n * 0.75);
        // Boulders have no up, so rotating them kills the stamped-grid read.
        s.rotation = N.noise2d(x * 4.3, y * 6.1) * Math.PI * 2;
        if ((x * 7 + y) % 3 === 0) s.scale.x *= -1;
        worldContainer.addChild(s);
      } else if (cell === CELL.BRICK) {
        const s = new PIXI.Sprite(getTexture('brick'));
        s.anchor.set(0.5);
        // Ruins stay roughly aligned — they were built by someone — but not perfectly.
        s.x = wx + jitter(x, y, 5, 0.12); s.y = wy + jitter(x, y, 6, 0.12);
        s.rotation = (N.noise2d(x * 2.1, y * 3.3) - 0.5) * 0.3;
        s.scale.set(0.92 + n * 0.2);
        worldContainer.addChild(s);
      }
    }
  }
}

// ============================================================
// BASES
// ============================================================
export function buildBases(worldContainer) {
  state.bases.length = 0;
  const turretTex = getTexture('turret');

  for (const clan of CLANS) {
    const pos = BASE_POSITIONS[clan.baseCorner];
    const wx = (pos.x - BASE_R) * GRID, wy = (pos.y - BASE_R) * GRID;
    const bw = (BASE_R * 2 + 1) * GRID, bh = bw;

    // Landing apron: packed sand scuffed flat by traffic. Kept faint — a solid
    // slab with a bright border dominated the whole corner of the map.
    const pad = new PIXI.Graphics();
    const px = wx - GRID * 0.6, py = wy - GRID * 0.6;
    const pw = bw + GRID * 1.2, ph = bh + GRID * 1.2;
    pad.roundRect(px, py, pw, ph, 26);
    pad.fill({ color: 0xa89058, alpha: 0.22 });
    pad.roundRect(px + 7, py + 7, pw - 14, ph - 14, 20);
    pad.stroke({ color: clan.color, width: 2, alpha: 0.28 });
    // Corner ticks instead of a continuous border — reads as markings, not a box.
    for (const [ox, oy, dx, dy] of [[0, 0, 1, 1], [pw, 0, -1, 1], [0, ph, 1, -1], [pw, ph, -1, -1]]) {
      pad.moveTo(px + ox + dx * 14, py + oy);
      pad.lineTo(px + ox + dx * 44, py + oy);
      pad.moveTo(px + ox, py + oy + dy * 14);
      pad.lineTo(px + ox, py + oy + dy * 44);
    }
    pad.stroke({ color: clan.color, width: 4, alpha: 0.5 });
    worldContainer.addChild(pad);

    // Clan-tinted bronze bunker
    const bunker = new PIXI.Sprite(getTexture(`bunker:${clan.color.toString(16).padStart(6, '0')}`));
    bunker.anchor.set(0.5);
    bunker.x = wx + bw / 2; bunker.y = wy + bh / 2;
    bunker.scale.set((bw * 0.78) / bunker.texture.width);
    worldContainer.addChild(bunker);

    const emblem = new PIXI.Text({
      text: clan.short,
      style: { fontSize: 20, fill: 0xfff2cc, fontFamily: 'monospace', fontWeight: 'bold' },
    });
    emblem.anchor.set(0.5);
    emblem.x = wx + bw / 2; emblem.y = wy + bh / 2 + bw * 0.30;
    worldContainer.addChild(emblem);

    // Turrets on the two outward corners of the plaza.
    const inset = GRID * 0.5;
    const corners = {
      nw: [[wx + bw - inset, wy - inset], [wx - inset, wy + bh - inset]],
      ne: [[wx + inset, wy - inset], [wx + bw + inset, wy + bh - inset]],
      sw: [[wx - inset, wy + inset], [wx + bw - inset, wy + bh + inset]],
      se: [[wx + bw + inset, wy + inset], [wx + inset, wy + bh + inset]],
    }[clan.baseCorner];

    const emplacement = getTexture(`turretbase:${clan.color.toString(16).padStart(6, '0')}`);
    const turrets = [];
    for (const [tx, ty] of corners) {
      const tCont = new PIXI.Container();
      const tBase = new PIXI.Sprite(emplacement);
      tBase.anchor.set(0.5);
      const tBarrel = new PIXI.Sprite(turretTex);
      tBarrel.anchor.set(0.5, 0.8); tBarrel.scale.set(1.25);
      tCont.addChild(tBase); tCont.addChild(tBarrel);
      tCont.x = tx; tCont.y = ty;
      worldContainer.addChild(tCont);
      turrets.push({ clanId: clan.id, barrel: tBarrel, x: tx, y: ty, shootTimer: 0 });
    }

    state.bases.push({ clanId: clan.id, clan, x: wx, y: wy, w: bw, h: bh, turrets });
  }
}

export function baseOf(clanId) {
  return state.bases.find(b => b.clanId === clanId);
}

export function baseCenter(clanId) {
  const b = baseOf(clanId);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function inBase(tank) {
  const b = baseOf(tank.clanId);
  return tank.x > b.x && tank.x < b.x + b.w && tank.y > b.y && tank.y < b.y + b.h;
}

// ============================================================
// DECALS (tracks, craters, scorch) — pooled, capped, fading
// ============================================================
const tracks = [];
const craters = [];

export function stampTrack(x, y, rotation) {
  const layer = state.layers.decals;
  let s;
  if (tracks.length >= TUNING.TRACK_CAP) {
    s = tracks.shift();
  } else {
    s = new PIXI.Sprite(getTexture('track'));
    s.anchor.set(0.5);
    layer.addChild(s);
  }
  s.x = x; s.y = y; s.rotation = rotation; s.alpha = 1;
  s.born = state.game.time;
  tracks.push(s);
}

const SCORCH_KEYS = ['fx:splatter', 'fx:cracked_ground', 'fx:impact_fracture'];
let scorchIdx = 0;

export function stampCrater(x, y, scale = 1, scorch = false) {
  const layer = state.layers.decals;
  const tex = scorch ? getTexture(SCORCH_KEYS[scorchIdx++ % SCORCH_KEYS.length]) : getTexture('crater');
  let s;
  if (craters.length >= TUNING.CRATER_CAP) {
    s = craters.shift();
  } else {
    s = new PIXI.Sprite(tex);
    s.anchor.set(0.5);
    layer.addChild(s);
  }
  s.texture = tex;
  s.x = x; s.y = y;
  s.rotation = Math.random() * Math.PI * 2;
  // The imported scorch art is 256 px; the painted crater is 56. Normalise so both
  // land at roughly the same footprint on the ground.
  s.scale.set(scale * (scorch ? 0.45 : 1));
  s.alpha = scorch ? 0.75 : 0.8;
  s.tint = scorch ? 0x2a2016 : 0xffffff;
  craters.push(s);
}

export function updateDecals() {
  const now = state.game.time;
  for (let i = tracks.length - 1; i >= 0; i--) {
    const s = tracks[i];
    const age = now - s.born;
    if (age > TUNING.TRACK_FADE_MS) {
      s.parent?.removeChild(s);
      tracks.splice(i, 1);
    } else {
      s.alpha = 1 - age / TUNING.TRACK_FADE_MS;
    }
  }
}

// ============================================================
// RESOURCE NODES — hidden until dug; a sand mound hints at them
// ============================================================
// Deposits come in tiers (VEIN_TIERS). A common deposit is a few units and a
// couple of seconds of drilling; a rich vein is a big typed cache that takes seven
// seconds and screams your position at every hostile inside a kilometre. That
// risk/reward dial is the whole reason to care which one you stopped at — and
// because WORLD_SEED is fixed, where the rich veins are is knowledge worth having.
function makeNodeGraphic(type, tier, weaponId) {
  const g = new PIXI.Graphics();
  if (type === 'fuel') {
    g.roundRect(-8, -10, 16, 20, 3); g.fill(0xddaa22);
    g.roundRect(-6, -8, 12, 16, 2); g.fill(0xffcc44);
    g.rect(-2, -12, 4, 4); g.fill(0xaa8811);
    g.rect(-4, 2, 8, 2); g.fill(0xaa8811);
  } else {
    // A typed cache takes its weapon's colour, so you can read what it pays out
    // from across the dune instead of driving over to find out.
    const tint = weaponId != null ? WEAPONS[weaponId].color : 0x3388cc;
    const lit = weaponId != null ? lighten(tint, 0.35) : 0x55aaee;
    g.moveTo(0, -12); g.lineTo(8, -2); g.lineTo(6, 10); g.lineTo(-6, 10); g.lineTo(-8, -2); g.closePath();
    g.fill(tint);
    g.moveTo(0, -12); g.lineTo(4, -1); g.lineTo(0, 8); g.lineTo(-4, -1); g.closePath();
    g.fill(lit);
    g.moveTo(-1, -8); g.lineTo(2, -3); g.lineTo(0, 2); g.closePath();
    g.fill({ color: 0xffffff, alpha: 0.4 });
  }
  if (tier.id === 'rich') {
    // Rich veins carry a ring so the tier reads before you're in drill range.
    g.circle(0, 0, 17);
    g.stroke({ color: type === 'fuel' ? 0xffdd66 : 0xaaddff, width: 2, alpha: 0.75 });
  }
  g.scale.set(tier.scale);
  return g;
}

function lighten(hex, amt) {
  const r = Math.min(255, ((hex >> 16) & 255) + 255 * amt);
  const g = Math.min(255, ((hex >> 8) & 255) + 255 * amt);
  const b = Math.min(255, (hex & 255) + 255 * amt);
  return (r << 16) | (g << 8) | b;
}

function rollNodeAmount(tier) {
  return tier.min + rndInt(tier.max - tier.min + 1);
}

function spawnResourceNode(worldContainer, wx, wy, type, tier) {
  // Typed caches dump their whole haul into one weapon instead of smearing it
  // across six magazines. Weighted toward the heavy weapons, which are the ones a
  // spread refill could never visibly restock.
  const TYPED_POOL = [1, 1, 3, 3, 4, 5, 5, 2];
  const typed = type === 'material' && rnd() < tier.typedChance;
  const weaponId = typed ? TYPED_POOL[rndInt(TYPED_POOL.length)] : null;

  const g = makeNodeGraphic(type, tier, weaponId);
  g.x = wx; g.y = wy;
  g.visible = false;
  const mound = new PIXI.Sprite(getTexture('mound'));
  mound.anchor.set(0.5);
  mound.x = wx; mound.y = wy;
  mound.scale.set(tier.scale);
  mound.alpha = 0;
  worldContainer.addChild(mound);
  worldContainer.addChild(g);
  return {
    graphic: g, mound, x: wx, y: wy, type, tier, weaponId,
    amount: rollNodeAmount(tier),
    alive: true, discovered: false, respawnTimer: 0,
    drilledBy: null,        // tank currently working it (player or NPC)
  };
}

export function buildResourceNodes(worldContainer) {
  state.resourceNodes.length = 0;
  const placed = [];
  const tooClose = (gx, gy) => placed.some(p => Math.hypot(p.x - gx, p.y - gy) < 7);

  // Biased toward landmarks so digging pulls you toward interesting terrain,
  // then topped up with open-ground deposits so nothing is only ever in cover.
  const candidates = [];
  for (const l of landmarks) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
      candidates.push([Math.round(l.x + Math.cos(a) * (l.r + 2)), Math.round(l.y + Math.sin(a) * (l.r + 2))]);
    }
  }
  for (let i = 0; i < 400; i++) candidates.push([4 + rndInt(GW - 8), 4 + rndInt(GH - 8)]);

  // Shuffle deterministically so the landmark ring isn't always consumed first.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rndInt(i + 1);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const richTarget = Math.round(TUNING.NODE_COUNT * TUNING.RICH_VEIN_FRACTION);
  for (const [gx, gy] of candidates) {
    if (state.resourceNodes.length >= TUNING.NODE_COUNT) break;
    if (cellAt(gx, gy) !== CELL.OPEN && cellAt(gx, gy) !== CELL.DUNE) continue;
    if (nearAnyBase(gx, gy, 3) || tooClose(gx, gy)) continue;
    placed.push({ x: gx, y: gy });
    // Rich veins are placed first so they land on the landmark-biased candidates
    // rather than whatever open sand is left over.
    const tier = state.resourceNodes.length < richTarget ? VEIN_TIERS[1] : VEIN_TIERS[0];
    state.resourceNodes.push(spawnResourceNode(
      worldContainer,
      gx * GRID + GRID / 2, gy * GRID + GRID / 2,
      rnd() < 0.5 ? 'fuel' : 'material', tier));
  }
}

// ============================================================
// DRILLING — a channel, not a keypress
// ============================================================
// Digging used to resolve instantly on E, so there was no window in which anything
// could go wrong and no reason to care where you stopped. It is now a hold: you sit
// still for the tier's drill time, and the drill is LOUD (see `emitNoise`), which
// is what turns every deposit into a decision — clear the area first, or gamble.

export function nodeInDrillRange(tank) {
  let best = null, bestD = TUNING.DIG_RANGE;
  for (const rn of state.resourceNodes) {
    if (!rn.alive) continue;
    if (rn.drilledBy && rn.drilledBy !== tank) continue;
    const d = Math.hypot(rn.x - tank.x, rn.y - tank.y);
    if (d < bestD) { best = rn; bestD = d; }
  }
  return best;
}

// Broadcast a noise contact. npc.js drains state.noiseEvents each frame and pulls
// anyone inside the radius toward it — this one channel is why the AI has any
// reason to converge on the player at all.
export function emitNoise(x, y, radius, source) {
  state.noiseEvents.push({ x, y, radius, source });
}

export function beginDrill(tank, rn) {
  if (!rn || !rn.alive || rn.drilledBy) return false;
  rn.drilledBy = tank;
  if (!rn.discovered) {
    rn.discovered = true;
    rn.graphic.visible = true;
    emit('discover', { node: rn });
  }
  const total = rn.tier.drillMS * (tank.drillMult ?? 1);
  tank.drill = { node: rn, elapsed: 0, total, noiseTimer: 0 };
  emit('drill-start', { node: rn, tank });
  emitNoise(rn.x, rn.y, rn.tier.noise, tank);
  return true;
}

export function cancelDrill(tank, reason = 'moved') {
  const d = tank.drill;
  if (!d) return;
  if (d.node && d.node.drilledBy === tank) d.node.drilledBy = null;
  tank.drill = null;
  emit('drill-cancel', { tank, reason });
}

// Advances an in-progress drill. Returns 'done' on the frame it completes.
export function advanceDrill(tank, deltaMS) {
  const d = tank.drill;
  if (!d) return null;
  const rn = d.node;
  if (!rn.alive) { cancelDrill(tank, 'gone'); return null; }

  d.elapsed += deltaMS;
  d.noiseTimer += deltaMS;
  if (d.noiseTimer >= TUNING.DRILL_NOISE_INTERVAL_MS) {
    d.noiseTimer = 0;
    emitNoise(rn.x, rn.y, rn.tier.noise, tank);
  }
  if (d.elapsed < d.total) return 'drilling';

  tank.drill = null;
  rn.drilledBy = null;
  return collectNode(tank, rn) ? 'done' : 'full';
}

// Extract a finished deposit into the tank. Fuel goes straight in the tank;
// materials become CARGO, which only becomes ammo when you get it home.
// Returns false if nothing could be taken (full tank / full hold).
export function collectNode(tank, rn) {
  let took = 0;
  if (rn.type === 'fuel') {
    took = Math.min(rn.amount, (tank.maxFuel ?? 40) - tank.fuel);
    tank.fuel += took;
  } else {
    const space = (tank.maxCargo ?? 0) - cargoTotal(tank);
    took = Math.min(rn.amount, Math.max(0, space));
    if (took > 0) addCargo(tank, rn.weaponId, took);
  }
  if (took <= 0) {
    emit('drill-full', { node: rn, tank });
    return false;
  }
  rn.amount -= took;
  emit('dig', { node: rn, amount: took, tank });
  if (rn.amount <= 0) depleteNode(rn, tank);
  return true;
}

export function depleteNode(rn, tank) {
  rn.alive = false;
  rn.drilledBy = null;
  rn.graphic.visible = false;
  rn.mound.alpha = 0;
  rn.discovered = false;
  rn.respawnTimer = TUNING.NODE_RESPAWN_FRAMES;
  emit('vein-depleted', { node: rn, tank, xp: rn.tier.xp });
}

// ============================================================
// CARGO — materials are hauled, not consumed where they're found
// ============================================================
// A hold is `{ spread, per[] }`: untyped units that refill every magazine, and
// typed units earmarked for one weapon. Banking at your depot is what turns either
// into ammo, so the trip home is the tense part of the loop and dying with a full
// hold actually costs you something.
export function makeCargo() {
  return { spread: 0, per: new Array(WEAPONS.length).fill(0) };
}

export function cargoTotal(tank) {
  const c = tank.cargo;
  if (!c) return 0;
  return c.spread + c.per.reduce((s, n) => s + n, 0);
}

export function addCargo(tank, weaponId, units) {
  if (!tank.cargo) tank.cargo = makeCargo();
  if (weaponId == null) tank.cargo.spread += units;
  else tank.cargo.per[weaponId] += units;
}

export function clearCargo(tank) {
  tank.cargo = makeCargo();
}

export function updateResourceNodes(dt) {
  const p = state.player();
  for (const rn of state.resourceNodes) {
    if (!rn.alive) {
      rn.respawnTimer -= dt;
      if (rn.respawnTimer <= 0) {
        rn.alive = true; rn.discovered = false;
        rn.graphic.visible = false;
        rn.amount = rollNodeAmount(rn.tier);
      }
      continue;
    }
    // Mound fades in as the player approaches (discoverability hint). Rich veins
    // announce themselves from further out — they're worth crossing the map for.
    if (p && !rn.discovered) {
      const range = TUNING.MOUND_VISIBLE_RANGE * rn.tier.scale;
      const d = Math.hypot(rn.x - p.x, rn.y - p.y);
      const target = d < range ? Math.min(1, (range - d) / 100) : 0;
      rn.mound.alpha += (target - rn.mound.alpha) * Math.min(1, 0.1 * dt);
    } else if (rn.discovered) {
      rn.mound.alpha = 0;
    }
  }
}

// Nearest alive node within prompt range of the tank (for the HUD prompt).
export function nearbyNode(tank) {
  let best = null, bestD = TUNING.PROMPT_RANGE;
  for (const rn of state.resourceNodes) {
    if (!rn.alive) continue;
    const d = Math.hypot(rn.x - tank.x, rn.y - tank.y);
    if (d < bestD) { best = rn; bestD = d; }
  }
  return best;
}

// A deposit an NPC could reasonably go work: alive, unclaimed, within range, and
// not sitting on top of the player (hostiles mining in your lap reads as a bug,
// not as competition).
export function findHarvestNode(x, y, maxDist, avoid, avoidDist) {
  let best = null, bestD = maxDist;
  for (const rn of state.resourceNodes) {
    if (!rn.alive || rn.drilledBy) continue;
    if (avoid && Math.hypot(rn.x - avoid.x, rn.y - avoid.y) < avoidDist) continue;
    const d = Math.hypot(rn.x - x, rn.y - y);
    if (d < bestD) { best = rn; bestD = d; }
  }
  return best;
}
