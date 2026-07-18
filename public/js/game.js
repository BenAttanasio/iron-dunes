(async () => {

// ============================================================
// CONFIGURATION
// ============================================================
const WORLD_W = 4000, WORLD_H = 4000;
const GRID = 50;
const GW = WORLD_W / GRID;   // 80
const GH = WORLD_H / GRID;   // 80
const TILE_SIZE = 512;

const CELL = { OPEN: 0, WALL: 1, TREE: 2, ROCK: 3, DUNE: 4, BASE: 5 };

const CLANS = [
  { id: 0, color: 0xcc3333, name: 'Martian Militia',  short: 'MM',  baseCorner: 'nw' },
  { id: 1, color: 0x33cc66, name: 'Peace Keepers',    short: 'PK',  baseCorner: 'sw' },
  { id: 2, color: 0xccaa33, name: 'Dune Dragoons',    short: 'DD',  baseCorner: 'ne' },
  { id: 3, color: 0x3366cc, name: 'Blue Tide',        short: 'BT',  baseCorner: 'se' },
];

const TANK_MODELS = [
  { id: 0, name: 'Sundance', desc: 'Glass cannon',
    speed: 2.2, hp: 70,  dmgMult: 1.4, armor: 0.7, slots: 4, scale: 0.95,
    stats: { speed: 6, armor: 3, power: 9, slots: 4 } },
  { id: 1, name: 'Bison', desc: 'Defense specialist',
    speed: 1.4, hp: 130, dmgMult: 0.9, armor: 1.4, slots: 5, scale: 1.15,
    stats: { speed: 3, armor: 9, power: 5, slots: 5 } },
  { id: 2, name: 'Spectre', desc: 'Velocity advantage',
    speed: 2.8, hp: 80,  dmgMult: 0.9, armor: 0.8, slots: 4, scale: 0.9,
    stats: { speed: 9, armor: 4, power: 5, slots: 4 } },
  { id: 3, name: 'Forge', desc: 'Max upgrade potential',
    speed: 1.8, hp: 90,  dmgMult: 1.0, armor: 1.0, slots: 9, scale: 1.0,
    stats: { speed: 5, armor: 5, power: 6, slots: 9 } },
];

const WEAPONS = [
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

const BASE_POSITIONS = {
  nw: { x: 4, y: 4 },
  ne: { x: 75, y: 4 },
  sw: { x: 4, y: 75 },
  se: { x: 75, y: 75 },
};

// ============================================================
// NOISE
// ============================================================
function makeNoise(seed) {
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263 + seed) & 0x7fffffff;
    h = ((h >> 13) ^ h) * 1274126177;
    return ((h >> 16) ^ h) & 0x7fffffff;
  }
  function noise2d(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const n00 = hash(ix, iy) / 0x7fffffff, n10 = hash(ix+1, iy) / 0x7fffffff;
    const n01 = hash(ix, iy+1) / 0x7fffffff, n11 = hash(ix+1, iy+1) / 0x7fffffff;
    return (n00*(1-sx)+n10*sx)*(1-sy) + (n01*(1-sx)+n11*sx)*sy;
  }
  function fbm(x, y, oct) {
    let v = 0, a = 1, f = 1, m = 0;
    for (let i = 0; i < oct; i++) { v += noise2d(x*f, y*f)*a; m += a; a *= 0.5; f *= 2; }
    return v / m;
  }
  return { noise2d, fbm };
}
const N = makeNoise(1274126177);

// ============================================================
// SAND TILE GENERATOR
// ============================================================
function generateSandTile(w, h, wx, wy) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h); const d = img.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const x = wx + px, y = wy + py;
      const dune = N.fbm(x * 0.003, y * 0.003, 4) * 30;
      const ripple = N.fbm(x * 0.005 + 20, y * 0.025 + 20, 4);
      const ridge = 1.0 - Math.abs(ripple * 2 - 1);
      const v = dune + Math.pow(ridge, 3) * 20;
      const grain = (Math.random() - 0.5) * 6;
      d[i]   = Math.min(255, Math.max(0, 192 + v + grain));
      d[i+1] = Math.min(255, Math.max(0, 164 + (v + grain) * 0.85));
      d[i+2] = Math.min(255, Math.max(0, 110 + (v + grain) * 0.55));
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ============================================================
// PIXI APP
// ============================================================
const app = new PIXI.Application();
await app.init({
  width: window.innerWidth, height: window.innerHeight,
  backgroundColor: 0xb8a472, antialias: false,
  resolution: window.devicePixelRatio || 1, autoDensity: true,
  canvas: document.getElementById('game'),
});
app.canvas.style.cursor = 'default';
window.addEventListener('resize', () => app.renderer.resize(window.innerWidth, window.innerHeight));

// ============================================================
// COLOR UTILITIES
// ============================================================
function hexToRgb(hex) { return { r: (hex>>16)&0xff, g: (hex>>8)&0xff, b: hex&0xff }; }
function lighten(c, a) { let r=(c>>16)&0xff,g=(c>>8)&0xff,b=c&0xff; return ((Math.min(255,r+a)<<16)|(Math.min(255,g+a)<<8)|Math.min(255,b+a)); }
function darken(c, a) { let r=(c>>16)&0xff,g=(c>>8)&0xff,b=c&0xff; return ((Math.max(0,r-a)<<16)|(Math.max(0,g-a)<<8)|Math.max(0,b-a)); }

// ============================================================
// TEXTURE GENERATORS
// ============================================================
function createTankTexture(bodyColor, scale = 1) {
  const c = document.createElement('canvas');
  const s = scale;
  const w = Math.ceil(44*s), h = Math.ceil(52*s);
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const cx = w/2, cy = h/2;
  const rgb = hexToRgb(bodyColor);
  const dk = hexToRgb(darken(bodyColor, 50));
  const lt = hexToRgb(lighten(bodyColor, 35));
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx+2, cy+3, 18*s, 20*s, 0, 0, Math.PI*2); ctx.fill();
  for (const dir of [-1, 1]) {
    const tx = cx + dir * 14 * s;
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(tx-5*s, cy-22*s, 10*s, 44*s);
    ctx.strokeStyle = '#444'; ctx.lineWidth = 0.8;
    for (let i = -20; i < 22; i += 4) {
      ctx.beginPath(); ctx.moveTo(tx-5*s, cy+i*s); ctx.lineTo(tx+5*s, cy+i*s); ctx.stroke();
    }
  }
  const bg = ctx.createLinearGradient(cx-12*s, cy, cx+12*s, cy);
  bg.addColorStop(0, `rgb(${dk.r},${dk.g},${dk.b})`);
  bg.addColorStop(0.3, `rgb(${lt.r},${lt.g},${lt.b})`);
  bg.addColorStop(0.7, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
  bg.addColorStop(1, `rgb(${dk.r},${dk.g},${dk.b})`);
  ctx.fillStyle = bg;
  ctx.fillRect(cx-12*s, cy-16*s, 24*s, 32*s);
  ctx.strokeStyle = `rgb(${Math.max(0,dk.r-20)},${Math.max(0,dk.g-20)},${Math.max(0,dk.b-20)})`;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx-12*s, cy-16*s, 24*s, 32*s);
  const tg = ctx.createRadialGradient(cx-2*s, cy-2*s, 1, cx, cy, 11*s);
  tg.addColorStop(0, `rgb(${Math.min(255,lt.r+20)},${Math.min(255,lt.g+20)},${Math.min(255,lt.b+20)})`);
  tg.addColorStop(0.6, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
  tg.addColorStop(1, `rgb(${dk.r},${dk.g},${dk.b})`);
  ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(cx, cy, 11*s, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = `rgb(${Math.max(0,dk.r-10)},${Math.max(0,dk.g-10)},${Math.max(0,dk.b-10)})`;
  ctx.lineWidth = 1.5; ctx.stroke();
  const ig = ctx.createRadialGradient(cx-1*s, cy-1*s, 0, cx, cy, 7*s);
  ig.addColorStop(0, `rgba(${lt.r},${lt.g},${lt.b},0.8)`);
  ig.addColorStop(1, `rgb(${Math.max(0,dk.r+10)},${Math.max(0,dk.g+10)},${Math.max(0,dk.b+10)})`);
  ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, 7*s, 0, Math.PI*2); ctx.fill();
  return PIXI.Texture.from(c);
}

