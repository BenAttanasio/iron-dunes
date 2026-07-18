// Map generation, passability/LOS queries, waypoint graph for AI pathing,
// world rendering (sand, walls, bases), decal pools, and resource nodes.

import { WORLD_W, WORLD_H, GRID, GW, GH, TILE_SIZE, CELL, CLANS, BASE_POSITIONS, TUNING } from './config.js';
import { generateSandTile, getTexture, darken, N } from './textures.js';
import * as state from './state.js';
import { emit } from './events.js';

const PIXI = window.PIXI;

// ============================================================
// MAP GRID
// ============================================================
export const mapGrid = [];
export const clearings = [];

function carveRect(x1, y1, x2, y2, type) {
  for (let y = Math.max(0, y1); y <= Math.min(GH - 1, y2); y++)
    for (let x = Math.max(0, x1); x <= Math.min(GW - 1, x2); x++)
      mapGrid[y][x] = type;
}

function carveLine(x1, y1, x2, y2, halfW, type) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x1 + (x2 - x1) * t);
    const cy = Math.round(y1 + (y2 - y1) * t);
    for (let dy = -halfW; dy <= halfW; dy++)
      for (let dx = -halfW; dx <= halfW; dx++)
        if (Math.abs(dx) + Math.abs(dy) <= halfW + 1) {
          const gx = cx + dx, gy = cy + dy;
          if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) mapGrid[gy][gx] = type;
        }
  }
}

function carveCircle(cx, cy, r, type) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) {
        const gx = cx + dx, gy = cy + dy;
        if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) mapGrid[gy][gx] = type;
      }
}

const CONNECTORS = [
  [15, 8, 15, 25], [30, 8, 30, 25], [50, 8, 50, 25], [65, 8, 65, 25],
  [15, 55, 15, 71], [30, 55, 30, 71], [50, 55, 50, 71], [65, 55, 65, 71],
  [8, 15, 25, 15], [8, 30, 25, 30], [8, 50, 25, 50], [8, 65, 25, 65],
  [55, 15, 71, 15], [55, 30, 71, 30], [55, 50, 71, 50], [55, 65, 71, 65],
  [25, 30, 40, 40], [55, 30, 40, 40],
  [25, 50, 40, 40], [55, 50, 40, 40],
  [20, 20, 35, 35], [60, 20, 45, 35],
  [20, 60, 35, 45], [60, 60, 45, 45],
];

