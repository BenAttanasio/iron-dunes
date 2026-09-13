# Iron Dunes: Rogue Battalions

An open-world tank survival game in a persistent desert. Drill buried deposits,
haul the cargo back to your depot before somebody kills you and takes it, fight
three rival clans who are working the same ground, and spend every promotion on
upgrades that decide what you can survive next.

There's no end state. You go back out.

Play it at [benattanasio.com/lab/iron-dunes](https://benattanasio.com/lab/iron-dunes).

## It's a revival of a game that doesn't exist any more

The original was **Battlefield 2: Rogue Battalions**, a Flash game on bonus.com.
bonus.com was a pre-Newgrounds portal full of Java and Flash games that shut down
around 2011, and when Flash itself died in 2020 the game went with it. There's no
archive of it that I've found, and almost nothing written about it anywhere.

This is a from-scratch rebuild. None of the original code, art, or audio is here.
The art direction was reconstructed from a single surviving reference screenshot,
kept in `Old Images/preview.webp`.

Two things inherit directly from the original and shouldn't be renamed: the four
clan names (Martian Militia, Peace Keepers, Dune Dragoons, Blue Tide), and the
`tankwars.save.v1` localStorage key, which is a storage identifier rather than a
title. Changing that key silently wipes every existing player's career.

### About the name

*Rogue Battalions* was the original's own half and it stays. *Battlefield* is an
active EA trademark in this exact category, so it can't sit in the title of a
game anyone can go and play, however affectionate the intent. **Iron Dunes**
replaces it, and it describes the thing more accurately anyway: a persistent
world you keep going back out into, rather than a map you win.

## Playing it

```bash
npm start
```

Then open http://localhost:3000.

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Aim turret |
| Click or Space | Fire |
| 1 to 6, or wheel | Select weapon |
| E (hold) | Drill a deposit |
| U | Service Record: ladder, upgrades, records |
| Tab (hold) | Theatre map |
| Esc | Back out of the Service Record, otherwise pause |

## The loop

1. **Drill.** Deposits are buried. Disturbed-sand mounds fade in as you get
   close, and holding E drills one for the tier's full channel time while you
   stand still. Drilling is loud and pulls hostiles toward you.
2. **Haul.** Fuel goes straight into the tank, but materials are cargo. They only
   become ammunition once you bank them at your own depot, and you drop most of
   the load where you die.
3. **Fight.** Three rival clans patrol, work the deposits themselves, and war
   with each other as well as with you. Destroyed tanks drop salvage crates that
   pay out as ammo where they fall.
4. **Rank up.** Kills, banking, and survival earn XP. Death costs XP and never a
   full rank. Each promotion is an upgrade point you spend where you want, and
   the ladder gates which tank models you can drive.

Those four are one system rather than four features, and the reason is in the
design doc: an earlier version had NPCs that couldn't hit a moving target, and
that single fact hollowed out everything else. If you can dodge every shell by
driving in a straight line, fuel doesn't matter, cover doesn't matter, the
resources that buy your ammunition don't matter, and neither does the rank that
was supposed to make you stronger.

[docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) records the whole design, including
the aiming fix that everything else hangs off, the clan doctrines, the vein
tiers, the NPC ecology, and the rank ladder.

## How it's built

Plain JavaScript modules on a canvas, no framework and no build step. Around
twenty modules under `public/js/`, each owning one concern: `world`, `entities`,
`npc`, `ammo`, `progression`, `records`, `hud`, `audio`, `textures`, `save`.

`server.js` is a static file server for local development. The game is entirely
client-side, so deploying it is copying `public/` to any static host.

Audio is synthesised with WebAudio rather than shipped as clips wherever it has
to react continuously. The engine loop follows your actual speed and stutters
when the fuel runs out, which is a thing a looping sample can't do.

Saves live in localStorage under `tankwars.save.v1`. There's no account and no
server to talk to.

## Layout

```
public/
  index.html
  js/            the game, one module per concern
  css/
  assets/        fx sprites, terrain detail, sfx
  CREDITS.md     asset licences, also shown on the pause screen
docs/GAME_DESIGN.md
Old Images/preview.webp    the reference screenshot the art was rebuilt from
server.js                  static file server for local dev
```

## Assets and licensing

The code is MIT, see [LICENSE](LICENSE). The art and audio have their own terms,
recorded in [public/CREDITS.md](public/CREDITS.md) and shown in game on the pause
screen, which is where the licences actually require them to be.

- Particle textures by **Reactorcore**, CC BY 4.0. The white-on-transparent
  variants are used so every effect is tinted in engine, which is why one spark
  sprite serves the muzzle flash, EMP burst, ricochet, and explosion.
- Terrain detail from **Poly Haven** (Sand 01 by Rob Tuytel, Rock Face 03), CC0.
  Both are greyscaled on import and composited as low-opacity grain over the
  procedurally painted sand and rock.

A purchased holographic foil pack was used for the radar dome reflection during
development and has been removed, because a purchased pack licenses the buyer
rather than everyone who clones the repo.

## Limitations

- Single player. The NPCs are the opposition, and there's no netcode.
- Desktop only. It needs a mouse for the turret and a keyboard for movement, and
  there are no touch controls.
- One map. The desert is persistent and procedurally dressed, without alternate
  theatres.
- Saves are per-browser. Clearing site data ends your career.

## License

MIT for the code. See [LICENSE](LICENSE) and
[public/CREDITS.md](public/CREDITS.md) for the asset terms.

More at [benattanasio.com/lab](https://benattanasio.com/lab).
