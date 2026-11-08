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

/**
 * Pre-finale gauntlet: two optional-then-required missions that must be
 * completed while returning to the Beacon, before the altar may open the boss.
 * The first mission asks the player to prove themselves at camp; the second
 * waves two short hunts after all shards are in hand. Completion is tracked
 * per-mission below and re-used in STAGES.RETURN objectives.
 */
export const MISSIONS = Object.freeze({
  emberTrial: Object.freeze({
    id: 'emberTrial',
    name: 'Trial of Embers',
    target: 3,
    reward: Object.freeze({ maxHealthBonus: 12 }),
  }),
  veilHunt: Object.freeze({
    id: 'veilHunt',
    name: 'The Turning Veil',
    target: 5,
    reward: Object.freeze({ maxManaBonus: 12 }),
  }),
});

export const SIDE_QUEST = Object.freeze({
  id: 'lanternWay',
  name: "The Lantern's Way",
  target: 8,
  reward: Object.freeze({ maxStaminaBonus: 10 }),
});

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
    /** Progress counters for the pre-finale missions. */
    missions: {
      emberTrial: 0,
      veilHunt: 0,
    },
    /** Progress for the side quest (survives the whole run). */
    sideQuest: {
      lanternWay: 0,
    },
  };
}

/** Cumulative foes felled since the start of the run. */
export function totalKills(state) {
  return state.kills ?? 0;
}

/** Is a mission complete? */
export function missionDone(state, missionId) {
  const mission = MISSIONS[missionId];
  if (!mission) return false;
  return (state.missions?.[missionId] ?? 0) >= mission.target;
}

/** Is the side quest complete? */
export function sideQuestDone(state) {
  return (state.sideQuest?.lanternWay ?? 0) >= SIDE_QUEST.target;
}

/** Mission names in display order. */
export function missionList(state) {
  return Object.values(MISSIONS).map((m) => ({
    id: m.id,
    name: m.name,
    progress: Math.min(state.missions?.[m.id] ?? 0, m.target),
    target: m.target,
    done: missionDone(state, m.id),
  }));
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
 *  - `{ type: 'enemy-killed' }` — ambient progress for missions / side quest
 *  - `{ type: 'interact-altar' }`
 *  - `{ type: 'finale-complete' }`
 *
 * @returns {{state:object, changed:boolean, effects:Array<object>}}
 */
export function questReducer(state, event) {
  const next = {
    ...state,
    shards: [...state.shards],
    missions: { ...(state.missions ?? {}) },
    sideQuest: { ...(state.sideQuest ?? {}) },
  };
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
        effects.push({ type: 'toast', text: 'All shards recovered — finish the trials near Emberfall Camp.' });
      } else {
        effects.push({ type: 'objective' });
      }
      break;
    }

    case 'enemy-killed': {
      // No stage gate: progress always counts, but only towards the missions
      // that are open right now. This keeps the gauntlet honest without
      // punishing players who fought before the quest asked them to.
      next.kills = (next.kills ?? 0) + 1;
      changed = true;

      const track = (missionId) => {
        const mission = MISSIONS[missionId];
        const current = next.missions[missionId] ?? 0;
        if (current >= mission.target) return;
        next.missions[missionId] = current + 1;
        if (next.missions[missionId] >= mission.target) {
          effects.push({ type: 'mission-complete', missionId });
        }
      };

      // Strictly sequential gauntlet: the Trial of Embers must be finished
      // before the Turning Veil even accepts kills (user-required step-by-step
      // progression — no parallel completion).
      const emberDone = (next.missions.emberTrial ?? 0) >= MISSIONS.emberTrial.target;
      if (!emberDone) {
        if (
          next.stage === STAGES.SHARDS ||
          next.stage === STAGES.RETURN ||
          next.stage === STAGES.FINALE
        ) {
          track('emberTrial');
        }
      } else if (next.stage === STAGES.RETURN || next.stage === STAGES.FINALE) {
        // Veil hunt opens only after the trial is done (and shards returned).
        track('veilHunt');
      }
      // NOTE: the Lantern Way is NOT kill-driven — lanterns are woken in
      // the world (Game._wakeLantern). Kills previously inflated it too.
      effects.push({ type: 'counter' });
      break;
    }

    case 'interact-altar': {
      if (next.stage !== STAGES.RETURN || !hasAllShards(next)) break;
      // The gauntlet: the altar will not open until both missions are done.
      const open = missionList(next).filter((m) => !m.done);
      if (open.length > 0) {
        effects.push({
          type: 'toast',
          text: `The Beacon stirs, but ${open.map((m) => m.name).join(' and ')} remain unfinished.`,
        });
        break;
      }
      next.stage = STAGES.FINALE;
      changed = true;
      effects.push({ type: 'finale' });
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
    case STAGES.SHARDS: {
      const trial = state.missions?.emberTrial ?? 0;
      const trialTarget = MISSIONS.emberTrial.target;
      const trialDone = trial >= trialTarget;
      const lantern = state.sideQuest?.lanternWay ?? 0;
      const lanternDone = lantern >= SIDE_QUEST.target;
      return {
        title: 'Recover the Aether Shards',
        hint: trialDone
          ? 'Trial of Embers complete — the Turning Veil awaits after the shards.'
          : `Defeat the Wardens and claim the shards. Trial of Embers: ${trial} / ${trialTarget} felled.`,
        marker: nextShardLocation(state)?.id ?? null,
        progress: `${state.shards.length} / ${LOCATIONS.shards.length} · Trial ${trialDone ? '✓' : `${trial}/${trialTarget}`} · Veil 🔒${lanternDone ? '' : ` · Lantern ${lantern}/${SIDE_QUEST.target}`}`,
      };
    }
    case STAGES.RETURN: {
      const open = missionList(state).filter((m) => !m.done);
      if (open.length > 0) {
        // Sequential: only the current mission is named — the next does
        // not exist for the player until this one is done.
        const m = open[0];
        return {
          title: m.name,
          hint: m.id === 'veilHunt'
            ? `Hunt the Veil creatures gathering around Emberfall Camp — ${m.progress} / ${m.target} felled.`
            : `Defeat Veil creatures near Emberfall Camp to complete the trial — ${m.progress} / ${m.target} felled.`,
          marker: 'camp',
          progress: `${m.progress} / ${m.target}`,
        };
      }
      return {
        title: 'Relight the Beacon',
        hint: 'Both trials complete — carry the shards to the Beacon of Aether.',
        marker: 'temple',
        progress: '3 / 3 · Trial ✓ · Veil ✓ · Boss unlocked',
      };
    }
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
    missions: { ...(state.missions ?? {}) },
    sideQuest: { ...(state.sideQuest ?? {}) },
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
  if (data.missions && typeof data.missions === 'object') {
    for (const id of Object.keys(MISSIONS)) {
      const value = data.missions[id];
      if (Number.isFinite(value)) {
        state.missions[id] = Math.max(0, Math.min(MISSIONS[id].target, Math.floor(value)));
      }
    }
  }
  if (data.sideQuest && typeof data.sideQuest === 'object') {
    const value = data.sideQuest.lanternWay;
    if (Number.isFinite(value)) {
      state.sideQuest.lanternWay = Math.max(0, Math.min(SIDE_QUEST.target, Math.floor(value)));
    }
  }
  return state;
}