function createTurretTexture() {
  const c = document.createElement('canvas'); c.width = 12; c.height = 36;
  const ctx = c.getContext('2d'); const cx = 6;
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(cx-3+1, 2, 6, 28);
  const bg = ctx.createLinearGradient(cx-3, 0, cx+3, 0);
  bg.addColorStop(0, '#333'); bg.addColorStop(0.4, '#666');
  bg.addColorStop(0.6, '#555'); bg.addColorStop(1, '#2a2a2a');
  ctx.fillStyle = bg; ctx.fillRect(cx-3, 0, 6, 28);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 0.8; ctx.strokeRect(cx-3, 0, 6, 28);
  ctx.fillStyle = '#222'; ctx.fillRect(cx-4, 0, 8, 4);
  ctx.fillStyle = '#555'; ctx.fillRect(cx-3.5, 20, 7, 2);
  return PIXI.Texture.from(c);
}

function createTreeTexture() {
  const c = document.createElement('canvas'); c.width = 48; c.height = 48;
  const ctx = c.getContext('2d'); const cx = 24, cy = 26;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(cx+2, cy+8, 16, 10, 0.1, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#5a3518'; ctx.fillRect(cx-2, cy, 4, 10);
  for (const l of [{x:0,y:-8,r:10,c:'#1e7a2e'},{x:-9,y:-4,r:8,c:'#237a30'},{x:9,y:-3,r:8,c:'#1f6e28'},
    {x:-5,y:-14,r:7,c:'#2a8838'},{x:5,y:-12,r:7,c:'#268432'},{x:0,y:-16,r:6,c:'#2e9040'}]) {
    ctx.fillStyle = l.c; ctx.beginPath(); ctx.arc(cx+l.x, cy+l.y, l.r, 0, Math.PI*2); ctx.fill();
  }
  for (const h of [{x:-3,y:-12,r:5,c:'#3aaa4a'},{x:4,y:-8,r:4,c:'#42b050'},{x:-7,y:-6,r:3,c:'#38a644'},{x:1,y:-17,r:3,c:'#4abb56'}]) {
    ctx.fillStyle = h.c; ctx.beginPath(); ctx.arc(cx+h.x, cy+h.y, h.r, 0, Math.PI*2); ctx.fill();
  }
  return PIXI.Texture.from(c);
}

function createRockTexture() {
  const c = document.createElement('canvas'); c.width = 40; c.height = 40;
  const ctx = c.getContext('2d'); const cx = 20, cy = 20;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx+3, cy+5, 14, 10, 0.1, 0, Math.PI*2); ctx.fill();
  const rg = ctx.createRadialGradient(cx-3, cy-4, 2, cx, cy, 12);
  rg.addColorStop(0, '#a89880'); rg.addColorStop(0.5, '#8a7a68'); rg.addColorStop(1, '#6a5a48');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.moveTo(cx-10,cy+4); ctx.quadraticCurveTo(cx-12,cy-6,cx-3,cy-10);
  ctx.quadraticCurveTo(cx+4,cy-12,cx+10,cy-6); ctx.quadraticCurveTo(cx+14,cy+1,cx+10,cy+5);
  ctx.quadraticCurveTo(cx+3,cy+8,cx-10,cy+4); ctx.fill();
  ctx.fillStyle = 'rgba(180,170,150,0.4)';
  ctx.beginPath(); ctx.ellipse(cx-2,cy-4,5,3,-0.3,0,Math.PI*2); ctx.fill();
  return PIXI.Texture.from(c);
}

function createMinimapFrame() {
  const c = document.createElement('canvas'); const sz = 160; c.width = sz; c.height = sz;
  const ctx = c.getContext('2d'); const cx = sz/2, cy = sz/2, r = sz/2-4;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(cx+2, cy+2, r+4, 0, Math.PI*2); ctx.fill();
  const og = ctx.createRadialGradient(cx-10, cy-10, r*0.7, cx, cy, r+3);
  og.addColorStop(0, '#c4a456'); og.addColorStop(0.5, '#8a6a30');
  og.addColorStop(0.8, '#6a5020'); og.addColorStop(1, '#4a3818');
  ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, r+3, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#3a2810'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r-2, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#a88838';
  for (let a = 0; a < Math.PI*2; a += Math.PI/6) {
    const bx = cx+Math.cos(a)*(r-1), by = cy+Math.sin(a)*(r-1);
    ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#c4a456'; ctx.beginPath(); ctx.arc(bx-0.5, by-0.5, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#a88838';
  }
  return PIXI.Texture.from(c);
}

// ============================================================
// MAP GENERATION — MOBA-style lanes (WIDER, MORE OPEN)
// ============================================================
const mapGrid = [];
for (let y = 0; y < GH; y++) {
  mapGrid[y] = [];
  for (let x = 0; x < GW; x++) mapGrid[y][x] = CELL.WALL;
}

function carveRect(x1, y1, x2, y2, type) {
  for (let y = Math.max(0, y1); y <= Math.min(GH-1, y2); y++)
    for (let x = Math.max(0, x1); x <= Math.min(GW-1, x2); x++)
      mapGrid[y][x] = type;
}

function carveLine(x1, y1, x2, y2, halfW, type) {
  const steps = Math.max(Math.abs(x2-x1), Math.abs(y2-y1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x1 + (x2-x1)*t);
    const cy = Math.round(y1 + (y2-y1)*t);
    for (let dy = -halfW; dy <= halfW; dy++)
      for (let dx = -halfW; dx <= halfW; dx++)
        if (Math.abs(dx)+Math.abs(dy) <= halfW+1) {
          const gx = cx+dx, gy = cy+dy;
          if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) mapGrid[gy][gx] = type;
        }
  }
}

function carveCircle(cx, cy, r, type) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx*dx+dy*dy <= r*r) {
        const gx = cx+dx, gy = cy+dy;
        if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) mapGrid[gy][gx] = type;
      }
}

// Bases (7x7 cleared area in each corner)
carveRect(1, 1, 7, 7, CELL.BASE);
carveRect(72, 1, 78, 7, CELL.BASE);
carveRect(1, 72, 7, 78, CELL.BASE);
carveRect(72, 72, 78, 78, CELL.BASE);

// Edge lanes — WIDE (7 cells)
carveRect(1, 2, 78, 8, CELL.OPEN);      // Top lane
carveRect(1, 71, 78, 77, CELL.OPEN);    // Bottom lane
carveRect(2, 1, 8, 78, CELL.OPEN);      // Left lane
carveRect(71, 1, 77, 78, CELL.OPEN);    // Right lane

// Diagonal lanes — WIDER (halfW=3)
carveLine(9, 9, 70, 70, 3, CELL.OPEN);  // NW-SE
carveLine(70, 9, 9, 70, 3, CELL.OPEN);  // NE-SW

// Center clearing — BIGGER
carveCircle(40, 40, 7, CELL.OPEN);

// Jungle clearings — MORE and BIGGER
const clearings = [];
for (let i = 0; i < 35; i++) {
  const cx = 12 + Math.floor(Math.random() * 56);
  const cy = 12 + Math.floor(Math.random() * 56);
  let wallCount = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (cx+dx >= 0 && cx+dx < GW && cy+dy >= 0 && cy+dy < GH && mapGrid[cy+dy][cx+dx] === CELL.WALL)
        wallCount++;
  if (wallCount > 10) {
    const r = 3 + Math.floor(Math.random() * 3);
    carveCircle(cx, cy, r, CELL.OPEN);
    clearings.push({ x: cx, y: cy, r });
  }
}

