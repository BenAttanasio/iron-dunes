// Versioned localStorage persistence: xp, spent upgrade points, career records,
// last clan/tank, mute.
//
// Schema v2 adds `upgrades` (points sunk per track), `spent`/`pending` point
// bookkeeping, and `records` (the Hall of Records). A v1 save migrates rather than
// resetting — the XP climb is the one thing nobody should lose.

import { SAVE_KEY } from './config.js';

// clan 3 = Blue Tide. Its teal hull is the one sampled straight out of the
// reference screenshot, so a fresh install opens looking like the original.
const DEFAULTS = {
  v: 2,
  xp: 0, clan: 3, tank: 0, muted: false,
  upgrades: {},      // { modelId: { trackId: pointsSpent } } — one sheet per hull
  records: {},       // see records.js
};

let data = load();
let saveTimer = null;

// Upgrades are nested one level: model id -> track id -> points. Anything that
// isn't a positive finite number is dropped rather than trusted, because this is
// user-editable storage and the values feed straight into stat maths.
function sanitizeUpgrades(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [modelId, sheet] of Object.entries(raw)) {
    if (!/^\d+$/.test(modelId) || !sheet || typeof sheet !== 'object') continue;
    const clean = {};
    for (const [track, v] of Object.entries(sheet)) {
      if (typeof track === 'string' && Number.isFinite(v) && v > 0) clean[track] = Math.floor(v);
    }
    if (Object.keys(clean).length) out[modelId] = clean;
  }
  return out;
}

function sanitizeRecords(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === 'string' && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // v1 had no upgrades/records; everything it did have still applies, so it
    // falls through the same reader and just picks up the new defaults.
    if (parsed.v !== 1 && parsed.v !== 2) return { ...DEFAULTS };
    return {
      ...DEFAULTS,
      xp: Number.isFinite(parsed.xp) ? Math.max(0, parsed.xp) : 0,
      clan: [0, 1, 2, 3].includes(parsed.clan) ? parsed.clan : DEFAULTS.clan,
      tank: [0, 1, 2, 3].includes(parsed.tank) ? parsed.tank : DEFAULTS.tank,
      muted: !!parsed.muted,
      upgrades: sanitizeUpgrades(parsed.upgrades),
      records: sanitizeRecords(parsed.records),
      v: 2,
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

// Force an immediate flush. Used when the player spends a point — losing that to a
// tab close would be the one edit they'd actually notice.
export function flush() {
  clearTimeout(saveTimer);
  write();
}

window.addEventListener('beforeunload', write);
