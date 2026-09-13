// In-game HUD styled after the original bonus.com game: a top bar of black
// panels with green borders (tank schematic, ammo counters, message feed,
// radar with rotating sweep, rank), a weapon bar, prompts/overlays, and the
// pause/death screens.

import { WEAPONS, TUNING, COLORS, RANKS, WORLD_W, WORLD_H, GW, GH, CELL } from './config.js';
import * as state from './state.js';
import { on, emit } from './events.js';
import { getTexture } from './textures.js';
import { mapGrid, cargoTotal } from './world.js';
import { reloadOf } from './entities.js';
import { ammoOf, totalAmmo, totalMaxAmmo } from './ammo.js';
import { getXP, getRank, getRankProgress, xpToNext, getPendingPoints } from './progression.js';
import { isMuted, setMuted, setLowFuelAlarm } from './audio.js';

const PIXI = window.PIXI;

const BAR_H = 96;
const PAD = 6;
const SLOT_W = 92, SLOT_H = 54, SLOT_GAP = 4;

let app = null;
let root = null;           // whole HUD container
let topBar = null;
let weaponBar = null;
let overlays = null;

// panels
let schematicSprite, schematicHpText;
let matText, fuelText, cargoText, cargoBar;
let msgTexts = [];
const messages = [];       // {text, color, born}
let radarContent, radarStatic, radarGlass, radarPanelPos = { x: 0, y: 0, r: 44 };
let rankInsignia, rankName, rankBarBg, rankBar, rankXpText;
let panelBgs = null;       // Graphics redrawn on layout
let scanlines = null;

// weapon bar
let weaponSlots = [];      // {slot, bg, icon, name, ammo, cool, gray} per weapon
let weaponInfo = null;     // name + description of the selected weapon
let weaponFlash = 0;
// Per-slot restock flash. A dig that refills six magazines has to be visible in
// the bar that shows those magazines, or the payout is invisible again.
const slotFlash = new Array(WEAPONS.length).fill(0);

// prompts & overlays
let digPrompt, depotText, lowFuelText, empText, vignette;
let drillGfx, drillText;       // the hold-to-drill channel ring
let upgradeText;               // "unspent point" nag
let markers = null;        // off-screen direction arrows + damage indicator
let deathOverlay, deathText, deathSub;
let pauseOverlay, stopBtn;
let banner, bannerTimer = 0;

// full-map overlay (Tab)
let mapOverlay = null, mapSprite = null, mapBlips = null, mapPanel = null, mapLegend = null;
let mapAlpha = 0;

// radar sweep state
let sweepAngle = 0;
const blips = new Map();   // entity -> {x, y, color, stamp}
const SWEEP_PERIOD_MS = (Math.PI * 2) / TUNING.RADAR_SWEEP_RAD_S * 1000;

// damage direction indicator
let dmgDir = 0, dmgTimer = 0;

// ============================================================
// HELPERS
// ============================================================
function panel(g, x, y, w, h) {
  g.roundRect(x, y, w, h, 4);
  g.fill(COLORS.HUD_PANEL);
  g.roundRect(x, y, w, h, 4);
  g.stroke({ color: COLORS.HUD_BORDER, width: 2 });
}

function makeText(size, fill = COLORS.HUD_TEXT, extra = {}) {
  return new PIXI.Text({ text: '', style: { fontSize: size, fill, fontFamily: 'monospace', ...extra } });
}

function setText(t, s) { if (t.text !== s) t.text = s; }

function bevelButton(label, w, h) {
  // Grey bevel button like the reference's STOP button.
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.rect(0, 0, w, h); g.fill(0xcccccc);
  g.rect(0, 0, w, 3); g.fill(0xffffff);
  g.rect(0, 0, 3, h); g.fill(0xffffff);
  g.rect(0, h - 3, w, 3); g.fill(0x777777);
  g.rect(w - 3, 0, 3, h); g.fill(0x777777);
  c.addChild(g);
  const t = new PIXI.Text({ text: label, style: { fontSize: 16, fill: 0x111111, fontFamily: 'monospace', fontWeight: 'bold' } });
  t.anchor.set(0.5); t.x = w / 2; t.y = h / 2;
  c.addChild(t);
  c.eventMode = 'static'; c.cursor = 'pointer';
  c.btnLabel = t;
  return c;
}

// Shots left in this weapon's own magazine, further limited by fuel for the two
// weapons that burn it. This is the number that actually communicates the
// difference between Ricochet and H.E.A.T.
function shotsLeft(p, w, i) {
  let n = ammoOf(p, i);
  if (w.fuelCost) n = Math.min(n, Math.floor(p.fuel / w.fuelCost));
  return n;
}

