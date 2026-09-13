// World-anchored floating text: the "+9 CANNON" that tells you a dig paid out.
//
// The resource loop's biggest feedback gap was that a haul was invisible — a
// deposit topped up six magazines proportionally and the only signal was a sound.
// These are the numbers, drawn in world space above whatever produced them.
//
// PIXI.Text is expensive to construct, so the sprites are pooled and recycled;
// nothing is created after the pool warms up.

import * as state from './state.js';

const PIXI = window.PIXI;

const MAX_FLOATERS = 28;
const pool = [];
const active = [];

function acquire() {
  const t = pool.pop();
  if (t) return t;
  return new PIXI.Text({
    text: '',
    style: {
      fontSize: 13, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold',
      stroke: { color: 0x000000, width: 4 },
    },
  });
}

// opts: color, size, life (frames), vy, delay (frames before it appears)
export function spawnFloater(x, y, text, opts = {}) {
  if (!state.layers.floaters) return;
  if (active.length >= MAX_FLOATERS) {
    const oldest = active.shift();
    oldest.t.parent?.removeChild(oldest.t);
    pool.push(oldest.t);
  }
  const t = acquire();
  t.text = text;
  t.style.fontSize = opts.size ?? 13;
  t.style.fill = opts.color ?? 0xffffff;
  t.anchor.set(0.5, 1);
  t.x = x; t.y = y;
  t.alpha = 0;
  t.scale.set(1);
  state.layers.floaters.addChild(t);

  const life = opts.life ?? 62;
  active.push({
    t, x, y, life, maxLife: life,
    vy: opts.vy ?? -0.62,
    delay: opts.delay ?? 0,
  });
}

// A stack of payout lines that don't overlap — one dig can pay out several
// weapons at once, and they have to be readable as a list rather than a pile.
export function spawnFloaterStack(x, y, lines, opts = {}) {
  lines.forEach((line, i) => {
    spawnFloater(x, y - i * 15, line.text, {
      ...opts,
      color: line.color ?? opts.color,
      delay: i * 4,
      life: (opts.life ?? 62) + i * 5,
    });
  });
}

export function updateFloaters(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const f = active[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    f.y += f.vy * dt;
    f.vy *= Math.pow(0.97, dt);       // eases to a stop rather than drifting off
    f.life -= dt;
    f.t.y = f.y;

    const k = f.life / f.maxLife;
    // Quick pop in, long hold, fade on the last third.
    const tIn = 1 - k;
    f.t.alpha = tIn < 0.08 ? tIn / 0.08 : Math.min(1, k / 0.33);
    f.t.scale.set(tIn < 0.08 ? 0.7 + (tIn / 0.08) * 0.3 : 1);

    if (f.life <= 0) {
      f.t.parent?.removeChild(f.t);
      pool.push(f.t);
      active.splice(i, 1);
    }
  }
}

export function clearFloaters() {
  for (const f of active) {
    f.t.parent?.removeChild(f.t);
    pool.push(f.t);
  }
  active.length = 0;
}
