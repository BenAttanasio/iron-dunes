// SERVICE RECORD — the ladder, the upgrade shop, and the Hall of Records.
//
// Rank used to be a name and a bar in the corner with no visible requirement, no
// visible reward, and nothing to compare against. Everything the ladder actually
// does now lives on one screen: where you are, what the next rung costs, which
// hulls it unlocks, where your points went, and the career bests worth chasing in
// a game that has no end state.
//
// Three tabs, rebuilt on demand rather than kept live — it is a paused screen, so
// a full rebuild per interaction is far cheaper than maintaining retained state.

import { RANKS, TANK_MODELS, UPGRADES, COLORS } from './config.js';
import * as state from './state.js';
import {
  getXP, getRankIndex, getRank, getRankProgress, xpToNext,
  getPendingPoints, getSpentPoints, getUpgradeLevel, currentOffers,
  spendPoint, canSpendOn, slotsRemaining, isMaxRank, pointsEarned,
} from './progression.js';
import { RECORDS, getRecord } from './records.js';

const PIXI = window.PIXI;

let app = null;
let root = null;
let open = false;
let tab = 'ladder';        // 'ladder' | 'upgrades' | 'records'
let ladderScroll = 0;

export function isServiceRecordOpen() { return open; }

export function initServiceRecord(pixiApp, parent) {
  app = pixiApp;
  root = new PIXI.Container();
  root.visible = false;
  root.eventMode = 'static';   // swallow clicks to whatever is behind
  parent.addChild(root);

  window.addEventListener('resize', () => { if (open) rebuild(); });
  window.addEventListener('wheel', e => {
    if (!open || tab !== 'ladder') return;
    ladderScroll = Math.max(0, Math.min(RANKS.length - 1, ladderScroll + (e.deltaY > 0 ? 1 : -1)));
    rebuild();
  }, { passive: true });
}

export function toggleServiceRecord() {
  open = !open;
  root.visible = open;
  if (open) {
    // Land on the tab that has something waiting for you.
    tab = getPendingPoints() > 0 ? 'upgrades' : 'ladder';
    ladderScroll = Math.max(0, getRankIndex() - 4);
    rebuild();
  }
}

export function closeServiceRecord() {
  if (!open) return;
  open = false;
  root.visible = false;
}

// ============================================================
// PRIMITIVES
// ============================================================
function panel(g, x, y, w, h, border = COLORS.HUD_BORDER) {
  g.roundRect(x, y, w, h, 4);
  g.fill(COLORS.HUD_PANEL);
  g.roundRect(x, y, w, h, 4);
  g.stroke({ color: border, width: 2 });
}

function text(str, size, fill = COLORS.HUD_TEXT, extra = {}) {
  return new PIXI.Text({ text: str, style: { fontSize: size, fill, fontFamily: 'monospace', ...extra } });
}

function button(label, w, h, onClick, enabled = true) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.roundRect(0, 0, w, h, 4);
  g.fill({ color: enabled ? 0x14301a : 0x1a1a1a });
  g.roundRect(0, 0, w, h, 4);
  g.stroke({ color: enabled ? COLORS.HUD_GREEN : 0x444444, width: 1.5 });
  c.addChild(g);
  const t = text(label, 12, enabled ? COLORS.HUD_TEXT : 0x666666, { fontWeight: 'bold' });
  t.anchor.set(0.5); t.x = w / 2; t.y = h / 2;
  c.addChild(t);
  if (enabled) {
    c.eventMode = 'static'; c.cursor = 'pointer';
    c.on('pointerdown', onClick);
  }
  return c;
}