// ============================================================
// INIT
// ============================================================
export function initHUD(pixiApp, hudContainer) {
  app = pixiApp;
  root = hudContainer;

  topBar = new PIXI.Container();
  weaponBar = new PIXI.Container();
  overlays = new PIXI.Container();
  root.addChild(topBar); root.addChild(weaponBar); root.addChild(overlays);

  panelBgs = new PIXI.Graphics();
  topBar.addChild(panelBgs);

  // CRT scanlines across the top bar — the cheapest cue that these panels are a
  // screen and not just boxes. The key is 'fx:' because that is where assets.js
  // registers it; asking for 'ui:scanlines' silently resolved to the missing-asset
  // blob, so the top bar was washed in a flat green glow instead of ruled lines.
  scanlines = new PIXI.TilingSprite({ texture: getTexture('fx:scanlines'), width: 10, height: 10 });
  scanlines.tileScale.set(0.22);
  scanlines.alpha = 0.16;
  scanlines.blendMode = 'add';
  scanlines.tint = 0x66ff99;
  topBar.addChild(scanlines);

  // --- schematic panel ---
  schematicSprite = new PIXI.Sprite(getTexture('schematic'));
  schematicSprite.anchor.set(0.5);
  topBar.addChild(schematicSprite);
  schematicHpText = makeText(11, COLORS.HUD_GREEN);
  topBar.addChild(schematicHpText);

  // --- resource panel ---
  const shellIcon = new PIXI.Sprite(getTexture('icon:shell'));
  const fuelIcon = new PIXI.Sprite(getTexture('icon:fuel'));
  topBar.addChild(shellIcon); topBar.addChild(fuelIcon);
  matText = makeText(14, COLORS.HUD_TEXT);
  fuelText = makeText(14, COLORS.HUD_TEXT);
  topBar.addChild(matText); topBar.addChild(fuelText);
  topBar.shellIcon = shellIcon; topBar.fuelIcon = fuelIcon;
  // Cargo: materials in the hold, worth nothing until you get them home and worth
  // losing if you don't. It needs its own readout or the haul is invisible.
  cargoBar = new PIXI.Graphics();
  cargoText = makeText(11, 0x66ccff, { fontWeight: 'bold' });
  topBar.addChild(cargoBar); topBar.addChild(cargoText);

  // --- message panel ---
  for (let i = 0; i < 3; i++) {
    const t = makeText(11, COLORS.HUD_TEXT);
    msgTexts.push(t); topBar.addChild(t);
  }

  // --- radar panel ---
  radarStatic = new PIXI.Graphics();
  radarContent = new PIXI.Graphics();
  // Specular sweep, masked to the dome and screened over the phosphor: reads as
  // curved glass over a CRT. Painted in textures.js (genGlass), not a photo scan.
  radarGlass = new PIXI.Sprite(getTexture('glass'));
  radarGlass.anchor.set(0.5);
  radarGlass.alpha = 0.14;
  radarGlass.blendMode = 'add';
  const glassMask = new PIXI.Graphics();
  radarGlass.mask = glassMask;
  topBar.addChild(radarStatic); topBar.addChild(radarContent);
  topBar.addChild(radarGlass); topBar.addChild(glassMask);
  topBar.glassMask = glassMask;

  // --- rank panel ---
  rankInsignia = makeText(18, COLORS.HUD_GREEN_BRIGHT, { fontWeight: 'bold' });
  rankName = makeText(13, COLORS.HUD_TEXT, { fontWeight: 'bold' });
  rankXpText = makeText(10, 0x88aa88);
  rankBarBg = new PIXI.Graphics();
  rankBar = new PIXI.Graphics();
  topBar.addChild(rankBarBg); topBar.addChild(rankBar);
  topBar.addChild(rankInsignia); topBar.addChild(rankName); topBar.addChild(rankXpText);

  buildWeaponBar();
  buildPromptsAndOverlays();
  buildMapOverlay();

  // STOP button (pauses)
  stopBtn = bevelButton('STOP', 90, 34);
  stopBtn.on('pointerdown', () => emit('pause-toggle', {}));
  root.addChild(stopBtn);

  buildDeathOverlay();
  buildPauseOverlay();
  subscribe();
  layoutHUD();
}

// ------------------------------------------------------------
// Weapon bar. All six weapons already existed and already had `desc` written in
// config, but every projectile drew as the same coloured dot and the description
// was rendered nowhere in-game — so nothing told you what 1-6 did. Each slot now
// carries its own projectile silhouette, its name, and how many shots you can
// actually afford.
// ------------------------------------------------------------
function buildWeaponBar() {
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    const slot = new PIXI.Container();

    const bg = new PIXI.Graphics();
    slot.addChild(bg);

    const icon = new PIXI.Sprite(getTexture(`shot:${w.type}`));
    icon.anchor.set(0.5);
    icon.scale.set(Math.min(26 / icon.texture.width, 32 / icon.texture.height));
    icon.x = 18; icon.y = SLOT_H / 2 + 1;
    slot.addChild(icon);

    const key = makeText(9, 0x99aa99, { fontWeight: 'bold' });
    key.text = w.key; key.x = 5; key.y = 4;
    slot.addChild(key);

    const name = makeText(10, COLORS.HUD_TEXT, { fontWeight: 'bold' });
    name.text = w.name.toUpperCase();
    name.x = 34; name.y = 12;
    slot.addChild(name);

    const ammo = makeText(10, 0x88aa88, { fontWeight: 'bold' });
    ammo.x = 34; ammo.y = 29;
    slot.addChild(ammo);

    // Ammo is per weapon, so the only cost worth showing is the shared one: fuel.
    const cost = makeText(8, 0x668866);
    cost.text = w.fuelCost ? `${w.fuelCost}F` : '';
    cost.anchor.set(1, 0); cost.x = SLOT_W - 6; cost.y = 4;
    slot.addChild(cost);

    // Cooldown wipes bottom-to-top. Every slot runs its own clock now, so you can
    // watch a heavy shot recharge while you keep firing something cheap.
    const cool = new PIXI.Graphics();
    slot.addChild(cool);
    const gray = new PIXI.Graphics();
    gray.rect(0, 0, SLOT_W, SLOT_H); gray.fill({ color: 0x151515, alpha: 0.62 });
    gray.visible = false;
    slot.addChild(gray);

    slot.eventMode = 'static'; slot.cursor = 'pointer';
    slot.on('pointerdown', () => {
      const p = state.player();
      if (p && p.weaponIndex !== i) { p.weaponIndex = i; emit('weapon-switch', { index: i }); }
    });
    weaponBar.addChild(slot);
    weaponSlots.push({ slot, bg, icon, name, ammo, cool, gray });
  }

  weaponInfo = makeText(12, 0xffdd88, { fontWeight: 'bold', align: 'center' });
  weaponInfo.anchor.set(0.5, 1);
  weaponBar.addChild(weaponInfo);
}

function buildPromptsAndOverlays() {
  digPrompt = makeText(13, 0xffee88, { fontWeight: 'bold', align: 'center' });
  digPrompt.anchor.set(0.5, 1);
  overlays.addChild(digPrompt);

  // Drill channel: a ring that fills around the deposit. World-anchored, because
  // the thing you have to watch during a drill is the horizon, not the HUD.
  drillGfx = new PIXI.Graphics();
  overlays.addChild(drillGfx);
  drillText = makeText(11, 0xffee88, { fontWeight: 'bold', align: 'center' });
  drillText.anchor.set(0.5, 1);
  overlays.addChild(drillText);

  upgradeText = makeText(13, 0xffcc44, { fontWeight: 'bold', align: 'center' });
  upgradeText.anchor.set(0.5, 0);
  overlays.addChild(upgradeText);

  depotText = makeText(14, 0x44ff88, { align: 'center' });
  depotText.anchor.set(0.5, 0);
  overlays.addChild(depotText);

  lowFuelText = makeText(16, 0xff5544, { fontWeight: 'bold' });
  lowFuelText.anchor.set(0.5);
  overlays.addChild(lowFuelText);

  // EM Pulse is orange/yellow now, so its overlay follows.
  empText = makeText(16, 0xffbb44, { fontWeight: 'bold', align: 'center' });
  empText.anchor.set(0.5);
  overlays.addChild(empText);

  vignette = new PIXI.Sprite(getTexture('vignette'));
  vignette.visible = false;
  overlays.addChild(vignette);

  markers = new PIXI.Graphics();
  overlays.addChild(markers);

  banner = makeText(30, 0xffcc44, { fontWeight: 'bold', align: 'center', dropShadow: true });
  banner.anchor.set(0.5);
  banner.visible = false;
  overlays.addChild(banner);
}

