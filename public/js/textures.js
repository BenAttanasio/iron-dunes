// Procedural texture generation behind a central registry.
//
// getTexture(key) caches by key. Keys that assets.js has registered (everything
// under 'fx:') resolve to loaded PNGs; everything else is painted here
// on a 2D canvas. A key with neither a registration nor a generator falls back to
// a soft blob rather than throwing, so a failed asset download degrades instead of
// breaking the game.
//
// Art direction target is Old Images/preview.webp: warm rippled sand, heavy dark
// outlines on every object, soft down-right cast shadows, painted highlight passes,
// and a green phosphor wireframe HUD.
//
// Keys: 'tank:<hexcolor>:<scale>:<chassis>', 'tankwhite:<scale>:<chassis>',
// 'turret', 'tree:<variant>',
// 'rock:<variant>', 'brick', 'crater', 'mound', 'track', 'crate:fuel',
// 'crate:material', 'prop:<kind>', 'shot:<weaponType>', 'bunker:<hexcolor>',
// 'vignette', 'icon:shell', 'icon:fuel', 'schematic', 'flash', 'glass', 'fx:*'

import { CHASSIS } from './config.js';

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
  return { noise2d, fbm, hash };
}
export const N = makeNoise(1274126177);

// ---------- color utils ----------
export function hexToRgb(hex) { return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff }; }
export function lighten(c, a) { const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff; return ((Math.min(255, r + a) << 16) | (Math.min(255, g + a) << 8) | Math.min(255, b + a)); }
export function darken(c, a) { const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff; return ((Math.max(0, r - a) << 16) | (Math.max(0, g - a) << 8) | Math.max(0, b - a)); }
// Darken toward a cool shadow rather than toward black. In the reference the
// dark armour panels are navy — the shadow side of that art is bluer than the
// lit side, not just less of it. Plain darken() drags a teal hull to olive-grey
// and a red hull to brown, which is why the dark plates used to look dirty.
export function shade(c, a) {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  return (Math.max(0, r - a * 1.15) << 16)
       | (Math.max(0, g - a * 1.0) << 8)
       |  Math.max(0, Math.round(b - a * 0.72));
}

