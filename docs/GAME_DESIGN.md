# Iron Dunes: Rogue Battalions — Game Design

Revival of an old Flash tank game from bonus.com. This document records the
design so nothing lives only in someone's head again.

## Lineage and the name

The original was **Battlefield 2: Rogue Battalions**, a Flash game on bonus.com.
This is a from-scratch revival of it — none of its code, art, or audio is here,
and the art direction was reconstructed from a single reference screenshot
(`Old Images/preview.webp`).

The name keeps the half that was the original's own and drops the half that was
not. *Battlefield* is an active EA trademark in exactly this category, so it
cannot sit in the title of a game that is publicly playable, no matter how
affectionate the intent. *Rogue Battalions* carries no such weight, so it stays
as the wordmark under the title. **Iron Dunes** is the new first half: tank,
desert, and — unlike "battlefield" — an accurate description of a persistent
world you keep going back out into rather than a map you win.

Two things that inherit from the original and should not be quietly renamed:
the four clan names (Martian Militia, Peace Keepers, Dune Dragoons, Blue Tide)
in `CLANS`, and the localStorage save key `tankwars.save.v1` — the key is a
storage identifier, not a title, and changing it silently wipes every existing
player's career.

## Core loop (open-world survival)

Persistent desert world, no end state. The loop:

1. **Drill** — resource deposits are buried in the sand. Disturbed-sand mounds
   fade in as you get close; **hold E** to drill, standing still, for the tier's
   full channel time. Drilling is loud and pulls hostiles toward you.
2. **Haul** — fuel goes straight in the tank, but materials are *cargo*. They only
   become ammunition when you bank them at your own depot, and you drop most of
   the load where you die.
3. **Fight** — three rival clans patrol, war with each other and with you, and
   work the deposits themselves. Destroyed tanks drop salvage crates, which pay
   out as ammo on the spot.
4. **Rank up** — kills, banking, and survival earn XP. Death costs XP (never a
   full rank). Each promotion is an upgrade point you choose where to spend, and
   the ladder gates the tank models.

### Why the loop is shaped this way

The three systems above are one system. The version before this had NPCs that
could not hit a moving target (see *Combat → Aiming*), and that single fact
hollowed out everything else: if you can dodge every shell by driving in a
straight line, then fuel doesn't matter, cover doesn't matter, the resources that
buy your ammunition don't matter, and neither does the rank that was supposed to
make you stronger. Nothing was ever at stake.

Fixing the aiming is what gives the rest teeth. Once shells land, being stationary
for a seven-second drill is a real risk, running on half speed at empty fuel is
genuinely dangerous, and carrying an unbanked load is worth protecting. Retune any
of these three together — they only work as a set.

## Rankings

> **PLACEHOLDER — the original bonus.com ranking ladder is not yet recorded.**
> The user played the original and will dictate the real rank names,
> thresholds, rank-up rules, and unlocks from memory. When that happens,
> record it here verbatim, then update `RANKS` in `public/js/config.js` —
> the system is fully data-driven, so the real ladder drops in as data.
>
> **What depends on the ladder's length**, if you re-rung it: the model `reqRank`
> gates, `slots` (sized against one point per promotion), and `AI_SKILL_MIX`
> (indexed by quartile, so it adapts automatically). Nothing reads the *thresholds*
> except the ladder itself.

Current placeholder ladder (public/js/config.js `RANKS`), following the real
US Army order. Not every real rung is present — this is the subset the user
picked, not the full E-1…O-10 ladder. `Recruit` and `Warlord` are not real
Army ranks; they bookend the ladder as the tutorial rung and the capstone.

| Rank | XP | Real equivalent | Notes |
|---|---|---|---|
| Recruit | 0 | — | Not an Army rank (E-1 is Private) |
| Private | 100 | E-1/E-2 | |
| Corporal | 250 | E-4 | Specialist (E-4) omitted |
| Sergeant | 450 | E-5 | |
| Staff Sergeant | 700 | E-6 | |
| Sergeant First Class | 1000 | E-7 | Outranks Staff Sergeant despite the name |
| Master Sergeant | 1350 | E-8 | |
| Sergeant Major | 1750 | E-9 | |
| Lieutenant | 2200 | O-1/O-2 | 2nd/1st Lt not split |
| Captain | 2700 | O-3 | |
| Major | 3300 | O-4 | |
| Lieutenant Colonel | 4000 | O-5 | |
| Colonel | 4800 | O-6 | |
| Brigadier General | 5700 | O-7 | 1 star |
| Major General | 6800 | O-8 | 2 stars — outranks Brigadier |
| Lieutenant General | 8100 | O-9 | 3 stars |
| General | 9700 | O-10 | 4 stars |
| Warlord | 11700 | — | Fictional capstone (where *General of the Army* sits) |

