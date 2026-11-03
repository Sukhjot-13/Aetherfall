/**
 * The story's quest state machine. Pure reducer so progression is testable and
 * cannot be advanced by UI-only tricks.
 */

import { LOCATIONS, SHARD_LOCATIONS } from '../world/locations.js';

export const STAGES = Object.freeze({
  AWAKEN: 'awaken',
  MEET_SABLE: 'meet-sable',
  SHARDS: 'shards',
  RETURN: 'return',
  FINALE: 'finale',
  FREE: 'free',
});

export const STAGE_ORDER = Object.freeze([
  STAGES.AWAKEN,
  STAGES.MEET_SABLE,
  STAGES.SHARDS,
  STAGES.RETURN,
  STAGES.FINALE,
  STAGES.FREE,
]);

/** Fresh quest state at the beginning of the game. */
export function createQuestState() {
  return {
    stage: STAGES.AWAKEN,
    /** @type {string[]} collected shard ids */
    shards: [],
    sableMet: false,
    beaconRestored: false,
    /** Seconds of play, filled by the game loop. */
    playSeconds: 0,
    kills: 0,
    deaths: 0,
  };
}

/** Number of collected shards. */
export function shardCount(state) {
  return state.shards.length;
}

/** All three shards recovered? */
export function hasAllShards(state) {
  return state.shards.length >= LOCATIONS.shards.length;
}

/**
 * The next uncollected shard location, or null.
 * @returns {typeof LOCATIONS.shards[number] | null}
 */
export function nextShardLocation(state) {
  for (const shard of LOCATIONS.shards) {
    if (!state.shards.includes(shard.id)) return shard;
  }
  return null;
}

/**
 * Apply a quest event.
 *
 * Events:
 *  - `{ type: 'talk', npc: 'wisp' | 'sable' }`
 *  - `{ type: 'collect-shard', id }`
 *  - `{ type: 'interact-altar' }`
 *  - `{ type: 'finale-complete' }`
 *
 * @returns {{state:object, changed:boolean, effects:Array<object>}}
 */
export function questReducer(state, event) {
  const next = { ...state, shards: [...state.shards] };
  const effects = [];
  let changed = false;

  switch (event?.type) {
    case 'talk': {
      if (event.npc === 'wisp' && next.stage === STAGES.AWAKEN) {
        next.stage = STAGES.MEET_SABLE;
        changed = true;
        effects.push({ type: 'objective' });
      } else if (event.npc === 'sable' && next.stage === STAGES.MEET_SABLE) {
        next.stage = STAGES.SHARDS;
        next.sableMet = true;
        changed = true;
        effects.push({ type: 'objective' });
        effects.push({ type: 'toast', text: 'New objective — recover the three Aether Shards' });
      }
      break;
    }

    case 'collect-shard': {
      if (next.stage !== STAGES.SHARDS) break;
      if (!SHARD_LOCATIONS[event.id]) break;
      if (next.shards.includes(event.id)) break;
      next.shards.push(event.id);
      changed = true;
      effects.push({ type: 'unlock', shardId: event.id });
      effects.push({ type: 'shard-collected', shardId: event.id });
      if (hasAllShards(next)) {
        next.stage = STAGES.RETURN;
        effects.push({ type: 'objective' });
        effects.push({ type: 'toast', text: 'All shards recovered — return to the Beacon' });
      } else {
        effects.push({ type: 'objective' });
      }
      break;
    }

    case 'interact-altar': {
      if (next.stage === STAGES.RETURN && hasAllShards(next)) {
        next.stage = STAGES.FINALE;
        changed = true;
        effects.push({ type: 'finale' });
      }
      break;
    }

    case 'finale-complete': {
      if (next.stage === STAGES.FINALE) {
        next.stage = STAGES.FREE;
        next.beaconRestored = true;
        changed = true;
        effects.push({ type: 'beacon-restored' });
        effects.push({ type: 'objective' });
      }
      break;
    }

    default:
      break;
  }

  return { state: next, changed, effects };
}

/**
 * HUD objective for the current stage.
 * @returns {{title:string, hint:string, marker:string|null, progress:string|null}}
 */
export function objectiveFor(state) {
  switch (state.stage) {
    case STAGES.AWAKEN:
      return {
        title: 'Awaken',
        hint: 'Listen to the wisp beside you.',
        marker: null,
        progress: null,
      };
    case STAGES.MEET_SABLE:
      return {
        title: 'Find the Keeper',
        hint: 'Seek Sable at Emberfall Camp.',
        marker: 'camp',
        progress: null,
      };
    case STAGES.SHARDS:
      return {
        title: 'Recover the Aether Shards',
        hint: 'Defeat the Wardens and claim the shards.',
        marker: nextShardLocation(state)?.id ?? null,
        progress: `${state.shards.length} / ${LOCATIONS.shards.length}`,
      };
    case STAGES.RETURN:
      return {
        title: 'Relight the Beacon',
        hint: 'Carry the shards to the Beacon of Aether.',
        marker: 'temple',
        progress: '3 / 3',
      };
    case STAGES.FINALE:
      return {
        title: 'Face the Veil Sovereign',
        hint: 'Vaelor guards the Beacon. Break him.',
        marker: 'temple',
        progress: null,
      };
    case STAGES.FREE:
    default:
      return {
        title: 'The Isle Breathes',
        hint: 'Explore Aetherfall. Its wilds still hold secrets.',
        marker: null,
        progress: null,
      };
  }
}

/** Marker world position for the current objective, if any. */
export function objectiveTarget(state) {
  const objective = objectiveFor(state);
  if (!objective.marker) return null;
  if (objective.marker === 'camp') return LOCATIONS.camp;
  if (objective.marker === 'temple') return LOCATIONS.temple;
  return SHARD_LOCATIONS[objective.marker] ?? null;
}

/** Serialise the durable quest fields. */
export function serializeQuest(state) {
  return {
    stage: state.stage,
    shards: [...state.shards],
    sableMet: state.sableMet,
    beaconRestored: state.beaconRestored,
    playSeconds: state.playSeconds,
    kills: state.kills,
    deaths: state.deaths,
  };
}

/** Rebuild quest state from a save, validating every field. */
export function deserializeQuest(data = {}) {
  const state = createQuestState();
  if (STAGE_ORDER.includes(data.stage)) state.stage = data.stage;
  if (Array.isArray(data.shards)) {
    state.shards = [...new Set(data.shards.filter((id) => Boolean(SHARD_LOCATIONS[id])))];
  }
  state.sableMet = Boolean(data.sableMet) || state.stage !== STAGES.AWAKEN;
  state.beaconRestored = Boolean(data.beaconRestored) || state.stage === STAGES.FREE;
  if (Number.isFinite(data.playSeconds)) state.playSeconds = Math.max(0, data.playSeconds);
  if (Number.isFinite(data.kills)) state.kills = Math.max(0, data.kills);
  if (Number.isFinite(data.deaths)) state.deaths = Math.max(0, data.deaths);
  return state;
}
