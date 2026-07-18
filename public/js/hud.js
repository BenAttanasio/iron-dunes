// In-game HUD styled after the original bonus.com game: a top bar of black
// panels with green borders (tank schematic, ammo counters, message feed,
// radar with rotating sweep, rank), a weapon bar, prompts/overlays, and the
// pause/death screens.

import { WEAPONS, TUNING, COLORS, RANKS } from './config.js';
import * as state from './state.js';
import { on, emit } from './events.js';
import { getTexture } from './textures.js';
import { getXP, getRank, getRankProgress } from './progression.js';
import { isMuted, setMuted, setLowFuelAlarm } from './audio.js';

const PIXI = window.PIXI;

const BAR_H = 96;
const PAD = 6;

let app = null;
let root = null;           // whole HUD container
let topBar = null;
let weaponBar = null;
let overlays = null;

// panels
let schematicSprite, schematicHpText;
let matText, fuelText;
let msgTexts = [];
const messages = [];       // {text, color, born}
let radarContent, radarStatic, radarPanelPos = { x: 0, y: 0, r: 44 };
let rankInsignia, rankName, rankBarBg, rankBar, rankXpText;
let panelBgs = null;       // Graphics redrawn on layout

// weapon bar
let weaponSlots = [];      // {bg, cool, gray, sel} per weapon

// prompts & overlays
let digPrompt, depotText, lowFuelText, empText, vignette;
let deathOverlay, deathText, deathSub;
let pauseOverlay, stopBtn;
let banner, bannerTimer = 0;

// radar sweep state
let sweepAngle = 0;
const blips = new Map();   // entity -> {x, y, color, stamp}
const SWEEP_PERIOD_MS = (Math.PI * 2) / TUNING.RADAR_SWEEP_RAD_S * 1000;

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

  // --- message panel ---
  for (let i = 0; i < 3; i++) {
    const t = makeText(11, COLORS.HUD_TEXT);
    msgTexts.push(t); topBar.addChild(t);
  }

  // --- radar panel ---
  radarStatic = new PIXI.Graphics();
  radarContent = new PIXI.Graphics();
  topBar.addChild(radarStatic); topBar.addChild(radarContent);

  // --- rank panel ---
  rankInsignia = makeText(18, COLORS.HUD_GREEN_BRIGHT, { fontWeight: 'bold' });
  rankName = makeText(13, COLORS.HUD_TEXT, { fontWeight: 'bold' });
  rankXpText = makeText(10, 0x88aa88);
  rankBarBg = new PIXI.Graphics();
  rankBar = new PIXI.Graphics();
  topBar.addChild(rankBarBg); topBar.addChild(rankBar);
  topBar.addChild(rankInsignia); topBar.addChild(rankName); topBar.addChild(rankXpText);

  // --- weapon bar ---
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    const slot = new PIXI.Container();
    const bg = new PIXI.Graphics();
    slot.addChild(bg);
    const icon = new PIXI.Graphics();
    icon.circle(23, 18, 7); icon.fill(w.color);
    icon.circle(23, 18, 3); icon.fill(0xffffff);
    slot.addChild(icon);
    const key = makeText(9, 0xaaaaaa); key.text = w.key; key.x = 4; key.y = 3;
    slot.addChild(key);
    const cost = makeText(8, 0x88aa88);
    const parts = [];
    if (w.fuelCost) parts.push(`${w.fuelCost}F`);
    if (w.matCost) parts.push(`${w.matCost}M`);
    cost.text = parts.join('+') || '—';
    cost.anchor.set(0.5, 0); cost.x = 23; cost.y = 32;
    slot.addChild(cost);
    const cool = new PIXI.Graphics();
    slot.addChild(cool);
    const gray = new PIXI.Graphics();
    gray.rect(0, 0, 46, 46); gray.fill({ color: 0x222222, alpha: 0.55 });
    gray.visible = false;
    slot.addChild(gray);
    const sel = new PIXI.Graphics();
    slot.addChild(sel);
    slot.eventMode = 'static'; slot.cursor = 'pointer';
    slot.on('pointerdown', () => { const p = state.player(); if (p) p.weaponIndex = i; });
    weaponBar.addChild(slot);
    weaponSlots.push({ slot, bg, cool, gray, sel });
  }

  // --- prompts & overlays ---
  digPrompt = makeText(13, 0xffee88, { fontWeight: 'bold', align: 'center' });
  digPrompt.anchor.set(0.5, 1);
  overlays.addChild(digPrompt);

  depotText = makeText(14, 0x44ff88, { align: 'center' });
  depotText.anchor.set(0.5, 0);
  overlays.addChild(depotText);

  lowFuelText = makeText(16, 0xff5544, { fontWeight: 'bold' });
  lowFuelText.anchor.set(0.5);
  overlays.addChild(lowFuelText);

  empText = makeText(16, 0x66aaff, { fontWeight: 'bold', align: 'center' });
  empText.anchor.set(0.5);
  overlays.addChild(empText);

  vignette = new PIXI.Sprite(getTexture('vignette'));
  vignette.visible = false;
  overlays.addChild(vignette);

  banner = makeText(30, 0xffcc44, { fontWeight: 'bold', align: 'center', dropShadow: true });
  banner.anchor.set(0.5);
  banner.visible = false;
  overlays.addChild(banner);

  // STOP button (pauses)
  stopBtn = bevelButton('STOP', 90, 34);
  stopBtn.on('pointerdown', () => emit('pause-toggle', {}));
  root.addChild(stopBtn);

  buildDeathOverlay();
  buildPauseOverlay();
  subscribe();
  layoutHUD();
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
  const mute = bevelButton(isMuted() ? 'SOUND: OFF' : 'SOUND: ON', 180, 38);
  mute.on('pointerdown', () => {
    setMuted(!isMuted());
    mute.btnLabel.text = isMuted() ? 'SOUND: OFF' : 'SOUND: ON';
  });
  const quit = bevelButton('RETURN TO MENU', 180, 38);
  quit.on('pointerdown', () => emit('return-to-menu', {}));
  pauseButtons = [resume, mute, quit];
  for (const b of pauseButtons) pauseOverlay.addChild(b);
  pauseOverlay.eventMode = 'static';
  root.addChild(pauseOverlay);
}