// ============================================================
// BUILD
// ============================================================
function rebuild() {
  root.removeChildren();
  const sw = app.screen.width, sh = app.screen.height;

  const dim = new PIXI.Graphics();
  dim.rect(0, 0, sw, sh); dim.fill({ color: 0x000000, alpha: 0.82 });
  root.addChild(dim);

  const W = Math.min(sw - 60, 760);
  const H = Math.min(sh - 60, 620);
  const X = sw / 2 - W / 2, Y = sh / 2 - H / 2;

  const bg = new PIXI.Graphics();
  panel(bg, X, Y, W, H);
  root.addChild(bg);

  const title = text('SERVICE RECORD', 20, COLORS.HUD_GREEN_BRIGHT, { fontWeight: 'bold' });
  title.anchor.set(0.5, 0); title.x = X + W / 2; title.y = Y + 14;
  root.addChild(title);

  // --- summary line ---
  const rank = getRank();
  const summary = isMaxRank()
    ? `${rank.insignia}  ${rank.name.toUpperCase()}   ·   XP ${Math.floor(getXP())}   ·   LADDER COMPLETE`
    : `${rank.insignia}  ${rank.name.toUpperCase()}   ·   XP ${Math.floor(getXP())}   ·   ${xpToNext()} TO ${RANKS[getRankIndex() + 1].name.toUpperCase()}`;
  const sub = text(summary, 11, 0x88aa88);
  sub.anchor.set(0.5, 0); sub.x = X + W / 2; sub.y = Y + 40;
  root.addChild(sub);

  // --- tabs ---
  const tabs = [['ladder', 'RANK LADDER'], ['upgrades', 'UPGRADES'], ['records', 'HALL OF RECORDS']];
  const tw = 150, tgap = 8;
  const totalTabW = tabs.length * (tw + tgap) - tgap;
  tabs.forEach(([id, label], i) => {
    const active = tab === id;
    const pending = id === 'upgrades' && getPendingPoints() > 0;
    const c = new PIXI.Container();
    c.x = X + W / 2 - totalTabW / 2 + i * (tw + tgap);
    c.y = Y + 62;
    const g = new PIXI.Graphics();
    g.roundRect(0, 0, tw, 26, 3);
    g.fill({ color: active ? 0x14301a : 0x0d1410 });
    g.roundRect(0, 0, tw, 26, 3);
    g.stroke({ color: active ? 0xffcc44 : COLORS.HUD_BORDER, width: active ? 2 : 1 });
    c.addChild(g);
    const t = text(pending ? `${label} (${getPendingPoints()})` : label, 11,
      active ? 0xffdd88 : 0x88aa88, { fontWeight: 'bold' });
    t.anchor.set(0.5); t.x = tw / 2; t.y = 13;
    c.addChild(t);
    c.eventMode = 'static'; c.cursor = 'pointer';
    c.on('pointerdown', () => { tab = id; rebuild(); });
    root.addChild(c);
  });

  const bodyY = Y + 100, bodyH = H - 100 - 52;
  if (tab === 'ladder') buildLadder(X + 16, bodyY, W - 32, bodyH);
  else if (tab === 'upgrades') buildUpgrades(X + 16, bodyY, W - 32, bodyH);
  else buildRecords(X + 16, bodyY, W - 32, bodyH);

  const close = button('CLOSE  [ESC]', 150, 30, () => {
    closeServiceRecord();
  });
  close.x = X + W / 2 - 75; close.y = Y + H - 42;
  root.addChild(close);
}