// Push a colour away from its own grey. The reference's turret core is more
// saturated than its hull, not just lighter.
export function saturate(c, amt) {
  const r = (c >> 16) & 0xff, g = (c >> 8) & 0xff, b = c & 0xff;
  const m = (r + g + b) / 3;
  const f = v => Math.max(0, Math.min(255, Math.round(m + (v - m) * amt)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
function css(hex, alpha = 1) {
  const { r, g, b } = hexToRgb(hex);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

// ============================================================
// REGISTRY
// ============================================================
const cache = new Map();
const detail = new Map();      // greyscale grain images used by the painters

export function registerTexture(key, tex) { cache.set(key, tex); }
export function registerDetail(name, img) { detail.set(name, img); }
export function detailImage(name) { return detail.get(name) || null; }

export function getTexture(key) {
  if (cache.has(key)) return cache.get(key);
  const [kind, ...args] = key.split(':');
  const gen = GENERATORS[kind] || GENERATORS._missing;
  const tex = gen(...args);
  cache.set(key, tex);
  return tex;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  return c;
}
function fromCanvas(c) { return PIXI.Texture.from(c); }

// Soft down-right cast shadow, the single most consistent cue in the reference.
function shadow(ctx, x, y, rx, ry, alpha = 0.28) {
  ctx.fillStyle = `rgba(40,26,10,${alpha})`;
  ctx.beginPath(); ctx.ellipse(x + 2.5, y + 3.5, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
}

// Heavy dark outline pass. Everything in the reference has one.
function outline(ctx, width = 2, color = 'rgba(24,16,8,0.95)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ---------- the 3D-cartoon toolkit ----------
// Blown up 7x, every object in the reference is built the same way: a near-black
// INK outline of uneven weight, a body that is lighter toward the upper-left, a
// hard bright edge along the top, and a dark contact edge along the bottom. These
// four helpers are that vocabulary, so a bush, a boulder and a bunker plate all
// catch light the same way instead of each generator improvising.

// Ink line. Two passes at different widths and alphas: a real brush outline in
// the reference is heavier on the shadow side than the lit side, and a single
// even stroke is what makes procedural art read as vector clipart.
function ink(ctx, width = 2, color = 'rgba(12,8,4,0.96)') {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width * 1.45; ctx.globalAlpha = 0.45; ctx.stroke();
  ctx.globalAlpha = 1; ctx.lineWidth = width; ctx.stroke();
  ctx.restore();
}

// Inner bevel on the CURRENT path: bright along the top-left, dark along the
// bottom-right. Clipping to the path and stroking twice at an offset is what
// gives a flat fill the moulded look the reference has; drawing the two edges as
// explicit lines only works on rectangles.
function bevel(ctx, w = 2, lit = 'rgba(255,255,255,0.5)', dark = 'rgba(0,0,0,0.42)') {
  ctx.save();
  ctx.clip();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = w * 2;
  ctx.strokeStyle = dark;
  ctx.save(); ctx.translate(-w * 0.75, -w * 0.9); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = lit;
  ctx.save(); ctx.translate(w * 0.75, w * 0.9); ctx.stroke(); ctx.restore();
  ctx.restore();
}

// A lit sphere — the reference's rivets, pebbles and hub bosses are all this.
function dome(ctx, x, y, r, base, inkW = 1.4) {
  const g = ctx.createRadialGradient(x - r * 0.42, y - r * 0.46, r * 0.05, x, y, r * 1.06);
  g.addColorStop(0, css(lighten(base, 92)));
  g.addColorStop(0.42, css(lighten(base, 26)));
  g.addColorStop(0.82, css(base));
  g.addColorStop(1, css(darken(base, 52)));
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  if (inkW) ink(ctx, inkW);
  // tight specular, offset up-left
  ctx.beginPath();
  ctx.ellipse(x - r * 0.36, y - r * 0.42, r * 0.3, r * 0.22, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.62)'; ctx.fill();
}

// The sweeping crescent gloss across the reference's boulders. Two arcs sharing
// endpoints, filled — a stroked arc reads as a scratch, a filled lens reads as
// a wet highlight rolling over a curved surface.
function crescent(ctx, x, y, r, a0, a1, thick, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, a0, a1);
  ctx.arc(x, y, r - thick, a1, a0, true);
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}

// Aggregate grit. The reference's brick and stone faces are visibly speckled;
// flat fills next to that photographic sand read as plastic.
function speckle(ctx, x, y, w, h, n, colors, sz = 1.5, seed = 0) {
  for (let i = 0; i < n; i++) {
    const px = x + N.noise2d(i * 3.7 + seed, seed * 1.7) * w;
    const py = y + N.noise2d(seed * 2.3, i * 4.1 + seed) * h;
    const r = sz * (0.35 + N.noise2d(i * 1.9, i * 2.7 + seed));
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  }
}

// Multiplies a greyscale grain image over the current canvas via soft-light, which
// adds photographic tooth without dragging the painted hue around.
function grain(ctx, w, h, name, alpha = 0.3, scale = 1, ox = 0, oy = 0) {
  const img = detailImage(name);
  if (!img) return;
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = alpha;
  const s = img.width * scale;
  for (let y = -(oy % s); y < h; y += s)
    for (let x = -(ox % s); x < w; x += s)
      ctx.drawImage(img, x, y, s, s);
  ctx.restore();
}

// ============================================================
// SAND — parametrized by world position, not registry-cached
// ============================================================
export function generateSandTile(w, h, wx, wy) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h); const d = img.data;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const x = wx + px, y = wy + py;

      // Big slow dunes, then the tight vertical ripple bands from the reference.
      const dune = N.fbm(x * 0.0022, y * 0.0022, 4) * 34;
      // Two ripple scales: broad wind bands plus a finer comb over the top. The
      // reference's sand reads as drawn lines, so this wants real contrast.
      const ripple = N.fbm(x * 0.006 + 20, y * 0.030 + 20, 4);
      const ridge = 1.0 - Math.abs(ripple * 2 - 1);
      const fine = N.fbm(x * 0.016 + 60, y * 0.075 + 60, 2);
      const fineRidge = 1.0 - Math.abs(fine * 2 - 1);
      // Broad soft shadow pooling in the dune troughs.
      const trough = Math.max(0, 0.55 - N.fbm(x * 0.0012 + 90, y * 0.0012 + 90, 3)) * 46;
      const grit = (N.hash(x, y) / 0x7fffffff - 0.5) * 7;

      const v = dune
        + Math.pow(ridge, 2.2) * 34 - 12
        + Math.pow(fineRidge, 3) * 13
        - trough + grit;
      // Warm ochre, tuned against the reference's sand.
      // Sampled from the reference: mid sand #c18e42, lit #ab7837. More saturated
      // and more orange than it looks by eye — the earlier paler, yellower mix
      // washed the whole map out.
      // Sampled from the reference: sand runs #ab7837 (shaded) to #c18e42 (lit).
      // That is a NARROW band — letting the ripple swing wider pushed the whole
      // map into a bright acid yellow.
      // Bases are back-solved from measuring the rendered result against the
      // reference, not picked by eye: the soft-light grain pass below lifts green
      // by ~13 and drops blue by ~7, so the raw numbers here look too red on their
      // own. Measured output lands on #c18e42.
      d[i]     = Math.min(255, Math.max(0, 170 + v * 0.75));
      d[i + 1] = Math.min(255, Math.max(0, 111 + v * 0.60));
      d[i + 2] = Math.min(255, Math.max(0, 63 + v * 0.34));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Photographic grain on top, aligned to world space so tiles don't seam.
  // Kept small and faint on purpose: at full size the source photo's own broad
  // light variation repeated every 512 px and showed up as a grid of rectangles
  // across the desert. At ~180 px it reads as tooth instead of blotches.
  grain(ctx, w, h, 'sand_grain', 0.2, 0.35, wx, wy);
  return c;
}

// ============================================================
// TANKS
// ============================================================
// Drawn facing up (-Y). Call sites apply rotation = angle + PI/2.
//
// Built as a MOSAIC OF PLATES, not a smooth hull. Blowing the reference tanks up
// 5x shows the defining trait of that art: a roughly square block made of separate
// rectangular armour panels, each its own value, divided by thick near-black gaps —
// closer to cloisonné than to a rendered vehicle. A smooth gradient hull with two
// black track bars (what this used to be) reads as a completely different game.
//
// Layout, in a 54x54 box facing up:
//   two columns of four track plates down the sides
//   one large hull plate through the middle
//   two small deck plates at the top flanking the gun mount
//   turret = thick black ring, lighter annulus, saturated core
// Few, LARGE plates. An earlier pass used four narrow plates a side with wide
// gaps and a dark rim on every plate; at a 50 px tank that reads as a floating
// checkerboard rather than a vehicle. The grout underneath supplies all the
// separation, so plates carry no rim of their own.
// Tone varies per plate, and plate heights are derived from the row count so a
// 2-row chassis reads as long open flanks and a 4-row chassis as stacked panels.
// Uniform plates at one tone read as a procedural grid; the reference's dark
// panels also go a lot darker than feels right in isolation.
// Plate tone for one panel. The reference's value spread is enormous — the same
// tank carries near-white plates and plates so dark they are nearly the grout —
// but the DISTRIBUTION is lopsided: most panels are light, and only one or two
// per flank go dark. Alternating light/dark evenly, which is what a fixed tone
// table does, is precisely how you get a checkerboard instead of a vehicle.
function plateTone(j, flip, ci) {
  // hash, not noise2d: noise2d is interpolated, so its values cluster hard around
  // 0.5 and a "> 0.62 means dark" test almost never fires. That is why the first
  // attempt at this came out uniformly pale however the thresholds were moved.
  // hash() is flat, so the stated proportion is the proportion you get.
  const u = N.hash(j * 31 + ci * 7, flip * 17 + ci * 3) / 0x7fffffff;
  if (u > 0.62) return -0.4 - (u - 0.62) * 1.9;    // dark navy panel, ~38% of them
  return -0.15 + u * 0.9;                           // otherwise mid through light
}

function genTank(colorStr, scaleStr, chassisStr, white = false) {
  const bodyColor = parseInt(colorStr, 16);
  const s = parseFloat(scaleStr) || 1;
  const ci = parseInt(chassisStr, 10) || 0;
  const ch = CHASSIS[ci] || CHASSIS[0];
  // Design units. NOT square: the reference's tanks are noticeably longer than
  // they are wide, and forcing them into a square box is half of why they used
  // to read as a cube with a bolt on it. Sprites anchor at (0.5, 0.5), so the
  // extra length costs nothing at the call sites.
  const UW = 54, UH = 62;
  const w = Math.ceil(UW * s), h = Math.ceil(UH * s);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const cx = w / 2, cy = h / 2;
  const GROUT = '#08141a';

  // Everything below is authored in design units and scaled here.
  const P = v => v * s;
  // The silhouette, shared by the body and by the hit-flash so they register.
  const hullPath = () => { ctx.beginPath(); ctx.roundRect(P(2.5), P(2), P(UW - 5), P(UH - 4), P(7)); };

  if (white) {
    // Hit-flash silhouette: the outer shape only, flat white.
    ctx.fillStyle = '#fff';
    hullPath(); ctx.fill();
    return fromCanvas(c);
  }

  shadow(ctx, cx, cy + P(1), P(23), P(26), 0.32);

  // One armour plate. Body gradient, then a moulded bevel — bright top-left,
  // dark bottom-right. The plates in the reference are not flat swatches; each
  // one has its own little lit edge, which is most of why that art looks solid.
  let plateSeed = 0;
  const plate = (px, py, pw, ph, tone, r = 2) => {
    // Ceiling on the light end matters: lighten() walks every channel toward
    // white, so a saturated clan colour turns pastel long before it turns light.
    // Past about +85 the red clan goes pink and the gold clan goes cream.
    const bc = tone < 0 ? shade(bodyColor, -tone * 96) : lighten(bodyColor, tone * 100);
    const g = ctx.createLinearGradient(P(px), P(py), P(px + pw * 0.5), P(py + ph));
    g.addColorStop(0, css(lighten(bc, 30)));
    g.addColorStop(0.55, css(bc));
    g.addColorStop(1, css(shade(bc, 34)));
    const path = () => { ctx.beginPath(); ctx.roundRect(P(px), P(py), P(pw), P(ph), P(r)); };
    path(); ctx.fillStyle = g; ctx.fill();

    // Painterly mottle. The reference's panels are visibly brush-textured — the
    // smooth gradients they replaced are the difference between "painted metal"
    // and "vector shape with a gradient fill", and it shows even at 50 px.
    const sd = ++plateSeed;
    ctx.save(); path(); ctx.clip();
    for (let i = 0; i < 5; i++) {
      const t = N.noise2d(i * 3.3 + sd * 9.1, sd * 4.7);
      const u = N.noise2d(sd * 2.9, i * 5.7 + sd * 6.3);
      ctx.fillStyle = i % 2 ? `rgba(255,255,255,${0.05 + t * 0.07})`
                            : `rgba(10,24,34,${0.05 + t * 0.09})`;
      ctx.beginPath();
      ctx.ellipse(P(px + u * pw), P(py + t * ph), P(pw * (0.3 + t * 0.5)), P(ph * (0.1 + u * 0.22)),
                  t * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    path();
    bevel(ctx, Math.max(0.8, P(0.9)), 'rgba(255,255,255,0.42)', 'rgba(0,0,0,0.3)');
  };

  // Grout: the whole silhouette in near-black, so every gap between plates reads.
  // The outline is deliberately heavy — at 7x the reference's tanks sit inside a
  // black keyline several pixels thick, and that band is what makes them pop off
  // sand of nearly the same lightness.
  hullPath();
  ctx.fillStyle = GROUT; ctx.fill();
  hullPath();
  ink(ctx, Math.max(1.8, P(3.0)), 'rgba(6,10,14,0.98)');

  // Track columns. One extra row over the chassis count, because the hull is now
  // longer. Plate heights are jittered per chassis so the two flanks are not a
  // mirrored ladder — in the reference the left and right runs plainly disagree.
  //
  // Measured off the reference rather than guessed: the grout gaps are about 3%
  // of the tank's width and the track columns about 17%. At the 1.5/full-trackW
  // this used, the black gaps were half again too wide and the flanks too broad,
  // which together are what made the hull read as tiling rather than plating.
  const GAP = 0.95, TOP = 4;
  const trackW = ch.trackW * 0.82;
  const runH = UH - TOP * 2;
  const rows = ch.rows + 1;
  for (const [colX, flip] of [[3.8, 0], [UW - 3.8 - trackW, 1]]) {
    const wts = [];
    let sum = 0;
    for (let i = 0; i < rows; i++) {
      const j = flip ? rows - 1 - i : i;
      const k = 0.72 + N.noise2d(j * 5.3 + ci * 11, flip * 3.1 + ci * 7) * 0.62;
      wts.push(k); sum += k;
    }
    const avail = runH - GAP * (rows - 1);
    let y = TOP;
    for (let i = 0; i < rows; i++) {
      const ph = avail * wts[i] / sum;
      plate(colX, y, trackW, ph, plateTone(flip ? rows - 1 - i : i, flip, ci), 1.8);
      y += ph + GAP;
    }
  }

  // Front and rear deck plates, spanning between the track columns. These close
  // the plate frame around the turret — in the reference the turret sits in a
  // ring of panels, not on an open slab. The rear pair is deliberately deeper
  // than the front pair so the tank has a readable nose and tail.
  const inX = 3.8 + trackW + GAP;
  const spanW = UW - inX * 2;
  const halfW = (spanW - GAP) / 2;
  plate(inX, TOP, halfW, 7.0, plateTone(20, 0, ci), 1.6);
  plate(inX + halfW + GAP, TOP, halfW, 7.0, plateTone(21, 1, ci), 1.6);
  // The rear pair is forced dark. Every reference tank has a dark band across
  // its back end, and it is most of what tells you which way one is pointing
  // when the gun is swung side-on.
  plate(inX, UH - TOP - 9.5, halfW, 9.5, -0.62, 1.6);
  plate(inX + halfW + GAP, UH - TOP - 9.5, halfW, 9.5, -0.86, 1.6);
  // Hull filler either side of the turret, so no raw grout shows through. Kept
  // mid-tone: a light slab here merges with the light turret plate on top of it.
  plate(inX, TOP + 8.5, spanW, UH - TOP * 2 - 19.5, -0.18, 2.2);

  // ---- Turret ----
  // The single biggest tell in the reference, and what the old circular version
  // got wrong: the turret is a large ROUNDED SQUARE deck plate — near the
  // lightest value on the tank — with a black ring drawn on top of it and the
  // saturated core inside that. A plain bright disc reads as a target sticker;
  // the squircle-plus-ring reads as a cast turret casting on a deck.
  // Slightly forward of centre, as in the reference — a dead-centred turret on a
  // symmetric hull gives you no way to tell the front from the back.
  const tcy = cy - P(1.5);
  // About half the tank's width, measured off the reference. It only fits at
  // this size because the hull is longer than it is wide — on the old square
  // hull a turret this big left no room for deck plates fore and aft.
  const TP = ch.turret * 0.98;            // half-extent of the turret plate
  const tg = ctx.createLinearGradient(cx - P(TP), tcy - P(TP), cx + P(TP * 0.5), tcy + P(TP));
  tg.addColorStop(0, css(lighten(bodyColor, 84)));
  tg.addColorStop(0.5, css(lighten(bodyColor, 46)));
  tg.addColorStop(1, css(lighten(bodyColor, 2)));
  ctx.beginPath();
  ctx.roundRect(cx - P(TP), tcy - P(TP), P(TP * 2), P(TP * 2), P(TP * 0.42));
  ctx.fillStyle = tg; ctx.fill();
  ctx.beginPath();
  ctx.roundRect(cx - P(TP), tcy - P(TP), P(TP * 2), P(TP * 2), P(TP * 0.42));
  ink(ctx, Math.max(1.4, P(2.3)), 'rgba(6,12,16,0.95)');
  ctx.beginPath();
  ctx.roundRect(cx - P(TP), tcy - P(TP), P(TP * 2), P(TP * 2), P(TP * 0.42));
  bevel(ctx, Math.max(1, P(1.3)), 'rgba(255,255,255,0.5)', 'rgba(0,0,0,0.3)');

  // Black ring, drawn straight onto the plate. Only barely filled — in the
  // reference this is a drawn circle on the turret casting, so the plate's own
  // gradient should carry through it. Filling it with a pale disc turned the
  // whole assembly into a bullseye.
  // Leaves a clear lit margin of turret plate around the ring — in the reference
  // you can plainly see the casting the ring is drawn on. Pushed out to the
  // plate edge it just reads as a black disc on the hull.
  const TR = TP * 0.72;
  ctx.beginPath(); ctx.arc(cx, tcy, P(TR), 0, Math.PI * 2);
  ctx.fillStyle = css(lighten(bodyColor, 30)); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, tcy, P(TR), 0, Math.PI * 2);
  ink(ctx, Math.max(1.1, P(1.7)), 'rgba(6,12,16,0.95)');

  // Saturated core — the focal point, but a PAINTED disc, not a lit sphere. The
  // reference's core is close to flat with one soft highlight; a full radial
  // gradient with a hot centre made it glow like a power cell.
  // Nearly filling the ring. A small core inside a wide pale annulus is a
  // bullseye; in the reference the core crowds the ring and the annulus is just
  // a rim of casting showing round the edge.
  const TC = TP * 0.62;
  const core = saturate(bodyColor, 1.38);
  const cg = ctx.createLinearGradient(cx - P(TC), tcy - P(TC), cx + P(TC * 0.6), tcy + P(TC));
  cg.addColorStop(0, css(lighten(core, 34)));
  cg.addColorStop(0.6, css(lighten(core, 6)));
  cg.addColorStop(1, css(darken(core, 26)));
  ctx.beginPath(); ctx.arc(cx, tcy, P(TC), 0, Math.PI * 2);
  ctx.fillStyle = cg; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, tcy, P(TC), 0, Math.PI * 2);
  ink(ctx, Math.max(1.1, P(1.8)), 'rgba(6,12,16,0.92)');
  ctx.fillStyle = 'rgba(255,255,255,0.19)';
  ctx.beginPath();
  ctx.ellipse(cx - P(TC * 0.3), tcy - P(TC * 0.36), P(TC * 0.3), P(TC * 0.18), -0.55, 0, Math.PI * 2);
  ctx.fill();

  return fromCanvas(c);
}

function genTurret() {
  // The gun barrel. Two numbers matter and both were wrong before: it is LONG —
  // in the reference the muzzle stands off the hull by about half the hull's own
  // length — and it is THIN, roughly a tenth of the tank's width. The old sprite
  // was short and fat, which is why the tanks read as squat boxes with a bolt on
  // top instead of as gun platforms.
  //
  // The LOWER PART OF THIS SPRITE IS EMPTY. Call sites anchor it at (0.5, 0.8),
  // which puts the pivot on the turret centre; drawing down to the pivot lays the
  // barrel across the turret and buries the bright core. It therefore starts just
  // outside the turret ring and runs out well past the hull.
  const W = 16, H = 64;
  const BASE = 32;          // everything below this is transparent (inside the ring)
  const c = canvas(W, H);
  const ctx = c.getContext('2d'); const cx = W / 2;

  // cast shadow of the barrel onto the sand, down-right like everything else
  ctx.fillStyle = 'rgba(30,20,8,0.32)';
  ctx.beginPath(); ctx.roundRect(cx - 2.6 + 2.2, 4.4, 5.2, BASE - 5, 2); ctx.fill();

  // Ink body behind the metal, so the barrel keeps the same heavy keyline as the
  // hull. Drawn as one bar; the segment break is painted on top of it.
  ctx.beginPath(); ctx.roundRect(cx - 3.5, 1, 7, BASE - 2, 3);
  ctx.fillStyle = '#08141a'; ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx - 3.5, 1, 7, BASE - 2, 3);
  ink(ctx, 2.1, 'rgba(6,12,16,0.96)');

  // Blue-grey, not neutral grey — a pure grey pipe reads as a foreign object
  // against the teal palette. Lit hard down the left third like the reference,
  // where the barrel is nearly white on one edge.
  const seg = (y, hgt) => {
    const g = ctx.createLinearGradient(cx - 2.5, 0, cx + 2.5, 0);
    g.addColorStop(0, '#5e767e');
    g.addColorStop(0.3, '#cfe4e7');
    g.addColorStop(0.62, '#8ea8ae');
    g.addColorStop(1, '#243640');
    ctx.beginPath(); ctx.roundRect(cx - 2.5, y, 5, hgt, 1.6);
    ctx.fillStyle = g; ctx.fill();
  };
  seg(2.6, 10.5);          // muzzle segment
  seg(14.5, BASE - 16);    // mid segment

  // Muzzle cap: a slightly wider collar with a dark bore, which is what stops a
  // long thin bar from looking like a stick.
  ctx.beginPath(); ctx.roundRect(cx - 3.6, 1.4, 7.2, 4.2, 1.6);
  const mg = ctx.createLinearGradient(cx - 3.6, 0, cx + 3.6, 0);
  mg.addColorStop(0, '#6d858c'); mg.addColorStop(0.32, '#dbeef0'); mg.addColorStop(1, '#22323a');
  ctx.fillStyle = mg; ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx - 3.6, 1.4, 7.2, 4.2, 1.6);
  ink(ctx, 1.5, 'rgba(6,12,16,0.9)');

  // Mantlet where the barrel meets the turret ring.
  ctx.beginPath(); ctx.roundRect(cx - 5.2, BASE - 7, 10.4, 7, 2.4);
  const bg = ctx.createLinearGradient(cx - 5.2, 0, cx + 5.2, 0);
  bg.addColorStop(0, '#4e646c'); bg.addColorStop(0.34, '#b6ced1'); bg.addColorStop(1, '#283a42');
  ctx.fillStyle = bg; ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx - 5.2, BASE - 7, 10.4, 7, 2.4);
  ink(ctx, 2.0, 'rgba(6,12,16,0.96)');
  return fromCanvas(c);
}