function subscribe() {
  on('message', ({ text, color }) => pushMessage(text, color));
  on('kill', ({ victim, killer }) => {
    const vName = victim.isPlayer ? 'You' : victim.clan.name;
    if (killer && killer.isPlayer) pushMessage(`You destroyed a ${victim.clan.name} tank`, 0xffcc44);
    else if (victim.isPlayer) pushMessage(`You were destroyed`, 0xff5544);
    else if (killer && killer.clan) pushMessage(`${killer.clan.short} destroyed a ${victim.clan.short} tank`, 0xaaaaaa);
    else pushMessage(`${vName} tank destroyed`, 0xaaaaaa);
  });
  on('discover', ({ node }) => pushMessage(`${node.type === 'fuel' ? 'Fuel' : 'Material'} deposit uncovered`, 0x66ffaa));
  on('pickup', ({ type, amount }) => pushMessage(`+${amount} ${type} salvaged`, 0x66ffaa));
  on('rank-up', ({ rank }) => {
    pushMessage(`PROMOTED: ${rank.name.toUpperCase()}`, 0xffcc44);
    banner.text = `${rank.insignia}  PROMOTED: ${rank.name.toUpperCase()}  ${rank.insignia}`;
    bannerTimer = 180;
  });
  on('xp-gained', () => refreshRankPanel());
  on('xp-lost', () => refreshRankPanel());
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
  topBar.shellIcon.x = x + 12; topBar.shellIcon.y = y + 8;
  matText.x = x + 40; matText.y = y + 14;
  topBar.fuelIcon.x = x + 10; topBar.fuelIcon.y = y + 46;
  fuelText.x = x + 40; fuelText.y = y + 50;
  x += resW + PAD;

  panel(panelBgs, x, y, msgW, h);
  for (let i = 0; i < 3; i++) { msgTexts[i].x = x + 10; msgTexts[i].y = y + 10 + i * 22; }
  x += msgW + PAD;

  panel(panelBgs, x, y, radW, h);
  radarPanelPos = { x: x + radW / 2, y: y + h / 2, r: Math.min(radW, h) / 2 - 8 };
  drawRadarStatic();
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

  // Weapon bar bottom center
  const totalW = WEAPONS.length * 50 - 4;
  weaponBar.x = sw / 2 - totalW / 2;
  weaponBar.y = sh - 56;
  weaponSlots.forEach((s, i) => { s.slot.x = i * 50; s.slot.y = 0; });

  // Overlays
  stopBtn.x = 14; stopBtn.y = sh - 48;
  depotText.x = sw / 2; depotText.y = BAR_H + 16;
  lowFuelText.x = sw / 2; lowFuelText.y = sh - 90;
  empText.x = sw / 2; empText.y = sh / 2 - 60;
  banner.x = sw / 2; banner.y = sh / 3;
  vignette.width = sw; vignette.height = sh;

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
  panel(pauseOverlay.pnl, sw / 2 - 130, sh / 2 - 120, 260, 240);
  pauseOverlay.titleText.x = sw / 2; pauseOverlay.titleText.y = sh / 2 - 85;
  pauseButtons.forEach((b, i) => { b.x = sw / 2 - 90; b.y = sh / 2 - 50 + i * 52; });
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

function refreshRankPanel() {
  const rank = getRank();
  setText(rankInsignia, rank.insignia);
  setText(rankName, rank.name.toUpperCase());
  setText(rankXpText, `XP ${Math.floor(getXP())}`);
  rankBar.clear();
  rankBar.rect(rankBar.barX, rankBar.barY, rankBar.barW * Math.min(1, getRankProgress()), 8);
  rankBar.fill(COLORS.HUD_GREEN);
}

// ============================================================
// RADAR
// ============================================================
function updateRadar(dt, p) {
  const { x: cx, y: cy, r } = radarPanelPos;
  const prev = sweepAngle;
  sweepAngle = (sweepAngle + TUNING.RADAR_SWEEP_RAD_S * (dt / 60)) % (Math.PI * 2);
  const step = (sweepAngle - prev + Math.PI * 2) % (Math.PI * 2);
  const now = state.game.time;

  // Refresh blips whose bearing the sweep crossed this frame
  const consider = (entity, ex, ey, color, always = false) => {
    const d = Math.hypot(ex - p.x, ey - p.y);
    if (d > TUNING.RADAR_RANGE) { blips.delete(entity); return; }
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
  const scale = r / TUNING.RADAR_RANGE;
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
  setText(matText, `${Math.floor(p.materials)}/${p.maxMaterials}`);
  setText(fuelText, `${p.fuel.toFixed(0)}/${p.maxFuel}`);
  fuelText.style.fill = p.fuel < p.maxFuel * TUNING.FUEL_WARN_FRAC ? 0xff5544 : COLORS.HUD_TEXT;

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

  updateRadar(dt, p);

  // Weapon bar
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    const s = weaponSlots[i];
    const affordable = p.fuel >= w.fuelCost && p.materials >= w.matCost;
    const selected = p.weaponIndex === i;
    s.bg.clear();
    s.bg.roundRect(0, 0, 46, 46, 4);
    s.bg.fill({ color: COLORS.HUD_PANEL, alpha: 0.85 });
    s.bg.roundRect(0, 0, 46, 46, 4);
    s.bg.stroke({ color: selected ? 0xffcc44 : COLORS.HUD_BORDER, width: selected ? 2.5 : 1.5 });
    s.gray.visible = !affordable;
    // cooldown pie (remaining fraction)
    const since = state.game.time - p.lastShot;
    s.cool.clear();
    if (selected && since < w.reload) {
      const remain = 1 - since / w.reload;
      s.cool.moveTo(23, 23);
      s.cool.arc(23, 23, 21, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain);
      s.cool.lineTo(23, 23);
      s.cool.fill({ color: 0x000000, alpha: 0.5 });
    }
  }

  // Dig prompt (world-anchored)
  if (nearbyResourceNode) {
    const rn = nearbyResourceNode;
    const sx = rn.x - state.camera.x, sy = rn.y - state.camera.y;
    digPrompt.visible = true;
    digPrompt.x = sx; digPrompt.y = sy - 28;
    digPrompt.alpha = 0.7 + 0.3 * Math.sin(state.game.frame * 0.15);
    setText(digPrompt, rn.discovered
      ? `PRESS E TO COLLECT (${rn.type.toUpperCase()} ×${rn.amount})`
      : 'PRESS E TO DIG');
  } else {
    digPrompt.visible = false;
  }

  // Depot
  if (p.inBase) {
    depotText.visible = true;
    setText(depotText, 'CLAN DEPOT — repairing & refueling');
  } else depotText.visible = false;

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
    setText(deathSub, `-${state.game.lastDeathXpLoss} XP\nRedeploying in ${Math.ceil(remain / 1000)}…`);
  } else deathOverlay.visible = false;

  stopBtn.visible = state.game.mode === 'playing';
}

export function setPaused(paused) {
  pauseOverlay.visible = paused;
}

export function resetHUD() {
  messages.length = 0;
  blips.clear();
  refreshRankPanel();
}
