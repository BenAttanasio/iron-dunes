// Clan/tank selection screen, restyled to the black/green panel language.
// Keyboard: ←/→ cycle, ↑/↓ or Tab switch row, Enter deploys.
// Remembers last selection via save.js.

import { CLANS, TANK_MODELS, COLORS } from './config.js';
import * as state from './state.js';
import { getTexture, tankTextureKey } from './textures.js';
import * as save from './save.js';

const PIXI = window.PIXI;

let app = null;
let container = null;
let onDeploy = null;
let focusRow = 1;   // 0 = clan, 1 = tank
let resizeTimer = null;

export function initMenu(pixiApp, menuContainer, deployCallback) {
  app = pixiApp;
  container = menuContainer;
  onDeploy = deployCallback;
  state.game.selectedClan = save.get('clan');
  state.game.selectedTank = save.get('tank');

  window.addEventListener('keydown', e => {
    if (state.game.mode !== 'menu') return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (focusRow === 0) state.game.selectedClan = (state.game.selectedClan + dir + CLANS.length) % CLANS.length;
      else state.game.selectedTank = (state.game.selectedTank + dir + TANK_MODELS.length) % TANK_MODELS.length;
      persist(); showMenu();
    } else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Tab') {
      focusRow = 1 - focusRow;
      showMenu();
      e.preventDefault();
    } else if (k === 'Enter') {
      onDeploy();
    }
  });

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.game.mode === 'menu') showMenu(); }, 150);
  });
}

function persist() {
  save.set('clan', state.game.selectedClan);
  save.set('tank', state.game.selectedTank);
}

function panel(g, x, y, w, h) {
  g.roundRect(x, y, w, h, 4);
  g.fill(COLORS.HUD_PANEL);
  g.roundRect(x, y, w, h, 4);
  g.stroke({ color: COLORS.HUD_BORDER, width: 2 });
}

function text(str, size, fill = COLORS.HUD_TEXT, extra = {}) {
  return new PIXI.Text({ text: str, style: { fontSize: size, fill, fontFamily: 'monospace', ...extra } });
}