// ------------------------------------------------------------
// TAB: RANK LADDER
// ------------------------------------------------------------
// Every rung, its cost, and what it unlocks. The player has never been able to see
// this — the requirements existed only in config.js.
function buildLadder(x, y, w, h) {
  const rowH = 26;
  const rows = Math.floor(h / rowH);
  const cur = getRankIndex();
  const start = Math.max(0, Math.min(RANKS.length - rows, ladderScroll));

  const hdr = text('RANK                          XP        UNLOCKS', 10, 0x668866, { fontWeight: 'bold' });
  hdr.x = x + 8; hdr.y = y - 14;
  root.addChild(hdr);

  for (let i = start; i < Math.min(RANKS.length, start + rows); i++) {
    const r = RANKS[i];
    const ry = y + (i - start) * rowH;
    const isCur = i === cur;
    const reached = i <= cur;

    const g = new PIXI.Graphics();
    g.roundRect(x, ry, w, rowH - 3, 3);
    g.fill({ color: isCur ? 0x14301a : (reached ? 0x0e1a10 : 0x0a0d0a), alpha: 0.9 });
    if (isCur) {
      g.roundRect(x, ry, w, rowH - 3, 3);
      g.stroke({ color: 0xffcc44, width: 2 });
    }
    root.addChild(g);

    const marker = text(isCur ? '▶' : (reached ? '✔' : ' '), 11,
      isCur ? 0xffcc44 : (reached ? COLORS.HUD_GREEN : 0x333333), { fontWeight: 'bold' });
    marker.x = x + 7; marker.y = ry + 5;
    root.addChild(marker);

    const ins = text(r.insignia, 11, reached ? COLORS.HUD_GREEN_BRIGHT : 0x445544, { fontWeight: 'bold' });
    ins.x = x + 24; ins.y = ry + 5;
    root.addChild(ins);

    const nm = text(r.name.toUpperCase(), 11,
      isCur ? 0xffdd88 : (reached ? COLORS.HUD_TEXT : 0x556655), { fontWeight: isCur ? 'bold' : 'normal' });
    nm.x = x + 92; nm.y = ry + 5;
    root.addChild(nm);

    const xpT = text(`${r.xp}`, 11, reached ? 0x88aa88 : 0x556655);
    xpT.anchor.set(1, 0); xpT.x = x + 350; xpT.y = ry + 5;
    root.addChild(xpT);

    // What this rung actually hands you: a hull, and a point either way.
    const unlocks = [];
    const model = TANK_MODELS.find(m => m.reqRank === i);
    if (model) unlocks.push(`${model.name.toUpperCase()} hull`);
    if (i > 0) unlocks.push('+1 upgrade point');
    const un = text(unlocks.join('  ·  ') || '—', 10,
      model ? (reached ? 0xffcc44 : 0xaa8844) : (reached ? 0x668866 : 0x445544));
    un.x = x + 372; un.y = ry + 6;
    root.addChild(un);

    // Progress into the rung you're currently working through.
    if (isCur && !isMaxRank()) {
      const barW = (w - 14) * Math.min(1, getRankProgress());
      const bar = new PIXI.Graphics();
      bar.rect(x + 7, ry + rowH - 6, barW, 2);
      bar.fill({ color: 0xffcc44, alpha: 0.8 });
      root.addChild(bar);
    }
  }

  if (RANKS.length > rows) {
    const hint = text('scroll to see the rest of the ladder', 9, 0x556655);
    hint.anchor.set(1, 0); hint.x = x + w; hint.y = y + h + 2;
    root.addChild(hint);
  }
}

