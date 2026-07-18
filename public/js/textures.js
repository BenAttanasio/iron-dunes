// Procedural texture generation behind a central registry.
// getTexture(key) caches by key; swapping in real art later means
// replacing a generator with a PIXI.Assets lookup — call sites don't change.
//
// Keys: 'tank:<hexcolor>:<scale>', 'tankwhite:<scale>', 'turret', 'tree',
// 'rock', 'brick', 'crater', 'mound', 'track', 'crate:fuel', 'crate:material',
// 'vignette', 'icon:shell', 'icon:fuel', 'schematic', 'flash'

const PIXI = window.PIXI;

// ---------- noise ----------
export function makeNoise(seed) {
  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263 + seed) & 0x7fffffff;
    h = ((h >> 13) ^ h) * 1274126177;
    return ((h >> 16) ^ h) & 0x7fffffff;
  }
  function noise2d(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const n00 = hash(ix, iy) / 0x7fffffff, n10 = hash(ix + 1, iy) / 0x7fffffff;
    const n01 = hash(ix, iy + 1) / 0x7fffffff, n11 = hash(ix + 1, iy + 1) / 0x7fffffff;
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
  }
  function fbm(x, y, oct) {
    let v = 0, a = 1, f = 1, m = 0;
    for (let i = 0; i < oct; i++) { v += noise2d(x * f, y * f) * a; m += a; a *= 0.5; f *= 2; }
    return v / m;
  }
  return { noise2d, fbm };
}
export const N = makeNoise(1274126177);

// ---------- color utils ----------
export function hexToRgb(hex) { return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }; }
export function lighten(c, a) { const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff; return ((Math.min(255, r + a) << 16) | (Math.min(255, g + a) << 8) | Math.min(255, b + a)); }
export function darken(c, a) { const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff; return ((Math.max(0, r - a) << 16) | (Math.max(0, g - a) << 8) | Math.max(0, b - a)); }