// ============================================================
// TERRAIN PROPS
// ============================================================
// Leafy clusters like the reference's green bushes. Three variants so a grove
// doesn't read as one stamp repeated.
//
// These are LEAVES, not lobes. Blown up, the reference's bushes are clusters of
// individually drawn five-lobed leaflets — coriander, more or less — each with
// its own black keyline and its own centre vein, overlapping into a clump. The
// old version stacked plain circles and shaded them, which is exactly how you
// get the broccoli look no amount of recolouring fixes. Nothing here is a circle.
const BUSH_VARIANTS = [
  [{ x: 0, y: -9, r: 11, a: -0.2 }, { x: -11, y: -3, r: 9.5, a: -1.1 }, { x: 10, y: -2, r: 9, a: 0.9 },
   { x: -6, y: -16, r: 8, a: -0.6 }, { x: 7, y: -14, r: 7.5, a: 0.5 }, { x: 0, y: -20, r: 6.5, a: 0.1 },
   { x: -13, y: -11, r: 6, a: -1.5 }, { x: 4, y: -5, r: 7, a: 2.4 }],
  [{ x: -7, y: -5, r: 10.5, a: 0.4 }, { x: 8, y: -6, r: 11, a: -0.5 }, { x: 0, y: -15, r: 9, a: 0.15 },
   { x: -13, y: -10, r: 7, a: -1.2 }, { x: 13, y: -12, r: 6.5, a: 1.3 }, { x: -3, y: -2, r: 7.5, a: 1.9 },
   { x: 6, y: -19, r: 6, a: -0.9 }],
  [{ x: 0, y: -5, r: 12, a: 0.25 }, { x: -10, y: -12, r: 8.5, a: -0.8 }, { x: 10, y: -11, r: 9, a: 1.0 },
   { x: 0, y: -18, r: 7.5, a: -0.3 }, { x: -5, y: -21, r: 5.5, a: 1.6 }, { x: 6, y: -21, r: 6, a: -1.7 },
   { x: -13, y: -4, r: 7, a: 2.2 }, { x: 12, y: -3, r: 6.5, a: -2.3 }],
];