// Connector tunnels — WIDER (halfW=2) and MORE
const connectors = [
  // Top lane ↔ mid area (vertical)
  [15, 8, 15, 25], [30, 8, 30, 25], [50, 8, 50, 25], [65, 8, 65, 25],
  // Bottom lane ↔ mid area (vertical)
  [15, 55, 15, 71], [30, 55, 30, 71], [50, 55, 50, 71], [65, 55, 65, 71],
  // Left lane ↔ mid area (horizontal)
  [8, 15, 25, 15], [8, 30, 25, 30], [8, 50, 25, 50], [8, 65, 25, 65],
  // Right lane ↔ mid area (horizontal)
  [55, 15, 71, 15], [55, 30, 71, 30], [55, 50, 71, 50], [55, 65, 71, 65],
  // Approaches to center
  [25, 30, 40, 40], [55, 30, 40, 40],
  [25, 50, 40, 40], [55, 50, 40, 40],
  // Cross-jungle shortcuts
  [20, 20, 35, 35], [60, 20, 45, 35],
  [20, 60, 35, 45], [60, 60, 45, 45],
];
for (const [x1, y1, x2, y2] of connectors)
  carveLine(x1, y1, x2, y2, 2, CELL.OPEN);

// Convert remaining walls to variety (trees, rocks, dunes)
for (let y = 0; y < GH; y++) {
  for (let x = 0; x < GW; x++) {
    if (mapGrid[y][x] !== CELL.WALL) continue;
    if (x === 0 || y === 0 || x === GW-1 || y === GH-1) continue;
    let border = false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (mapGrid[y+dy] && mapGrid[y+dy][x+dx] !== undefined &&
            mapGrid[y+dy][x+dx] !== CELL.WALL && mapGrid[y+dy][x+dx] !== CELL.TREE &&
            mapGrid[y+dy][x+dx] !== CELL.ROCK)
          border = true;
    if (border) {
      const r = Math.random();
      if (r < 0.4) mapGrid[y][x] = CELL.TREE;
      else if (r < 0.65) mapGrid[y][x] = CELL.ROCK;
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

// Collision check
function isPassable(wx, wy) {
  const gx = Math.floor(wx / GRID), gy = Math.floor(wy / GRID);
  if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) return false;
  const cell = mapGrid[gy][gx];
  return cell === CELL.OPEN || cell === CELL.BASE || cell === CELL.DUNE;
}

// ============================================================
// GAME STATE
// ============================================================
let gameState = 'menu';
let selectedClan = 0;
let selectedTank = 0;

// ============================================================
// CONTAINERS
// ============================================================
const menuContainer = new PIXI.Container();
const worldContainer = new PIXI.Container();
const hudContainer = new PIXI.Container();
app.stage.addChild(worldContainer);
app.stage.addChild(hudContainer);
app.stage.addChild(menuContainer);

// ============================================================
// RENDER MAP INTO WORLD
// ============================================================
for (let x = 0; x < WORLD_W; x += TILE_SIZE) {
  for (let y = 0; y < WORLD_H; y += TILE_SIZE) {
    const tileW = Math.min(TILE_SIZE, WORLD_W - x);
    const tileH = Math.min(TILE_SIZE, WORLD_H - y);
    const sandCanvas = generateSandTile(tileW, tileH, x, y);
    const tile = new PIXI.Sprite(PIXI.Texture.from(sandCanvas));
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
    const color = (r << 16) | (g << 8) | b;
    wallGfx.rect(wx, wy, GRID, GRID); wallGfx.fill(color);
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

// Tree and rock sprites
const treeTex = createTreeTexture();
const rockTex = createRockTexture();
const treeSprites = [];
for (let y = 0; y < GH; y++) {
  for (let x = 0; x < GW; x++) {
    if (mapGrid[y][x] === CELL.TREE) {
      const s = new PIXI.Sprite(treeTex); s.anchor.set(0.5);
      s.x = x * GRID + GRID/2; s.y = y * GRID + GRID/2;
      s.scale.set(0.9 + Math.random() * 0.4);
      worldContainer.addChild(s); treeSprites.push(s);
    } else if (mapGrid[y][x] === CELL.ROCK) {
      const s = new PIXI.Sprite(rockTex); s.anchor.set(0.5);
      s.x = x * GRID + GRID/2; s.y = y * GRID + GRID/2;
      s.scale.set(0.8 + Math.random() * 0.6);
      worldContainer.addChild(s);
    }
  }
}

// ============================================================
// BASE RENDERING & DEFENSE SYSTEM
// ============================================================
const turretTex = createTurretTexture();

const bases = [];
for (const clan of CLANS) {
  const pos = BASE_POSITIONS[clan.baseCorner];
  const wx = pos.x * GRID, wy = pos.y * GRID;
  const bw = 7 * GRID, bh = 7 * GRID;
  const baseContainer = new PIXI.Container();

  const pad = new PIXI.Graphics();
  pad.rect(wx - GRID, wy - GRID, bw + GRID*2, bh + GRID*2);
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
  const midX = bx + bbw/2, midY = by + bbh/2;
  const clearing = new PIXI.Graphics();
  if (clan.baseCorner === 'nw') {
    clearing.rect(bx + bbw - 12, midY - entranceSize/2, 14, entranceSize);
    clearing.rect(midX - entranceSize/2, by + bbh - 12, entranceSize, 14);
  } else if (clan.baseCorner === 'ne') {
    clearing.rect(bx - 1, midY - entranceSize/2, 14, entranceSize);
    clearing.rect(midX - entranceSize/2, by + bbh - 12, entranceSize, 14);
  } else if (clan.baseCorner === 'sw') {
    clearing.rect(bx + bbw - 12, midY - entranceSize/2, 14, entranceSize);
    clearing.rect(midX - entranceSize/2, by - 1, entranceSize, 14);
  } else {
    clearing.rect(bx - 1, midY - entranceSize/2, 14, entranceSize);
    clearing.rect(midX - entranceSize/2, by - 1, entranceSize, 14);
  }
  clearing.fill(0xb8a472);

  const emblem = new PIXI.Text({
    text: clan.short,
    style: { fontSize: 22, fill: clan.color, fontFamily: 'monospace', fontWeight: 'bold' }
  });
  emblem.anchor.set(0.5);
  emblem.x = wx + bw/2; emblem.y = wy + bh/2;

  baseContainer.addChild(building);
  baseContainer.addChild(clearing);
  baseContainer.addChild(emblem);
  worldContainer.addChild(baseContainer);

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

  const baseTurrets = [];
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
    baseTurrets.push({ container: tCont, barrel: tBarrel, x: tp.x, y: tp.y, angle: 0, shootTimer: 0 });
  }

  bases.push({ clan, x: wx, y: wy, w: bw, h: bh, turrets: baseTurrets, container: baseContainer });
}

// ============================================================
// RESOURCE NODES — HIDDEN until dug up, radar-only
// ============================================================
const resourceNodes = [];

function spawnResourceNode(wx, wy, type) {
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
  g.x = wx; g.y = wy;
  g.visible = false; // HIDDEN by default — radar only
  worldContainer.addChild(g);
  return { graphic: g, x: wx, y: wy, type, amount: 3 + Math.floor(Math.random() * 4),
           alive: true, discovered: false, respawnTimer: 0 };
}

for (const cl of clearings) {
  const type = Math.random() < 0.5 ? 'fuel' : 'material';
  resourceNodes.push(spawnResourceNode(cl.x * GRID + GRID/2, cl.y * GRID + GRID/2, type));
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
    resourceNodes.push(spawnResourceNode(gx * GRID + GRID/2, gy * GRID + GRID/2, type));
  }
}

// ============================================================
// PLAYER & ENEMY DATA
// ============================================================
const player = {
  x: 0, y: 0, angle: 0, turretAngle: 0,
  hp: 100, maxHp: 100,
  fuel: 30, maxFuel: 40,
  materials: 30, maxMaterials: 40,
  weaponIndex: 0,
  speed: 2, dmgMult: 1, armor: 1,
  empTimer: 0,
  inBase: false,
  alive: true,
};

const enemies = [];
const projectiles = [];
const particles = [];
const placedMines = [];

const projectileLayer = new PIXI.Container();
const particleLayer = new PIXI.Container();
const tankLayer = new PIXI.Container();
const roofLayer = new PIXI.Container();
worldContainer.addChild(tankLayer);
worldContainer.addChild(projectileLayer);
worldContainer.addChild(particleLayer);
worldContainer.addChild(roofLayer);

let playerContainer, playerBody, playerTurret;

function createPlayerTank() {
  const clan = CLANS[selectedClan];
  const model = TANK_MODELS[selectedTank];
  const bodyTex = createTankTexture(clan.color, model.scale);
  playerContainer = new PIXI.Container();
  playerBody = new PIXI.Sprite(bodyTex); playerBody.anchor.set(0.5);
  playerTurret = new PIXI.Sprite(turretTex); playerTurret.anchor.set(0.5, 0.8);
  playerContainer.addChild(playerBody); playerContainer.addChild(playerTurret);
  tankLayer.addChild(playerContainer);

  const base = BASE_POSITIONS[clan.baseCorner];
  player.x = base.x * GRID + 3.5 * GRID;
  player.y = base.y * GRID + 3.5 * GRID;
  player.hp = model.hp; player.maxHp = model.hp;
  player.speed = model.speed;
  player.dmgMult = model.dmgMult;
  player.armor = model.armor;
  player.fuel = 30; player.materials = 30;
  player.weaponIndex = 0;
  player.empTimer = 0;
  player.alive = true;
}

function createEnemies() {
  for (const clan of CLANS) {
    if (clan.id === selectedClan) continue;
    const bodyTex = createTankTexture(clan.color, 0.9);
    const base = BASE_POSITIONS[clan.baseCorner];
    for (let i = 0; i < 5; i++) {
      let ex, ey, attempts = 0;
      do {
        ex = (base.x + Math.random() * 20 - 5) * GRID;
        ey = (base.y + Math.random() * 20 - 5) * GRID;
        attempts++;
      } while (attempts < 30 && !isPassable(ex, ey));
      if (!isPassable(ex, ey)) { ex = base.x * GRID + 3.5*GRID; ey = base.y * GRID + 3.5*GRID; }

      const cont = new PIXI.Container();
      const body = new PIXI.Sprite(bodyTex); body.anchor.set(0.5);
      const turr = new PIXI.Sprite(turretTex); turr.anchor.set(0.5, 0.8); turr.scale.set(0.9);
      cont.addChild(body); cont.addChild(turr);
      cont.x = ex; cont.y = ey;
      tankLayer.addChild(cont);

      const hpBg = new PIXI.Graphics();
      hpBg.rect(-20, -32, 40, 4); hpBg.fill({ color: 0x000000, alpha: 0.6 }); cont.addChild(hpBg);
      const hpBar = new PIXI.Graphics(); cont.addChild(hpBar);
      const label = new PIXI.Text({
        text: clan.short,
        style: { fontSize: 9, fill: 0xffffff, fontFamily: 'monospace' }
      });
      label.anchor.set(0.5); label.y = -39; label.alpha = 0.8; cont.addChild(label);

      enemies.push({
        container: cont, body, turret: turr, hpBar,
        x: ex, y: ey, angle: Math.random()*Math.PI*2, turretAngle: Math.random()*Math.PI*2,
        hp: 60, maxHp: 60, alive: true, clan, empTimer: 0,
        ai: { state: 'patrol', timer: 0, targetAngle: Math.random()*Math.PI*2, shootTimer: 0 }
      });
    }
  }
}

// ============================================================
// COMBAT
// ============================================================
let lastShot = 0;

function spawnProjectile(x, y, angle, weapon, owner, ownerObj) {
  const g = new PIXI.Graphics();
  const c = weapon.color;
  if (weapon.type === 'mine') {
    g.circle(0, 0, weapon.size+2); g.fill({ color: 0x000000, alpha: 0.3 });
    g.circle(0, 0, weapon.size); g.fill(0x664422);
    g.circle(0, 0, weapon.size*0.5); g.fill(0x884400);
    for (let a = 0; a < Math.PI*2; a += Math.PI/3) {
      g.circle(Math.cos(a)*weapon.size*0.7, Math.sin(a)*weapon.size*0.7, 2); g.fill(0x553311);
    }
    g.x = x; g.y = y;
    projectileLayer.addChild(g);
    placedMines.push({ graphic: g, x, y, damage: weapon.damage, owner, size: weapon.size,
                       life: 600, armed: false, armTimer: 30 });
    return;
  }
  g.circle(0, 0, weapon.size*2); g.fill({ color: c, alpha: 0.15 });
  g.circle(0, 0, weapon.size); g.fill(c);
  g.circle(0, 0, weapon.size*0.4); g.fill(0xffffff);
  g.x = x + Math.cos(angle)*30; g.y = y + Math.sin(angle)*30;
  projectileLayer.addChild(g);
  projectiles.push({
    graphic: g, vx: Math.cos(angle)*weapon.speed, vy: Math.sin(angle)*weapon.speed, angle,
    damage: weapon.damage * (owner === 'player' ? player.dmgMult : 0.7),
    life: weapon.maxLife || 120, owner, size: weapon.size, type: weapon.type,
    bounces: weapon.bounces || 0, turnRate: weapon.turnRate || 0,
    blastRadius: weapon.blastRadius || 0, empDuration: weapon.empDuration || 0,
  });
}

function spawnParticle(x, y, color, size, life) {
  const g = new PIXI.Graphics(); g.circle(0, 0, size); g.fill(color);
  g.x = x; g.y = y; particleLayer.addChild(g);
  const a = Math.random()*Math.PI*2, spd = 1 + Math.random()*3;
  particles.push({ graphic: g, vx: Math.cos(a)*spd, vy: Math.sin(a)*spd, life, maxLife: life });
}

function spawnExplosion(x, y, count) {
  const colors = [0xff4400, 0xffaa00, 0xffcc44, 0xff6600];
  for (let i = 0; i < count; i++)
    spawnParticle(x, y, colors[Math.floor(Math.random()*4)], 2+Math.random()*4, 15+Math.random()*20);
}

function spawnEMPEffect(x, y) {
  for (let i = 0; i < 12; i++)
    spawnParticle(x, y, 0x4488ff, 1+Math.random()*2, 20+Math.random()*15);
}

// ============================================================
// HUD ELEMENTS
// ============================================================
const mmSize = 150;
const mmFrameTex = createMinimapFrame();
let mmFrame, mmBg, mmContent;
let hudHpBg, hudHpFill, hudHpText;
let hudFuelBg, hudFuelFill, hudFuelText;
let hudMatBg, hudMatFill, hudMatText;
let hudWeapon, hudEnemy, hudDepot;

function createHUD() {
  hudContainer.removeChildren();
  mmBg = new PIXI.Graphics();
  mmContent = new PIXI.Graphics();
  mmFrame = new PIXI.Sprite(mmFrameTex); mmFrame.anchor.set(0.5);
  hudContainer.addChild(mmBg); hudContainer.addChild(mmContent); hudContainer.addChild(mmFrame);

  hudHpBg = new PIXI.Graphics();
  hudHpFill = new PIXI.Graphics();
  hudHpText = new PIXI.Text({ text: '', style: { fontSize: 11, fill: 0xffffff, fontFamily: 'monospace' } });
  hudContainer.addChild(hudHpBg); hudContainer.addChild(hudHpFill); hudContainer.addChild(hudHpText);

  hudFuelBg = new PIXI.Graphics();
  hudFuelFill = new PIXI.Graphics();
  hudFuelText = new PIXI.Text({ text: '', style: { fontSize: 11, fill: 0xffffff, fontFamily: 'monospace' } });
  hudContainer.addChild(hudFuelBg); hudContainer.addChild(hudFuelFill); hudContainer.addChild(hudFuelText);

  hudMatBg = new PIXI.Graphics();
  hudMatFill = new PIXI.Graphics();
  hudMatText = new PIXI.Text({ text: '', style: { fontSize: 11, fill: 0xffffff, fontFamily: 'monospace' } });
  hudContainer.addChild(hudMatBg); hudContainer.addChild(hudMatFill); hudContainer.addChild(hudMatText);

  hudWeapon = new PIXI.Text({ text: '', style: { fontSize: 12, fill: 0xffffff, fontFamily: 'monospace' } });
  hudContainer.addChild(hudWeapon);

  hudEnemy = new PIXI.Text({ text: '', style: { fontSize: 12, fill: 0xff8888, fontFamily: 'monospace' } });
  hudContainer.addChild(hudEnemy);

  hudDepot = new PIXI.Text({ text: '', style: { fontSize: 14, fill: 0x44ff88, fontFamily: 'monospace', align: 'center' } });
  hudDepot.anchor.set(0.5, 0);
  hudContainer.addChild(hudDepot);
}

// ============================================================
// SELECTION SCREEN — fixed layout + hotkeys panel
// ============================================================
function showMenu() {
  gameState = 'menu';
  menuContainer.removeChildren();
  worldContainer.visible = false;
  hudContainer.visible = false;
  app.canvas.style.cursor = 'default';

  const sw = app.screen.width, sh = app.screen.height;

  const bg = new PIXI.Graphics();
  bg.rect(0, 0, sw, sh); bg.fill(0x1a1408);
  menuContainer.addChild(bg);

  // Title
  const title = new PIXI.Text({
    text: 'TANK WARS',
    style: { fontSize: 48, fill: 0xccaa44, fontFamily: 'monospace', fontWeight: 'bold',
             dropShadow: true, dropShadowColor: 0x000000, dropShadowDistance: 3 }
  });
  title.anchor.set(0.5); title.x = sw/2; title.y = 50;
  menuContainer.addChild(title);

  const subtitle = new PIXI.Text({
    text: 'SELECT YOUR CLAN AND TANK',
    style: { fontSize: 14, fill: 0x888866, fontFamily: 'monospace' }
  });
  subtitle.anchor.set(0.5); subtitle.x = sw/2; subtitle.y = 88;
  menuContainer.addChild(subtitle);

  // ---- CLAN SELECTION ----
  const clanLabel = new PIXI.Text({ text: 'CLAN',
    style: { fontSize: 14, fill: 0xaaaaaa, fontFamily: 'monospace' } });
  clanLabel.anchor.set(0.5); clanLabel.x = sw/2; clanLabel.y = 118;
  menuContainer.addChild(clanLabel);

  const clanStartX = sw/2 - (CLANS.length * 130) / 2 + 65;
  for (let i = 0; i < CLANS.length; i++) {
    const clan = CLANS[i];
    const box = new PIXI.Container();
    box.x = clanStartX + i * 130; box.y = 160;
    box.eventMode = 'static'; box.cursor = 'pointer';

    const cbg = new PIXI.Graphics();
    cbg.roundRect(-52, -24, 104, 56, 6);
    cbg.fill({ color: clan.color, alpha: i === selectedClan ? 0.8 : 0.25 });
    cbg.stroke({ color: i === selectedClan ? 0xffffff : clan.color, width: i === selectedClan ? 3 : 1 });
    box.addChild(cbg);

    const nm = new PIXI.Text({
      text: clan.name,
      style: { fontSize: 10, fill: 0xffffff, fontFamily: 'monospace', align: 'center', wordWrap: true, wordWrapWidth: 95 }
    });
    nm.anchor.set(0.5); nm.y = 6;
    box.addChild(nm);

    box.on('pointerdown', () => { selectedClan = i; showMenu(); });
    menuContainer.addChild(box);
  }

  // ---- TANK SELECTION (fixed: tank below text) ----
  const tankLabel = new PIXI.Text({ text: 'TANK',
    style: { fontSize: 14, fill: 0xaaaaaa, fontFamily: 'monospace' } });
  tankLabel.anchor.set(0.5); tankLabel.x = sw/2; tankLabel.y = 210;
  menuContainer.addChild(tankLabel);

  const tankStartX = sw/2 - (TANK_MODELS.length * 170) / 2 + 85;
  for (let i = 0; i < TANK_MODELS.length; i++) {
    const model = TANK_MODELS[i];
    const box = new PIXI.Container();
    box.x = tankStartX + i * 170; box.y = 340;
    box.eventMode = 'static'; box.cursor = 'pointer';

    const tbg = new PIXI.Graphics();
    tbg.roundRect(-72, -100, 144, 210, 6);
    tbg.fill({ color: 0x222211, alpha: 0.8 });
    tbg.stroke({ color: i === selectedTank ? 0xffcc44 : 0x444433, width: i === selectedTank ? 3 : 1 });
    box.addChild(tbg);

    // Name at top
    const nm = new PIXI.Text({
      text: model.name,
      style: { fontSize: 14, fill: 0xffcc44, fontFamily: 'monospace', fontWeight: 'bold' }
    });
    nm.anchor.set(0.5); nm.y = -82;
    box.addChild(nm);

    // Description
    const desc = new PIXI.Text({
      text: model.desc,
      style: { fontSize: 10, fill: 0x999977, fontFamily: 'monospace' }
    });
    desc.anchor.set(0.5); desc.y = -65;
    box.addChild(desc);

    // Stat bars FIRST (above tank preview)
    const statNames = ['SPD', 'ARM', 'PWR', 'SLT'];
    const statKeys = ['speed', 'armor', 'power', 'slots'];
    const statColors = [0x44cc44, 0x4488cc, 0xcc4444, 0xccaa44];
    for (let s = 0; s < 4; s++) {
      const sy = -48 + s * 20;
      const label = new PIXI.Text({
        text: statNames[s],
        style: { fontSize: 9, fill: 0xaaaaaa, fontFamily: 'monospace' }
      });
      label.x = -58; label.y = sy;
      box.addChild(label);

      const barBg = new PIXI.Graphics();
      barBg.rect(-28, sy + 2, 82, 10); barBg.fill({ color: 0x000000, alpha: 0.5 });
      box.addChild(barBg);

      const barFill = new PIXI.Graphics();
      const fillW = (model.stats[statKeys[s]] / 10) * 82;
      barFill.rect(-28, sy + 2, fillW, 10); barFill.fill(statColors[s]);
      box.addChild(barFill);

      const val = new PIXI.Text({
        text: `${model.stats[statKeys[s]]}`,
        style: { fontSize: 8, fill: 0xffffff, fontFamily: 'monospace' }
      });
      val.x = 58; val.y = sy;
      box.addChild(val);
    }

    // Tank preview BELOW stat bars
    const preview = new PIXI.Sprite(createTankTexture(CLANS[selectedClan].color, model.scale));
    preview.anchor.set(0.5); preview.y = 60; preview.scale.set(1.3);
    box.addChild(preview);

    box.on('pointerdown', () => { selectedTank = i; showMenu(); });
    menuContainer.addChild(box);
  }

  // ---- HOTKEYS PANEL ----
  const hotkeysLines = [
    'CONTROLS',
    '',
    'WASD        Move tank',
    'Mouse       Aim turret',
    'Click/Space Fire weapon',
    '1-6         Select weapon',
    'E           Dig resources',
    '',
    'WEAPONS',
    '',
    '1 Cannon    High damage',
    '2 H.E.A.T.  Area blast',
    '3 Ricochet  Bouncing shots',
    '4 Homing    Heat-seeking',
    '5 Mine      Area denial',
    '6 EM Pulse  Disrupt electronics',
  ];
  const hotkeyText = new PIXI.Text({
    text: hotkeysLines.join('\n'),
    style: { fontSize: 10, fill: 0x888866, fontFamily: 'monospace', lineHeight: 14 }
  });
  hotkeyText.x = 20; hotkeyText.y = 120;
  menuContainer.addChild(hotkeyText);

  // Right-side info
  const infoLines = [
    'RESOURCES',
    '',
    'Fuel      Movement & weapons',
    'Materials Ammunition',
    '',
    'Resources show on radar.',
    'Drive near + press E to dig.',
    'Return to base to refuel',
    'and repair automatically.',
  ];
  const infoText = new PIXI.Text({
    text: infoLines.join('\n'),
    style: { fontSize: 10, fill: 0x888866, fontFamily: 'monospace', lineHeight: 14 }
  });
  infoText.x = sw - 220; infoText.y = 120;
  menuContainer.addChild(infoText);

  // ---- DEPLOY BUTTON ----
  const deployBtn = new PIXI.Container();
  deployBtn.x = sw/2; deployBtn.y = sh - 50;
  deployBtn.eventMode = 'static'; deployBtn.cursor = 'pointer';

  const btnBg = new PIXI.Graphics();
  btnBg.roundRect(-80, -22, 160, 44, 8);
  btnBg.fill(0x44aa44);
  btnBg.stroke({ color: 0x88ff88, width: 2 });
  deployBtn.addChild(btnBg);

  const btnText = new PIXI.Text({
    text: 'DEPLOY',
    style: { fontSize: 20, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' }
  });
  btnText.anchor.set(0.5);
  deployBtn.addChild(btnText);

  deployBtn.on('pointerdown', () => startGame());
  menuContainer.addChild(deployBtn);
}

// ============================================================
// START GAME
// ============================================================
function startGame() {
  gameState = 'playing';
  menuContainer.visible = false;
  worldContainer.visible = true;
  hudContainer.visible = true;
  app.canvas.style.cursor = 'crosshair';

  tankLayer.removeChildren();
  projectileLayer.removeChildren();
  particleLayer.removeChildren();
  enemies.length = 0;
  projectiles.length = 0;
  particles.length = 0;
  placedMines.length = 0;

  createPlayerTank();
  createEnemies();
  createHUD();
}

// ============================================================
// INPUT — E = dig (not D)
// ============================================================
const keys = {};
let mouseX = 0, mouseY = 0;
let digPressed = false; // one-shot flag for E key

window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  const k = e.key;
  if (k >= '1' && k <= '6') player.weaponIndex = parseInt(k) - 1;
  if (k.toLowerCase() === 'e') digPressed = true;
});
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mousedown', () => keys['mouse'] = true);
window.addEventListener('mouseup', () => keys['mouse'] = false);

// ============================================================
// GAME LOOP
// ============================================================
app.ticker.add(() => {
  if (gameState !== 'playing') return;

  const sw = app.screen.width, sh = app.screen.height;

  // ---- PLAYER MOVEMENT (D = right, no conflict) ----
  if (player.empTimer > 0) {
    player.empTimer--;
  } else {
    let mx = 0, my = 0;
    if (keys['w'] || keys['arrowup']) my -= 1;
    if (keys['s'] || keys['arrowdown']) my += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (mx || my) {
      const a = Math.atan2(my, mx);
      player.angle = a;
      const spd = player.speed;
      const nx = player.x + Math.cos(a) * spd;
      const ny = player.y + Math.sin(a) * spd;
      const r = 15;
      if (isPassable(nx + r, player.y) && isPassable(nx - r, player.y) &&
          isPassable(nx, player.y + r) && isPassable(nx, player.y - r))
        player.x = nx;
      if (isPassable(player.x + r, ny) && isPassable(player.x - r, ny) &&
          isPassable(player.x, ny + r) && isPassable(player.x, ny - r))
        player.y = ny;
      player.x = Math.max(GRID, Math.min(WORLD_W - GRID, player.x));
      player.y = Math.max(GRID, Math.min(WORLD_H - GRID, player.y));
      player.fuel = Math.max(0, player.fuel - 0.003);
    }
  }

  // Camera
  const camX = player.x - sw/2;
  const camY = player.y - sh/2;
  worldContainer.x = -camX; worldContainer.y = -camY;

  // Turret aim
  const wmx = mouseX + camX, wmy = mouseY + camY;
  player.turretAngle = Math.atan2(wmy - player.y, wmx - player.x) + Math.PI/2;
  playerContainer.x = player.x; playerContainer.y = player.y;
  playerBody.rotation = player.angle + Math.PI/2;
  playerTurret.rotation = player.turretAngle;

  // ---- DIG RESOURCES (E key, one-shot) ----
  if (digPressed) {
    digPressed = false;
    for (const rn of resourceNodes) {
      if (!rn.alive) continue;
      if (Math.hypot(rn.x - player.x, rn.y - player.y) < 45) {
        if (!rn.discovered) {
          // Uncover the resource
          rn.discovered = true;
          rn.graphic.visible = true;
          spawnParticle(rn.x, rn.y, 0xccaa66, 3, 15);
          spawnParticle(rn.x, rn.y, 0xccaa66, 3, 15);
          spawnParticle(rn.x, rn.y, 0xccaa66, 3, 15);
        } else {
          // Already uncovered — collect it
          if (rn.type === 'fuel' && player.fuel < player.maxFuel) {
            const take = Math.min(rn.amount, player.maxFuel - player.fuel);
            player.fuel += take; rn.amount -= take;
          } else if (rn.type === 'material' && player.materials < player.maxMaterials) {
            const take = Math.min(rn.amount, player.maxMaterials - player.materials);
            player.materials += take; rn.amount -= take;
          }
          if (rn.amount <= 0) {
            rn.alive = false; rn.graphic.visible = false; rn.discovered = false;
            rn.respawnTimer = 1800;
            spawnParticle(rn.x, rn.y, rn.type === 'fuel' ? 0xffcc44 : 0x4488cc, 4, 20);
          }
        }
        break;
      }
    }
  }

  // Resource respawn
  for (const rn of resourceNodes) {
    if (rn.alive) continue;
    rn.respawnTimer--;
    if (rn.respawnTimer <= 0) {
      rn.alive = true; rn.discovered = false; rn.graphic.visible = false;
      rn.amount = 3 + Math.floor(Math.random() * 4);
    }
  }

  // ---- BASE DETECTION (depot) — repair + refuel only here ----
  player.inBase = false;
  const playerClanBase = bases.find(b => b.clan.id === selectedClan);
  if (playerClanBase) {
    const bx = playerClanBase.x, by = playerClanBase.y;
    const bw = playerClanBase.w, bh = playerClanBase.h;
    if (player.x > bx && player.x < bx + bw && player.y > by && player.y < by + bh) {
      player.inBase = true;
      if (player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 0.1);
      if (player.fuel < player.maxFuel) player.fuel = Math.min(player.maxFuel, player.fuel + 0.05);
      if (player.materials < player.maxMaterials) player.materials = Math.min(player.maxMaterials, player.materials + 0.03);
    }
  }

  // ---- PLAYER SHOOTING ----
  const now = Date.now();
  const weapon = WEAPONS[player.weaponIndex];
  if ((keys['mouse'] || keys[' ']) && now - lastShot > weapon.reload && player.empTimer <= 0) {
    if (player.fuel >= weapon.fuelCost && player.materials >= weapon.matCost) {
      lastShot = now;
      player.fuel -= weapon.fuelCost;
      player.materials -= weapon.matCost;
      const a = player.turretAngle - Math.PI/2;
      spawnProjectile(player.x, player.y, a, weapon, 'player', player);
    }
  }

  // ---- ENEMY AI ----
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.empTimer > 0) { e.empTimer--; continue; }

    const dist = Math.hypot(e.x - player.x, e.y - player.y);
    e.ai.timer--;

    if (dist < 450) e.ai.state = 'attack';
    else if (e.ai.timer <= 0) {
      e.ai.state = 'patrol';
      e.ai.targetAngle = Math.random() * Math.PI * 2;
      e.ai.timer = 60 + Math.random() * 120;
    }

    if (e.ai.state === 'patrol') {
      const nx = e.x + Math.cos(e.ai.targetAngle) * 0.8;
      const ny = e.y + Math.sin(e.ai.targetAngle) * 0.8;
      if (isPassable(nx, ny)) { e.x = nx; e.y = ny; }
      else { e.ai.targetAngle = Math.random() * Math.PI * 2; e.ai.timer = 30; }
      e.angle = e.ai.targetAngle;
    } else {
      const atp = Math.atan2(player.y - e.y, player.x - e.x);
      e.turretAngle = atp + Math.PI/2;
      if (dist > 180) {
        const nx = e.x + Math.cos(atp) * 1.2;
        const ny = e.y + Math.sin(atp) * 1.2;
        if (isPassable(nx, ny)) { e.x = nx; e.y = ny; }
        e.angle = atp;
      }
      e.ai.shootTimer--;
      if (e.ai.shootTimer <= 0 && dist < 450) {
        e.ai.shootTimer = 50 + Math.random() * 50;
        const a = e.turretAngle - Math.PI/2;
        const ew = { ...WEAPONS[0], damage: 10, speed: 5, size: 3, color: e.clan.color };
        spawnProjectile(e.x, e.y, a, ew, 'enemy', e);
      }
    }

    e.x = Math.max(GRID, Math.min(WORLD_W - GRID, e.x));
    e.y = Math.max(GRID, Math.min(WORLD_H - GRID, e.y));
    e.container.x = e.x; e.container.y = e.y;
    e.body.rotation = e.angle + Math.PI/2;
    e.turret.rotation = e.turretAngle;
    e.hpBar.clear();
    e.hpBar.rect(-20, -32, (e.hp / e.maxHp) * 40, 4);
    e.hpBar.fill(e.hp > e.maxHp * 0.5 ? 0x44cc44 : e.hp > e.maxHp * 0.25 ? 0xcccc44 : 0xcc4444);
  }

  // ---- BASE DEFENSE TURRETS ----
  for (const base of bases) {
    for (const t of base.turrets) {
      let closest = null, closestDist = 400;
      const allTargets = [];
      if (base.clan.id === selectedClan) {
        for (const e of enemies) { if (e.alive) allTargets.push(e); }
      } else {
        allTargets.push({ x: player.x, y: player.y, alive: player.alive });
      }
      for (const tgt of allTargets) {
        if (!tgt.alive) continue;
        const d = Math.hypot(tgt.x - t.x, tgt.y - t.y);
        if (d < closestDist) { closest = tgt; closestDist = d; }
      }
      if (closest) {
        t.angle = Math.atan2(closest.y - t.y, closest.x - t.x) + Math.PI/2;
        t.barrel.rotation = t.angle;
        t.shootTimer--;
        if (t.shootTimer <= 0) {
          t.shootTimer = 60 + Math.random() * 30;
          const a = t.angle - Math.PI/2;
          const tw = { speed: 6, damage: 15, size: 3, color: base.clan.color, type: 'bullet',
                       reload: 0, fuelCost: 0, matCost: 0 };
          spawnProjectile(t.x, t.y, a, tw, base.clan.id === selectedClan ? 'player' : 'enemy', null);
        }
      }
    }
  }

  // ---- PROJECTILE UPDATE ----
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];

    if (p.type === 'homing' && p.owner === 'player') {
      let closest = null, closestDist = 300;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - p.graphic.x, e.y - p.graphic.y);
        if (d < closestDist) { closest = e; closestDist = d; }
      }
      if (closest) {
        const desired = Math.atan2(closest.y - p.graphic.y, closest.x - p.graphic.x);
        const current = Math.atan2(p.vy, p.vx);
        let diff = desired - current;
        while (diff > Math.PI) diff -= Math.PI*2;
        while (diff < -Math.PI) diff += Math.PI*2;
        const turn = Math.sign(diff) * Math.min(Math.abs(diff), p.turnRate);
        const newAngle = current + turn;
        const spd = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(newAngle) * spd;
        p.vy = Math.sin(newAngle) * spd;
      }
    }

    p.graphic.x += p.vx; p.graphic.y += p.vy;
    p.life--;

    if (p.type === 'ricochet' && p.bounces > 0) {
      if (!isPassable(p.graphic.x, p.graphic.y)) {
        const prevX = p.graphic.x - p.vx, prevY = p.graphic.y - p.vy;
        if (isPassable(prevX, p.graphic.y)) p.vy = -p.vy;
        else if (isPassable(p.graphic.x, prevY)) p.vx = -p.vx;
        else { p.vx = -p.vx; p.vy = -p.vy; }
        p.bounces--;
        p.graphic.x += p.vx; p.graphic.y += p.vy;
        spawnParticle(p.graphic.x, p.graphic.y, 0x66ffff, 2, 10);
      }
    }

    if (p.type !== 'ricochet' && !isPassable(p.graphic.x, p.graphic.y)) {
      spawnExplosion(p.graphic.x, p.graphic.y, 4);
      projectileLayer.removeChild(p.graphic); projectiles.splice(i, 1);
      continue;
    }

    if (p.life <= 0) {
      if (p.blastRadius > 0) {
        spawnExplosion(p.graphic.x, p.graphic.y, 15);
        for (const e of enemies) {
          if (!e.alive) continue;
          if (Math.hypot(p.graphic.x - e.x, p.graphic.y - e.y) < p.blastRadius) {
            e.hp -= p.damage;
            if (e.hp <= 0) { e.alive = false; e.container.visible = false; spawnExplosion(e.x, e.y, 25); }
          }
        }
        if (p.owner === 'enemy' && Math.hypot(p.graphic.x - player.x, p.graphic.y - player.y) < p.blastRadius) {
          player.hp -= p.damage / player.armor;
        }
      }
      projectileLayer.removeChild(p.graphic); projectiles.splice(i, 1);
      continue;
    }

    if (p.owner === 'player') {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (Math.hypot(p.graphic.x - e.x, p.graphic.y - e.y) < 22) {
          e.hp -= p.damage;
          if (p.empDuration > 0) { e.empTimer = p.empDuration; spawnEMPEffect(e.x, e.y); }
          spawnExplosion(p.graphic.x, p.graphic.y, 8);
          if (e.hp <= 0) {
            e.alive = false; e.container.visible = false;
            spawnExplosion(e.x, e.y, 25);
            const dropType = Math.random() < 0.5 ? 'fuel' : 'material';
            if (dropType === 'fuel') player.fuel = Math.min(player.maxFuel, player.fuel + 2);
            else player.materials = Math.min(player.maxMaterials, player.materials + 2);
          }
          if (p.blastRadius > 0) {
            for (const e2 of enemies) {
              if (!e2.alive || e2 === e) continue;
              if (Math.hypot(p.graphic.x - e2.x, p.graphic.y - e2.y) < p.blastRadius) {
                e2.hp -= p.damage * 0.5;
                if (e2.hp <= 0) { e2.alive = false; e2.container.visible = false; spawnExplosion(e2.x, e2.y, 25); }
              }
            }
          }
          projectileLayer.removeChild(p.graphic); projectiles.splice(i, 1);
          break;
        }
      }
    }

    if (p.owner === 'enemy') {
      if (Math.hypot(p.graphic.x - player.x, p.graphic.y - player.y) < 22) {
        player.hp -= p.damage / player.armor;
        if (p.empDuration > 0) { player.empTimer = p.empDuration; spawnEMPEffect(player.x, player.y); }
        spawnExplosion(p.graphic.x, p.graphic.y, 6);
        projectileLayer.removeChild(p.graphic); projectiles.splice(i, 1);
        if (player.hp <= 0) {
          player.hp = player.maxHp;
          const base = BASE_POSITIONS[CLANS[selectedClan].baseCorner];
          player.x = base.x * GRID + 3.5 * GRID;
          player.y = base.y * GRID + 3.5 * GRID;
          player.fuel = Math.max(5, player.fuel);
          spawnExplosion(player.x, player.y, 20);
        }
      }
    }
  }

  // ---- MINE UPDATE ----
  for (let i = placedMines.length - 1; i >= 0; i--) {
    const m = placedMines[i];
    m.life--;
    if (m.armTimer > 0) { m.armTimer--; continue; }
    m.armed = true;
    let triggered = false;
    if (m.owner === 'player') {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (Math.hypot(m.x - e.x, m.y - e.y) < 30) {
          e.hp -= m.damage;
          if (e.hp <= 0) { e.alive = false; e.container.visible = false; }
          triggered = true; break;
        }
      }
    } else {
      if (Math.hypot(m.x - player.x, m.y - player.y) < 30) {
        player.hp -= m.damage / player.armor;
        triggered = true;
      }
    }
    if (triggered || m.life <= 0) {
      spawnExplosion(m.x, m.y, 15);
      projectileLayer.removeChild(m.graphic);
      placedMines.splice(i, 1);
    }
  }

  // ---- PARTICLE UPDATE ----
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.graphic.x += p.vx; p.graphic.y += p.vy;
    p.life--;
    p.graphic.alpha = p.life / p.maxLife;
    if (p.life <= 0) { particleLayer.removeChild(p.graphic); particles.splice(i, 1); }
  }

  // ---- HUD UPDATE ----
  if (!hudHpBg) return;

  // Minimap
  const mmCX = sw - mmSize/2 - 20, mmCY = mmSize/2 + 20;
  mmFrame.x = mmCX; mmFrame.y = mmCY; mmFrame.scale.set(mmSize / 140 * 1.14);
  mmBg.clear(); mmBg.circle(mmCX, mmCY, mmSize/2 - 8); mmBg.fill(0x9a8a5a);
  mmContent.clear();
  const mmx = mmCX - mmSize/2 + 8, mmy = mmCY - mmSize/2 + 8, mmw = mmSize - 16, mmh = mmSize - 16;

  // Walls on minimap
  for (let gy = 0; gy < GH; gy += 2) {
    for (let gx = 0; gx < GW; gx += 2) {
      if (mapGrid[gy][gx] === CELL.WALL || mapGrid[gy][gx] === CELL.TREE || mapGrid[gy][gx] === CELL.ROCK) {
        mmContent.rect(mmx + (gx / GW) * mmw, mmy + (gy / GH) * mmh, 2, 2);
        mmContent.fill({ color: 0x5a4a38, alpha: 0.6 });
      }
    }
  }

  // Bases on minimap
  for (const base of bases) {
    const bxx = mmx + (base.x / WORLD_W) * mmw;
    const byy = mmy + (base.y / WORLD_H) * mmh;
    const bsw = (base.w / WORLD_W) * mmw;
    const bsh = (base.h / WORLD_H) * mmh;
    mmContent.rect(bxx, byy, bsw, bsh);
    mmContent.fill({ color: base.clan.color, alpha: 0.4 });
  }

  // Resources on minimap (ALWAYS visible here, even if not discovered)
  for (const rn of resourceNodes) {
    if (!rn.alive) continue;
    mmContent.circle(mmx + (rn.x / WORLD_W) * mmw, mmy + (rn.y / WORLD_H) * mmh, 2);
    mmContent.fill(rn.type === 'fuel' ? 0xffcc44 : 0x4488cc);
  }

  // Enemies on minimap
  for (const e of enemies) {
    if (!e.alive) continue;
    mmContent.rect(mmx + (e.x / WORLD_W) * mmw - 2, mmy + (e.y / WORLD_H) * mmh - 2, 4, 4);
    mmContent.fill(e.clan.color);
  }

  // Player on minimap
  mmContent.rect(mmx + (player.x / WORLD_W) * mmw - 3, mmy + (player.y / WORLD_H) * mmh - 3, 6, 6);
  mmContent.fill(0xffffff);

  // Health bar
  const barW = 180, barH = 14, barX = 15, hpY = sh - 42;
  hudHpBg.clear(); hudHpBg.rect(barX, hpY, barW + 4, barH + 4); hudHpBg.fill({ color: 0x000000, alpha: 0.6 });
  hudHpFill.clear(); hudHpFill.rect(barX + 2, hpY + 2, (player.hp / player.maxHp) * barW, barH);
  hudHpFill.fill(player.hp > player.maxHp * 0.5 ? 0x44cc44 : player.hp > player.maxHp * 0.25 ? 0xcccc44 : 0xcc4444);
  hudHpText.text = `HP ${Math.ceil(player.hp)}/${player.maxHp}`;
  hudHpText.x = barX + 6; hudHpText.y = hpY + 2;

  // Fuel bar
  const fuelY = hpY - 22;
  hudFuelBg.clear(); hudFuelBg.rect(barX, fuelY, barW + 4, barH + 4); hudFuelBg.fill({ color: 0x000000, alpha: 0.6 });
  hudFuelFill.clear(); hudFuelFill.rect(barX + 2, fuelY + 2, (player.fuel / player.maxFuel) * barW, barH);
  hudFuelFill.fill(0xddaa22);
  hudFuelText.text = `FUEL ${player.fuel.toFixed(1)}/${player.maxFuel}`;
  hudFuelText.x = barX + 6; hudFuelText.y = fuelY + 2;

  // Materials bar
  const matY = fuelY - 22;
  hudMatBg.clear(); hudMatBg.rect(barX, matY, barW + 4, barH + 4); hudMatBg.fill({ color: 0x000000, alpha: 0.6 });
  hudMatFill.clear(); hudMatFill.rect(barX + 2, matY + 2, (player.materials / player.maxMaterials) * barW, barH);
  hudMatFill.fill(0x4488cc);
  hudMatText.text = `MAT ${Math.floor(player.materials)}/${player.maxMaterials}`;
  hudMatText.x = barX + 6; hudMatText.y = matY + 2;

  // Weapon display
  const w = WEAPONS[player.weaponIndex];
  const canFire = player.fuel >= w.fuelCost && player.materials >= w.matCost;
  hudWeapon.text = `[${w.key}] ${w.name}${canFire ? '' : ' (LOW RES)'}`;
  hudWeapon.style.fill = canFire ? 0xffffff : 0xff4444;
  hudWeapon.x = barX; hudWeapon.y = matY - 22;

  // Enemy count
  const alive = enemies.filter(e => e.alive).length;
  hudEnemy.text = `Hostiles: ${alive}/${enemies.length}`;
  hudEnemy.x = barX; hudEnemy.y = matY - 42;

  // Depot overlay
  if (player.inBase) {
    hudDepot.text = 'CLAN DEPOT\nRepairing & Refueling...';
    hudDepot.x = sw / 2; hudDepot.y = 80;
    hudDepot.visible = true;
  } else {
    hudDepot.visible = false;
  }

  // Safety respawn
  if (player.hp <= 0) {
    player.hp = player.maxHp;
    const base = BASE_POSITIONS[CLANS[selectedClan].baseCorner];
    player.x = base.x * GRID + 3.5 * GRID;
    player.y = base.y * GRID + 3.5 * GRID;
  }
});

// ============================================================
// INITIALIZE
// ============================================================
showMenu();

})();