export function showMenu() {
  container.removeChildren();
  container.visible = true;
  app.canvas.style.cursor = 'default';

  const sw = app.screen.width, sh = app.screen.height;

  const bg = new PIXI.Graphics();
  bg.rect(0, 0, sw, sh); bg.fill(0x0a0e08);
  container.addChild(bg);

  const title = text('TANK WARS', 48, 0xccaa44, {
    fontWeight: 'bold', dropShadow: true, dropShadowColor: 0x000000, dropShadowDistance: 3
  });
  title.anchor.set(0.5); title.x = sw / 2; title.y = 50;
  container.addChild(title);

  const subtitle = text('SELECT YOUR CLAN AND TANK', 14, 0x669966);
  subtitle.anchor.set(0.5); subtitle.x = sw / 2; subtitle.y = 88;
  container.addChild(subtitle);

  // ---- CLAN ROW ----
  const clanLabel = text(focusRow === 0 ? '▶ CLAN ◀' : 'CLAN', 14, focusRow === 0 ? COLORS.HUD_GREEN_BRIGHT : 0xaaaaaa);
  clanLabel.anchor.set(0.5); clanLabel.x = sw / 2; clanLabel.y = 118;
  container.addChild(clanLabel);

  const clanStartX = sw / 2 - (CLANS.length * 130) / 2 + 65;
  for (let i = 0; i < CLANS.length; i++) {
    const clan = CLANS[i];
    const box = new PIXI.Container();
    box.x = clanStartX + i * 130; box.y = 160;
    box.eventMode = 'static'; box.cursor = 'pointer';

    const cbg = new PIXI.Graphics();
    cbg.roundRect(-52, -24, 104, 56, 6);
    cbg.fill({ color: clan.color, alpha: i === state.game.selectedClan ? 0.8 : 0.25 });
    cbg.stroke({ color: i === state.game.selectedClan ? 0xffffff : clan.color, width: i === state.game.selectedClan ? 3 : 1 });
    box.addChild(cbg);

    const nm = text(clan.name, 10, 0xffffff, { align: 'center', wordWrap: true, wordWrapWidth: 95 });
    nm.anchor.set(0.5); nm.y = 6;
    box.addChild(nm);

    box.on('pointerdown', () => { state.game.selectedClan = i; persist(); showMenu(); });
    container.addChild(box);
  }

  // ---- TANK ROW ----
  const tankLabel = text(focusRow === 1 ? '▶ TANK ◀' : 'TANK', 14, focusRow === 1 ? COLORS.HUD_GREEN_BRIGHT : 0xaaaaaa);
  tankLabel.anchor.set(0.5); tankLabel.x = sw / 2; tankLabel.y = 210;
  container.addChild(tankLabel);

  const tankStartX = sw / 2 - (TANK_MODELS.length * 170) / 2 + 85;
  for (let i = 0; i < TANK_MODELS.length; i++) {
    const model = TANK_MODELS[i];
    const box = new PIXI.Container();
    box.x = tankStartX + i * 170; box.y = 340;
    box.eventMode = 'static'; box.cursor = 'pointer';

    const tbg = new PIXI.Graphics();
    tbg.roundRect(-72, -100, 144, 210, 6);
    tbg.fill({ color: COLORS.HUD_PANEL, alpha: 0.9 });
    tbg.stroke({ color: i === state.game.selectedTank ? 0xffcc44 : COLORS.HUD_BORDER, width: i === state.game.selectedTank ? 3 : 1 });
    box.addChild(tbg);

    const nm = text(model.name, 14, 0xffcc44, { fontWeight: 'bold' });
    nm.anchor.set(0.5); nm.y = -82;
    box.addChild(nm);

    const desc = text(model.desc, 10, 0x88aa88);
    desc.anchor.set(0.5); desc.y = -65;
    box.addChild(desc);

    const statNames = ['SPD', 'ARM', 'PWR', 'SLT'];
    const statKeys = ['speed', 'armor', 'power', 'slots'];
    const statColors = [0x44cc44, 0x4488cc, 0xcc4444, 0xccaa44];
    for (let s = 0; s < 4; s++) {
      const sy = -48 + s * 20;
      const label = text(statNames[s], 9, 0xaaaaaa);
      label.x = -58; label.y = sy;
      box.addChild(label);

      const barBg = new PIXI.Graphics();
      barBg.rect(-28, sy + 2, 82, 10); barBg.fill({ color: 0x000000, alpha: 0.5 });
      box.addChild(barBg);

      const barFill = new PIXI.Graphics();
      barFill.rect(-28, sy + 2, (model.stats[statKeys[s]] / 10) * 82, 10);
      barFill.fill(statColors[s]);
      box.addChild(barFill);

      const val = text(`${model.stats[statKeys[s]]}`, 8, 0xffffff);
      val.x = 58; val.y = sy;
      box.addChild(val);
    }

    const preview = new PIXI.Sprite(getTexture(tankTextureKey(CLANS[state.game.selectedClan].color, model.scale)));
    preview.anchor.set(0.5); preview.y = 60; preview.scale.set(1.3);
    box.addChild(preview);

    box.on('pointerdown', () => { state.game.selectedTank = i; persist(); showMenu(); });
    container.addChild(box);
  }

  // ---- SIDE PANELS ----
  const leftPanel = new PIXI.Graphics();
  panel(leftPanel, 14, 114, 220, 260);
  container.addChild(leftPanel);
  const hotkeys = text([
    'CONTROLS', '',
    'WASD        Move tank',
    'Mouse       Aim turret',
    'Click/Space Fire weapon',
    '1-6 / Wheel Select weapon',
    'E           Dig resources',
    'Esc         Pause', '',
    'WEAPONS', '',
    '1 Cannon    High damage',
    '2 H.E.A.T.  Area blast',
    '3 Ricochet  Bouncing shots',
    '4 Homing    Heat-seeking',
    '5 Mine      Area denial',
    '6 EM Pulse  Disrupt systems',
  ].join('\n'), 10, 0x88aa88, { lineHeight: 14 });
  hotkeys.x = 26; hotkeys.y = 126;
  container.addChild(hotkeys);

  const rightPanel = new PIXI.Graphics();
  panel(rightPanel, sw - 244, 114, 230, 190);
  container.addChild(rightPanel);
  const info = text([
    'FIELD MANUAL', '',
    'Fuel      Movement & weapons',
    'Materials Ammunition', '',
    'Watch for disturbed sand —',
    'drive close + press E to dig.',
    'Dug deposits show on radar.',
    'Return to base to repair,',
    'refuel and rearm.', '',
    'Rank up: kills, digs,',
    'survival. Death costs XP.',
  ].join('\n'), 10, 0x88aa88, { lineHeight: 14 });
  info.x = sw - 232; info.y = 126;
  container.addChild(info);

  // ---- DEPLOY ----
  const deployBtn = new PIXI.Container();
  deployBtn.x = sw / 2; deployBtn.y = sh - 50;
  deployBtn.eventMode = 'static'; deployBtn.cursor = 'pointer';
  const btnBg = new PIXI.Graphics();
  btnBg.roundRect(-80, -22, 160, 44, 8);
  btnBg.fill(0x1a5a1a);
  btnBg.stroke({ color: COLORS.HUD_GREEN_BRIGHT, width: 2 });
  deployBtn.addChild(btnBg);
  const btnText = text('DEPLOY', 20, 0xffffff, { fontWeight: 'bold' });
  btnText.anchor.set(0.5);
  deployBtn.addChild(btnText);
  const hint = text('[ENTER]', 9, 0x669966);
  hint.anchor.set(0.5); hint.y = 30;
  deployBtn.addChild(hint);
  deployBtn.on('pointerdown', () => onDeploy());
  container.addChild(deployBtn);
}

export function hideMenu() {
  container.visible = false;
}