// A five-lobed leaflet as a closed path. The |cos| term puts a deep notch between
// lobes, which is what makes the silhouette read as foliage at 20 px rather than
// as a scalloped disc.
function leafPath(ctx, x, y, r, rot) {
  const STEPS = 44;
  ctx.beginPath();
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * Math.PI * 2;
    const lobe = Math.pow(Math.abs(Math.cos(2.5 * t)), 0.42);
    const rr = r * (0.42 + 0.58 * lobe);
    const px = x + Math.cos(t + rot) * rr;
    const py = y + Math.sin(t + rot) * rr * 0.94;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function genTree(variantStr) {
  const v = (parseInt(variantStr, 10) || 0) % BUSH_VARIANTS.length;
  const leaves = BUSH_VARIANTS[v];
  const c = canvas(60, 60);
  const ctx = c.getContext('2d'); const cx = 30, cy = 34;

  shadow(ctx, cx, cy + 7, 18, 10, 0.3);

  // trunk peeking under the canopy
  ctx.fillStyle = '#4d2d13';
  ctx.beginPath(); ctx.roundRect(cx - 2.5, cy - 2, 5, 12, 2); ctx.fill();
  outline(ctx, 1.4);

  // Greens sampled off the reference's leaves, which are far BRIGHTER than the
  // forest green they were: #1fb92f in the light, #0d7a19 in the body, with the
  // darkness coming from the black keyline rather than from the fill.
  const greens = [
    ['#31d94a', '#16a327', '#0a6414'],
    ['#28c93e', '#0f9420', '#075a11'],
    ['#3ce055', '#1bab2e', '#0c6b16'],
    ['#22bf37', '#0d8c1c', '#06520f'],
  ];

  // Back-to-front so the upper leaves overlap the lower ones, and each leaf gets
  // its own keyline — the unified silhouette outline the old version used lost
  // every internal edge and that is where the foliage detail lives.
  const order = leaves.map((l, i) => ({ l, i })).sort((a, b) => a.l.y - b.l.y);
  for (const { l, i } of order) {
    const [lit, mid, deep] = greens[i % greens.length];
    leafPath(ctx, cx + l.x, cy + l.y, l.r, l.a);
    ink(ctx, 2.6, 'rgba(4,26,8,0.95)');
    const g = ctx.createRadialGradient(
      cx + l.x - l.r * 0.3, cy + l.y - l.r * 0.36, 1,
      cx + l.x, cy + l.y, l.r);
    g.addColorStop(0, lit); g.addColorStop(0.55, mid); g.addColorStop(1, deep);
    ctx.fillStyle = g; ctx.fill();

    // centre vein plus two side veins, the detail that sells the leaflet
    ctx.save();
    ctx.strokeStyle = 'rgba(6,50,12,0.5)'; ctx.lineWidth = 1; ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const a = l.a + (k - 1) * 1.25;
      ctx.beginPath();
      ctx.moveTo(cx + l.x, cy + l.y);
      ctx.lineTo(cx + l.x + Math.cos(a) * l.r * 0.78, cy + l.y + Math.sin(a) * l.r * 0.74);
      ctx.stroke();
    }
    ctx.restore();

    // specular on the upper-left lobe
    ctx.fillStyle = 'rgba(150,255,160,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx + l.x - l.r * 0.34, cy + l.y - l.r * 0.4, l.r * 0.3, l.r * 0.19, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return fromCanvas(c);
}

// Warm bronze-brown boulders with satellite pebbles, like the reference's rock piles.
const ROCK_SHAPES = [
  [[-11, 5], [-13, -5], [-5, -11], [4, -13], [11, -6], [13, 2], [8, 7], [-2, 8]],
  [[-12, 3], [-9, -8], [0, -12], [9, -9], [13, 0], [10, 8], [-1, 10], [-9, 8]],
  [[-10, 6], [-14, -2], [-7, -10], [3, -12], [12, -7], [14, 4], [5, 9], [-4, 9]],
];

// Satellite pebbles: position, radius. The reference scatters a wide range of
// sizes — a couple almost as big as the boulder, several tiny — which is what
// makes the pile look like debris instead of a decorated blob.
// Deliberately lopsided. Evenly spaced satellites turn the pile into an atom
// diagram; the reference clusters two or three big ones on one shoulder and
// trails the small ones off the other.
const ROCK_PEBBLES = [
  [[-16, -8, 5.6], [-12, -15, 3.4], [12, -12, 4.4], [-7, 13, 3.2], [6, 13, 2.2], [17, 2, 1.9], [1, 17, 1.5]],
  [[14, -11, 5.2], [18, -3, 3.2], [-13, -10, 3.6], [3, 15, 4.2], [-8, 14, 2.3], [-18, 5, 1.8], [9, 17, 1.4]],
  [[-14, -12, 4.8], [-17, -3, 3.0], [14, -9, 4.2], [10, 13, 3.4], [-6, 15, 2.4], [19, 5, 1.7], [-1, -18, 1.6]],
];

function genRock(variantStr) {
  const v = (parseInt(variantStr, 10) || 0) % ROCK_SHAPES.length;
  const pts = ROCK_SHAPES[v];
  const c = canvas(52, 52);
  const ctx = c.getContext('2d'); const cx = 26, cy = 25;

  const massPath = () => {
    ctx.beginPath();
    ctx.moveTo(cx + pts[0][0], cy + pts[0][1]);
    for (let i = 1; i <= pts.length; i++) {
      const p = pts[i % pts.length], q = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(cx + p[0], cy + p[1], cx + (p[0] + q[0]) / 2, cy + (p[1] + q[1]) / 2);
    }
    ctx.closePath();
  };

  shadow(ctx, cx, cy + 5, 16, 10, 0.34);

  // Pebbles behind the mass, each a properly lit little sphere. Half of them sit
  // under the boulder's edge so the cluster overlaps instead of orbiting it.
  for (const [px, py, pr] of ROCK_PEBBLES[v]) {
    shadow(ctx, cx + px, cy + py + 1, pr * 1.05, pr * 0.7, 0.26);
    dome(ctx, cx + px, cy + py, pr, 0x6a4021, 1.5);
  }

  // Main mass. Reference boulders are chocolate brown and GLOSSY — the thing
  // that identifies them is a broad cream crescent rolling over the top-left
  // shoulder, not the base colour. Without it they read as flat olive lumps.
  massPath();
  const rg = ctx.createRadialGradient(cx - 6, cy - 7, 2, cx + 2, cy + 3, 19);
  rg.addColorStop(0, '#a86733'); rg.addColorStop(0.34, '#7d4922');
  rg.addColorStop(0.68, '#512c12'); rg.addColorStop(1, '#241205');
  ctx.fillStyle = rg; ctx.fill();

  ctx.save(); massPath(); ctx.clip();
  // Grain kept low: at the old 0.55 the soft-light pass desaturated the whole
  // boulder to khaki, which is the opposite of the reference's chocolate.
  grain(ctx, 52, 52, 'rock_grain', 0.28, 0.19);

  // The gloss, clipped so it dies at the silhouette edge. This is the single
  // feature that identifies the reference's boulders, so it is drawn strong:
  // a broad cream sweep with a hot core rolling over the top-left shoulder.
  crescent(ctx, cx + 1, cy + 2, 15, Math.PI * 1.0, Math.PI * 1.66, 5.4, 'rgba(238,214,172,0.62)');
  crescent(ctx, cx + 1, cy + 2, 15.4, Math.PI * 1.1, Math.PI * 1.52, 2.6, 'rgba(255,247,226,0.85)');
  // a second, tighter roll lower down — the reference boulders read as two
  // stacked lumps, not one dome
  crescent(ctx, cx + 3, cy + 9, 11, Math.PI * 1.04, Math.PI * 1.58, 3.2, 'rgba(228,196,150,0.45)');
  // contact darkness along the bottom-right
  crescent(ctx, cx, cy, 17, Math.PI * 0.02, Math.PI * 0.62, 7, 'rgba(24,11,3,0.42)');
  ctx.restore();

  massPath();
  ink(ctx, 2.6, 'rgba(20,10,3,0.95)');

  // the fissure between the two lumps
  ctx.strokeStyle = 'rgba(26,13,4,0.6)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy + 1); ctx.quadraticCurveTo(cx - 1, cy + 5, cx + 9, cy + 1);
  ctx.stroke();
  return fromCanvas(c);
}

// The reference's red block. It is ONE cast block, not a course of masonry: a
// very heavy black keyline, a hard white highlight along the top edge alone, a
// coarse red aggregate face, and a few dark blast pits. The old version drew
// stretcher-bond courses with head joints, which at 50 px reads as a scrap of
// wall texture rather than as an object standing on the sand.
function genBrick() {
  const c = canvas(52, 52);
  const ctx = c.getContext('2d');
  const X = 3, Y = 3, W = 45, H = 41, R = 4;
  const facePath = () => { ctx.beginPath(); ctx.roundRect(X, Y, W, H, R); };

  ctx.fillStyle = 'rgba(40,26,10,0.34)';
  ctx.beginPath(); ctx.roundRect(X + 3.5, Y + 5, W, H, R); ctx.fill();

  facePath();
  const bg = ctx.createLinearGradient(X, Y, X + W * 0.4, Y + H);
  bg.addColorStop(0, '#c05046'); bg.addColorStop(0.45, '#a5342c');
  bg.addColorStop(1, '#71201b');
  ctx.fillStyle = bg; ctx.fill();

  ctx.save(); facePath(); ctx.clip();
  // aggregate grit — the reference's face is visibly grainy, close up
  speckle(ctx, X, Y, W, H, 90, ['rgba(226,132,116,0.5)', 'rgba(96,24,18,0.45)', 'rgba(255,190,170,0.3)'], 1.5, 1);
  speckle(ctx, X, Y, W, H, 40, ['rgba(60,14,10,0.4)'], 2.4, 7);
  // Blast pits: irregular in size and placement, and one big pale scar through
  // the middle. Five evenly spread discs read as polka dots, which is what the
  // first pass produced.
  for (const [px, py, pr, rot] of [[11, 12, 4.6, 0.4], [38, 14, 3.1, 1.9], [14, 35, 3.8, 2.7],
                                   [33, 32, 2.4, 0.9], [26, 9, 2.0, 1.4]]) {
    ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
    ctx.beginPath(); ctx.ellipse(0, 0, pr, pr * 0.78, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(26,7,5,0.75)'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(pr * 0.2, pr * 0.24, pr * 0.5, pr * 0.36, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(198,116,96,0.5)'; ctx.fill();
    ctx.restore();
  }
  // the chipped scar — pale exposed aggregate, as on the reference block. Kept
  // small and off-centre; filling the middle of the face just looked like an egg.
  ctx.beginPath();
  ctx.moveTo(21, 18); ctx.quadraticCurveTo(26, 14, 29, 19);
  ctx.quadraticCurveTo(30, 25, 24, 26); ctx.quadraticCurveTo(19, 24, 21, 18);
  ctx.closePath();
  ctx.fillStyle = 'rgba(232,190,168,0.34)'; ctx.fill();
  ink(ctx, 1.5, 'rgba(24,6,4,0.5)');
  ctx.restore();

  // Bevel: hot white along the top edge, deep shade along the bottom. In the
  // reference this highlight is nearly pure white and is the whole reason the
  // block reads as having thickness.
  facePath();
  bevel(ctx, 2.2, 'rgba(255,228,214,0.72)', 'rgba(38,8,6,0.5)');

  facePath();
  ink(ctx, 3.2, 'rgba(10,4,3,0.97)');
  return fromCanvas(c);
}

// Passable scenery. These never block movement — they exist so open ground still
// reads as a place rather than a plain.
function genProp(kind) {
  const c = canvas(40, 40);
  const ctx = c.getContext('2d'); const cx = 20, cy = 22;

  if (kind === 'stone') {
    // Same glossy-boulder language as the real rocks, just smaller — these used
    // to be flat shaded circles and read as a different game's asset.
    shadow(ctx, cx, cy + 3, 11, 6, 0.26);
    for (const [ox, oy, r] of [[-5, 1, 5], [4, -2, 6.5], [7, 5, 3.5]]) {
      dome(ctx, cx + ox, cy + oy, r, 0x7d5a34, 1.7);
      crescent(ctx, cx + ox, cy + oy, r * 0.86, Math.PI * 1.05, Math.PI * 1.6, r * 0.26,
               'rgba(238,214,172,0.42)');
    }
  } else if (kind === 'scrub') {
    // Dry desert grass: blades tapering to a point, each with a dark keyline
    // under a lit edge, instead of the flat round-capped strokes it was.
    shadow(ctx, cx, cy + 4, 10, 4, 0.2);
    const blade = (i, col, w, dx) => {
      const lean = (i - 4) * 0.17;
      const len = 9 + ((i * 5) % 4) * 3.2;
      const bx = cx + (i - 4) * 1.9 + dx, by = cy + 5;
      const tx = bx + Math.sin(lean) * len * 1.5, ty = by - len;
      ctx.beginPath();
      ctx.moveTo(bx - w, by);
      ctx.quadraticCurveTo(bx + (tx - bx) * 0.4 - w * 0.4, by - len * 0.55, tx, ty);
      ctx.quadraticCurveTo(bx + (tx - bx) * 0.4 + w * 0.6, by - len * 0.5, bx + w, by);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
    };
    for (let i = 0; i < 9; i++) blade(i, '#3f4a1c', 2.1, 0);      // keyline pass
    for (let i = 0; i < 9; i++) blade(i, '#6c7a30', 1.4, -0.3);
    for (let i = 0; i < 5; i++) blade(i * 2, 'rgba(164,180,92,0.8)', 0.7, -0.7);
  } else if (kind === 'bones') {
    shadow(ctx, cx, cy + 1, 11, 4, 0.18);
    ctx.fillStyle = '#ddd2b4';
    ctx.strokeStyle = 'rgba(90,74,50,0.8)'; ctx.lineWidth = 1.3;
    // ribcage arcs
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(cx - 6 + i * 4, cy, 6 - i * 0.5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    // long bone
    ctx.beginPath(); ctx.roundRect(cx - 12, cy + 5, 20, 3.5, 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 12, cy + 6.5, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 8, cy + 6.5, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else { // wreck — a burnt-out hull half swallowed by sand
    // Built from the same parts as a live tank (plated hull, ring turret, barrel)
    // so it reads as one of these tanks that died, rather than as a generic crate.
    shadow(ctx, cx, cy + 3, 14, 9, 0.32);
    const hull = () => { ctx.beginPath(); ctx.roundRect(cx - 12, cy - 10, 24, 21, 3.5); };
    hull();
    const g = ctx.createLinearGradient(cx - 12, cy - 10, cx - 1, cy + 11);
    g.addColorStop(0, '#5a4f45'); g.addColorStop(0.45, '#3b332c'); g.addColorStop(1, '#1d1917');
    ctx.fillStyle = g; ctx.fill();
    // burnt plating, scorched darker toward the bottom-right
    ctx.save(); hull(); ctx.clip();
    speckle(ctx, cx - 12, cy - 10, 24, 21, 22, ['rgba(150,74,30,0.34)', 'rgba(10,8,6,0.4)'], 1.8, 5);
    ctx.strokeStyle = 'rgba(12,9,7,0.7)'; ctx.lineWidth = 1.4;
    for (const yy of [-4, 3]) {
      ctx.beginPath(); ctx.moveTo(cx - 12, cy + yy); ctx.lineTo(cx + 12, cy + yy); ctx.stroke();
    }
    ctx.restore();
    hull(); bevel(ctx, 1.4, 'rgba(190,170,150,0.26)', 'rgba(0,0,0,0.45)');
    hull(); ink(ctx, 2.2, 'rgba(10,8,6,0.95)');

    // collapsed turret ring
    ctx.beginPath(); ctx.arc(cx + 1, cy - 1, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#2b2622'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 1, cy - 1, 6, 0, Math.PI * 2);
    ink(ctx, 1.8, 'rgba(10,8,6,0.9)');
    ctx.beginPath(); ctx.arc(cx + 1, cy - 1, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = '#100d0b'; ctx.fill();

    // snapped barrel, drooping
    ctx.save();
    ctx.translate(cx + 5, cy - 2); ctx.rotate(0.22);
    ctx.beginPath(); ctx.roundRect(0, 0, 14, 4.2, 1.6);
    const bgd = ctx.createLinearGradient(0, 0, 0, 4.2);
    bgd.addColorStop(0, '#6a615a'); bgd.addColorStop(1, '#241f1c');
    ctx.fillStyle = bgd; ctx.fill();
    ink(ctx, 1.5, 'rgba(10,8,6,0.9)');
    ctx.restore();
  }
  return fromCanvas(c);
}

// ============================================================
// BASES
// ============================================================
// Brass/bronze bunker hub, echoing the mechanical structure in the reference's
// top-right corner. Tinted per clan.
// This is the most heavily drawn object in the reference, and the old version
// under-built it badly: a flat disc with eight small bolts and a ring of feet.
// Blown up, the real thing is a machined BRONZE WHEEL — a broad beveled rim, a
// spoked face divided into quadrants, six raised rivets, and a hub that is a
// ring around a domed boss — bolted into a recessed housing with a cylindrical
// roller at each of the lower corners. Everything below is that, built out of
// the dome/bevel/ink toolkit so it catches light like the rest of the art.
function genBunker(colorStr) {
  const clan = parseInt(colorStr, 16);
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d'); const cx = S / 2, cy = S / 2;

  // Kept deliberately high-key. The reference's base is bright polished bronze;
  // built from the darker end of the same ramp it comes out olive drab, which
  // reads as camouflage netting rather than as machined metal.
  const PLATE = 0xa9884c, DEEP = 0x6b5330;

  shadow(ctx, cx, cy + 5, 58, 54, 0.34);

  // ---- housing behind the wheel ----
  ctx.beginPath(); ctx.roundRect(6, 12, S - 12, S - 26, 9);
  const hg = ctx.createLinearGradient(0, 12, S * 0.4, S - 14);
  hg.addColorStop(0, '#cfae6c'); hg.addColorStop(0.45, '#9a7a44'); hg.addColorStop(1, '#5a431f');
  ctx.fillStyle = hg; ctx.fill();
  ctx.beginPath(); ctx.roundRect(6, 12, S - 12, S - 26, 9);
  bevel(ctx, 3, 'rgba(255,240,200,0.42)', 'rgba(20,12,2,0.5)');
  ctx.beginPath(); ctx.roundRect(6, 12, S - 12, S - 26, 9);
  ink(ctx, 3.6, 'rgba(24,14,4,0.96)');

  // recessed side panels — the reference's housing is a frame around a sunk face
  for (const px of [11, S - 39]) {
    ctx.beginPath(); ctx.roundRect(px, 22, 28, S - 46, 5);
    ctx.fillStyle = css(DEEP); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px, 22, 28, S - 46, 5);
    bevel(ctx, 2.4, 'rgba(20,12,2,0.55)', 'rgba(255,236,190,0.34)');   // inverted: a recess
    ctx.beginPath(); ctx.roundRect(px, 22, 28, S - 46, 5);
    ink(ctx, 2.4, 'rgba(24,14,4,0.9)');
  }

  // ---- lower corner rollers, drawn before the wheel so it overlaps them ----
  for (const rx of [22, S - 22]) {
    const ry = S - 22;
    shadow(ctx, rx, ry + 2, 15, 14, 0.3);
    dome(ctx, rx, ry, 14, 0x8a6c3c, 2.8);
    ctx.beginPath(); ctx.arc(rx, ry, 9, 0, Math.PI * 2);
    ctx.fillStyle = css(darken(PLATE, 30)); ctx.fill();
    ctx.beginPath(); ctx.arc(rx, ry, 9, 0, Math.PI * 2);
    ink(ctx, 2, 'rgba(24,14,4,0.9)');
    dome(ctx, rx, ry, 5, 0xa5854d, 1.6);      // the hex nut in the middle
  }

  // ---- the wheel ----
  const RIM = 47, FACE = 39;
  ctx.beginPath(); ctx.arc(cx, cy, RIM, 0, Math.PI * 2);
  const rimg = ctx.createLinearGradient(cx - RIM, cy - RIM, cx + RIM * 0.6, cy + RIM);
  rimg.addColorStop(0, '#e2cd95'); rimg.addColorStop(0.4, '#a98a52');
  rimg.addColorStop(1, '#4a3418');
  ctx.fillStyle = rimg; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, RIM, 0, Math.PI * 2);
  ink(ctx, 3.4, 'rgba(24,14,4,0.96)');

  // sunken face inside the rim
  ctx.beginPath(); ctx.arc(cx, cy, FACE, 0, Math.PI * 2);
  const fg = ctx.createRadialGradient(cx - 14, cy - 16, 3, cx, cy, FACE);
  fg.addColorStop(0, '#e0bd7e'); fg.addColorStop(0.55, '#a9834a');
  fg.addColorStop(1, '#6b4e24');
  ctx.fillStyle = fg; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, FACE, 0, Math.PI * 2); ctx.clip();
  grain(ctx, S, S, 'rock_grain', 0.16, 0.22);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, FACE, 0, Math.PI * 2);
  ink(ctx, 3, 'rgba(24,14,4,0.92)');

  // spokes dividing the face into quadrants, incised rather than drawn on: a
  // dark groove with a lit edge below it
  const HUB = 17;
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const x0 = cx + Math.cos(a) * HUB, y0 = cy + Math.sin(a) * HUB;
    const x1 = cx + Math.cos(a) * FACE, y1 = cy + Math.sin(a) * FACE;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(30,18,4,0.75)'; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,238,196,0.3)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x0 + 1.6, y0 + 1.8); ctx.lineTo(x1 + 1.6, y1 + 1.8); ctx.stroke();
  }

  // six raised rivets around the face
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + 0.5;
    dome(ctx, cx + Math.cos(a) * 28, cy + Math.sin(a) * 28, 5.2, 0xb49257, 1.8);
  }

  // hub: ring, then the clan-tinted boss
  ctx.beginPath(); ctx.arc(cx, cy, HUB, 0, Math.PI * 2);
  const hb = ctx.createLinearGradient(cx - HUB, cy - HUB, cx + HUB * 0.6, cy + HUB);
  hb.addColorStop(0, '#e8d3a0'); hb.addColorStop(0.45, '#a2834b'); hb.addColorStop(1, '#4a3418');
  ctx.fillStyle = hb; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, HUB, 0, Math.PI * 2);
  ink(ctx, 2.8, 'rgba(24,14,4,0.94)');
  dome(ctx, cx, cy, 11.5, clan, 2.4);
  return fromCanvas(c);
}

