// Keyboard/mouse input. Keys clear on window blur (no stuck movement
// after alt-tab); Esc emits pause-toggle; E is a one-shot dig latch.

import * as state from './state.js';
import { emit } from './events.js';

export function initInput(canvas) {
  window.addEventListener('keydown', e => {
    const k = e.key;
    state.input.keys[k.toLowerCase()] = true;
    if (state.game.mode === 'playing') {
      if (k >= '1' && k <= '6') {
        const p = state.player();
        if (p) p.weaponIndex = parseInt(k, 10) - 1;
      }
      if (k.toLowerCase() === 'e') state.input.digPressed = true;
    }
    if (k === 'Escape' && (state.game.mode === 'playing' || state.game.mode === 'paused')) {
      emit('pause-toggle', {});
    }
  });

  window.addEventListener('keyup', e => {
    state.input.keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener('blur', () => {
    for (const k in state.input.keys) state.input.keys[k] = false;
    state.input.mouseDown = false;
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
    p.weaponIndex = (p.weaponIndex + dir + 6) % 6;
    e.preventDefault();
  }, { passive: false });
}