Deliberately omitted: Private First Class, Specialist, First Sergeant,
Command Sergeant Major, the entire warrant officer tier (W-1…CW-5).

Thresholds were re-spaced when the ladder grew from 10 rungs to 18. The curve
keeps its accelerating shape and the early rungs are near their old values;
the top moved 7500 → 11700, so a full climb is roughly 55 % longer than the
10-rung version. Retune freely — nothing reads these numbers but the ladder.

### XP sources (TUNING in config.js)

| Event | XP |
|---|---|
| Kill (killing blow) | +25 |
| Uncover a deposit | +3 |
| Drill a deposit dry | +6 common / +22 rich (`VEIN_TIERS[].xp`) |
| Bank cargo at the depot | +1.5 per unit |
| Survival outside base | +1 per 10 s |
| **Death** | −15 % of the current rank band (never demotes) |

Note the weighting: **banking pays more than digging**. Finding a rich vein is
worth something, but getting it home is worth more, which is the whole point of
making materials a haul rather than an instant refill.

### Seeing the ladder — the Service Record

**It owns a top-level stage layer of its own** (`recordContainer` in `main.js`),
not a slot inside `menuContainer`. Parented to the menu it could never be seen in
either context: `showMenu()` opens with `removeChildren()`, so the first menu
draw detached it from the stage permanently, and `hideMenu()` hides that
container during play, so it could not have drawn over the game even before
that. The symptom was that `U` "just opened the pause menu" — the handler pauses
first, and the record itself never rendered — and that clicking the menu's
SERVICE RECORD button appeared to do nothing.

Press **U** (in game, paused, or from the menu) for the Service Record. Three tabs:

- **Rank ladder** — all 18 rungs, your position, XP cost, and what each unlocks.
- **Upgrades** — spend points, three offers at a time.
- **Hall of Records** — career bests (see below).

This screen exists because the ladder's requirements previously lived *only* in
`config.js`. There was no in-game way to find out what the next rank cost or what
it gave you, so the ranks read as decorative titles.

### Upgrade points

**One point per promotion, spent by the player**, chosen from three offered tracks
(`UPGRADES` in config.js). The offer is deterministic in the hull and the points
already sunk into it, so closing the screen cannot be used to reroll it.

This replaced auto-applied points worth +3 max HP and +1 % damage each. A Forge
that climbed the *entire* 11,700-XP ladder gained +27 HP and +9 % damage under the
old scheme — imperceptible, and never a choice. Tracks are now worth noticing
(+14 HP, +8 % damage, −7 % reload, …).

**Each hull keeps its own build sheet**, spending the same career points
independently. `slots` is that hull's cap: Sundance 11, Bison 13, Spectre 11,
Forge 17 against 17 points at max rank — only the Forge can absorb a whole career,
which is what "max upgrade potential" is supposed to mean.

> The first cut of this shared one sheet across all hulls and truncated it to the
> model's cap at *apply* time. That was quietly broken: the truncation ran in
> `UPGRADES` array order, so on a smaller hull the tracks declared last silently
> did nothing — you could sink points into AUTOLOADER and get no autoloader, with
> no way to find out. Per-hull sheets remove the truncation entirely and make
> switching hulls cost nothing; it only changes the ceiling.

Before that, points were spread evenly across the ladder so every model filled its
last slot at max rank. That worked only because the old 10-rung ladder happened to
match the Forge's 9 slots; on 18 rungs it capped the Forge at Captain.

### Model unlocks

| Model | Required rank | XP |
|---|---|---|
| Sundance | Recruit | 0 |
| Bison | Sergeant | 450 |
| Spectre | Master Sergeant | 1350 |
| Forge | Captain | 2700 |

Locked hulls stay visible on the select screen with their requirement shown —
seeing what the Forge is and what it costs is the reason to keep climbing. A save
pointing at a hull now out of reach falls back via `fallbackModelIndex`.

### Rank as identity

Rank is worn, not just displayed: the insignia floats above your hull, and from
Lieutenant up hostiles call you out by rank in the message feed when they acquire
you (throttled to once per 22 s, `announceContact`). Most importantly, **your rank
drives the NPC skill mix** — see *Combat → Skill tiers*.

### Hall of Records (records.js)

Career bests, persisted, never reset by death: most kills in one life, longest
life, deepest push from base, biggest cargo run, peak XP, highest rank, career
kills, deposits drilled dry, materials banked, tanks lost. A sandbox with no end
state needs something to chase; this is it, and it costs nothing because the save
file was already there.

### Save format