// ------------------------------------------------------------
// Full-world map on Tab. The world is 4000x4000 and the radar only reaches
// 1200 px, so without this you are navigating a desert blind.
// ------------------------------------------------------------
function buildMapOverlay() {
  mapOverlay = new PIXI.Container();
  mapOverlay.visible = false;

  const dim = new PIXI.Graphics();
  mapOverlay.addChild(dim); mapOverlay.dim = dim;
  mapPanel = new PIXI.Graphics();
  mapOverlay.addChild(mapPanel);

  // Terrain is static, so bake it once rather than redrawing 6400 cells a frame.
  const S = 400;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const cw = S / GW;
  ctx.fillStyle = '#241c0e'; ctx.fillRect(0, 0, S, S);
  const CELL_COLOR = {
    [CELL.OPEN]: '#6b5a33', [CELL.DUNE]: '#7d6a3d', [CELL.BASE]: '#8d7a4a',
    [CELL.TREE]: '#1e5c26', [CELL.ROCK]: '#4b3a24', [CELL.BRICK]: '#7a2b26',
    [CELL.WALL]: '#191308',
  };
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      ctx.fillStyle = CELL_COLOR[mapGrid[y][x]] || '#191308';
      ctx.fillRect(x * cw, y * cw, cw + 0.5, cw + 0.5);
    }
  }
  mapSprite = new PIXI.Sprite(PIXI.Texture.from(c));
  mapOverlay.addChild(mapSprite);

  mapBlips = new PIXI.Graphics();
  mapOverlay.addChild(mapBlips);
  // The radar-range ring is bigger than the map panel near an edge, so clip
  // everything dynamic to the panel instead of letting it bleed over the HUD.
  const clip = new PIXI.Graphics();
  mapOverlay.addChild(clip);
  mapBlips.mask = clip;
  mapOverlay.clip = clip;

  mapLegend = makeText(10, 0x88aa88);
  mapOverlay.addChild(mapLegend);

  const title = makeText(14, COLORS.HUD_GREEN_BRIGHT, { fontWeight: 'bold' });
  title.text = 'THEATRE MAP'; title.anchor.set(0.5, 0);
  mapOverlay.addChild(title); mapOverlay.titleText = title;

  root.addChild(mapOverlay);
}

function buildDeathOverlay() {
  deathOverlay = new PIXI.Container();
  deathOverlay.visible = false;
  const dim = new PIXI.Graphics();
  deathOverlay.addChild(dim); deathOverlay.dim = dim;
  const pnl = new PIXI.Graphics();
  deathOverlay.addChild(pnl); deathOverlay.pnl = pnl;
  deathText = makeText(26, 0xff5544, { fontWeight: 'bold', align: 'center' });
  deathText.anchor.set(0.5);
  deathSub = makeText(14, COLORS.HUD_TEXT, { align: 'center' });
  deathSub.anchor.set(0.5);
  deathOverlay.addChild(deathText); deathOverlay.addChild(deathSub);
  deathOverlay.eventMode = 'static'; // swallow clicks
  root.addChild(deathOverlay);
}

let pauseButtons = [];
let creditsText = null;
function buildPauseOverlay() {
  pauseOverlay = new PIXI.Container();
  pauseOverlay.visible = false;
  const dim = new PIXI.Graphics();
  pauseOverlay.addChild(dim); pauseOverlay.dim = dim;
  const pnl = new PIXI.Graphics();
  pauseOverlay.addChild(pnl); pauseOverlay.pnl = pnl;
  const title = makeText(22, COLORS.HUD_GREEN_BRIGHT, { fontWeight: 'bold' });
  title.text = 'PAUSED'; title.anchor.set(0.5);
  pauseOverlay.addChild(title); pauseOverlay.titleText = title;

  const resume = bevelButton('RESUME', 180, 38);
  resume.on('pointerdown', () => emit('pause-toggle', {}));
  const record = bevelButton('SERVICE RECORD', 180, 38);
  record.on('pointerdown', () => emit('open-service-record', {}));
  const mute = bevelButton(isMuted() ? 'SOUND: OFF' : 'SOUND: ON', 180, 38);
  mute.on('pointerdown', () => {
    setMuted(!isMuted());
    mute.btnLabel.text = isMuted() ? 'SOUND: OFF' : 'SOUND: ON';
  });
  const quit = bevelButton('RETURN TO MENU', 180, 38);
  quit.on('pointerdown', () => emit('return-to-menu', {}));
  pauseButtons = [resume, record, mute, quit];
  for (const b of pauseButtons) pauseOverlay.addChild(b);

  // The particle pack is CC BY 4.0 — the credit has to be visible in the product,
  // not just in a repo file.
  creditsText = makeText(8, 0x557755, { align: 'center', lineHeight: 11 });
  creditsText.text = 'Particle textures by Reactorcore (CC BY 4.0)\n'
    + 'Terrain grain: Poly Haven (CC0)   SFX: Kenney (CC0)';
  creditsText.anchor.set(0.5, 0);
  pauseOverlay.addChild(creditsText);

  pauseOverlay.eventMode = 'static';
  root.addChild(pauseOverlay);
}

