# Tank Wars — Game Design

Revival of an old Flash tank game from bonus.com. This document records the
design so nothing lives only in someone's head again.

## Core loop (open-world survival)

Persistent desert world, no end state. The loop:

1. **Dig** — resource deposits are buried in the sand. Disturbed-sand mounds
   fade in as you get close; press **E** once to uncover, again to collect.
   Fuel powers movement and heavy weapons; materials are ammunition.
2. **Fight** — three rival clans patrol and war with each other and with you.
   Destroyed tanks drop salvage crates.
3. **Rank up** — kills, digs, and survival earn XP. Death costs XP
   (never a full rank). Rank unlocks upgrade points.

## Rankings

> **PLACEHOLDER — the original bonus.com ranking ladder is not yet recorded.**
> The user played the original and will dictate the real rank names,
> thresholds, rank-up rules, and unlocks from memory. When that happens,
> record it here verbatim, then update `RANKS` in `public/js/config.js` —
> the system is fully data-driven, so the real ladder drops in as data.
>
> Also record here: the original game's name on bonus.com.

Current placeholder ladder (public/js/config.js `RANKS`):

| Rank | XP | Notes |
|---|---|---|
| Recruit | 0 | |
| Private | 100 | |
| Corporal | 250 | |
| Sergeant | 500 | |
| Lieutenant | 900 | |
| Captain | 1500 | |
| Major | 2400 | |
| Colonel | 3600 | |
| General | 5200 | |
| Warlord | 7500 | |

### XP sources (TUNING in config.js)

| Event | XP |
|---|---|
| Kill (killing blow) | +25 |
| Uncover a deposit | +3 |
| Deplete a deposit | +5 |
| Survival outside base | +1 per 10 s |
| **Death** | −15 % of the current rank band (never demotes) |

XP persists in localStorage (`tankwars.save.v1`) along with last selected
clan/tank and the mute setting.

### Upgrade slots

Each rank above Recruit grants one upgrade point, capped by the tank model's
slot count (Forge: 9, Bison: 5, Sundance/Spectre: 4). Each point currently
gives +3 max HP and +1 % damage, applied on spawn. This makes the `slots`
stat real; revisit once the original unlock rules are known.

## Combat

- 6 weapons (keys 1–6 or mouse wheel): Cannon, H.E.A.T. (area blast, costs
  fuel+materials), Ricochet (bounces), Homing, Mine, EM Pulse (disables
  electronics — victim can't move/shoot, radar shows static).
- Damage is clan-based: any projectile/mine/turret hurts any tank of another
  clan. NPC shots deal 70 % damage (player-friendliness nerf from the
  prototype, kept deliberately).
- Base turrets engage the nearest hostile-clan tank within 400 px,
  line-of-sight required.
- Death: explosion, wreck scorch, 5 s redeploy countdown showing the XP
  penalty; respawn at base with reduced fuel/materials and 2 s spawn
  protection.

## Resources & bases

- Deposits: hidden until dug, then visible on the radar; respawn ~30 s after
  depletion. Kill drops: salvage crates (2–4 fuel or materials, 15 s).
- Own base: slow repair/refuel/rearm while inside ("CLAN DEPOT").
- Fuel: drains while driving; below 25 % → warning + alarm; at 0 → half
  speed and engine stutter (you can always limp home).

## NPC ecology

- 4 clans (Martian Militia, Peace Keepers, Dune Dragoons, Blue Tide) in the
  four corners. All clans fight all other clans, not just the player.
- AI states: PATROL (waypoint graph over the lane network) → ATTACK
  (200–380 px standoff, fires only with line of sight) → SEEK (last known
  position, 6 s) → RETREAT (below 30 % HP, heals at base) → DISABLED (EMP).
- Wave director: every 20 s each clan is topped up toward its population
  target (5 + player rank scaling, cap 9; allied clan keeps 3 patrollers).
  Reinforcements are announced in the message feed.

## HUD (styled after the original)

Top bar of black panels with green borders: wireframe tank schematic
(colors degrade with HP, flickers on hit), shell/fuel counters, 3-line
message feed, circular radar with rotating sweep (blips snapshot when the
sweep passes them and fade until re-swept; undiscovered deposits never
appear), rank panel with XP bar. Bottom: 6-slot weapon bar with cooldown
sweep and cost display, grey STOP button (pause), low-fuel / EMP / low-HP
overlays.

## Audio

All SFX are synthesized with WebAudio (no asset files): engine loop follows
speed, per-weapon shots, explosions, dig scrapes, EMP sweep, rank-up
fanfare, low-fuel alarm. Mute persists.

## Art / future asset swap

All textures are canvas-generated behind a registry
(`public/js/textures.js`, `getTexture(key)`). To swap in purchased art,
replace a generator with a `PIXI.Assets` lookup for the same key — call
sites don't change. The visual target is `Old Images/preview.webp`
(original screenshot): warm rippled sand, outlined cartoon tanks, leafy
bushes, red brick obstacles, black/green HUD panels.