`tankwars.save.v1` (key name is stable; the `v` field inside migrates). **v2** adds
per-hull `upgrades` and `records`. A v1 save migrates rather than resetting — the
XP climb is the one thing nobody should lose.

## The map

**Open desert, not a maze.** The generator starts every cell OPEN and then
*places* obstacles. (It used to do the opposite — fill the grid with wall and
carve narrow lanes — which lined every driving lane with impassable rock and
then scattered more rock into the lanes themselves.)

- Landmark clusters on a jittered lattice (min 7 cells apart): bush groves,
  rock outcrops, brick ruins, and dune fields. Dune fields are **passable** —
  they change the footing, not the route.
- Three authored chokepoints, the only places terrain deliberately squeezes:
  a ruined brick ring around the map centre with four gates, and two rock
  ridges pinching the north and south approaches, each with two 5-cell gaps.
  All three stop short of the map edge, so nothing is ever cut off.
- **Clearance guarantee** (`widenPinches`): no passable cell may sit in a gap
  narrower than `MIN_CORRIDOR` (3 cells / 150 px) on both axes. Obstacles
  erode until that holds. Then `ensureConnected` flood-fills from each base
  and carves a corridor if the centre is unreachable. You cannot get wedged.
- Decorative scenery (stones, scrub, bones, wrecks) is drawn with **no
  collision** — density without blocking anyone.
- Seeded from `WORLD_SEED`, so the desert is identical every session and worth
  learning.

Obstacle sprites are jittered off their cell centre to break up the 50 px grid,
but only by ~a third of a cell: collision is per-cell, so a sprite flung further
than that visually sits on ground you can actually drive over.

## Combat

Six weapons (keys 1–6, mouse wheel, or click a slot).

**Ammo is per weapon.** Each has its own magazine — spending a Cannon round never
costs you a Ricochet or an EM Pulse. `maxAmmo` is therefore the dial that makes
the weapons feel different: 60 ricochets against 3 EM pulses says more than any
damage number. Fuel is the one shared cost, and only the two heaviest weapons
spend it on top of their own ammo.

| # | Weapon | Damage | Reload | Magazine | Fuel | Character |
|---|---|---|---|---|---|---|
| 1 | Cannon | 30 | 400 ms | 30 | — | The basic shot. Baseline for everything. |
| 2 | H.E.A.T. | 52 + 90 px blast | 1100 ms | 6 | 4 | Heaviest hit, very few shots. |
| 3 | Ricochet | 12, 10 bounces | 220 ms | 60 | — | Cheap and plentiful, weak, bounces off everything. |
| 4 | Homing | 22, slow (speed 3.6) | 550 ms | 20 | — | Real seeker (420 px). Hits less hard than H.E.A.T. |
| 5 | Mine | 45 | 1000 ms | 12 | — | Area denial. |
| 6 | EM Pulse | 3 + disable | 3000 ms | **3** | 12 | A shot that bursts where it lands. |

- **EM Pulse** is a projectile, not a self-detonation: it flies out and bursts
  where it lands, disabling out to 420 px. Duration falls off with range from the
  burst (2.5 s at the centre → 0.6 s at the edge), caps at the 5 nearest targets,
  and refreshes rather than stacks — one pulse must not neutralise a whole field.
- **Ricochet** gets 10 bounces and a long life on purpose. Bouncing is its whole
  identity, and over open desert a 4-bounce round simply never visibly bounced.
  The bounce also rewinds to the last passable position before reflecting;
  reflecting in place left the round inside the wall, where it ping-ponged and
  burned every bounce in a few frames.
- Cooldowns are **per weapon** (`tank.lastShotPer`), so a heavy shot can
  recharge while you keep firing something cheap.
- Every projectile has its own sprite and a tapered ribbon trail; the missiles
  additionally cough textured smoke. All trails render into one shared
  `Graphics`, so they cost one draw call no matter how many shots are in flight.
- Damage is clan-based: any projectile/mine/turret hurts any tank of another
  clan. NPC shots deal 70 % damage (player-friendliness nerf from the
  prototype, kept deliberately).
- Base turrets engage the nearest hostile-clan tank within 400 px,
  line-of-sight required.
- Death: explosion, wreck scorch, 5 s redeploy countdown showing the XP penalty
  **and the cargo you spilled**; respawn at base with reduced fuel/materials and
  2 s spawn protection.
- Reload is per *tank*, not per weapon — the AUTOLOADER upgrade and the NPC skill
  tiers both scale it. Everything must go through `reloadOf(tank, weapon)`,
  including the HUD's cooldown wipe, or the bar disagrees with the gun.

### Aiming — the bug this all hinged on