function subscribe() {
  on('message', ({ text, color }) => pushMessage(text, color));
  on('kill', ({ victim, killer }) => {
    // Now that every hostile has a callsign, the feed can name names.
    const nm = t => t.isPlayer ? 'You' : (t.callsign ? `${t.clan.short}·${t.callsign}` : t.clan.name);
    if (killer && killer.isPlayer) pushMessage(`You destroyed ${nm(victim)}`, 0xffcc44);
    else if (victim.isPlayer) pushMessage(killer ? `${nm(killer)} destroyed you` : 'You were destroyed', 0xff5544);
    else if (killer && killer.clan) pushMessage(`${nm(killer)} destroyed ${nm(victim)}`, 0xaaaaaa);
    else pushMessage(`${nm(victim)} destroyed`, 0xaaaaaa);
  });
  on('discover', ({ node }) => {
    const what = node.tier.id === 'rich' ? 'RICH VEIN' : 'Deposit';
    const kind = node.type === 'fuel' ? 'fuel'
      : node.weaponId != null ? `${WEAPONS[node.weaponId].name} cache` : 'materials';
    pushMessage(`${what} uncovered — ${kind}`, node.tier.id === 'rich' ? 0xffcc44 : 0x66ffaa);
  });
  on('pickup', ({ type, amount }) => pushMessage(`+${amount} ${type} salvaged`, 0x66ffaa));
  on('cargo-banked', ({ units, remaining }) => {
    if (remaining <= 0) pushMessage(`Hold emptied — ${units} banked`, 0x66ffaa);
  });
  on('npc-harvested', ({ clan, node }) => {
    const p = state.player();
    // Only report the ones you could plausibly have contested.
    if (!p || Math.hypot(node.x - p.x, node.y - p.y) > radarRange(p)) return;
    pushMessage(`${clan.short} stripped a ${node.tier.id === 'rich' ? 'rich vein' : 'deposit'}`, clan.color);
  });
  on('drill-cancel', ({ tank, reason }) => {
    if (!tank.isPlayer || reason === 'released' || reason === 'died') return;
    pushMessage(reason === 'emp' ? 'Drill offline — systems down' : 'Drill broken off', 0xffaa44);
  });
  // Restock flash on the specific magazines that moved.
  on('ammo-gained', ({ index }) => { slotFlash[index] = 34; });
  on('pulse', ({ hit }) => pushMessage(
    hit ? `EM pulse — ${hit} target${hit > 1 ? 's' : ''} disabled` : 'EM pulse — nothing in range',
    0xffaa22));
  on('rank-up', ({ rank }) => {
    pushMessage(`PROMOTED: ${rank.name.toUpperCase()} — press U to spend`, 0xffcc44);
    banner.text = `${rank.insignia}  PROMOTED: ${rank.name.toUpperCase()}  ${rank.insignia}`;
    // Long names would run off a narrow window. Reset scale first — .width is
    // scaled, and a promotion can land mid pop-in of the previous banner.
    banner.scale.set(1);
    fitText(banner, app.screen.width - 40, 30);
    bannerTimer = 180;
  });
  on('xp-gained', () => refreshRankPanel());
  on('xp-lost', () => refreshRankPanel());
  on('weapon-switch', () => { weaponFlash = 45; });
  on('player-hit', ({ source }) => {
    const p = state.player();
    if (!p || !source) return;
    dmgDir = Math.atan2(source.y - p.y, source.x - p.x);
    dmgTimer = 60;
  });
}

function pushMessage(text, color = 0xccffcc) {
  messages.push({ text, color, born: performance.now() });
  if (messages.length > 3) messages.shift();
}

// ============================================================
// LAYOUT (called at init and on resize)
// ============================================================
export function layoutHUD() {
  const sw = app.screen.width, sh = app.screen.height;

  // Top bar panel geometry
  const schW = 150, resW = 200, radW = 120, rankW = 170;
  const msgW = Math.max(120, sw - schW - resW - radW - rankW - PAD * 6);
  let x = PAD;
  panelBgs.clear();
  const y = PAD, h = BAR_H - PAD * 2 + 8;

  panel(panelBgs, x, y, schW, h);
  schematicSprite.x = x + 45; schematicSprite.y = y + h / 2;
  schematicHpText.x = x + 88; schematicHpText.y = y + h / 2 - 8;
  x += schW + PAD;

  panel(panelBgs, x, y, resW, h);
  topBar.shellIcon.x = x + 12; topBar.shellIcon.y = y + 4;
  matText.x = x + 40; matText.y = y + 10;
  topBar.fuelIcon.x = x + 10; topBar.fuelIcon.y = y + 36;
  fuelText.x = x + 40; fuelText.y = y + 40;
  cargoText.x = x + 12; cargoText.y = y + 66;
  cargoBar.barX = x + 96; cargoBar.barY = y + 69; cargoBar.barW = resW - 108;
  x += resW + PAD;

  panel(panelBgs, x, y, msgW, h);
  for (let i = 0; i < 3; i++) { msgTexts[i].x = x + 10; msgTexts[i].y = y + 10 + i * 22; }
  x += msgW + PAD;

  panel(panelBgs, x, y, radW, h);
  radarPanelPos = { x: x + radW / 2, y: y + h / 2, r: Math.min(radW, h) / 2 - 8 };
  drawRadarStatic();
  radarGlass.x = radarPanelPos.x; radarGlass.y = radarPanelPos.y;
  radarGlass.width = radarGlass.height = radarPanelPos.r * 2.1;
  topBar.glassMask.clear();
  topBar.glassMask.circle(radarPanelPos.x, radarPanelPos.y, radarPanelPos.r);
  topBar.glassMask.fill(0xffffff);
  x += radW + PAD;

  panel(panelBgs, x, y, rankW, h);
  rankInsignia.x = x + 12; rankInsignia.y = y + 10;
  rankName.x = x + 12; rankName.y = y + 34;
  rankXpText.x = x + 12; rankXpText.y = y + 68;
  rankBarBg.clear();
  rankBarBg.rect(x + 12, y + 54, rankW - 24, 8);
  rankBarBg.fill({ color: 0x003300 });
  rankBar.barX = x + 12; rankBar.barY = y + 54; rankBar.barW = rankW - 24;
  refreshRankPanel();

  scanlines.x = PAD; scanlines.y = y;
  scanlines.width = sw - PAD * 2; scanlines.height = h;

  // Weapon bar bottom center
  const totalW = WEAPONS.length * (SLOT_W + SLOT_GAP) - SLOT_GAP;
  weaponBar.x = sw / 2 - totalW / 2;
  weaponBar.y = sh - SLOT_H - 14;
  weaponSlots.forEach((s, i) => { s.slot.x = i * (SLOT_W + SLOT_GAP); s.slot.y = 0; });
  weaponInfo.x = totalW / 2; weaponInfo.y = -8;

  // Overlays
  stopBtn.x = 14; stopBtn.y = sh - 48;
  depotText.x = sw / 2; depotText.y = BAR_H + 16;
  upgradeText.x = sw / 2; upgradeText.y = BAR_H + 40;
  lowFuelText.x = sw / 2; lowFuelText.y = sh - SLOT_H - 52;
  empText.x = sw / 2; empText.y = sh / 2 - 60;
  banner.x = sw / 2; banner.y = sh / 3;
  vignette.width = sw; vignette.height = sh;

  // Map overlay
  const S = Math.min(sw - 120, sh - 190, 620);
  const mx = sw / 2 - S / 2, my = sh / 2 - S / 2 + 10;
  mapOverlay.dim.clear();
  mapOverlay.dim.rect(0, 0, sw, sh); mapOverlay.dim.fill({ color: 0x000000, alpha: 0.6 });
  mapPanel.clear();
  panel(mapPanel, mx - 10, my - 34, S + 20, S + 62);
  mapSprite.x = mx; mapSprite.y = my;
  mapSprite.width = S; mapSprite.height = S;
  mapOverlay.mapRect = { x: mx, y: my, s: S };
  mapOverlay.clip.clear();
  mapOverlay.clip.rect(mx, my, S, S);
  mapOverlay.clip.fill(0xffffff);
  mapOverlay.titleText.x = sw / 2; mapOverlay.titleText.y = my - 28;
  mapLegend.x = mx; mapLegend.y = my + S + 7;
  setText(mapLegend, 'YOU ▲   base ■   fuel ●   ammo ●   contact ✕   [hold TAB]');

  // Death overlay
  deathOverlay.dim.clear();
  deathOverlay.dim.rect(0, 0, sw, sh); deathOverlay.dim.fill({ color: 0x000000, alpha: 0.55 });
  deathOverlay.pnl.clear();
  panel(deathOverlay.pnl, sw / 2 - 220, sh / 2 - 80, 440, 160);
  deathText.x = sw / 2; deathText.y = sh / 2 - 30;
  deathSub.x = sw / 2; deathSub.y = sh / 2 + 25;

  // Pause overlay
  pauseOverlay.dim.clear();
  pauseOverlay.dim.rect(0, 0, sw, sh); pauseOverlay.dim.fill({ color: 0x000000, alpha: 0.55 });
  pauseOverlay.pnl.clear();
  panel(pauseOverlay.pnl, sw / 2 - 130, sh / 2 - 150, 260, 320);
  pauseOverlay.titleText.x = sw / 2; pauseOverlay.titleText.y = sh / 2 - 118;
  pauseButtons.forEach((b, i) => { b.x = sw / 2 - 90; b.y = sh / 2 - 90 + i * 48; });
  creditsText.x = sw / 2; creditsText.y = sh / 2 + 128;
}

