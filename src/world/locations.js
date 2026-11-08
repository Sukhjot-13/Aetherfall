/**
 * Canonical world layout: island dimensions, points of interest and the
 * flattening zones that make structures sit on level ground. Pure data — no
 * rendering dependencies — so gameplay, minimap and tests can share it.
 */

export const WORLD = Object.freeze({
  /** Full square size of the terrain mesh, in metres. 2026-11-03: ~39× the
   *  original area (1700 → 10600 m side, radius 560 → 3380 m). */
  size: 10600,
  /** Nominal land radius before the coastline falloff. */
  islandRadius: 3380,
  /** Ocean surface height. */
  waterLevel: 0,
  /** Terrain grid resolution (segments per axis). */
  terrainSegments: 256,
  /** Master world seed. */
  seed: 20261026,
  /** Length of a full day/night cycle in seconds. */
  dayLength: 420,
  /** Start time, in decimal hours. */
  startHour: 8.4,
  /** Playable land radius. 2026-11-03: 2900 m keeps a safe water margin
   *  inside the 3380 m nominal radius. */
  walkEdge: 3120,
  /** Multiplicative area vs the original 1700 m island: (10600/1700)^2 ≈ 39×. */
  areaMultiple: 39,
});

/** Safe, well-inside-the-island walk limit (see WORLD.walkEdge). */
export const WALK_EDGE = WORLD.walkEdge ?? 3120;

/** Points of interest. `radius` is the flattened clearing around each one. */
export const LOCATIONS = Object.freeze({
  spawn: Object.freeze({
    id: 'spawn',
    name: "Wayfarer's Shore",
    x: 58,
    z: 430,
    radius: 30,
    targetHeight: null,
  }),
  camp: Object.freeze({
    id: 'camp',
    name: 'Emberfall Camp',
    x: 132,
    z: 286,
    radius: 28,
    targetHeight: null,
  }),
  temple: Object.freeze({
    id: 'temple',
    name: 'Beacon of Aether',
    x: 0,
    z: -332,
    radius: 56,
    targetHeight: null,
  }),
  shards: Object.freeze([
    Object.freeze({
      id: 'grove',
      name: 'Whisperwood Grove',
      x: -268,
      z: 118,
      radius: 22,
      targetHeight: null,
      color: '#6ff2c8',
      accent: '#2f8f78',
    }),
    Object.freeze({
      id: 'ruins',
      name: 'Tidewreck Ruins',
      x: 304,
      z: 44,
      radius: 24,
      targetHeight: null,
      color: '#8fc8ff',
      accent: '#2c5f8f',
    }),
    Object.freeze({
      id: 'peak',
      name: 'Stormpeak Shrine',
      x: -280,
      z: -260,
      radius: 24,
      targetHeight: null,
      color: '#c6a8ff',
      accent: '#5a3f8f',
    }),
  ]),
  /** Expanded-world frontier: new regions so the ~39× larger island is
   *  worth crossing. Existing core layout is untouched for save compat. */
  frontier: Object.freeze([
    Object.freeze({
      id: 'aetherMine',
      name: 'Aether Mine',
      // 2026-11-03: relocated from (-1020,-690) — raw height 98.6 m put the
      // timber frame in the snow biome (>82 m). The new south-west lowland
      // sits at ~26 m in grass with a gentle approach.
      x: -1020,
      z: 620,
      radius: 46,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'emberCastle',
      name: 'Embercastle',
      x: 1070,
      z: -810,
      radius: 88,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'saltVillage',
      name: 'Saltmere Village',
      x: 1340,
      z: 700,
      radius: 62,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'sunkenCrypt',
      name: 'Sunken Crypt',
      x: -1290,
      z: 850,
      radius: 52,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'skyTemple',
      name: 'Sky-Thread Temple',
      x: 350,
      z: -1940,
      radius: 70,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'glassHollow',
      name: 'Glasshollow',
      x: -1750,
      z: -420,
      radius: 54,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'emberWastes',
      name: 'The Ember Wastes',
      x: 1750,
      z: 350,
      radius: 64,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'moonlitDocks',
      name: 'Moonlit Docks',
      x: 450,
      z: 1950,
      radius: 56,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'stormSpire',
      name: 'Stormspire',
      x: -350,
      z: -2280,
      radius: 60,
      targetHeight: null,
    }),
    Object.freeze({
      id: 'frostFjord',
      name: 'Frostfjord',
      x: 1950,
      z: -1250,
      radius: 58,
      targetHeight: null,
    }),
  ]),
});