export function generateMap() {
  for (let y = 0; y < GH; y++) {
    mapGrid[y] = [];
    for (let x = 0; x < GW; x++) mapGrid[y][x] = CELL.WALL;
  }

  // Bases (7x7 cleared area in each corner)
  carveRect(1, 1, 7, 7, CELL.BASE);
  carveRect(72, 1, 78, 7, CELL.BASE);
  carveRect(1, 72, 7, 78, CELL.BASE);
  carveRect(72, 72, 78, 78, CELL.BASE);

  // Edge lanes
  carveRect(1, 2, 78, 8, CELL.OPEN);
  carveRect(1, 71, 78, 77, CELL.OPEN);
  carveRect(2, 1, 8, 78, CELL.OPEN);
  carveRect(71, 1, 77, 78, CELL.OPEN);

  // Diagonal lanes
  carveLine(9, 9, 70, 70, 3, CELL.OPEN);
  carveLine(70, 9, 9, 70, 3, CELL.OPEN);

  // Center clearing
  carveCircle(40, 40, 7, CELL.OPEN);

  // Jungle clearings
  clearings.length = 0;
  for (let i = 0; i < 35; i++) {
    const cx = 12 + Math.floor(Math.random() * 56);
    const cy = 12 + Math.floor(Math.random() * 56);
    let wallCount = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (cx + dx >= 0 && cx + dx < GW && cy + dy >= 0 && cy + dy < GH && mapGrid[cy + dy][cx + dx] === CELL.WALL)
          wallCount++;
    if (wallCount > 10) {
      const r = 3 + Math.floor(Math.random() * 3);
      carveCircle(cx, cy, r, CELL.OPEN);
      clearings.push({ x: cx, y: cy, r });
    }
  }

  for (const [x1, y1, x2, y2] of CONNECTORS) carveLine(x1, y1, x2, y2, 2, CELL.OPEN);

  // Convert remaining walls to variety (trees, rocks, bricks, dunes)
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (mapGrid[y][x] !== CELL.WALL) continue;
      if (x === 0 || y === 0 || x === GW - 1 || y === GH - 1) continue;
      let border = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (mapGrid[y + dy] && mapGrid[y + dy][x + dx] !== undefined &&
              mapGrid[y + dy][x + dx] !== CELL.WALL && mapGrid[y + dy][x + dx] !== CELL.TREE &&
              mapGrid[y + dy][x + dx] !== CELL.ROCK)
            border = true;
      if (border) {
        const r = Math.random();
        if (r < 0.4) mapGrid[y][x] = CELL.TREE;
        else if (r < 0.65) mapGrid[y][x] = CELL.ROCK;
        else if (r < 0.68) mapGrid[y][x] = CELL.BRICK;
      } else {
        const r = Math.random();
        if (r < 0.12) mapGrid[y][x] = CELL.TREE;
        else if (r < 0.2) mapGrid[y][x] = CELL.ROCK;
        else if (r < 0.3) mapGrid[y][x] = CELL.DUNE;
      }
    }
  }

  // Sparse cover in open lanes
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (mapGrid[y][x] !== CELL.OPEN) continue;
      if (Math.random() < 0.015) mapGrid[y][x] = CELL.TREE;
      else if (Math.random() < 0.01) mapGrid[y][x] = CELL.ROCK;
    }
  }
}

// ============================================================
// QUERIES
// ============================================================
export function isPassable(wx, wy) {
  const gx = Math.floor(wx / GRID), gy = Math.floor(wy / GRID);
  if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return false;
  const cell = mapGrid[gy][gx];
  return cell === CELL.OPEN || cell === CELL.BASE || cell === CELL.DUNE;
}

