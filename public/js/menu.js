// Clan/tank selection screen, restyled to the black/green panel language.
// Keyboard: ←/→ cycle, ↑/↓ or Tab switch row, Enter deploys.
// Remembers last selection via save.js.

import { CLANS, TANK_MODELS, COLORS, RANKS } from './config.js';
import * as state from './state.js';
import { emit } from './events.js';
import { getTexture, tankTextureKey } from './textures.js';
import * as save from './save.js';
import { isModelUnlocked, fallbackModelIndex, getRank, getXP, xpToNext, getPendingPoints } from './progression.js';
import { isServiceRecordOpen } from './rankscreen.js';

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
  // Models are rank-gated, so a save that points at a locked hull (or a v1 save
  // from before gating) has to be repaired before the menu ever draws it.
  state.game.selectedTank = fallbackModelIndex(save.get('tank'));

  window.addEventListener('keydown', e => {
    if (state.game.mode !== 'menu') return;
    // The service record sits on top of the menu and owns the keyboard while open.
    if (isServiceRecordOpen()) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (focusRow === 0) {
        state.game.selectedClan = (state.game.selectedClan + dir + CLANS.length) % CLANS.length;
      } else {
        // Skip over locked hulls rather than parking the cursor on one.
        let next = state.game.selectedTank;
        for (let i = 0; i < TANK_MODELS.length; i++) {
          next = (next + dir + TANK_MODELS.length) % TANK_MODELS.length;
          if (isModelUnlocked(TANK_MODELS[next])) break;
        }
        state.game.selectedTank = next;
      }
      persist(); showMenu();
    } else if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Tab') {
      focusRow = 1 - focusRow;
      showMenu();
      e.preventDefault();
    } else if (k.toLowerCase() === 'u') {
      emit('open-service-record', {});
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

  const title = text('IRON DUNES', 48, 0xccaa44, {
    fontWeight: 'bold', dropShadow: true, dropShadowColor: 0x000000, dropShadowDistance: 3
  });
  title.anchor.set(0.5); title.x = sw / 2; title.y = 38;
  container.addChild(title);

  // The wordmark is the lineage: the original was a Flash game called
  // Battlefield 2: Rogue Battalions. The half worth keeping is the half that was
  // actually its own — see the Lineage note in docs/GAME_DESIGN.md.
  const wordmark = text('R O G U E   B A T T A L I O N S', 13, 0x8a7433, { fontWeight: 'bold' });
  wordmark.anchor.set(0.5); wordmark.x = sw / 2; wordmark.y = 68;
  container.addChild(wordmark);

  const subtitle = text('SELECT YOUR CLAN AND TANK', 14, 0x669966);
  subtitle.anchor.set(0.5); subtitle.x = sw / 2; subtitle.y = 88;
  container.addChild(subtitle);

  // Standing in the menu you should be able to see where you are on the ladder and
  // what the next rung costs — it used to be visible nowhere at all.
  const rank = getRank();
  const need = xpToNext();
  const pending = getPendingPoints();
  const line = need > 0
    ? `${rank.insignia}  ${rank.name.toUpperCase()}   ·   XP ${Math.floor(getXP())}   ·   ${need} TO NEXT RANK`
    : `${rank.insignia}  ${rank.name.toUpperCase()}   ·   XP ${Math.floor(getXP())}   ·   LADDER COMPLETE`;
  const rankLine = text(line, 12, 0xccaa44, { fontWeight: 'bold' });
  rankLine.anchor.set(0.5); rankLine.x = sw / 2; rankLine.y = 106;
  container.addChild(rankLine);

  const recordBtn = new PIXI.Container();
  recordBtn.x = sw / 2; recordBtn.y = 126;
  recordBtn.eventMode = 'static'; recordBtn.cursor = 'pointer';
  const rbg = new PIXI.Graphics();
  rbg.roundRect(-110, -10, 220, 21, 3);
  rbg.fill({ color: pending > 0 ? 0x33280c : 0x0d1410 });
  rbg.roundRect(-110, -10, 220, 21, 3);
  rbg.stroke({ color: pending > 0 ? 0xffcc44 : COLORS.HUD_BORDER, width: pending > 0 ? 2 : 1 });
  recordBtn.addChild(rbg);
  const rlabel = text(
    pending > 0 ? `SERVICE RECORD — ${pending} POINT${pending > 1 ? 'S' : ''}  [U]` : 'SERVICE RECORD  [U]',
    10, pending > 0 ? 0xffdd88 : 0x88aa88, { fontWeight: 'bold' });
  rlabel.anchor.set(0.5); rlabel.y = 0;
  recordBtn.addChild(rlabel);
  recordBtn.on('pointerdown', () => emit('open-service-record', {}));
  container.addChild(recordBtn);

  // ---- LAYOUT BAND ----
  // The side panels are fixed-width, so the selection rows have to live in the gap
  // between them and scale to fit. Laying the rows out at a fixed pitch centred on
  // the screen put the outer cards underneath the panels on narrower windows.
  const LEFT_W = 220, RIGHT_W = 230, PANEL_GAP = 20;
  const showPanels = sw >= 860;   // below this the panels would eat the whole screen
  const bandL = showPanels ? 14 + LEFT_W + PANEL_GAP : 20;
  const bandR = showPanels ? sw - 14 - RIGHT_W - PANEL_GAP : sw - 20;
  const bandW = bandR - bandL;
  const bandCx = (bandL + bandR) / 2;

  // ---- CLAN ROW ----
  const clanLabel = text(focusRow === 0 ? '▶ CLAN ◀' : 'CLAN', 14, focusRow === 0 ? COLORS.HUD_GREEN_BRIGHT : 0xaaaaaa);
  clanLabel.anchor.set(0.5); clanLabel.x = bandCx; clanLabel.y = 146;
  container.addChild(clanLabel);

  const clanRow = new PIXI.Container();
  const clanRowW = CLANS.length * 130;
  clanRow.x = bandCx; clanRow.y = 188;
  clanRow.scale.set(Math.min(1, bandW / clanRowW));
  container.addChild(clanRow);

  for (let i = 0; i < CLANS.length; i++) {
    const clan = CLANS[i];
    const box = new PIXI.Container();
    box.x = i * 130 + 65 - clanRowW / 2; box.y = 0;
    box.eventMode = 'static'; box.cursor = 'pointer';

    const cbg = new PIXI.Graphics();
    cbg.roundRect(-52, -28, 104, 64, 6);
    cbg.fill({ color: clan.color, alpha: i === state.game.selectedClan ? 0.8 : 0.25 });
    cbg.stroke({ color: i === state.game.selectedClan ? 0xffffff : clan.color, width: i === state.game.selectedClan ? 3 : 1 });
    box.addChild(cbg);

    const nm = text(clan.name, 10, 0xffffff, { align: 'center', wordWrap: true, wordWrapWidth: 95 });
    nm.anchor.set(0.5); nm.y = -2;
    box.addChild(nm);

    // Each clan fights with a different weapon now, which is worth knowing before
    // you pick who your enemies are going to be.
    const doc = text(clan.loadout.doctrine, 8, 0x000000, { align: 'center', wordWrap: true, wordWrapWidth: 98 });
    doc.anchor.set(0.5, 0); doc.y = 12; doc.alpha = 0.75;
    box.addChild(doc);

    box.on('pointerdown', () => { state.game.selectedClan = i; persist(); showMenu(); });
    clanRow.addChild(box);
  }

  // ---- TANK ROW ----
  const tankLabel = text(focusRow === 1 ? '▶ TANK ◀' : 'TANK', 14, focusRow === 1 ? COLORS.HUD_GREEN_BRIGHT : 0xaaaaaa);
  tankLabel.anchor.set(0.5); tankLabel.x = bandCx; tankLabel.y = 240;
  container.addChild(tankLabel);

  // Cards are authored at a fixed 170x210 pitch and the whole row is then scaled
  // to fit both the horizontal band and the space above the DEPLOY button.
  const tankRow = new PIXI.Container();
  const tankRowW = TANK_MODELS.length * 170;
  const TANK_ROW_TOP = 272, TANK_ROW_H = 210;
  const tankScale = Math.min(1, bandW / tankRowW, (sh - 88 - TANK_ROW_TOP) / TANK_ROW_H);
  tankRow.x = bandCx;
  tankRow.y = TANK_ROW_TOP + 100 * tankScale;
  tankRow.scale.set(tankScale);
  container.addChild(tankRow);

  for (let i = 0; i < TANK_MODELS.length; i++) {
    const model = TANK_MODELS[i];
    const unlocked = isModelUnlocked(model);
    const box = new PIXI.Container();
    box.x = i * 170 + 85 - tankRowW / 2; box.y = 0;
    box.eventMode = 'static'; box.cursor = unlocked ? 'pointer' : 'default';

    const tbg = new PIXI.Graphics();
    tbg.roundRect(-72, -100, 144, 210, 6);
    tbg.fill({ color: COLORS.HUD_PANEL, alpha: unlocked ? 0.9 : 0.55 });
    tbg.stroke({
      color: !unlocked ? 0x444444 : (i === state.game.selectedTank ? 0xffcc44 : COLORS.HUD_BORDER),
      width: unlocked && i === state.game.selectedTank ? 3 : 1,
    });
    box.addChild(tbg);

    const nm = text(model.name, 14, unlocked ? 0xffcc44 : 0x776644, { fontWeight: 'bold' });
    nm.anchor.set(0.5); nm.y = -82;
    box.addChild(nm);

    const desc = text(model.desc, 10, unlocked ? 0x88aa88 : 0x556655);
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

    // Hull + barrel, same two sprites the real tank is built from. Without the
    // barrel the preview reads as a canister rather than a tank.
    // y/scale keep the whole sprite — barrel included — clear of the stat bars,
    // which end at y = 22. Both numbers had to come down when the hull got
    // longer and the gun got its full reference length: at the old 68/1.1 the
    // muzzle finished up on top of the stat rows.
    const preview = new PIXI.Container();
    preview.y = 76; preview.scale.set(0.85);
    const hull = new PIXI.Sprite(getTexture(
      tankTextureKey(CLANS[state.game.selectedClan].hull, model.scale, model.chassis)));
    hull.anchor.set(0.5);
    const barrel = new PIXI.Sprite(getTexture('turret'));
    barrel.anchor.set(0.5, 0.8);
    barrel.scale.set(model.scale);       // matches how createTank mounts it
    preview.addChild(hull); preview.addChild(barrel);
    if (!unlocked) preview.alpha = 0.25;
    box.addChild(preview);

    // Locked hulls stay on the screen rather than being hidden: seeing what the
    // Forge is and what it costs is the reason to keep climbing.
    if (!unlocked) {
      const veil = new PIXI.Graphics();
      veil.roundRect(-72, -100, 144, 210, 6);
      veil.fill({ color: 0x000000, alpha: 0.45 });
      box.addChild(veil);
      const lock = text(`LOCKED\n${RANKS[model.reqRank].name.toUpperCase()}`, 11, 0xffaa44,
        { fontWeight: 'bold', align: 'center', lineHeight: 15 });
      lock.anchor.set(0.5); lock.y = 34;
      box.addChild(lock);
      const req = text(`${RANKS[model.reqRank].xp} XP`, 9, 0x998866);
      req.anchor.set(0.5); req.y = 60;
      box.addChild(req);
    }

    box.on('pointerdown', () => {
      if (!unlocked) return;
      state.game.selectedTank = i; persist(); showMenu();
    });
    tankRow.addChild(box);
  }

  // ---- SIDE PANELS ----
  if (!showPanels) {
    buildDeployButton(container, sw, sh);
    return;
  }
  const leftPanel = new PIXI.Graphics();
  panel(leftPanel, 14, 144, LEFT_W, 290);
  container.addChild(leftPanel);
  const hotkeys = text([
    'CONTROLS', '',
    'WASD        Move tank',
    'Mouse       Aim turret',
    'Click/Space Fire weapon',
    '1-6 / Wheel Select weapon',
    'E (HOLD)    Drill a deposit',
    'U           Service record',
    'Tab (hold)  Theatre map',
    'Esc         Pause', '',
    'WEAPONS', '',
    '1 Cannon    Baseline shell',
    '2 H.E.A.T.  Heaviest, rare',
    '3 Ricochet  Bounces, plentiful',
    '4 Homing    Slow seeker',
    '5 Mine      Area denial',
    '6 EM Pulse  Disabling burst',
  ].join('\n'), 10, 0x88aa88, { lineHeight: 14 });
  hotkeys.x = 26; hotkeys.y = 156;
  container.addChild(hotkeys);

  const rightPanel = new PIXI.Graphics();
  panel(rightPanel, sw - 14 - RIGHT_W, 144, RIGHT_W, 290);
  container.addChild(rightPanel);
  const info = text([
    'FIELD MANUAL', '',
    'HOLD E on disturbed sand to',
    'drill. You must stay still,',
    'and drilling is LOUD — every',
    'hostile nearby will come.',
    'Rich veins pay far more and',
    'shout far further.', '',
    'Fuel goes straight in the',
    'tank. Materials are CARGO:',
    'haul them to your depot to',
    'bank them as ammo. Die and',
    'you drop most of the load.', '',
    'Rank up: kills, banking,',
    'survival. Each promotion is',
    'an upgrade point you spend.',
  ].join('\n'), 10, 0x88aa88, { lineHeight: 14 });
  info.x = sw - 8 - RIGHT_W; info.y = 156;
  container.addChild(info);

  buildDeployButton(container, sw, sh);
}

function buildDeployButton(parent, sw, sh) {
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
  parent.addChild(deployBtn);
}

export function hideMenu() {
  container.visible = false;
}