// Emplacement the base turrets sit on. Was a plain Graphics circle, which read as
// a red lollipop next to the painted bunker.
function genTurretBase(colorStr) {
  const clan = parseInt(colorStr, 16);
  const S = 44;
  const c = canvas(S, S);
  const ctx = c.getContext('2d'); const cx = S / 2, cy = S / 2;

  shadow(ctx, cx, cy + 1, 17, 15, 0.34);

  // sandbagged ring — the bags are lit spheres now rather than flat ellipses,
  // which is what makes a ring of them read as stacked sacks
  ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2);
  const rg = ctx.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, 17);
  rg.addColorStop(0, '#c6a670'); rg.addColorStop(0.6, '#96794b'); rg.addColorStop(1, '#5e4a28');
  ctx.fillStyle = rg; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2);
  ink(ctx, 2.2, 'rgba(28,18,6,0.9)');
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const bx = cx + Math.cos(a) * 13.5, by = cy + Math.sin(a) * 13.5;
    const base = i % 2 ? 0xa98d5c : 0x93794a;
    ctx.save(); ctx.translate(bx, by); ctx.rotate(a);
    const bg = ctx.createRadialGradient(-1.6, -1.4, 0.4, 0, 0, 4.8);
    bg.addColorStop(0, css(lighten(base, 66))); bg.addColorStop(0.55, css(base));
    bg.addColorStop(1, css(darken(base, 44)));
    ctx.beginPath(); ctx.ellipse(0, 0, 4.8, 3.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = bg; ctx.fill();
    ink(ctx, 1.4, 'rgba(30,20,8,0.8)');
    ctx.restore();
  }

  // steel mount
  ctx.beginPath(); ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
  const mg = ctx.createLinearGradient(cx - 9, cy - 9, cx + 9, cy + 9);
  mg.addColorStop(0, '#8a8a96'); mg.addColorStop(0.42, '#4c4c56'); mg.addColorStop(1, '#212127');
  ctx.fillStyle = mg; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
  ink(ctx, 2.2, 'rgba(16,16,20,0.94)');

  // clan plate
  dome(ctx, cx, cy, 5.2, clan, 1.8);
  return fromCanvas(c);
}

