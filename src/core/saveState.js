/**
 * Save-file rules. Versioned, validated and fail-closed: a corrupt or
 * future-version save is rejected rather than partially applied.
 */

import { CAMERA_MODES } from '../player/cameraLogic.js';
import { STAGE_ORDER } from '../gameplay/questState.js';
import { SHARD_LOCATIONS, WORLD } from '../world/locations.js';
import { deserializeQuest, serializeQuest } from '../gameplay/questState.js';
import { deserializePowers, serializePowers } from '../gameplay/powerState.js';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'aetherfall.save.v1';
export const SETTINGS_KEY = 'aetherfall.settings.v1';

/**
 * Build a complete save payload from live game state.
 * @param {{quest:object, powers:object, player:{x:number,y:number,z:number,yaw:number}, world:{timeOfDay:number}, camera:{mode:string}, stats?:object}} snapshot
 */
export function createSaveData(snapshot) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    quest: serializeQuest(snapshot.quest),
    powers: serializePowers(snapshot.powers),
    player: {
      x: snapshot.player.x,
      y: snapshot.player.y,
      z: snapshot.player.z,
      yaw: snapshot.player.yaw,
    },
    world: {
      timeOfDay: snapshot.world.timeOfDay,
    },
    camera: {
      mode: snapshot.camera.mode,
    },
    stats: snapshot.stats ?? {},
  };
}

/**
 * Validate an untrusted save payload.
 * @returns {{ok:true, data:object} | {ok:false, reason:string}}
 */
export function validateSaveData(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'missing' };
  if (raw.version !== SAVE_VERSION) return { ok: false, reason: 'version' };
  if (!raw.player || typeof raw.player !== 'object') return { ok: false, reason: 'player' };
  const { x, y, z, yaw } = raw.player;
  if (![x, y, z, yaw].every((n) => Number.isFinite(n))) return { ok: false, reason: 'player' };
  if (!raw.quest || !STAGE_ORDER.includes(raw.quest.stage)) return { ok: false, reason: 'quest' };
  if (!Array.isArray(raw.quest.shards)) return { ok: false, reason: 'quest' };
  if (!raw.quest.shards.every((id) => Boolean(SHARD_LOCATIONS[id]))) {
    return { ok: false, reason: 'quest' };
  }
  if (Math.hypot(x, z) > WORLD.islandRadius * 2.2) return { ok: false, reason: 'bounds' };
  if (y < -50 || y > 400) return { ok: false, reason: 'bounds' };
  if (!Number.isFinite(raw.world?.timeOfDay)) return { ok: false, reason: 'world' };
  const mode = raw.camera?.mode;
  if (mode !== CAMERA_MODES.FIRST && mode !== CAMERA_MODES.THIRD) {
    return { ok: false, reason: 'camera' };
  }
  return { ok: true, data: raw };
}

/** Rebuild live state from a validated payload. */
export function hydrateSaveData(data) {
  return {
    quest: deserializeQuest(data.quest),
    powers: deserializePowers(data.powers),
    player: {
      x: data.player.x,
      y: data.player.y,
      z: data.player.z,
      yaw: data.player.yaw,
    },
    world: {
      timeOfDay: ((data.world.timeOfDay % 24) + 24) % 24,
    },
    camera: {
      mode: data.camera.mode,
    },
    stats: data.stats ?? {},
  };
}

/** localStorage read with corrupt-data protection. */
export function loadSave(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const result = validateSaveData(parsed);
    return result.ok ? hydrateSaveData(result.data) : null;
  } catch {
    return null;
  }
}

/** localStorage write. Returns true when the save was stored. */
export function writeSave(snapshot, storage = globalThis.localStorage) {
  try {
    const data = createSaveData(snapshot);
    storage?.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Remove the save slot. */
export function clearSave(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