NPCs used to fire at `atan2(target.y - y, target.x - x)`: **where the target is**.
With a speed-5 shell across a 200–380 px standoff that is 40–75 frames of flight,
during which a Spectre at 2.8 px/frame has moved ~150 px.

They were not "easy". They were *mathematically incapable* of hitting anything
that was moving. Measured on the real code, aiming at a crossing target 300 px out:

| Aim | Miss distance |
|---|---|
| Old behaviour (no lead) | **146.6 px** |
| Full intercept solve | **2.2 px** |

The hit radius is 22 px. Driving in any straight line was perfectly safe forever,
which is why fuel, cover, resources and rank all felt weightless.

`leadAngle` (npc.js) now solves the intercept iteratively — predict where the
target will be when the shell arrives, re-solve three times. Velocities and
projectile speed are both in px-per-dt-frame, so `t` is in frames and the units
line up with no conversion.

The miss then comes *back*, but as a designed stat rather than a physics failure.

### Skill tiers (`AI_SKILLS`, `AI_SKILL_MIX`)

| Tier | Lead | Jitter | Reload | Strafe | Cover |
|---|---|---|---|---|---|
| Green | 0.30 | 0.115 | ×1.40 | 0.25 | — |
| Regular | 0.72 | 0.055 | ×1.05 | 0.60 | 0.35 |
| Veteran `»` | 0.95 | 0.024 | ×0.82 | 1.00 | 0.80 |
| Elite `★` | 1.00 | 0.009 | ×0.66 | 1.20 | 1.00 |

`lead` is the fraction of the full intercept solution applied — 0 reproduces the
old broken aim exactly, 1 is a perfect intercept. A Green crew still misses a
crossing target; an Elite crew does not.

**The mix shifts with your rank** (`AI_SKILL_MIX`, one row per quartile of the
ladder). At Recruit the desert is 70 % rookies who spray; by Warlord it is 75 %
veterans and elites who lead perfectly. This is the main dial that makes rank
*felt* in the firefight rather than read in a panel. Veteran and up wear their tier
marker in the callsign label so you can tell before they shoot.

### Clan doctrines (`CLANS[].loadout`)

Every hostile used to fire one identical nerfed cannon, so all four clans played
the same and it never mattered who you were fighting.

| Clan | Primary | Secondary | Standoff | Reads as |
|---|---|---|---|---|
| Martian Militia | H.E.A.T. | Cannon (far) | ×0.62 | Rushers who close and hit hard |
| Peace Keepers | Cannon | Mine (retreating) | ×1.15 | Area denial; their retreat is a threat |
| Dune Dragoons | Ricochet | Cannon (no LOS) | ×1.30 | Skirmishers, lethal in the brick ruins |
| Blue Tide | Homing | Cannon (close) | ×1.00 | Missile crews you have to break LOS on |

NPC weapon stats are tuned down from the player versions (`NPC_WEAPON_TWEAKS`).
**EM Pulse is deliberately absent from every loadout** — on the receiving end a
disable is a punishment, not a fight.

### Movement in a fight

- Inside the standoff band NPCs used to `moveTank(0,0,0)` — two statues trading
  shells, and trivially easy to lead in return. They now **circle**, flipping
  direction every ~2.2 s.
- Veterans and above **break line of sight while reloading** (`seekCover`): sample
  eight headings, prefer one that blocks LOS while staying in the band, re-engage
  when the gun is back. Peek, shoot, hide.

### Notoriety and hunter squads

Killing a clan's tanks raises your notoriety with it (`+10` per kill, decaying
0.22/s). Past 45 that clan dispatches a **hunter squad** of 3 Veteran-or-better
tanks that path to you directly regardless of aggro range, for 60 s. They wear red
labels and get a ring on the theatre map.

Notoriety *pays for* the squad rather than resetting, so a sustained rampage keeps
them coming instead of buying one wave of silence. This is rank-as-difficulty you
can feel, and it is the only thing in the game that hunts you personally.

## Resources & bases

Two resources, as in the original: **fuel** (oil) and **materials** (gems).

### What was wrong with digging

It was one instant keypress. There was no window in which anything could go wrong,
the reward was invisible (a spread refill of six magazines — a 3-unit deposit was
9 cannon rounds but *0.9 of an EM Pulse*, so the interesting half of the arsenal
never visibly restocked), and if your magazines were near full you got literally
nothing while the reward chime still played. With 34 deposits respawning every
30 s, nothing was ever contested and skipping one cost you nothing.

### Drilling is a channel

**Hold E.** You must stand still (`DRILL_MOVE_CANCEL`); moving, an EMP, or
releasing breaks it off. A ring fills around the deposit and the drill audio climbs
in pitch across the channel.

