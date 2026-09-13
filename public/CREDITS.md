# Credits

## Particle textures — attribution required

```
Particle textures by Reactorcore — https://reactorcoregames.github.io/ (CC BY 4.0)
```

*Particle Effect Texture Essentials* by Reactorcore, licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The `white_on_transparent`
variants are used (RGB = white, alpha = shape) so every effect is tinted in-engine —
one spark sprite serves muzzle flash, EMP burst, ricochet and explosion depending on
the tint it's handed. See `public/assets/fx/`.

This credit is also shown on the in-game pause screen, which is where the licence
actually requires it to live.

## Terrain detail — public domain

- *Sand 01* by Rob Tuytel — [Poly Haven](https://polyhaven.com/a/sand_01) (CC0)
- *Rock Face 03* — [Poly Haven](https://polyhaven.com/a/rock_face_03) (CC0)

Both are greyscaled on import and composited as a low-opacity soft-light grain over
the procedurally painted sand and rock. They are texture *detail*, not the base art —
the painted look from the original game is still doing the work.

## Sound effects — public domain

*Impact Sounds* by [Kenney](https://kenney.nl/assets/impact-sounds) (CC0). Sixteen
clips in `public/assets/sfx/`, layered **over** the synthesized SFX rather than
replacing them: recorded metal gives an impact a transient no oscillator will, but
the engine loop has to follow player speed and stutter on empty fuel, which only a
synthesized source can do.

## Everything else

Tanks, terrain props, bases, projectiles, HUD vector art, decals and every other
sound are generated procedurally at runtime — see `public/js/textures.js` and
`public/js/audio.js`.

---

Re-import any of the above with:

```
powershell -ExecutionPolicy Bypass -File scripts/import-assets.ps1
```

## Not shipped

The radar dome's glass reflection was briefly a scan from a *purchased* holographic
foil pack. Purchased packs are licensed to a developer, not sublicensed to everyone
who clones a public repository, so it was removed rather than committed. It is now
painted at runtime by `genGlass()` in `public/js/textures.js`.

Everything that ships here is CC0 or CC BY — redistributable in a public repo,
with attribution where the licence asks for it. Hold any future asset to that bar
before it goes in `public/assets/`.