function drawRadarStatic() {
  const { x, y, r } = radarPanelPos;
  radarStatic.clear();
  radarStatic.circle(x, y, r); radarStatic.fill(0x001a00);
  radarStatic.circle(x, y, r); radarStatic.stroke({ color: COLORS.HUD_BORDER, width: 1.5 });
  radarStatic.circle(x, y, r * 0.66); radarStatic.stroke({ color: 0x004400, width: 1 });
  radarStatic.circle(x, y, r * 0.33); radarStatic.stroke({ color: 0x004400, width: 1 });
  radarStatic.moveTo(x - r, y); radarStatic.lineTo(x + r, y); radarStatic.stroke({ color: 0x004400, width: 1 });
  radarStatic.moveTo(x, y - r); radarStatic.lineTo(x, y + r); radarStatic.stroke({ color: 0x004400, width: 1 });
}

// Shrink to fit: the longest rank names (SERGEANT FIRST CLASS) overflow the
// 170px rank panel at the base size.
function fitText(t, maxW, baseSize) {
  if (t.style.fontSize !== baseSize) t.style.fontSize = baseSize;
  if (t.width > maxW) t.style.fontSize = Math.max(8, Math.floor(baseSize * maxW / t.width));
}

function refreshRankPanel() {
  const rank = getRank();
  setText(rankInsignia, rank.insignia);
  setText(rankName, rank.name.toUpperCase());
  fitText(rankName, rankBar.barW || 146, 13);
  // The requirement for the next rung was never shown anywhere, which is why the
  // ladder read as a set of titles rather than something you could work toward.
  const need = xpToNext();
  setText(rankXpText, need > 0
    ? `XP ${Math.floor(getXP())}  ·  ${need} TO GO  [U]`
    : `XP ${Math.floor(getXP())}  ·  MAX RANK  [U]`);
  fitText(rankXpText, rankBar.barW || 146, 10);
  rankBar.clear();
  rankBar.rect(rankBar.barX, rankBar.barY, rankBar.barW * Math.min(1, getRankProgress()), 8);
  rankBar.fill(COLORS.HUD_GREEN);
}

// ============================================================
// RADAR
// ============================================================
// The RADAR ARRAY upgrade scales this, so nothing may read TUNING.RADAR_RANGE
// directly — the ring on the map and the blip cutoff have to agree.
export function radarRange(p) {
  return TUNING.RADAR_RANGE * (p?.radarMult ?? 1);
}

function updateRadar(dt, p) {
  const { x: cx, y: cy, r } = radarPanelPos;
  const range = radarRange(p);
  const prev = sweepAngle;
  sweepAngle = (sweepAngle + TUNING.RADAR_SWEEP_RAD_S * (dt / 60)) % (Math.PI * 2);
  const step = (sweepAngle - prev + Math.PI * 2) % (Math.PI * 2);
  const now = state.game.time;

  // Refresh blips whose bearing the sweep crossed this frame
  const consider = (entity, ex, ey, color, always = false) => {
    const d = Math.hypot(ex - p.x, ey - p.y);
    if (d > range) { blips.delete(entity); return; }
    const bearing = (Math.atan2(ey - p.y, ex - p.x) + Math.PI * 2) % (Math.PI * 2);
    const crossed = ((bearing - prev + Math.PI * 2) % (Math.PI * 2)) <= step;
    if (crossed || always || !blips.has(entity)) {
      blips.set(entity, { x: ex, y: ey, color, stamp: now, steady: always });
    }
  };

  for (const t of state.tanks) {
    if (t.isPlayer || !t.alive) continue;
    consider(t, t.x, t.y, t.clan.color);
  }
  for (const rn of state.resourceNodes) {
    if (!rn.alive || !rn.discovered) { blips.delete(rn); continue; }
    consider(rn, rn.x, rn.y, rn.type === 'fuel' ? 0xffcc44 : 0x4488cc);
  }
  for (const b of state.bases) {
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    consider(b, bc.x, bc.y, b.clan.color, b.clanId === p.clanId);
  }

  radarContent.clear();
  const scale = r / range;
  const empd = p.empTimer > 0;

  if (empd) {
    // static noise
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
      radarContent.rect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2, 2);
      radarContent.fill({ color: 0x00ff00, alpha: Math.random() * 0.8 });
    }
    return;
  }

  // blips (snapshot positions, fading until re-swept)
  for (const [entity, b] of blips) {
    const age = now - b.stamp;
    const alpha = b.steady ? 0.9 : Math.max(0, 1 - age / SWEEP_PERIOD_MS);
    if (alpha <= 0) { blips.delete(entity); continue; }
    const dx = (b.x - p.x) * scale, dy = (b.y - p.y) * scale;
    if (dx * dx + dy * dy > r * r) continue;
    radarContent.rect(cx + dx - 2, cy + dy - 2, 4, 4);
    radarContent.fill({ color: b.color, alpha });
  }

  // sweep wedge + leading edge
  radarContent.moveTo(cx, cy);
  radarContent.arc(cx, cy, r - 1, sweepAngle - 0.5, sweepAngle);
  radarContent.lineTo(cx, cy);
  radarContent.fill({ color: 0x00ff00, alpha: 0.18 });
  radarContent.moveTo(cx, cy);
  radarContent.lineTo(cx + Math.cos(sweepAngle) * (r - 1), cy + Math.sin(sweepAngle) * (r - 1));
  radarContent.stroke({ color: 0x33ff66, width: 1.5, alpha: 0.9 });

  // player dot + facing tick
  radarContent.circle(cx, cy, 2.5); radarContent.fill(0xffffff);
  radarContent.moveTo(cx, cy);
  radarContent.lineTo(cx + Math.cos(p.angle) * 7, cy + Math.sin(p.angle) * 7);
  radarContent.stroke({ color: 0xffffff, width: 1 });
}