// ============================================================
// PROJECTILES — drawn pointing up (-Y); call sites rotate by angle + PI/2
// ============================================================
function genShot(type) {
  const c = canvas(20, 34);
  const ctx = c.getContext('2d'); const cx = 10;

  if (type === 'cannon') {
    // Stubby brass shell.
    ctx.beginPath();
    ctx.moveTo(cx, 4); ctx.quadraticCurveTo(cx + 4, 10, cx + 4, 16);
    ctx.lineTo(cx + 4, 24); ctx.lineTo(cx - 4, 24); ctx.lineTo(cx - 4, 16);
    ctx.quadraticCurveTo(cx - 4, 10, cx, 4); ctx.closePath();
    const g = ctx.createLinearGradient(cx - 4, 0, cx + 4, 0);
    g.addColorStop(0, '#8a6a1e'); g.addColorStop(0.4, '#ffdc6a');
    g.addColorStop(0.7, '#d8a832'); g.addColorStop(1, '#7a5c18');
    ctx.fillStyle = g; ctx.fill();
    ink(ctx, 1.7, 'rgba(38,24,2,0.95)');
    // driving band + nose glint: these are shown at icon size in the weapon bar,
    // so they carry more detail than their 10 px in-flight size would justify
    ctx.fillStyle = 'rgba(120,88,20,0.55)'; ctx.fillRect(cx - 4, 19, 8, 2.4);
    ctx.fillStyle = 'rgba(255,255,220,0.85)';
    ctx.beginPath(); ctx.ellipse(cx - 0.6, 7, 1.7, 3, 0, 0, Math.PI * 2); ctx.fill();

  } else if (type === 'blast') {
    // H.E.A.T. — fat finned warhead.
    ctx.fillStyle = '#7a2c08';
    ctx.beginPath(); ctx.moveTo(cx - 7, 24); ctx.lineTo(cx - 4, 15); ctx.lineTo(cx - 4, 26); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(cx + 7, 24); ctx.lineTo(cx + 4, 15); ctx.lineTo(cx + 4, 26); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, 2); ctx.quadraticCurveTo(cx + 6, 9, cx + 5.5, 18);
    ctx.lineTo(cx + 5.5, 27); ctx.lineTo(cx - 5.5, 27); ctx.lineTo(cx - 5.5, 18);
    ctx.quadraticCurveTo(cx - 6, 9, cx, 2); ctx.closePath();
    const g = ctx.createLinearGradient(cx - 6, 0, cx + 6, 0);
    g.addColorStop(0, '#8c2f00'); g.addColorStop(0.35, '#ff9a2e');
    g.addColorStop(0.65, '#ef6a12'); g.addColorStop(1, '#7d2a00');
    ctx.fillStyle = g; ctx.fill();
    ink(ctx, 1.9, 'rgba(34,12,0,0.95)');
    ctx.fillStyle = 'rgba(120,44,0,0.5)'; ctx.fillRect(cx - 5.5, 20, 11, 2.2);
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath(); ctx.ellipse(cx - 0.6, 6, 1.9, 3.4, 0, 0, Math.PI * 2); ctx.fill();

  } else if (type === 'ricochet') {
    // Small hard slug — cheap, fast, weak.
    ctx.beginPath();
    ctx.moveTo(cx, 8); ctx.lineTo(cx + 3, 14); ctx.lineTo(cx + 3, 21);
    ctx.lineTo(cx - 3, 21); ctx.lineTo(cx - 3, 14); ctx.closePath();
    const g = ctx.createLinearGradient(cx - 3, 0, cx + 3, 0);
    g.addColorStop(0, '#1d6c72'); g.addColorStop(0.4, '#b6ffff');
    g.addColorStop(0.8, '#4fd6de'); g.addColorStop(1, '#186067');
    ctx.fillStyle = g; ctx.fill();
    ink(ctx, 1.5, 'rgba(4,30,34,0.95)');
    ctx.fillStyle = 'rgba(230,255,255,0.8)';
    ctx.beginPath(); ctx.ellipse(cx - 0.7, 12, 1.1, 2.2, 0, 0, Math.PI * 2); ctx.fill();

  } else if (type === 'homing') {
    // A proper missile: nose cone, body, tail fins.
    ctx.fillStyle = '#8a2a86';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * 7.5, 27); ctx.lineTo(cx + s * 3.5, 19); ctx.lineTo(cx + s * 3.5, 29); ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath(); ctx.roundRect(cx - 3.5, 9, 7, 20, 2);
    const g = ctx.createLinearGradient(cx - 3.5, 0, cx + 3.5, 0);
    g.addColorStop(0, '#6d1c69'); g.addColorStop(0.35, '#ff9df8');
    g.addColorStop(0.7, '#e055d8'); g.addColorStop(1, '#661a62');
    ctx.fillStyle = g; ctx.fill();
    ink(ctx, 1.7, 'rgba(30,4,28,0.95)');
    ctx.fillStyle = 'rgba(120,20,112,0.5)'; ctx.fillRect(cx - 3.5, 21, 7, 2);
    // nose cone
    ctx.beginPath();
    ctx.moveTo(cx, 1); ctx.lineTo(cx + 3.5, 10); ctx.lineTo(cx - 3.5, 10); ctx.closePath();
    ctx.fillStyle = '#ffd4fb'; ctx.fill();
    ink(ctx, 1.5, 'rgba(30,4,28,0.95)');
    // seeker glow
    ctx.fillStyle = 'rgba(255,120,240,0.9)';
    ctx.beginPath(); ctx.arc(cx, 13, 1.8, 0, Math.PI * 2); ctx.fill();

  } else if (type === 'pulse' || type === 'emp') {
    // Charged orb; the real spectacle is the detonation, not the projectile.
    const g = ctx.createRadialGradient(cx, 17, 1, cx, 17, 9);
    g.addColorStop(0, '#fffbe0'); g.addColorStop(0.35, '#ffd24a');
    g.addColorStop(0.7, '#ff8b16'); g.addColorStop(1, 'rgba(255,110,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, 17, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,180,0.9)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, 17, 5.5, 0, Math.PI * 2); ctx.stroke();

  } else { // mine — a squat puck, no travel
    shadow(ctx, cx, 18, 8, 5, 0.3);
    ctx.beginPath(); ctx.arc(cx, 17, 7.5, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(cx - 2.4, 14.6, 1, cx, 17, 7.5);
    g.addColorStop(0, '#a08046'); g.addColorStop(0.6, '#5d4526'); g.addColorStop(1, '#33240f');
    ctx.fillStyle = g; ctx.fill();
    ink(ctx, 2, 'rgba(20,12,4,0.95)');
    // pressure plate in the middle and the trigger prongs around it
    dome(ctx, cx, 17, 3.6, 0x7a5a2e, 1.4);
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      dome(ctx, cx + Math.cos(a) * 5.6, 17 + Math.sin(a) * 5.6, 1.5, 0x4a3418, 0.9);
    }
  }
  return fromCanvas(c);
}

