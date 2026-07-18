// Versioned localStorage persistence: xp, last clan/tank, mute.

import { SAVE_KEY } from './config.js';

const DEFAULTS = { v: 1, xp: 0, clan: 0, tank: 0, muted: false };

let data = load();
let saveTimer = null;

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    if (parsed.v !== 1) return { ...DEFAULTS };
    return {
      ...DEFAULTS,
      xp: Number.isFinite(parsed.xp) ? Math.max(0, parsed.xp) : 0,
      clan: [0, 1, 2, 3].includes(parsed.clan) ? parsed.clan : 0,
      tank: [0, 1, 2, 3].includes(parsed.tank) ? parsed.tank : 0,
      muted: !!parsed.muted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function write() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage full/blocked */ }
}

export function get(key) { return data[key]; }

export function set(key, value) {
  data[key] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 1000);
}

window.addEventListener('beforeunload', write);