// ============================================================
// PER-FRAME UPDATE
// ============================================================
export function updateHUD(dt, nearbyResourceNode) {
  const p = state.player();
  if (!p) return;
  const sw = app.screen.width, sh = app.screen.height;

  // Schematic damage coloring
  const frac = p.hp / p.maxHp;
  let tint;
  if (p.hitFlash > 0) tint = 0xffffff;
  else if (frac > 0.7) tint = 0x00cc44;
  else if (frac > 0.4) tint = 0xcccc22;
  else if (frac > 0.2) tint = 0xdd7722;
  else tint = (state.game.frame % 30 < 15) ? 0xdd2222 : 0x661111;
  schematicSprite.tint = tint;
  setText(schematicHpText, `HP\n${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`);
  schematicHpText.style.fill = tint;

  // Resource counters
  // Total rounds across all six magazines — the weapon bar breaks it down.
  setText(matText, `${totalAmmo(p)}/${totalMaxAmmo()}`);
  setText(fuelText, `${p.fuel.toFixed(0)}/${Math.round(p.maxFuel)}`);
  fuelText.style.fill = p.fuel < p.maxFuel * TUNING.FUEL_WARN_FRAC ? 0xff5544 : COLORS.HUD_TEXT;

  // Cargo hold
  const cargo = cargoTotal(p);
  const cargoFull = cargo >= p.maxCargo;
  setText(cargoText, `CARGO ${Math.floor(cargo)}/${Math.round(p.maxCargo)}`);
  cargoText.style.fill = cargoFull ? 0xff9944 : (cargo > 0 ? 0x66ccff : 0x557766);
  cargoBar.clear();
  cargoBar.rect(cargoBar.barX, cargoBar.barY, cargoBar.barW, 7);
  cargoBar.fill({ color: 0x00220a, alpha: 0.9 });
  if (cargo > 0) {
    cargoBar.rect(cargoBar.barX, cargoBar.barY, cargoBar.barW * Math.min(1, cargo / p.maxCargo), 7);
    cargoBar.fill(cargoFull ? 0xff9944 : 0x3399dd);
  }

  // Rank insignia worn on the hull
  if (p.insignia) {
    const rk = getRank();
    setText(p.insignia, rk.insignia);
    p.insignia.visible = p.alive;
  }

  // Messages
  const nowMs = performance.now();
  for (let i = 0; i < 3; i++) {
    const m = messages[i];
    if (!m) { setText(msgTexts[i], ''); continue; }
    const age = nowMs - m.born;
    if (age > 6000) { setText(msgTexts[i], ''); continue; }
    setText(msgTexts[i], m.text);
    msgTexts[i].style.fill = m.color;
    msgTexts[i].alpha = age > 5000 ? 1 - (age - 5000) / 1000 : 1;
  }

  // Slow scanline drift, so the panels feel alive.
  scanlines.tilePosition.y += dt * 0.35;

  updateRadar(dt, p);
  updateWeaponBar(dt, p);
  drawMarkers(p, sw, sh);
  updateMapOverlay(dt, p);
  if (dmgTimer > 0) dmgTimer -= dt;

  // Drill channel / dig prompt (world-anchored)
  drawDrill(p, nearbyResourceNode);

  // Depot
  if (p.inBase) {
    depotText.visible = true;
    const cargoHeld = cargoTotal(p);
    setText(depotText, cargoHeld > 0
      ? `CLAN DEPOT — banking cargo (${Math.ceil(cargoHeld)} left)`
      : 'CLAN DEPOT — repairing & refueling');
  } else depotText.visible = false;

  // Unspent upgrade points. A promotion that hands you something you never notice
  // is the same as a promotion that hands you nothing.
  // Ask about the hull actually being driven, not the menu selection.
  const pending = getPendingPoints(p.model);
  if (pending > 0 && state.game.mode === 'playing') {
    upgradeText.visible = true;
    upgradeText.alpha = 0.65 + 0.35 * Math.sin(state.game.frame * 0.09);
    setText(upgradeText, `${pending} UPGRADE POINT${pending > 1 ? 'S' : ''} UNSPENT — PRESS U`);
  } else upgradeText.visible = false;

  // Low fuel
  const lowFuel = p.fuel < p.maxFuel * TUNING.FUEL_WARN_FRAC;
  if (lowFuel) {
    lowFuelText.visible = (state.game.frame % 40) < 25;
    setText(lowFuelText, p.fuel <= 0 ? 'FUEL EMPTY — SPEED REDUCED' : 'LOW FUEL');
  } else lowFuelText.visible = false;
  if (p.alive) setLowFuelAlarm(lowFuel && state.game.mode === 'playing');

  // EMP overlay
  if (p.empTimer > 0) {
    empText.visible = true;
    setText(empText, `SYSTEMS OFFLINE ${(p.empTimer / 60).toFixed(1)}s`);
  } else empText.visible = false;

  // Low-HP vignette
  if (p.alive && frac < 0.3) {
    vignette.visible = true;
    vignette.alpha = 0.25 + 0.15 * Math.sin(state.game.frame * 0.08);
  } else vignette.visible = false;

  // Spawn protection shimmer
  if (state.game.spawnProtection > 0 && p.alive) {
    p.container.alpha = 0.5 + 0.4 * Math.sin(state.game.frame * 0.4);
  } else if (p.alive) {
    p.container.alpha = 1;
  }

  // Rank-up banner
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    banner.visible = true;
    const tIn = 180 - bannerTimer;
    banner.scale.set(Math.min(1, tIn / 12));
    banner.alpha = bannerTimer < 30 ? bannerTimer / 30 : 1;
  } else banner.visible = false;

  // Death screen
  if (state.game.mode === 'dead') {
    deathOverlay.visible = true;
    const remain = Math.max(0, state.game.respawnAt - state.game.time);
    setText(deathText, 'TANK DESTROYED');
    const lost = state.game.lastDeathCargo;
    setText(deathSub, lost > 0
      ? `-${state.game.lastDeathXpLoss} XP   ·   ${lost} CARGO SPILLED AT THE WRECK\nRedeploying in ${Math.ceil(remain / 1000)}…`
      : `-${state.game.lastDeathXpLoss} XP\nRedeploying in ${Math.ceil(remain / 1000)}…`);
  } else deathOverlay.visible = false;

  stopBtn.visible = state.game.mode === 'playing';
}