The drill is **loud**: it pushes a noise contact (`emitNoise`) that pulls every
hostile inside the radius toward you, weighted so closer tanks are likelier to
bite. This is the single channel between the resource system and the AI, and it is
why the AI has any reason to converge on you at all. Every deposit is now a
decision: clear the area first, or gamble.

### Vein tiers (`VEIN_TIERS`)

| Tier | Units | Drill | Noise | XP | Share |
|---|---|---|---|---|---|
| Common | 3–6 | 2.4 s | 560 px | 6 | 78 % |
| Rich vein | 12–17 | 7.2 s | 1000 px | 22 | 22 % |

Rich veins are ringed, larger, always typed, and their mound fades in from further
away. Because `WORLD_SEED` is fixed, *where the rich veins are* is knowledge worth
having — the map is learnable and that is the point.

### Typed caches

A material deposit may be earmarked for one weapon (always, for rich veins;
`typedChance` otherwise), weighted toward the heavy weapons a spread refill could
never visibly restock. The node and its crates take that weapon's colour, so you
can read the payout from across the dune. `addAmmoTyped` gives 0.42 of that
magazine per unit versus 0.10 spread across all six — finding an EM Pulse cache is
an event.

### Cargo — materials are hauled, not consumed where they're found

Fuel goes straight in the tank. **Materials become cargo** (`{spread, per[]}`),
capped by the hull (`TANK_MODELS[].cargo`, 12–26), and only become ammunition when
you **bank them at your own depot** — 6 units/s, at ×1.5 the value of field
salvage. Dying spills 75 % of your load as recoverable crates, typed ones dropping
as typed crates.

This is what makes the trip home tense and gives death a cost you can see. An XP
number nobody watches is not a consequence; a lost load is.

> **The safety valve.** Kill salvage still pays out as ammo *on the spot*, not as
> cargo. That is deliberate: it means the hauling economy can never brick you far
> from base with an empty magazine. Hauling is the efficient path, fighting is the
> desperate one, and both work. Drilling also refuses to *start* when the relevant
> store is already full, so you can't spend seven seconds on a rich vein only to be
> told your hold was full the whole time.

### Everything else

- Deposits: hidden until drilled, then visible on the radar; respawn ~30 s after
  depletion. Kill drops: salvage crates (2–4 fuel or materials, 15 s).
- **NPCs work the deposits too.** One digger per clan at a time, never within
  420 px of the player, drilling for 5.2 s and making their own (quieter) noise.
  A rival stripping a vein you wanted is something you can hear coming and go take
  off them — a whole encounter that falls out of systems that already existed.
- Own base: slow repair/refuel/rearm while inside ("CLAN DEPOT"), plus cargo
  banking. The rearm rate is deliberately slow — at the first value tried, parking
  at base out-paced going and digging, which made the whole resource loop
  pointless.
- Fuel: drains while driving; below 25 % → warning + alarm; at 0 → half
  speed and engine stutter (you can always limp home). This now *matters*, because
  shells land.

### Feedback

Every payout says what it was, in world space, above the hole it came out of
(`floaters.js` — pooled `PIXI.Text`, nothing allocated after warm-up), the
specific weapon slots that took delivery flash in the weapon bar, and a completed
drill plays a rising arpeggio (longer and higher for a rich vein). The old dig gave
you a sound and nothing else.

## NPC ecology

- 4 clans (Martian Militia, Peace Keepers, Dune Dragoons, Blue Tide) in the
  four corners. All clans fight all other clans, not just the player. Each fights
  with its own weapon doctrine — see *Combat → Clan doctrines*.
- Every NPC gets its own callsign at spawn (`MM·Ravager88`), shown above its HP
  bar in the clan colour and faded out with distance so a crowded field doesn't
  turn into text soup. Veteran and Elite crews prefix theirs with `»` / `★`.
  The kill feed names them.
- AI states: PATROL (waypoint graph over open ground; hunters path straight to
  you instead) → ATTACK (per-clan standoff band, circling, cover discipline while
  reloading) → SEEK (last known position or a noise contact) → HARVEST (drilling a
  deposit) → RETREAT (below 30 % HP, heals at base) → DISABLED (EMP).
- Wave director: every 20 s each clan is topped up toward its population
  target (5 + player rank scaling, cap 9; allied clan keeps 3 patrollers), and may
  assign a digger. Reinforcements are announced in the message feed.
- Notoriety runs on top of all of this — see *Combat → Notoriety and hunter
  squads*.