// ------------------------------------------------------------
// TAB: UPGRADES
// ------------------------------------------------------------
// A promotion grants a point; you choose where it goes from three offers. The
// offers are deterministic in how many points you have already spent, so closing
// the screen can't be used to reroll them.
function buildUpgrades(x, y, w, h) {
  const model = TANK_MODELS[state.game.selectedTank] || TANK_MODELS[0];
  const pending = getPendingPoints(model);
  const spent = getSpentPoints(model);
  const remain = slotsRemaining(model);

  const head = text(
    `${model.name.toUpperCase()} · ${spent}/${model.slots} SLOTS FILLED · ${pending} POINT${pending === 1 ? '' : 'S'} UNSPENT`,
    12, pending > 0 ? 0xffcc44 : 0x88aa88, { fontWeight: 'bold' });
  head.x = x + 4; head.y = y - 14;
  root.addChild(head);

  // Each hull keeps its own build sheet against the same earned points, so this
  // has to say which hull you are looking at or a Forge build reads as a Sundance
  // build the moment you switch.
  const note = text(
    `Career points earned: ${pointsEarned()}. Every hull spends them independently — ` +
    `this one caps at ${model.slots}.`, 9, 0x668866);
  note.x = x + 4; note.y = y + 2;
  root.addChild(note);

  // --- offers ---
  let cursorY = y + 20;
  if (pending > 0 && remain > 0) {
    const offers = currentOffers(model);
    const cardW = (w - 16) / 3, cardH = 108;
    offers.forEach((u, i) => {
      const cx = x + i * (cardW + 8);
      const lvl = getUpgradeLevel(u.id, model);
      const usable = canSpendOn(u.id, model);
      const c = new PIXI.Container();
      c.x = cx; c.y = cursorY;
      const g = new PIXI.Graphics();
      g.roundRect(0, 0, cardW, cardH, 5);
      g.fill({ color: 0x0e1a10, alpha: 0.95 });
      g.roundRect(0, 0, cardW, cardH, 5);
      g.stroke({ color: usable ? 0xffcc44 : 0x444444, width: usable ? 2 : 1 });
      c.addChild(g);

      const nm = text(u.name, 11, 0xffdd88, { fontWeight: 'bold', wordWrap: true, wordWrapWidth: cardW - 16, align: 'center' });
      nm.anchor.set(0.5, 0); nm.x = cardW / 2; nm.y = 10;
      c.addChild(nm);

      const ds = text(u.desc, 11, COLORS.HUD_TEXT);
      ds.anchor.set(0.5, 0); ds.x = cardW / 2; ds.y = 44;
      c.addChild(ds);

      const lv = text(`level ${lvl}/${u.max}`, 9, 0x668866);
      lv.anchor.set(0.5, 0); lv.x = cardW / 2; lv.y = 62;
      c.addChild(lv);

      const take = button(usable ? 'INSTALL' : 'MAXED', cardW - 24, 22, () => {
        if (spendPoint(u.id, model)) rebuild();
      }, usable);
      take.x = 12; take.y = cardH - 32;
      c.addChild(take);
      root.addChild(c);
    });
    cursorY += cardH + 14;
  } else {
    const why = remain <= 0
      ? `${model.name} is fully built out — a bigger hull can absorb more.`
      : 'No unspent points. Rank up to earn more.';
    const t = text(why, 11, 0x668866);
    t.x = x + 4; t.y = cursorY + 4;
    root.addChild(t);
    cursorY += 30;
  }

  // --- installed tracks ---
  const instHdr = text('INSTALLED', 10, 0x668866, { fontWeight: 'bold' });
  instHdr.x = x + 4; instHdr.y = cursorY;
  root.addChild(instHdr);
  cursorY += 16;

  const rowH = 20;
  for (const u of UPGRADES) {
    const lvl = getUpgradeLevel(u.id, model);
    if (cursorY > y + h - rowH) break;
    const nm = text(u.name, 10, lvl > 0 ? COLORS.HUD_TEXT : 0x445544);
    nm.x = x + 8; nm.y = cursorY;
    root.addChild(nm);

    const ds = text(u.desc, 9, lvl > 0 ? 0x668866 : 0x3a463a);
    ds.x = x + 180; ds.y = cursorY + 1;
    root.addChild(ds);

    // Pip row reads faster than a number when you're scanning a build.
    const pips = new PIXI.Graphics();
    for (let i = 0; i < u.max; i++) {
      pips.rect(x + 330 + i * 11, cursorY + 3, 8, 8);
      pips.fill(i < lvl ? COLORS.HUD_GREEN : 0x243024);
    }
    root.addChild(pips);
    cursorY += rowH;
  }
}

// ------------------------------------------------------------
// TAB: HALL OF RECORDS
// ------------------------------------------------------------
function buildRecords(x, y, w, h) {
  const rowH = 26;
  let cy = y;
  for (const rec of RECORDS) {
    if (cy > y + h - rowH) break;
    const raw = getRecord(rec.id);
    const value = rec.id === 'topRank'
      ? (RANKS[Math.min(RANKS.length - 1, Math.floor(raw))]?.name.toUpperCase() || '—')
      : (raw > 0 ? rec.fmt(raw) : '—');

    const g = new PIXI.Graphics();
    g.roundRect(x, cy, w, rowH - 4, 3);
    g.fill({ color: 0x0e1a10, alpha: 0.7 });
    root.addChild(g);

    const nm = text(rec.name, 11, COLORS.HUD_TEXT);
    nm.x = x + 10; nm.y = cy + 4;
    root.addChild(nm);

    const vt = text(value, 11, raw > 0 ? 0xffcc44 : 0x445544, { fontWeight: 'bold' });
    vt.anchor.set(1, 0); vt.x = x + w - 10; vt.y = cy + 4;
    root.addChild(vt);
    cy += rowH;
  }

  const foot = text(
    'Records persist across sessions. Nothing here resets on death.',
    9, 0x556655);
  foot.x = x + 4; foot.y = y + h - 4;
  root.addChild(foot);
}