/** Convenience lookup: shard id -> location. */
export const SHARD_LOCATIONS = Object.freeze(
  Object.fromEntries(LOCATIONS.shards.map((s) => [s.id, s])),
);

/**
 * Flattening zones applied after the raw height function. A zone forces the
 * ground toward `targetHeight` inside `inner` metres and blends out to
 * `radius`. `targetHeight: null` means "use the raw height at the centre".
 */
export const FLATTEN_ZONES = Object.freeze([
  Object.freeze({
    id: 'spawn',
    x: LOCATIONS.spawn.x,
    z: LOCATIONS.spawn.z,
    radius: LOCATIONS.spawn.radius,
    inner: 0.5,
    targetHeight: LOCATIONS.spawn.targetHeight,
  }),
  Object.freeze({
    id: 'camp',
    x: LOCATIONS.camp.x,
    z: LOCATIONS.camp.z,
    radius: LOCATIONS.camp.radius,
    inner: 0.58,
    targetHeight: LOCATIONS.camp.targetHeight,
  }),
  Object.freeze({
    id: 'temple',
    x: LOCATIONS.temple.x,
    z: LOCATIONS.temple.z,
    radius: LOCATIONS.temple.radius,
    inner: 0.62,
    targetHeight: LOCATIONS.temple.targetHeight,
  }),
  ...LOCATIONS.shards.map((s) =>
    Object.freeze({
      id: s.id,
      x: s.x,
      z: s.z,
      radius: s.radius,
      inner: 0.55,
      targetHeight: s.targetHeight,
    }),
  ),
  ...LOCATIONS.frontier.map((s) =>
    Object.freeze({
      id: s.id,
      x: s.x,
      z: s.z,
      radius: s.radius,
      inner: 0.55,
      targetHeight: s.targetHeight,
    }),
  ),
]);

/** Every named place, including shard sites, for minimap + objectives. */
export const POI_LIST = Object.freeze([
  Object.freeze({ ...LOCATIONS.spawn, kind: 'spawn' }),
  Object.freeze({ ...LOCATIONS.camp, kind: 'camp' }),
  Object.freeze({ ...LOCATIONS.temple, kind: 'temple' }),
  ...LOCATIONS.shards.map((s) => Object.freeze({ ...s, kind: 'shard' })),
  ...LOCATIONS.frontier.map((s) => Object.freeze({ ...s, kind: 'frontier' })),
]);

/** Convenience lookup: frontier id -> location. */
export const FRONTIER_LOCATIONS = Object.freeze(
  Object.fromEntries(LOCATIONS.frontier.map((s) => [s.id, s])),
);

  /** Human-readable name for an arbitrary world position, used by the HUD. */
export function regionNameAt(x, z, locations = LOCATIONS) {
  const all = [locations.spawn, locations.camp, locations.temple, ...(locations.frontier ?? []), ...locations.shards];
  let best = null;
  let bestDist = Infinity;
  for (const loc of all) {
    const d = Math.hypot(x - loc.x, z - loc.z);
    if (d < (loc.radius ?? 30) * 1.6 && d < bestDist) {
      best = loc;
      bestDist = d;
    }
  }
  if (best) return best.name;
  const radial = Math.hypot(x, z) / (WORLD.islandRadius * 0.92);
  if (radial < 0.28) return 'The Heartland';
  if (radial < 0.55) return 'The Green Reach';
  if (radial < 0.78) return 'The Outer Wilds';
  return 'The Sundered Coast';
}
