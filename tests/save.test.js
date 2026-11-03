import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSaveData,
  hydrateSaveData,
  SAVE_VERSION,
  validateSaveData,
} from '../src/core/saveState.js';
import { createQuestState, questReducer, STAGES } from '../src/gameplay/questState.js';
import { createPowerState, unlockPowers } from '../src/gameplay/powerState.js';
import { CAMERA_MODES } from '../src/player/cameraLogic.js';

function makeSnapshot() {
  let quest = createQuestState();
  quest = questReducer(quest, { type: 'talk', npc: 'wisp' }).state;
  quest = questReducer(quest, { type: 'talk', npc: 'sable' }).state;
  quest = questReducer(quest, { type: 'collect-shard', id: 'grove' }).state;
  quest.kills = 4;
  const powers = createPowerState();
  unlockPowers(powers, 'grove');
  return {
    quest,
    powers,
    player: { x: 12, y: 8, z: -4, yaw: 1.2 },
    world: { timeOfDay: 9.5 },
    camera: { mode: CAMERA_MODES.FIRST },
    stats: { note: 'test' },
  };
}

test('save data round-trips through validation and hydration', () => {
  const data = createSaveData(makeSnapshot());
  assert.equal(data.version, SAVE_VERSION);
  const result = validateSaveData(data);
  assert.equal(result.ok, true);
  const live = hydrateSaveData(result.data);
  assert.equal(live.quest.stage, STAGES.SHARDS);
  assert.deepEqual(live.quest.shards, ['grove']);
  assert.ok(live.powers.unlocked.includes('frostNova'));
  assert.equal(live.player.x, 12);
  assert.equal(live.camera.mode, CAMERA_MODES.FIRST);
  assert.equal(live.world.timeOfDay, 9.5);
});

test('wrong version is rejected', () => {
  const data = createSaveData(makeSnapshot());
  data.version = 999;
  assert.equal(validateSaveData(data).ok, false);
});

test('missing player is rejected', () => {
  const data = createSaveData(makeSnapshot());
  delete data.player;
  assert.equal(validateSaveData(data).ok, false);
});

test('non-finite position is rejected', () => {
  const data = createSaveData(makeSnapshot());
  data.player.x = Number.NaN;
  assert.equal(validateSaveData(data).ok, false);
});

test('unknown shard ids are rejected', () => {
  const data = createSaveData(makeSnapshot());
  data.quest.shards = ['moon'];
  assert.equal(validateSaveData(data).ok, false);
});

test('out-of-bounds positions are rejected', () => {
  const data = createSaveData(makeSnapshot());
  data.player.x = 99999;
  assert.equal(validateSaveData(data).ok, false);
});

test('unknown camera mode is rejected', () => {
  const data = createSaveData(makeSnapshot());
  data.camera.mode = 'sideways';
  assert.equal(validateSaveData(data).ok, false);
});

test('corrupt JSON is rejected by the loader', async () => {
  const { loadSave } = await import('../src/core/saveState.js');
  const storage = {
    getItem() {
      return '{not json';
    },
  };
  assert.equal(loadSave(storage), null);
});

test('valid storage payload loads', async () => {
  const { loadSave, SAVE_KEY } = await import('../src/core/saveState.js');
  const data = createSaveData(makeSnapshot());
  const storage = {
    getItem(key) {
      return key === SAVE_KEY ? JSON.stringify(data) : null;
    },
  };
  const live = loadSave(storage);
  assert.ok(live);
  assert.equal(live.quest.stage, STAGES.SHARDS);
});