// ------------------------------------------------------------
// DRILL CHANNEL
// ------------------------------------------------------------
// While drilling, an arc fills around the deposit. This is the risk window made
// visible: it is also the only moment in the game where the player is deliberately
// stationary, so it has to be legible without taking the eyes off the field.
function drawDrill(p, nearbyResourceNode) {
  drillGfx.clear();

  if (p.drill) {
    const rn = p.drill.node;
    const sx = rn.x - state.camera.x, sy = rn.y - state.camera.y;
    const frac = Math.min(1, p.drill.elapsed / p.drill.total);
    const R = 30;
    const rich = rn.tier.id === 'rich';
    const col = rich ? 0xffcc44 : 0x66ffaa;

    drillGfx.circle(sx, sy, R);
    drillGfx.stroke({ color: 0x000000, width: 6, alpha: 0.55 });
    drillGfx.circle(sx, sy, R);
    drillGfx.stroke({ color: 0x224422, width: 3.5 });
    // arc() appends to the current sub-path, and after a stroke() the pen sits at
    // the origin — so without this moveTo the fill arc was joined to (0,0) by a
    // line, drawn as a long yellow streak from the top-left of the screen to the
    // deposit. Always seed an arc with an explicit moveTo to its start point.
    const a0 = -Math.PI / 2, a1 = a0 + frac * Math.PI * 2;
    drillGfx.moveTo(sx + Math.cos(a0) * R, sy + Math.sin(a0) * R);
    drillGfx.arc(sx, sy, R, a0, a1);
    drillGfx.stroke({ color: col, width: 3.5 });

    // Noise ring: a literal picture of who can hear this.
    const pulse = (state.game.time % TUNING.DRILL_NOISE_INTERVAL_MS) / TUNING.DRILL_NOISE_INTERVAL_MS;
    drillGfx.circle(sx, sy, 34 + pulse * 46);
    drillGfx.stroke({ color: col, width: 1.5, alpha: 0.32 * (1 - pulse) });

    drillText.visible = true;
    drillText.x = sx; drillText.y = sy - 40;
    drillText.style.fill = col;
    setText(drillText, `${rich ? 'DRILLING RICH VEIN' : 'DRILLING'}  ${Math.floor(frac * 100)}%\nHOLD E — DO NOT MOVE`);
    digPrompt.visible = false;
    return;
  }

  drillText.visible = false;

  if (nearbyResourceNode) {
    const rn = nearbyResourceNode;
    const sx = rn.x - state.camera.x, sy = rn.y - state.camera.y;
    digPrompt.visible = true;
    digPrompt.x = sx; digPrompt.y = sy - 28;
    digPrompt.alpha = 0.7 + 0.3 * Math.sin(state.game.frame * 0.15);
    digPrompt.style.fill = rn.tier.id === 'rich' ? 0xffcc44 : 0xffee88;
    const secs = (rn.tier.drillMS * (p.drillMult ?? 1) / 1000).toFixed(1);
    if (!rn.discovered) {
      setText(digPrompt, 'HOLD E TO DIG');
    } else {
      const kind = rn.type === 'fuel' ? 'FUEL'
        : rn.weaponId != null ? `${WEAPONS[rn.weaponId].name.toUpperCase()} CACHE` : 'MATERIALS';
      setText(digPrompt, `HOLD E — ${kind} ×${rn.amount}  (${secs}s, loud)`);
    }
  } else {
    digPrompt.visible = false;
  }
}

function updateWeaponBar(dt, p) {
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    const s = weaponSlots[i];
    const left = shotsLeft(p, w, i);
    const affordable = left >= 1;
    const selected = p.weaponIndex === i;

    // Restock flash: this slot just took delivery.
    if (slotFlash[i] > 0) slotFlash[i] -= dt;
    const flashing = slotFlash[i] > 0;

    s.bg.clear();
    s.bg.roundRect(0, 0, SLOT_W, SLOT_H, 4);
    s.bg.fill({ color: flashing ? 0x14301a : COLORS.HUD_PANEL, alpha: 0.9 });
    s.bg.roundRect(0, 0, SLOT_W, SLOT_H, 4);
    s.bg.stroke({
      color: flashing ? w.color : (selected ? 0xffcc44 : COLORS.HUD_BORDER),
      width: flashing ? 2.5 : (selected ? 2.5 : 1.5),
      alpha: flashing ? 0.4 + 0.6 * (slotFlash[i] / 34) : 1,
    });
    s.name.style.fill = selected ? 0xffdd88 : COLORS.HUD_TEXT;
    s.icon.alpha = affordable ? 1 : 0.35;
    s.gray.visible = !affordable;

    setText(s.ammo, `${left}/${w.maxAmmo}`);
    s.ammo.style.fill = flashing ? w.color
      : left === 0 ? 0xcc4444
      : left <= Math.max(1, w.maxAmmo * 0.2) ? 0xddaa44 : 0x88aa88;

    // Reload is per-tank now (the AUTOLOADER upgrade scales it), so the wipe has to
    // ask the same question the gun does or the bar lies about when you can fire.
    const reload = reloadOf(p, w);
    const since = state.game.time - (p.lastShotPer ? p.lastShotPer[i] : p.lastShot);
    s.cool.clear();
    if (since < reload) {
      const remain = 1 - since / reload;
      s.cool.rect(0, SLOT_H * (1 - remain), SLOT_W, SLOT_H * remain);
      s.cool.fill({ color: 0x000000, alpha: 0.55 });
    }
  }

  const w = WEAPONS[p.weaponIndex];
  setText(weaponInfo, `${w.name.toUpperCase()} — ${w.desc}`);
  if (weaponFlash > 0) {
    weaponFlash -= dt;
    weaponInfo.scale.set(1 + Math.min(0.25, weaponFlash / 200));
    weaponInfo.alpha = 1;
  } else {
    weaponInfo.scale.set(1);
    weaponInfo.alpha = 0.75;
  }
}

// ============================================================
// OFF-SCREEN MARKERS — home base, nearest known deposit, incoming fire
// ============================================================
const markerLabels = [];
const markerLabelPool = [];