// ============================================================
// DECALS & MISC
// ============================================================
function genCrater() {
  const c = canvas(56, 56);
  const ctx = c.getContext('2d'); const cx = 28, cy = 28;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  g.addColorStop(0, 'rgba(34,22,10,0.8)');
  g.addColorStop(0.5, 'rgba(74,52,26,0.5)');
  g.addColorStop(0.82, 'rgba(120,94,52,0.28)');
  g.addColorStop(1, 'rgba(150,120,70,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fill();
  // thrown-up rim, heavier on one side so it doesn't read as a stamp
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 15 + Math.sin(a * 3) * 3.5;
    ctx.fillStyle = `rgba(96,72,38,${0.28 + Math.sin(a * 2) * 0.16})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(20,12,4,0.5)';
  ctx.beginPath(); ctx.ellipse(cx, cy, 8, 6.5, 0.4, 0, Math.PI * 2); ctx.fill();
  return fromCanvas(c);
}

// Spoil heaped beside a dig. Soft-edged on purpose — it sits directly on the
// sand, so a hard rim would read as a pancake dropped on the ground. The lit
// crest and the shadowed skirt do the shaping instead.
function genMound() {
  const c = canvas(44, 36);
  const ctx = c.getContext('2d'); const cx = 22, cy = 19;
  shadow(ctx, cx, cy + 4, 15, 8, 0.2);

  // shadowed skirt first, offset down-right
  let g = ctx.createRadialGradient(cx + 3, cy + 3, 2, cx + 2, cy + 2, 17);
  g.addColorStop(0, 'rgba(140,98,44,0.5)'); g.addColorStop(0.65, 'rgba(150,108,52,0.28)');
  g.addColorStop(1, 'rgba(160,118,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + 2, 17, 11.5, 0, 0, Math.PI * 2); ctx.fill();

  // lit heap on top
  g = ctx.createRadialGradient(cx - 5, cy - 5, 1, cx - 1, cy - 1, 14);
  g.addColorStop(0, 'rgba(240,206,152,0.92)'); g.addColorStop(0.55, 'rgba(206,158,92,0.72)');
  g.addColorStop(1, 'rgba(178,128,62,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx - 1, cy - 1, 14, 9, 0, 0, Math.PI * 2); ctx.fill();

  // clods of turned sand, so it reads as dug rather than poured
  speckle(ctx, cx - 11, cy - 7, 22, 14, 18,
          ['rgba(250,224,178,0.5)', 'rgba(128,88,38,0.4)'], 1.7, 11);
  return fromCanvas(c);
}

function genTrack() {
  // A pressed-in smudge, not a printed cleat. Stamped every 7 px of travel these
  // overlap into a continuous scuff; anything crisper reads as railway sleepers.
  const c = canvas(10, 10);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 10);
  g.addColorStop(0, 'rgba(96,68,32,0)');
  g.addColorStop(0.35, 'rgba(104,74,36,0.15)');
  g.addColorStop(0.65, 'rgba(104,74,36,0.15)');
  g.addColorStop(1, 'rgba(96,68,32,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 10, 10);
  ctx.fillStyle = 'rgba(64,44,20,0.10)';
  ctx.fillRect(0, 4.2, 10, 1.6);
  return fromCanvas(c);
}

function genCrate(type) {
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  const X = 4, Y = 3, W = 23, H = 23;
  const box = () => { ctx.beginPath(); ctx.roundRect(X, Y, W, H, 2.5); };
  shadow(ctx, X + W / 2, Y + H / 2 + 2, 12, 8, 0.3);

  box();
  const g = ctx.createLinearGradient(X, Y, X + W * 0.45, Y + H);
  g.addColorStop(0, '#b0863f'); g.addColorStop(0.45, '#835f31'); g.addColorStop(1, '#4b3418');
  ctx.fillStyle = g; ctx.fill();

  // plank seams and the corner bracing, cut in rather than drawn over
  ctx.save(); box(); ctx.clip();
  speckle(ctx, X, Y, W, H, 26, ['rgba(60,40,16,0.3)', 'rgba(220,180,120,0.22)'], 1.4, 3);
  ctx.strokeStyle = 'rgba(44,30,12,0.7)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(X, Y); ctx.lineTo(X + W, Y + H); ctx.moveTo(X + W, Y); ctx.lineTo(X, Y + H);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,226,170,0.28)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X + 1.4, Y); ctx.lineTo(X + W + 1.4, Y + H);
  ctx.moveTo(X + W + 1.4, Y); ctx.lineTo(X + 1.4, Y + H);
  ctx.stroke();
  ctx.restore();

  box(); bevel(ctx, 1.8, 'rgba(255,232,180,0.5)', 'rgba(20,12,2,0.45)');
  box(); ink(ctx, 2.4, 'rgba(20,12,4,0.95)');

  // contents lamp: fuel amber vs. material blue, as a lit dome so it reads at
  // pickup size without needing a label
  const accent = type === 'fuel' ? 0xffcc44 : 0x55aaee;
  dome(ctx, X + W / 2, Y + H / 2, 5.4, accent, 1.7);
  return fromCanvas(c);
}

// Soft drift stamped once per DUNE cell. Filling those cells with flat
// rectangles made dune fields read as translucent grey boxes with stair-stepped
// 50 px edges; overlapping soft blobs union into an organic drift instead.
//
// Two lobes, not one. A single pale blob — which is what this was — stacks up
// across a dune field into what looks like fog or a smudged lens, and it was
// the least convincing thing on screen. In the reference the big dune forms are
// read mostly by their SHADOW, with only a thin lit crest, so this is a warm
// shadow offset down-right with a lighter crest riding up-left of it.
function genDunePatch() {
  const S = 128, R = S / 2;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');

  const lobe = (ox, oy, rad, stops) => {
    const g = ctx.createRadialGradient(R + ox, R + oy, 2, R + ox, R + oy, rad);
    for (const [t, col] of stops) g.addColorStop(t, col);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(R + ox, R + oy, rad, 0, Math.PI * 2); ctx.fill();
  };

  // shadowed body
  lobe(7, 9, R - 6, [
    [0, 'rgba(126,86,38,0.30)'],
    [0.55, 'rgba(140,98,46,0.18)'],
    [1, 'rgba(150,110,56,0)'],
  ]);
  // lit crest
  lobe(-9, -11, R - 16, [
    [0, 'rgba(238,206,150,0.30)'],
    [0.5, 'rgba(228,192,134,0.17)'],
    [1, 'rgba(220,182,124,0)'],
  ]);
  return fromCanvas(c);
}

function genVignette() {
  const sz = 256;
  const c = canvas(sz, sz);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(sz / 2, sz / 2, sz * 0.28, sz / 2, sz / 2, sz * 0.56);
  g.addColorStop(0, 'rgba(180,0,0,0)');
  g.addColorStop(1, 'rgba(180,0,0,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, sz, sz);
  return fromCanvas(c);
}

// ---------- HUD wireframe (green phosphor) ----------
function phosphor(ctx, draw) {
  // Bloom pass then the crisp line, so the vector art glows like a CRT.
  ctx.save();
  ctx.strokeStyle = 'rgba(0,255,90,0.28)'; ctx.lineWidth = 4.5;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  draw(ctx);
  ctx.restore();
  ctx.strokeStyle = '#4dff88'; ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  draw(ctx);
}

function genIconShell() {
  const c = canvas(22, 36);
  const ctx = c.getContext('2d');
  phosphor(ctx, g => {
    g.beginPath();
    g.moveTo(11, 3); g.quadraticCurveTo(18, 13, 17, 25); g.lineTo(17, 31); g.lineTo(5, 31);
    g.lineTo(5, 25); g.quadraticCurveTo(4, 13, 11, 3); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(11, 3); g.lineTo(11, 31); g.stroke();
    g.beginPath(); g.moveTo(5, 25); g.lineTo(17, 25); g.stroke();
  });
  return fromCanvas(c);
}

function genIconFuel() {
  const c = canvas(26, 32);
  const ctx = c.getContext('2d');
  phosphor(ctx, g => {
    g.strokeRect(5, 7, 16, 20);
    g.beginPath(); g.moveTo(9, 7); g.lineTo(9, 3); g.lineTo(15, 3); g.lineTo(15, 7); g.stroke();
    g.beginPath(); g.moveTo(8, 15); g.lineTo(13, 20); g.lineTo(11, 20); g.lineTo(16, 25); g.stroke();
  });
  return fromCanvas(c);
}

function genSchematic() {
  const c = canvas(76, 68);
  const ctx = c.getContext('2d');
  phosphor(ctx, g => {
    g.strokeRect(7, 8, 14, 52);
    g.strokeRect(55, 8, 14, 52);
    for (let y = 12; y < 60; y += 6) {
      g.beginPath(); g.moveTo(7, y); g.lineTo(21, y); g.stroke();
      g.beginPath(); g.moveTo(55, y); g.lineTo(69, y); g.stroke();
    }
    g.strokeRect(24, 14, 28, 40);
    g.beginPath(); g.arc(38, 36, 10, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(38, 26); g.lineTo(38, 6); g.stroke();
  });
  return fromCanvas(c);
}

function genFlash() {
  const c = canvas(32, 32);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,235,1)');
  g.addColorStop(0.35, 'rgba(255,205,95,0.85)');
  g.addColorStop(1, 'rgba(255,140,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(16, 16, 15, 0, Math.PI * 2); ctx.fill();
  return fromCanvas(c);
}

// Curved-glass specular sweep for the radar dome. White on transparent so the
// call site tints it with an additive blend; a broad diagonal band plus a
// top-left bloom is what sells "there is a lens over the phosphor". This used to
// be a photographic foil scan from a purchased pack, which could not ship in a
// public repo — painting it costs nothing and matches the rest of the HUD, all
// of which is generated.
function genGlass() {
  const sz = 256, h = sz / 2;
  const c = canvas(sz, sz);
  const ctx = c.getContext('2d');

  // Broad diagonal band: the sweep a curved surface throws under a single light.
  ctx.save();
  ctx.translate(h, h); ctx.rotate(-Math.PI / 4); ctx.translate(-h, -h);
  const band = ctx.createLinearGradient(0, h - 74, 0, h + 74);
  band.addColorStop(0,    'rgba(255,255,255,0)');
  band.addColorStop(0.42, 'rgba(255,255,255,0.55)');
  band.addColorStop(0.5,  'rgba(255,255,255,0.85)');
  band.addColorStop(0.58, 'rgba(255,255,255,0.45)');
  band.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = band; ctx.fillRect(-sz, 0, sz * 3, sz);
  ctx.restore();

  // Hot spot up-left, matching the down-right cast shadows everything else uses.
  const spot = ctx.createRadialGradient(sz * 0.34, sz * 0.3, 2, sz * 0.34, sz * 0.3, sz * 0.42);
  spot.addColorStop(0, 'rgba(255,255,255,0.7)');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spot; ctx.fillRect(0, 0, sz, sz);

  // Fade to nothing at the rim so the mask edge never reads as a hard cut.
  ctx.globalCompositeOperation = 'destination-in';
  const rim = ctx.createRadialGradient(h, h, sz * 0.2, h, h, h);
  rim.addColorStop(0, 'rgba(0,0,0,1)');
  rim.addColorStop(0.8, 'rgba(0,0,0,0.85)');
  rim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rim; ctx.fillRect(0, 0, sz, sz);

  return fromCanvas(c);
}

// Last-resort fallback: a soft white blob. Used when an 'fx:' PNG failed to
// load, so a missing asset dims an effect instead of crashing the frame.
function genMissing() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(32, 32, 31, 0, Math.PI * 2); ctx.fill();
  return fromCanvas(c);
}

const GENERATORS = {
  tank: (color, scale, chassis) => genTank(color, scale, chassis, false),
  tankwhite: (scale, chassis) => genTank('ffffff', scale, chassis, true),
  turret: genTurret,
  tree: genTree,
  rock: genRock,
  brick: genBrick,
  prop: genProp,
  bunker: genBunker,
  turretbase: genTurretBase,
  shot: genShot,
  crater: genCrater,
  dunepatch: genDunePatch,
  mound: genMound,
  track: genTrack,
  crate: genCrate,
  vignette: genVignette,
  icon: (which) => which === 'shell' ? genIconShell() : genIconFuel(),
  schematic: genSchematic,
  flash: genFlash,
  glass: genGlass,
  _missing: genMissing,
  fx: genMissing,
};

export function tankTextureKey(color, scale, chassis = 0) {
  return `tank:${color.toString(16).padStart(6, '0')}:${scale}:${chassis}`;
}