**Invariant: every state that steers via `followPath` needs a fallback that still
calls `moveTank`.** `findPath` returns `null` whenever the nearest waypoint is
unreachable from the tank's own — which is exactly what happens to a tank wedged
in the corner behind its own bunker. PATROL used to read
`if (!followPath(...)) newPatrolPath(tank)`, so a null path meant `moveTank` was
never reached and the tank stood frozen for the rest of the match. PATROL and
RETREAT now steer bodily at their goal when pathing fails; `steer()`'s wall
probes walk them around the obstruction until they rejoin the graph.

Spawn placement feeds the same bug. `spawnNPC` widens its ring as attempts fail
rather than retrying one tight radius and then falling back **onto the base
centre**, which is where the bunker stands — the old fallback reliably parked
tanks inside their own base.

## HUD (styled after the original)

Top bar of black panels with green borders: wireframe tank schematic
(colors degrade with HP, flickers on hit), shell/fuel counters, **cargo hold bar**,
3-line message feed, circular radar with rotating sweep (blips snapshot when the
sweep passes them and fade until re-swept; undiscovered deposits never
appear), rank panel with XP bar **and the XP still needed for the next rung**.
Panels carry a CRT treatment: drifting scanline tiling, phosphor bloom on the green
vector art, and a painted specular sweep masked over the radar dome (`glass` in
textures.js).

Radar range is scaled by the RADAR ARRAY upgrade, so nothing may read
`TUNING.RADAR_RANGE` directly — go through `radarRange(p)` or the range ring on
the theatre map will disagree with the blip cutoff.

World-anchored during play: the drill ring with its expanding noise pulse (a
literal picture of who can hear you), and floating payout numbers.

Bottom: a 6-slot weapon bar. Each slot shows its **projectile silhouette**, its
**name**, its own magazine (`4/6`), its fuel cost if any, and its own cooldown
wipe. The top bar's shell counter is the total across all six magazines. The selected weapon's description sits above the bar and pulses
on switch. (`WEAPONS[].desc` existed in config all along but was rendered
nowhere in-game, which is why nobody could tell what 1–6 did.)

Orientation aids, because the world is 4000×4000 and the radar only reaches
1200 px:

- **Hold Tab** for the theatre map — baked terrain, bases, uncovered deposits,
  your radar footprint, and contacts (own clan always, hostiles only inside
  radar range; hunters ringed in red). Undiscovered deposits stay hidden, same
  rule as the radar.
- Off-screen arrows to your base and the nearest known deposit, with distance.
- A directional wedge showing where incoming fire came from.

### Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Aim turret |
| Click / Space | Fire |
| 1–6 / wheel | Select weapon |
| **E (hold)** | Drill a deposit |
| **U** | Service Record (ladder / upgrades / records) |
| Tab (hold) | Theatre map |
| Esc | Back out of the Service Record, else pause |

The camera centres the tank in the area *below* the top bar and is allowed
100 px of overscan past the world edge — without it the camera pins in a corner
and the player ends up tucked under the HUD.

Also: grey STOP button (pause), low-fuel / EMP / low-HP overlays.

## Audio

Synthesized WebAudio for anything that has to react continuously — the engine
loop follows player speed and stutters on empty fuel, per-weapon shots,
explosions, EMP sweep, rank-up fanfare, low-fuel alarm. Mute persists.

Layered **over** that, sixteen recorded CC0 one-shots (Kenney Impact Sounds) for
digging, armour hits, ricochet pings, wreck impacts and pickups — a recorded
transient is something an oscillator won't give you. Every sampled play is a
no-op until the buffers decode, and stays a no-op if the files are absent, so
the synth layer is always the floor.

## Art

The visual target is `Old Images/preview.webp` (the original screenshot): warm
rippled sand, outlined cartoon tanks, leafy bushes, red brick obstacles,
black/green HUD panels. Everything below serves that.

### Palette — measured, not guessed

Colours were eyeballed twice and were wrong both times. They are now **sampled
from `Old Images/preview.webp`** by loading it into a canvas and averaging small
patches. Keep these numbers; re-derive them the same way if the target changes.

Sample by **most-common non-outline colour**, not by averaging. Averaging drags
everything toward the black grout — it once reported the red brick as `#45201b`,
a near-black, which is nothing like the red you actually see.

| Element | Reference |
|---|---|
| Tank hull (blue) | `#70b0b0` common, `#72acb3` lit, `#4a6a68` shadow, `#1a4854` outline |
| Red | `#b03030` / `#d05050` |
| Green | `#107010` / `#109030` |
| Gold | `#b09050` |
| Sand | `#c18e42` mid, `#ab7837` shaded |
| Rock | `#8a5637` lit, `#45230d` deep |
| Base metal | `#b28c64` plate, `#6e3c10` recess |

The reference **green has almost no blue in it** (`#107010` — blue channel 16).
That matters for clan colours: any green with blue in it slides into teal and
stops being distinguishable from Blue Tide, which is exactly what happened when
the green was picked by eye.