function drawMarkers(p, sw, sh) {
  markers.clear();
  markerLabels.length = 0;
  const inset = 62;
  const cx = sw / 2, cy = sh / 2 + 20;
  const rx = sw / 2 - inset, ry = sh / 2 - inset - 30;

  const arrow = (wx, wy, color, label) => {
    const sx = wx - state.camera.x, sy = wy - state.camera.y;
    if (sx > inset && sx < sw - inset && sy > BAR_H + inset && sy < sh - inset) return;
    const a = Math.atan2(wy - (state.camera.y + sh / 2), wx - (state.camera.x + sw / 2));
    const px = cx + Math.cos(a) * rx, py = cy + Math.sin(a) * ry;
    markers.moveTo(px + Math.cos(a) * 11, py + Math.sin(a) * 11);
    markers.lineTo(px + Math.cos(a + 2.5) * 9, py + Math.sin(a + 2.5) * 9);
    markers.lineTo(px + Math.cos(a - 2.5) * 9, py + Math.sin(a - 2.5) * 9);
    markers.closePath();
    markers.fill({ color, alpha: 0.85 });
    markers.stroke({ color: 0x000000, width: 1.5, alpha: 0.7 });
    if (label) {
      markerLabels.push({
        x: px - Math.cos(a) * 22, y: py - Math.sin(a) * 22, color,
        text: `${label} ${Math.round(Math.hypot(wx - p.x, wy - p.y) / 10)}`,
      });
    }
  };

  const home = state.bases.find(b => b.clanId === p.clanId);
  if (home) arrow(home.x + home.w / 2, home.y + home.h / 2, home.clan.color, 'BASE');

  let near = null, nearD = Infinity;
  for (const rn of state.resourceNodes) {
    if (!rn.alive || !rn.discovered) continue;
    const d = Math.hypot(rn.x - p.x, rn.y - p.y);
    if (d < nearD) { near = rn; nearD = d; }
  }
  if (near) arrow(near.x, near.y, near.type === 'fuel' ? 0xffcc44 : 0x55aaee, 'DIG');

  // Where did that shot come from?
  if (dmgTimer > 0) {
    const alpha = Math.min(0.65, dmgTimer / 60);
    const ex = cx + Math.cos(dmgDir) * (rx - 18), ey = cy + Math.sin(dmgDir) * (ry - 18);
    markers.moveTo(ex + Math.cos(dmgDir) * 16, ey + Math.sin(dmgDir) * 16);
    markers.lineTo(ex + Math.cos(dmgDir + 2.4) * 13, ey + Math.sin(dmgDir + 2.4) * 13);
    markers.lineTo(ex + Math.cos(dmgDir - 2.4) * 13, ey + Math.sin(dmgDir - 2.4) * 13);
    markers.closePath();
    markers.fill({ color: 0xff4433, alpha });
  }

  // Pooled labels for the distance readouts.
  while (markerLabelPool.length < markerLabels.length) {
    const t = makeText(9, 0xffffff, { fontWeight: 'bold', stroke: { color: 0x000000, width: 3 } });
    t.anchor.set(0.5);
    overlays.addChild(t);
    markerLabelPool.push(t);
  }
  markerLabelPool.forEach((t, i) => {
    const m = markerLabels[i];
    if (!m) { t.visible = false; return; }
    t.visible = true;
    t.x = m.x; t.y = m.y;
    setText(t, m.text);
    t.style.fill = m.color;
  });
}

// ============================================================
// FULL MAP (hold Tab)
// ============================================================
function updateMapOverlay(dt, p) {
  const want = state.input.mapOpen && state.game.mode === 'playing';
  mapAlpha += ((want ? 1 : 0) - mapAlpha) * Math.min(1, dt / TUNING.MAP_FADE_FRAMES);
  mapOverlay.visible = mapAlpha > 0.01;
  mapOverlay.alpha = mapAlpha;
  if (!mapOverlay.visible) return;

  const { x: mx, y: my, s: S } = mapOverlay.mapRect;
  const toMap = (wx, wy) => [mx + (wx / WORLD_W) * S, my + (wy / WORLD_H) * S];

  mapBlips.clear();

  for (const b of state.bases) {
    const [bx, by] = toMap(b.x + b.w / 2, b.y + b.h / 2);
    mapBlips.rect(bx - 6, by - 6, 12, 12);
    mapBlips.fill({ color: b.clan.color, alpha: 0.95 });
    mapBlips.rect(bx - 6, by - 6, 12, 12);
    mapBlips.stroke({ color: b.clanId === p.clanId ? 0xffffff : 0x000000, width: 2 });
  }

  // Only deposits you have actually uncovered, same rule as the radar.
  for (const rn of state.resourceNodes) {
    if (!rn.alive || !rn.discovered) continue;
    const [rx2, ry2] = toMap(rn.x, rn.y);
    mapBlips.circle(rx2, ry2, 3.5);
    mapBlips.fill(rn.type === 'fuel' ? 0xffcc44 : 0x55aaee);
  }

  // Contacts: your own clan always, hostiles only inside radar range.
  const range = radarRange(p);
  for (const t of state.tanks) {
    if (t.isPlayer || !t.alive) continue;
    if (t.clanId !== p.clanId && Math.hypot(t.x - p.x, t.y - p.y) > range) continue;
    const [tx, ty] = toMap(t.x, t.y);
    mapBlips.moveTo(tx - 3, ty - 3); mapBlips.lineTo(tx + 3, ty + 3);
    mapBlips.moveTo(tx + 3, ty - 3); mapBlips.lineTo(tx - 3, ty + 3);
    // Hunters sent after you personally get a ring, so a squad converging on your
    // position reads as a squad converging on your position.
    mapBlips.stroke({ color: t.ai?.hunt ? 0xff6644 : t.clan.color, width: t.ai?.hunt ? 2.5 : 2 });
    if (t.ai?.hunt) {
      mapBlips.circle(tx, ty, 6);
      mapBlips.stroke({ color: 0xff6644, width: 1, alpha: 0.7 });
    }
  }

  const [px, py] = toMap(p.x, p.y);
  mapBlips.circle(px, py, (range / WORLD_W) * S);
  mapBlips.stroke({ color: 0x33ff66, width: 1, alpha: 0.35 });

  const a = p.angle;
  mapBlips.moveTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9);
  mapBlips.lineTo(px + Math.cos(a + 2.5) * 7, py + Math.sin(a + 2.5) * 7);
  mapBlips.lineTo(px + Math.cos(a - 2.5) * 7, py + Math.sin(a - 2.5) * 7);
  mapBlips.closePath();
  mapBlips.fill(0xffffff);
  mapBlips.stroke({ color: 0x000000, width: 1.5 });
}

export function setPaused(paused) {
  pauseOverlay.visible = paused;
}

export function resetHUD() {
  messages.length = 0;
  blips.clear();
  dmgTimer = 0;
  refreshRankPanel();
}
