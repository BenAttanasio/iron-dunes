// Tiny pub/sub. Gameplay code emits; audio/HUD/progression subscribe,
// so those systems are never imported by gameplay modules.
//
// Event names used across the game:
//   'shot-fired'   {tank, weapon}
//   'explosion'    {x, y, big}
//   'kill'         {victim, killer}
//   'player-hit'   {damage}
//   'player-died'  {}
//   'player-respawned' {}
//   'dig'          {node}         — collected some resources
//   'discover'     {node}         — uncovered a node
//   'pickup'       {type, amount}
//   'emp'          {tank}
//   'low-fuel'     {}
//   'mine-planted' {}
//   'mine-armed'   {}
//   'ricochet'     {x, y}
//   'xp-gained'    {amount, total}
//   'xp-lost'      {amount}
//   'rank-up'      {rank}
//   'wave-spawned' {clan, count}
//   'message'      {text, color?}
//   'pause-toggle' {}

const handlers = new Map();

export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
}

export function emit(name, payload) {
  const list = handlers.get(name);
  if (!list) return;
  for (const fn of list) fn(payload);
}