Two things this exposed that intuition got backwards:

- **Tanks separate from sand by HUE, not value.** The reference's teal hull and
  its sand sit at almost the same lightness. Dark "muted" hulls read as scorch
  marks; warm hulls vanish into the ground.
- **The sand band is narrow.** Letting the dune/ripple term swing wide pushed the
  whole map into acid yellow. The generator's channel bases are back-solved from
  measuring the *rendered* output, because the soft-light grain pass shifts green
  up ~13 and blue down ~7 — so the raw numbers in `generateSandTile` look too red
  on their own. Verify by sampling a screenshot, not by reading the source.

### The registry

One entry point, `getTexture(key)` in `public/js/textures.js`. A key resolves in
this order:

1. **Registered** — `assets.js` has loaded a PNG under that key (`fx:*`, `ui:*`).
2. **Generated** — a canvas painter runs and the result is cached.
3. **Fallback** — an unknown `fx:`/`ui:` key returns a soft white blob rather
   than throwing, so a failed asset download dims an effect instead of killing
   the frame.

Call sites never change when art moves between those tiers.

### What is imported vs. painted

Imported art is deliberately confined to things a painter is bad at — particles
and photographic grain — and **every import must be CC0 or CC BY**, because
`public/assets/` ships in a public repo. A purchased pack licenses the buyer, not
everyone who clones the repository; the radar dome's glass reflection was one such
import and is now painted (`genGlass`) instead. See `public/CREDITS.md`.

| Source | Licence | Used for |
|---|---|---|
| Particle Effect Texture Essentials (Reactorcore) | **CC BY 4.0 — attribution required** | 43 `fx:*` textures: explosions, smoke, sparks, shockwaves, the EM pulse burst, ground decals, HUD scanlines |
| Poly Haven `sand_01` / `rock_face_03` | CC0 | Greyscale grain composited soft-light over the painted sand and rock |
| Kenney Impact Sounds | CC0 | 16 sampled one-shots (see Audio) |

Everything else — tanks, bushes, rocks, brick, bases, projectiles, decals, HUD
vector art — is painted on canvas at runtime, in a consistent style: heavy dark
outline, soft down-right cast shadow, upper-left key light, painted highlight
passes.

### The shading vocabulary

Blown up 7×, every object in the reference is assembled from the same four
moves, so they live in `textures.js` as shared helpers rather than being
re-improvised per generator:

| Helper | What it is | Why |
|---|---|---|
| `ink()` | Two-pass black keyline, wide-and-faint under narrow-and-solid | A single even stroke is what makes procedural art read as vector clipart; real brush outlines vary in weight |
| `bevel()` | Clips to the current path, strokes it offset up-left in white and down-right in black | Turns a flat fill into a moulded panel. Works on any path, unlike drawing the two lit edges by hand |
| `dome()` | Lit sphere with a tight offset specular | Every rivet, pebble, sandbag and bolt in the reference is this |
| `crescent()` | Filled lens between two arcs | The gloss rolling over the boulders. A *stroked* arc reads as a scratch; only a filled lens reads as a wet highlight |

Two colour rules go with them. `shade()` darkens toward navy rather than toward
black, because the reference's shadow side is bluer than its lit side — plain
subtraction drags a teal hull to olive and a red hull to brown. And `lighten()`
has a practical ceiling around +85: it walks every channel toward white, so a
saturated clan colour goes pastel well before it goes light. Past that the red
clan is pink and the gold clan is cream.

**Tanks stay procedural on purpose.** 4 clans × 4 models = 16 sprites, and the
clan-tint parameterisation is worth more here than any sprite pack would be.

### Tank construction

Blow the reference tanks up 7× and the design is unmistakable: a **block longer
than it is wide, built from separate rectangular armour plates divided by
near-black grout**, closer to cloisonné than to a rendered vehicle. `genTank`
reproduces that literally:

1. Fill the whole silhouette with grout (`#08141a`).
2. Lay plates on top, inset, so every gap between them *is* the grout showing
   through. Plates carry no dark rim of their own — adding one doubles every gap
   and the tank reads as a floating checkerboard.
3. Track columns down each flank, plus deck plates fore and aft, closing a
   **frame of panels around the turret**. Heights are jittered per chassis so the
   two flanks aren't a mirrored ladder.
4. Turret last, and it is **not a disc**: a large rounded-square deck plate (the
   lightest value on the tank) with a black ring drawn on it and a saturated core
   inside that. A bright circle on its own reads as a target sticker.

The gun is a separate sprite so it can track the mouse, and **its lower half is
deliberately empty**. It anchors at (0.5, 0.8), which places the pivot on the
turret centre; drawing down to the pivot laid the barrel across the turret and
buried that core. It starts just outside the ring instead.