function cellBlocksLOS(gx, gy) {
  if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return true;
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

export function buildWaypointGraph() {
  waypoints.length = 0;
  const add = (gx, gy) => {
    const x = gx * GRID + GRID / 2, y = gy * GRID + GRID / 2;
    if (!isPassable(x, y)) return;
    waypoints.push({ x, y, edges: [] });
  };
  // Base centers, lane corners, lane midpoints, center
  for (const corner of Object.values(BASE_POSITIONS)) add(corner.x, corner.y);
  add(5, 5); add(75, 5); add(5, 75); add(75, 75);
  add(40, 5); add(40, 75); add(5, 40); add(75, 40);
  add(40, 40);
  // Connector endpoints
  for (const [x1, y1, x2, y2] of CONNECTORS) { add(x1, y1); add(x2, y2); }
  // Clearing centers
  for (const cl of clearings) add(cl.x, cl.y);

  // Dedupe near-identical nodes
  for (let i = waypoints.length - 1; i >= 0; i--) {
    for (let j = 0; j < i; j++) {
      if (Math.hypot(waypoints[i].x - waypoints[j].x, waypoints[i].y - waypoints[j].y) < 80) {
        waypoints.splice(i, 1); break;
      }
    }
  }
  // Edges
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i], b = waypoints[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < 1400 && clearCorridor(a.x, a.y, b.x, b.y)) {
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

// BFS over the ~60-node graph. Returns array of {x,y} points ending at (tx,ty),
// or null if either end can't reach the graph.
export function findPath(fx, fy, tx, ty) {
  const from = nearestWaypoint(fx, fy);
  const to = nearestWaypoint(tx, ty);
  if (from === -1 || to === -1) return null;
  const prev = new Array(waypoints.length).fill(-2);
  prev[from] = -1;
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
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
  // Sand tiles
  for (let x = 0; x < WORLD_W; x += TILE_SIZE) {
    for (let y = 0; y < WORLD_H; y += TILE_SIZE) {
      const tileW = Math.min(TILE_SIZE, WORLD_W - x);
      const tileH = Math.min(TILE_SIZE, WORLD_H - y);
      const tile = new PIXI.Sprite(PIXI.Texture.from(generateSandTile(tileW, tileH, x, y)));
      tile.x = x; tile.y = y;
      worldContainer.addChild(tile);
    }
  }

  // Wall layer
  const wallGfx = new PIXI.Graphics();
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (mapGrid[y][x] !== CELL.WALL) continue;
      const wx = x * GRID, wy = y * GRID;
      const nv = N.fbm(x * 0.1, y * 0.1, 2);
      const base = 90 + nv * 20;
      const r = Math.floor(base + 15), g = Math.floor(base + 5), b = Math.floor(base - 10);
      wallGfx.rect(wx, wy, GRID, GRID); wallGfx.fill((r << 16) | (g << 8) | b);
      wallGfx.rect(wx, wy, GRID, 2); wallGfx.fill({ color: 0xffffff, alpha: 0.15 });
      wallGfx.rect(wx, wy + GRID - 2, GRID, 2); wallGfx.fill({ color: 0x000000, alpha: 0.2 });
    }
  }
  worldContainer.addChild(wallGfx);

  // Dune overlays
  const duneGfx = new PIXI.Graphics();
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      if (mapGrid[y][x] !== CELL.DUNE) continue;
      duneGfx.rect(x * GRID, y * GRID, GRID, GRID);
      duneGfx.fill({ color: 0xc4a456, alpha: 0.3 });
    }
  }
  worldContainer.addChild(duneGfx);

  // Trees, rocks, bricks
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const cell = mapGrid[y][x];
      if (cell === CELL.TREE) {
        const s = new PIXI.Sprite(getTexture('tree')); s.anchor.set(0.5);
        s.x = x * GRID + GRID / 2; s.y = y * GRID + GRID / 2;
        s.scale.set(0.9 + Math.random() * 0.4);
        worldContainer.addChild(s);
      } else if (cell === CELL.ROCK) {
        const s = new PIXI.Sprite(getTexture('rock')); s.anchor.set(0.5);
        s.x = x * GRID + GRID / 2; s.y = y * GRID + GRID / 2;
        s.scale.set(0.8 + Math.random() * 0.6);
        worldContainer.addChild(s);
      } else if (cell === CELL.BRICK) {
        const s = new PIXI.Sprite(getTexture('brick'));
        s.x = x * GRID; s.y = y * GRID;
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
    const wx = pos.x * GRID, wy = pos.y * GRID;
    const bw = 7 * GRID, bh = 7 * GRID;

    const pad = new PIXI.Graphics();
    pad.rect(wx - GRID, wy - GRID, bw + GRID * 2, bh + GRID * 2);
    pad.fill({ color: darken(clan.color, 60), alpha: 0.2 });
    worldContainer.addChild(pad);

    const building = new PIXI.Graphics();
    const bx = wx - 10, by = wy - 10;
    const bbw = bw + 20, bbh = bh + 20;
    building.rect(bx, by, bbw, 12); building.fill(darken(clan.color, 40));
    building.rect(bx, by + bbh - 12, bbw, 12); building.fill(darken(clan.color, 40));
    building.rect(bx, by, 12, bbh); building.fill(darken(clan.color, 40));
    building.rect(bx + bbw - 12, by, 12, bbh); building.fill(darken(clan.color, 40));

    const entranceSize = 80;
    const midX = bx + bbw / 2, midY = by + bbh / 2;
    const clearing = new PIXI.Graphics();
    if (clan.baseCorner === 'nw') {
      clearing.rect(bx + bbw - 12, midY - entranceSize / 2, 14, entranceSize);
      clearing.rect(midX - entranceSize / 2, by + bbh - 12, entranceSize, 14);
    } else if (clan.baseCorner === 'ne') {
      clearing.rect(bx - 1, midY - entranceSize / 2, 14, entranceSize);
      clearing.rect(midX - entranceSize / 2, by + bbh - 12, entranceSize, 14);
    } else if (clan.baseCorner === 'sw') {
      clearing.rect(bx + bbw - 12, midY - entranceSize / 2, 14, entranceSize);
      clearing.rect(midX - entranceSize / 2, by - 1, entranceSize, 14);
    } else {
      clearing.rect(bx - 1, midY - entranceSize / 2, 14, entranceSize);
      clearing.rect(midX - entranceSize / 2, by - 1, entranceSize, 14);
    }
    clearing.fill(0xb8a472);

    const emblem = new PIXI.Text({
      text: clan.short,
      style: { fontSize: 22, fill: clan.color, fontFamily: 'monospace', fontWeight: 'bold' }
    });
    emblem.anchor.set(0.5);
    emblem.x = wx + bw / 2; emblem.y = wy + bh / 2;

    worldContainer.addChild(building);
    worldContainer.addChild(clearing);
    worldContainer.addChild(emblem);

    const turretPositions = [];
    if (clan.baseCorner === 'nw') {
      turretPositions.push({ x: wx + bw + 10, y: wy - 10 }, { x: wx - 10, y: wy + bh + 10 });
    } else if (clan.baseCorner === 'ne') {
      turretPositions.push({ x: wx - 10, y: wy - 10 }, { x: wx + bw + 10, y: wy + bh + 10 });
    } else if (clan.baseCorner === 'sw') {
      turretPositions.push({ x: wx - 10, y: wy - 10 }, { x: wx + bw + 10, y: wy + bh + 10 });
    } else {
      turretPositions.push({ x: wx + bw + 10, y: wy - 10 }, { x: wx - 10, y: wy + bh + 10 });
    }

    const turrets = [];
    for (const tp of turretPositions) {
      const tCont = new PIXI.Container();
      const tBase = new PIXI.Graphics();
      tBase.circle(0, 0, 12); tBase.fill(darken(clan.color, 30));
      tBase.circle(0, 0, 8); tBase.fill(clan.color);
      const tBarrel = new PIXI.Sprite(turretTex);
      tBarrel.anchor.set(0.5, 0.8); tBarrel.scale.set(1.1);
      tCont.addChild(tBase); tCont.addChild(tBarrel);
      tCont.x = tp.x; tCont.y = tp.y;
      worldContainer.addChild(tCont);
      turrets.push({ clanId: clan.id, barrel: tBarrel, x: tp.x, y: tp.y, shootTimer: 0 });
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

export function stampCrater(x, y, scale = 1, scorch = false) {
  const layer = state.layers.decals;
  let s;
  if (craters.length >= TUNING.CRATER_CAP) {
    s = craters.shift();
    s.texture = getTexture('crater');
  } else {
    s = new PIXI.Sprite(getTexture('crater'));
    s.anchor.set(0.5);
    layer.addChild(s);
  }
  s.x = x; s.y = y;
  s.rotation = Math.random() * Math.PI * 2;
  s.scale.set(scale);
  s.alpha = scorch ? 0.9 : 0.8;
  s.tint = scorch ? 0x333333 : 0xffffff;
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
function makeNodeGraphic(type) {
  const g = new PIXI.Graphics();
  if (type === 'fuel') {
    g.roundRect(-8, -10, 16, 20, 3); g.fill(0xddaa22);
    g.roundRect(-6, -8, 12, 16, 2); g.fill(0xffcc44);
    g.rect(-2, -12, 4, 4); g.fill(0xaa8811);
    g.rect(-4, 2, 8, 2); g.fill(0xaa8811);
  } else {
    g.moveTo(0, -12); g.lineTo(8, -2); g.lineTo(6, 10); g.lineTo(-6, 10); g.lineTo(-8, -2); g.closePath();
    g.fill(0x3388cc);
    g.moveTo(0, -12); g.lineTo(4, -1); g.lineTo(0, 8); g.lineTo(-4, -1); g.closePath();
    g.fill(0x55aaee);
    g.moveTo(-1, -8); g.lineTo(2, -3); g.lineTo(0, 2); g.closePath();
    g.fill({ color: 0xffffff, alpha: 0.4 });
  }
  return g;
}

function spawnResourceNode(worldContainer, wx, wy, type) {
  const g = makeNodeGraphic(type);
  g.x = wx; g.y = wy;
  g.visible = false;
  const mound = new PIXI.Sprite(getTexture('mound'));
  mound.anchor.set(0.5);
  mound.x = wx; mound.y = wy;
  mound.alpha = 0;
  worldContainer.addChild(mound);
  worldContainer.addChild(g);
  return {
    graphic: g, mound, x: wx, y: wy, type,
    amount: 3 + Math.floor(Math.random() * 4),
    alive: true, discovered: false, respawnTimer: 0,
  };
}

export function buildResourceNodes(worldContainer) {
  state.resourceNodes.length = 0;
  for (const cl of clearings) {
    const type = Math.random() < 0.5 ? 'fuel' : 'material';
    state.resourceNodes.push(spawnResourceNode(worldContainer, cl.x * GRID + GRID / 2, cl.y * GRID + GRID / 2, type));
  }
  for (let i = 0; i < 20; i++) {
    let gx, gy, attempts = 0;
    do {
      gx = 8 + Math.floor(Math.random() * 64);
      gy = 8 + Math.floor(Math.random() * 64);
      attempts++;
    } while (attempts < 50 && mapGrid[gy][gx] !== CELL.OPEN);
    if (mapGrid[gy][gx] === CELL.OPEN) {
      const type = Math.random() < 0.5 ? 'fuel' : 'material';
      state.resourceNodes.push(spawnResourceNode(worldContainer, gx * GRID + GRID / 2, gy * GRID + GRID / 2, type));
    }
  }
}

// Player pressed E: discover or collect the nearest node in range.
// Returns true if something happened.
export function digAt(tank) {
  for (const rn of state.resourceNodes) {
    if (!rn.alive) continue;
    if (Math.hypot(rn.x - tank.x, rn.y - tank.y) >= TUNING.DIG_RANGE) continue;
    if (!rn.discovered) {
      rn.discovered = true;
      rn.graphic.visible = true;
      emit('discover', { node: rn });
    } else {
      let took = 0;
      if (rn.type === 'fuel' && tank.fuel < tank.maxFuel) {
        took = Math.min(rn.amount, tank.maxFuel - tank.fuel);
        tank.fuel += took;
      } else if (rn.type === 'material' && tank.materials < tank.maxMaterials) {
        took = Math.min(rn.amount, tank.maxMaterials - tank.materials);
        tank.materials += took;
      }
      if (took > 0) {
        rn.amount -= took;
        emit('dig', { node: rn, amount: took });
      }
      if (rn.amount <= 0) {
        rn.alive = false;
        rn.graphic.visible = false;
        rn.mound.alpha = 0;
        rn.discovered = false;
        rn.respawnTimer = TUNING.NODE_RESPAWN_FRAMES;
      }
    }
    return true;
  }
  return false;
}

export function updateResourceNodes(dt) {
  const p = state.player();
  for (const rn of state.resourceNodes) {
    if (!rn.alive) {
      rn.respawnTimer -= dt;
      if (rn.respawnTimer <= 0) {
        rn.alive = true; rn.discovered = false;
        rn.graphic.visible = false;
        rn.amount = 3 + Math.floor(Math.random() * 4);
      }
      continue;
    }
    // Mound fades in as the player approaches (discoverability hint)
    if (p && !rn.discovered) {
      const d = Math.hypot(rn.x - p.x, rn.y - p.y);
      const target = d < TUNING.MOUND_VISIBLE_RANGE ? Math.min(1, (TUNING.MOUND_VISIBLE_RANGE - d) / 100) : 0;
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