// ---------- sand tiles (parametrized by world position, not registry-cached) ----------
export function generateSandTile(w, h, wx, wy) {
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
      // Warm palette tuned toward the original's sand (#c89858-ish)
      d[i]     = Math.min(255, Math.max(0, 198 + v + grain));
      d[i + 1] = Math.min(255, Math.max(0, 155 + (v + grain) * 0.8));
      d[i + 2] = Math.min(255, Math.max(0, 92 + (v + grain) * 0.5));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------- registry ----------
const cache = new Map();

export function getTexture(key) {
  if (cache.has(key)) return cache.get(key);
  const [kind, ...args] = key.split(':');
  const gen = GENERATORS[kind];
  if (!gen) throw new Error(`No texture generator for '${key}'`);
  const tex = gen(...args);
  cache.set(key, tex);
  return tex;
}

function fromCanvas(c) { return PIXI.Texture.from(c); }

// ---------- generators ----------
function genTank(colorStr, scaleStr, white = false) {
  const bodyColor = parseInt(colorStr, 16);
  const s = parseFloat(scaleStr) || 1;
  const w = Math.ceil(48 * s), h = Math.ceil(56 * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const cx = w / 2, cy = h / 2;
  const rgb = hexToRgb(bodyColor);
  const dk = hexToRgb(darken(bodyColor, 50));
  const lt = hexToRgb(lighten(bodyColor, 35));

  if (!white) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(cx + 2, cy + 3, 18 * s, 20 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  // tracks — dark cartoon outline for the hand-drawn look
  for (const dir of [-1, 1]) {
    const tx = cx + dir * 14 * s;
    ctx.fillStyle = white ? '#fff' : '#2a2a2a';
    ctx.fillRect(tx - 5 * s, cy - 22 * s, 10 * s, 44 * s);
    if (!white) {
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.strokeRect(tx - 5 * s, cy - 22 * s, 10 * s, 44 * s);
      ctx.strokeStyle = '#444'; ctx.lineWidth = 0.8;
      for (let i = -20; i < 22; i += 4) {
        ctx.beginPath(); ctx.moveTo(tx - 5 * s, cy + i * s); ctx.lineTo(tx + 5 * s, cy + i * s); ctx.stroke();
      }
    }
  }
  // hull
  if (white) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 12 * s, cy - 16 * s, 24 * s, 32 * s);
    ctx.beginPath(); ctx.arc(cx, cy, 11 * s, 0, Math.PI * 2); ctx.fill();
    return fromCanvas(c);
  }
  const bg = ctx.createLinearGradient(cx - 12 * s, cy, cx + 12 * s, cy);
  bg.addColorStop(0, `rgb(${dk.r},${dk.g},${dk.b})`);
  bg.addColorStop(0.3, `rgb(${lt.r},${lt.g},${lt.b})`);
  bg.addColorStop(0.7, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
  bg.addColorStop(1, `rgb(${dk.r},${dk.g},${dk.b})`);
  ctx.fillStyle = bg;
  ctx.fillRect(cx - 12 * s, cy - 16 * s, 24 * s, 32 * s);
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.8;
  ctx.strokeRect(cx - 12 * s, cy - 16 * s, 24 * s, 32 * s);
  // turret ring
  const tg = ctx.createRadialGradient(cx - 2 * s, cy - 2 * s, 1, cx, cy, 11 * s);
  tg.addColorStop(0, `rgb(${Math.min(255, lt.r + 20)},${Math.min(255, lt.g + 20)},${Math.min(255, lt.b + 20)})`);
  tg.addColorStop(0.6, `rgb(${rgb.r},${rgb.g},${rgb.b})`);
  tg.addColorStop(1, `rgb(${dk.r},${dk.g},${dk.b})`);
  ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(cx, cy, 11 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.8; ctx.stroke();
  const ig = ctx.createRadialGradient(cx - 1 * s, cy - 1 * s, 0, cx, cy, 7 * s);
  ig.addColorStop(0, `rgba(${lt.r},${lt.g},${lt.b},0.8)`);
  ig.addColorStop(1, `rgb(${Math.max(0, dk.r + 10)},${Math.max(0, dk.g + 10)},${Math.max(0, dk.b + 10)})`);
  ctx.fillStyle = ig; ctx.beginPath(); ctx.arc(cx, cy, 7 * s, 0, Math.PI * 2); ctx.fill();
  return fromCanvas(c);
}

function genTurret() {
  const c = document.createElement('canvas'); c.width = 12; c.height = 36;
  const ctx = c.getContext('2d'); const cx = 6;
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(cx - 3 + 1, 2, 6, 28);
  const bg = ctx.createLinearGradient(cx - 3, 0, cx + 3, 0);
  bg.addColorStop(0, '#333'); bg.addColorStop(0.4, '#666');
  bg.addColorStop(0.6, '#555'); bg.addColorStop(1, '#2a2a2a');
  ctx.fillStyle = bg; ctx.fillRect(cx - 3, 0, 6, 28);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.strokeRect(cx - 3, 0, 6, 28);
  ctx.fillStyle = '#222'; ctx.fillRect(cx - 4, 0, 8, 4);
  ctx.fillStyle = '#555'; ctx.fillRect(cx - 3.5, 20, 7, 2);
  return fromCanvas(c);
}

function genTree() {
  // Leafy cartoon bush with dark outline, like the reference's green clusters.
  const c = document.createElement('canvas'); c.width = 48; c.height = 48;
  const ctx = c.getContext('2d'); const cx = 24, cy = 26;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + 8, 16, 10, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a3518'; ctx.fillRect(cx - 2, cy, 4, 10);
  const lobes = [{ x: 0, y: -8, r: 10 }, { x: -9, y: -4, r: 8 }, { x: 9, y: -3, r: 8 },
    { x: -5, y: -14, r: 7 }, { x: 5, y: -12, r: 7 }, { x: 0, y: -16, r: 6 }];
  // outline pass
  ctx.fillStyle = '#0e3a14';
  for (const l of lobes) { ctx.beginPath(); ctx.arc(cx + l.x, cy + l.y, l.r + 1.8, 0, Math.PI * 2); ctx.fill(); }
  const greens = ['#1e8a2e', '#23902f', '#1f7e28', '#2a9838', '#269432', '#2ea040'];
  lobes.forEach((l, i) => {
    ctx.fillStyle = greens[i % greens.length];
    ctx.beginPath(); ctx.arc(cx + l.x, cy + l.y, l.r, 0, Math.PI * 2); ctx.fill();
  });
  for (const h of [{ x: -3, y: -12, r: 5 }, { x: 4, y: -8, r: 4 }, { x: -7, y: -6, r: 3 }, { x: 1, y: -17, r: 3 }]) {
    ctx.fillStyle = '#4abb56';
    ctx.beginPath(); ctx.arc(cx + h.x, cy + h.y, h.r, 0, Math.PI * 2); ctx.fill();
  }
  return fromCanvas(c);
}

function genRock() {
  const c = document.createElement('canvas'); c.width = 40; c.height = 40;
  const ctx = c.getContext('2d'); const cx = 20, cy = 20;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx + 3, cy + 5, 14, 10, 0.1, 0, Math.PI * 2); ctx.fill();
  const rg = ctx.createRadialGradient(cx - 3, cy - 4, 2, cx, cy, 12);
  rg.addColorStop(0, '#a89880'); rg.addColorStop(0.5, '#8a7a68'); rg.addColorStop(1, '#6a5a48');
  ctx.fillStyle = rg;
  ctx.beginPath(); ctx.moveTo(cx - 10, cy + 4); ctx.quadraticCurveTo(cx - 12, cy - 6, cx - 3, cy - 10);
  ctx.quadraticCurveTo(cx + 4, cy - 12, cx + 10, cy - 6); ctx.quadraticCurveTo(cx + 14, cy + 1, cx + 10, cy + 5);
  ctx.quadraticCurveTo(cx + 3, cy + 8, cx - 10, cy + 4); ctx.fill();
  ctx.strokeStyle = '#3a3228'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(180,170,150,0.4)';
  ctx.beginPath(); ctx.ellipse(cx - 2, cy - 4, 5, 3, -0.3, 0, Math.PI * 2); ctx.fill();
  return fromCanvas(c);
}

function genBrick() {
  // Red brick block like the reference's red obstacle.
  const c = document.createElement('canvas'); c.width = 50; c.height = 50;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9c2f2a'; ctx.fillRect(0, 0, 50, 50);
  ctx.strokeStyle = '#5e1512'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 48, 48);
  ctx.strokeStyle = '#6e1f1a'; ctx.lineWidth = 1.5;
  for (let y = 0; y <= 50; y += 12) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(50, y); ctx.stroke(); }
  for (let row = 0; row < 5; row++) {
    const off = row % 2 ? 12 : 0;
    for (let x = off; x <= 50; x += 24) {
      ctx.beginPath(); ctx.moveTo(x, row * 12); ctx.lineTo(x, row * 12 + 12); ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(2, 2, 46, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(2, 44, 46, 4);
  return fromCanvas(c);
}

function genCrater() {
  const c = document.createElement('canvas'); c.width = 48; c.height = 48;
  const ctx = c.getContext('2d'); const cx = 24, cy = 24;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 22);
  g.addColorStop(0, 'rgba(40,28,16,0.75)');
  g.addColorStop(0.55, 'rgba(70,50,28,0.45)');
  g.addColorStop(1, 'rgba(90,70,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
  // ragged rim clumps
  ctx.fillStyle = 'rgba(60,42,22,0.5)';
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
    const r = 14 + Math.sin(a * 3) * 3;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  return fromCanvas(c);
}

function genMound() {
  // Disturbed-sand mound marking a buried resource node.
  const c = document.createElement('canvas'); c.width = 36; c.height = 28;
  const ctx = c.getContext('2d'); const cx = 18, cy = 15;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 4, 13, 7, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(cx - 3, cy - 4, 1, cx, cy, 13);
  g.addColorStop(0, '#e0b878'); g.addColorStop(0.7, '#c89858'); g.addColorStop(1, '#a87838');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, 13, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(120,86,40,0.6)'; ctx.lineWidth = 1;
  for (const [ox, oy, r] of [[-5, -2, 3], [4, 1, 4], [0, 3, 2.5]]) {
    ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0.3, Math.PI * 1.4); ctx.stroke();
  }
  return fromCanvas(c);
}

function genTrack() {
  const c = document.createElement('canvas'); c.width = 6; c.height = 10;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(60,44,24,0.35)';
  ctx.fillRect(0, 0, 6, 4); ctx.fillRect(0, 6, 6, 4);
  return fromCanvas(c);
}

function genCrate(type) {
  const c = document.createElement('canvas'); c.width = 24; c.height = 24;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(13, 14, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7a5a30'; ctx.fillRect(3, 3, 18, 18);
  ctx.strokeStyle = '#4a3418'; ctx.lineWidth = 2; ctx.strokeRect(3, 3, 18, 18);
  ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(21, 21); ctx.moveTo(21, 3); ctx.lineTo(3, 21); ctx.stroke();
  ctx.fillStyle = type === 'fuel' ? '#ffcc44' : '#55aaee';
  ctx.beginPath(); ctx.arc(12, 12, 4, 0, Math.PI * 2); ctx.fill();
  return fromCanvas(c);
}

function genVignette() {
  const sz = 256;
  const c = document.createElement('canvas'); c.width = sz; c.height = sz;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(sz / 2, sz / 2, sz * 0.3, sz / 2, sz / 2, sz * 0.55);
  g.addColorStop(0, 'rgba(180,0,0,0)');
  g.addColorStop(1, 'rgba(180,0,0,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, sz, sz);
  return fromCanvas(c);
}

function genIconShell() {
  // Green wireframe shell like the reference HUD.
  const c = document.createElement('canvas'); c.width = 20; c.height = 34;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#00cc44'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(10, 2); ctx.quadraticCurveTo(17, 12, 16, 24); ctx.lineTo(16, 30); ctx.lineTo(4, 30);
  ctx.lineTo(4, 24); ctx.quadraticCurveTo(3, 12, 10, 2);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(10, 30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 24); ctx.lineTo(16, 24); ctx.stroke();
  return fromCanvas(c);
}

function genIconFuel() {
  const c = document.createElement('canvas'); c.width = 24; c.height = 30;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#00cc44'; ctx.lineWidth = 1.5;
  ctx.strokeRect(4, 6, 16, 20);
  ctx.beginPath(); ctx.moveTo(8, 6); ctx.lineTo(8, 2); ctx.lineTo(14, 2); ctx.lineTo(14, 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(7, 14); ctx.lineTo(12, 19); ctx.lineTo(10, 19); ctx.lineTo(15, 24); ctx.stroke();
  return fromCanvas(c);
}

function genSchematic() {
  // Green wireframe top-down tank for the damage panel (drawn facing up).
  const c = document.createElement('canvas'); c.width = 72; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#00cc44'; ctx.lineWidth = 1.5;
  // tracks
  ctx.strokeRect(6, 6, 14, 52);
  ctx.strokeRect(52, 6, 14, 52);
  for (let y = 10; y < 58; y += 6) {
    ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(20, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(52, y); ctx.lineTo(66, y); ctx.stroke();
  }
  // hull
  ctx.strokeRect(22, 12, 28, 40);
  // turret + barrel
  ctx.beginPath(); ctx.arc(36, 34, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(36, 24); ctx.lineTo(36, 6); ctx.stroke();
  return fromCanvas(c);
}

function genFlash() {
  const c = document.createElement('canvas'); c.width = 24; c.height = 24;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(12, 12, 1, 12, 12, 11);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.4, 'rgba(255,200,80,0.8)');
  g.addColorStop(1, 'rgba(255,140,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(12, 12, 11, 0, Math.PI * 2); ctx.fill();
  return fromCanvas(c);
}

const GENERATORS = {
  tank: (color, scale) => genTank(color, scale, false),
  tankwhite: (scale) => genTank('ffffff', scale, true),
  turret: genTurret,
  tree: genTree,
  rock: genRock,
  brick: genBrick,
  crater: genCrater,
  mound: genMound,
  track: genTrack,
  crate: genCrate,
  vignette: genVignette,
  icon: (which) => which === 'shell' ? genIconShell() : genIconFuel(),
  schematic: genSchematic,
  flash: genFlash,
};

export function tankTextureKey(color, scale) {
  return `tank:${color.toString(16).padStart(6, '0')}:${scale}`;
}
