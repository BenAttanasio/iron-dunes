// Keyboard/mouse input. Keys clear on window blur (no stuck movement
// after alt-tab); Esc emits pause-toggle; E is a one-shot dig latch.

import * as state from './state.js';
import { emit } from './events.js';

function selectWeapon(i) {
  const p = state.player();
  if (!p || i === p.weaponIndex) return;
  p.weaponIndex = i;
  emit('weapon-switch', { index: i });
}

export function initInput(canvas) {
  window.addEventListener('keydown', e => {
    const k = e.key;
    const lower = k.toLowerCase();
    state.input.keys[lower] = true;
    if (state.game.mode === 'playing') {
      if (k >= '1' && k <= '6') selectWeapon(parseInt(k, 10) - 1);
      // E is HELD now, not tapped: drilling is a channel you have to sit through.
      if (lower === 'e') state.input.digHeld = true;
      if (lower === 'u') emit('open-service-record', {});
      if (k === 'Tab') { state.input.mapOpen = true; e.preventDefault(); }
    } else if (state.game.mode === 'paused' && lower === 'u') {
      emit('open-service-record', {});
    }
    if (k === 'Escape') {
      // Esc backs out of the service record first, then toggles pause.
      emit('escape', {});
    }
  });

  window.addEventListener('keyup', e => {
    const lower = e.key.toLowerCase();
    state.input.keys[lower] = false;
    if (lower === 'e') state.input.digHeld = false;
    if (e.key === 'Tab') state.input.mapOpen = false;
  });

  window.addEventListener('blur', () => {
    for (const k in state.input.keys) state.input.keys[k] = false;
    state.input.mouseDown = false;
    state.input.mapOpen = false;
    state.input.digHeld = false;
    if (state.game.mode === 'playing') emit('pause-toggle', {});
  });

  window.addEventListener('mousemove', e => {
    state.input.mouseX = e.clientX;
    state.input.mouseY = e.clientY;
  });
  canvas.addEventListener('mousedown', () => { state.input.mouseDown = true; });
  window.addEventListener('mouseup', () => { state.input.mouseDown = false; });

  // Mouse wheel cycles weapons
  canvas.addEventListener('wheel', e => {
    if (state.game.mode !== 'playing') return;
    const p = state.player();
    if (!p) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    selectWeapon((p.weaponIndex + dir + 6) % 6);
    e.preventDefault();
  }, { passive: false });
}