Four proportions were measured off the reference rather than guessed, and all
four had been wrong:

| | Reference | Was |
|---|---|---|
| Hull | ~54 × 62 — clearly longer than wide | square |
| Track column | ~17% of width | ~24% |
| Grout gap | ~3% of width | ~5% |
| Turret plate | ~50% of width | ~44%, and circular |
| Barrel | stands off the nose by ~half the hull length, ~10% of width thick | short and fat |

**Plate values are a lopsided distribution, not a repeating table.** The spread is
enormous — near-white panels next to panels that are almost the grout — but most
are light and only a third go dark. A fixed alternating tone table gives you a
checkerboard. The draw also has to come from `N.hash`, not `N.noise2d`:
`noise2d` is interpolated, so its values cluster hard around 0.5 and a
"> 0.62 means dark" test almost never fires. That one detail cost two passes of
wondering why the tanks stayed uniformly pale whatever the thresholds were.

Things that looked right in isolation and were wrong on screen: a smooth gradient
hull, a square silhouette, a circular turret, a chunky neutral-grey barrel, an
even light/dark plate alternation, and flat plate fills with no brush mottle.

Because the gun is one shared texture, it has to be scaled to the hull it sits on
(`createTank`, and the select-screen card). Left at a fixed size it looked stubby
on a Bison and oversized on a Spectre.

**Chassis (`CHASSIS` in config.js).** The four tank models used to differ only by
`scale`, so every tank in the game — and all four cards on the select screen — was
one silhouette at four sizes. Each model now names a chassis controlling track
width, hull inset, turret radius and plate-row count, so a Bison (broad tracks,
four rows, big turret) reads differently from a Spectre (narrow tracks, two rows,
long open flanks) at a glance. The chassis index is part of the texture key, so
the variants cache separately.

### Terrain props

The same "measure it, don't guess it" pass applied to everything else on the
ground. In each case the old version was a plausible-looking shortcut that the
magnified reference simply doesn't support:

- **Bushes are leaves, not lobes.** The reference draws individual five-lobed
  leaflets, each with its own keyline and centre vein, overlapping into a clump.
  Stacking shaded circles is how you get broccoli, and no amount of recolouring
  fixes it. `leafPath()` puts a deep notch between lobes so the silhouette still
  reads as foliage at 20 px. The greens are also far brighter than they look in a
  thumbnail (`#1fb92f` lit) — the darkness comes from the keyline, not the fill.
- **Boulders are identified by their gloss.** A broad cream crescent rolling over
  the top-left shoulder, not the base colour, is what makes them read. They are
  chocolate brown; the grain pass has to stay low (0.28) or soft-light
  desaturates them to khaki. Satellites are deliberately lopsided — evenly spaced
  ones turn the pile into an atom diagram.
- **The red block is one cast block, not masonry.** Courses and head joints at
  50 px read as a scrap of wall texture rather than an object standing on sand.
  It is a heavy keyline, a hot white top edge, a speckled aggregate face and a
  few irregular blast pits.
- **The base is a machined bronze wheel**, and it was badly under-built: a broad
  beveled rim, a face divided into quadrants by incised spokes, six raised
  rivets, a hub ring around a domed boss, and a cylindrical roller at each lower
  corner. It also has to stay high-key — built from the darker end of the bronze
  ramp it comes out olive drab, which reads as camouflage netting.
- **Dune drifts are read by their shadow.** A single pale blob stacked across a
  dune field into what looked like fog; the stamp is now a warm shadow lobe with
  a smaller lit crest riding up-left of it.

Each clan carries two colours (`config.js`): `hull` is the muted, desaturated body
paint, matching the reference's slate-blue tanks — saturated hulls read as toys
against warm sand, and the generator's own outline and shading already supply the
contrast. `color` is the brighter clan identity used for radar blips, name labels,
base tint and menu, because a 4 px blip has to stay legible.

The attribution for the CC BY pack is required to be visible in the product, so
it renders on the pause screen as well as sitting in `public/CREDITS.md`.

### Re-importing

`scripts/import-assets.ps1` extracts exactly the files used out of the packs in
`~/Downloads`, downscales them (43 particle textures at 512² → 128²/256²), and
downloads the CC0 sources with a local cache. Source packs are 135 MB + 54 MB;
`public/assets/` ships at ~1.5 MB. Re-run it after adding entries to a manifest:

```
powershell -ExecutionPolicy Bypass -File scripts/import-assets.ps1
```

Missing packs are warned about and skipped — the procedural generators still
produce a complete, playable game with `public/assets/` entirely absent.
