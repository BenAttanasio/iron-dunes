// Loads the imported PNG assets into the texture registry that already lives in
// textures.js. Nothing else in the codebase changes: call sites keep asking for
// getTexture('fx:explosion_a') exactly like they ask for getTexture('rock'), and
// a missing file silently falls back to a procedural generator.
//
// Run scripts/import-assets.ps1 to (re)produce everything under public/assets/.

import { registerTexture, registerDetail } from './textures.js';

const PIXI = window.PIXI;

// key suffix -> file under public/assets/fx/. Registered as 'fx:<name>'.
const FX = [
  // muzzle / glow
  'muzzle_flash', 'glow_hot', 'glow_soft', 'rays_6', 'rays_32',
  // explosions & impacts
  'explosion_a', 'explosion_b', 'explosion_c', 'burst_a', 'burst_b', 'impact_ring',
  'debris_a', 'debris_b', 'debris_scatter',
  // sparks
  'sparks_a', 'sparks_b', 'star_5pt',
  // smoke / dust
  'smoke_a', 'smoke_b', 'cloud', 'fog', 'dust_motes',
  // fire
  'fire_tongue', 'fire_wisp', 'fire_broad', 'embers', 'embers_big',
  // shockwaves & the EM pulse burst
  'shockwave', 'shockwave_ring', 'shockwave_wide', 'sunburst', 'sparkle_burst',
  // electrical
  'arc', 'tendril',
  // ground decals
  'cracked_ground', 'impact_fracture', 'splatter', 'scratch',
  // misc
  'force_field', 'halo_ring', 'sonar_pulse', 'scanlines', 'haze',
];

// Greyscale photographic grain. These are consumed by the canvas generators via
// drawImage, not by PIXI, so they load as plain HTMLImageElements.
const DETAIL = ['sand_grain', 'rock_grain'];

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // missing detail art is not fatal
    img.src = src;
  });
}

export async function loadAssets(onProgress) {
  // Detail grain first: the texture generators read it synchronously when they run.
  const detailImages = await Promise.all(DETAIL.map(n => loadImage(`assets/detail/${n}.png`)));
  DETAIL.forEach((n, i) => { if (detailImages[i]) registerDetail(n, detailImages[i]); });

  const bundle = [];
  for (const n of FX) bundle.push({ alias: `fx:${n}`, src: `assets/fx/${n}.png` });

  let done = 0;
  await Promise.all(bundle.map(async ({ alias, src }) => {
    try {
      const tex = await PIXI.Assets.load(src);
      registerTexture(alias, tex);
    } catch {
      // Leave it unregistered — getTexture() falls back to the procedural generator.
      console.warn(`[assets] could not load ${src}; using procedural fallback`);
    }
    onProgress?.(++done / bundle.length);
  }));
}
