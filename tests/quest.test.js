import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createQuestState,
  hasAllShards,
  nextShardLocation,
  objectiveFor,
  questReducer,
  STAGES,
} from '../src/gameplay/questState.js';
import { LOCATIONS } from '../src/world/locations.js';

test('quest starts at awaken with nothing collected', () => {
  const state = createQuestState();
  assert.equal(state.stage, STAGES.AWAKEN);
  assert.deepEqual(state.shards, []);
  assert.equal(hasAllShards(state), false);
});

test('talking to the wisp advances to find Sable', () => {
  const { state, changed } = questReducer(createQuestState(), { type: 'talk', npc: 'wisp' });
  assert.equal(changed, true);
  assert.equal(state.stage, STAGES.MEET_SABLE);
  assert.equal(objectiveFor(state).marker, 'camp');
});

test('cannot skip straight to Sable without the wisp', () => {
  const { state, changed } = questReducer(createQuestState(), { type: 'talk', npc: 'sable' });
  assert.equal(changed, false);
  assert.equal(state.stage, STAGES.AWAKEN);
});

test('full happy path reaches free roam', () => {
  let state = createQuestState();
  state = questReducer(state, { type: 'talk', npc: 'wisp' }).state;
  state = questReducer(state, { type: 'talk', npc: 'sable' }).state;
  assert.equal(state.stage, STAGES.SHARDS);

  for (const shard of LOCATIONS.shards) {
    const result = questReducer(state, { type: 'collect-shard', id: shard.id });
    assert.equal(result.changed, true, `shard ${shard.id} should be collected`);
    assert.ok(result.effects.some((e) => e.type === 'unlock' && e.shardId === shard.id));
    state = result.state;
  }

  assert.equal(state.stage, STAGES.RETURN);
  assert.equal(hasAllShards(state), true);
  assert.equal(objectiveFor(state).marker, 'temple');

  const finale = questReducer(state, { type: 'interact-altar' });
  assert.equal(finale.changed, true);
  assert.equal(finale.state.stage, STAGES.FINALE);
  const finaleObjective = objectiveFor(finale.state);
  assert.equal(finaleObjective.title, 'Face the Veil Sovereign');
  assert.equal(finaleObjective.marker, 'temple');
  assert.match(finaleObjective.hint, /Vaelor/);

  const done = questReducer(finale.state, { type: 'finale-complete' });
  assert.equal(done.state.stage, STAGES.FREE);
  assert.equal(done.state.beaconRestored, true);
  assert.equal(objectiveFor(done.state).title, 'The Isle Breathes');
});

test('duplicate shards are ignored', () => {
  let state = questReducer(createQuestState(), { type: 'talk', npc: 'wisp' }).state;
  state = questReducer(state, { type: 'talk', npc: 'sable' }).state;
  state = questReducer(state, { type: 'collect-shard', id: 'grove' }).state;
  const again = questReducer(state, { type: 'collect-shard', id: 'grove' });
  assert.equal(again.changed, false);
  assert.equal(again.state.shards.length, 1);
});

test('shards cannot be collected before the quest reaches them', () => {
  const state = createQuestState();
  const result = questReducer(state, { type: 'collect-shard', id: 'grove' });
  assert.equal(result.changed, false);
  assert.equal(result.state.shards.length, 0);
});

test('altar cannot be used without all shards', () => {
  let state = questReducer(createQuestState(), { type: 'talk', npc: 'wisp' }).state;
  state = questReducer(state, { type: 'talk', npc: 'sable' }).state;
  state = questReducer(state, { type: 'collect-shard', id: 'grove' }).state;
  const result = questReducer(state, { type: 'interact-altar' });
  assert.equal(result.changed, false);
  assert.equal(result.state.stage, STAGES.SHARDS);
});

test('unknown shard ids are rejected', () => {
  let state = questReducer(createQuestState(), { type: 'talk', npc: 'wisp' }).state;
  state = questReducer(state, { type: 'talk', npc: 'sable' }).state;
  const result = questReducer(state, { type: 'collect-shard', id: 'moon' });
  assert.equal(result.changed, false);
});

test('next shard location follows collection order', () => {
  let state = questReducer(createQuestState(), { type: 'talk', npc: 'wisp' }).state;
  state = questReducer(state, { type: 'talk', npc: 'sable' }).state;
  assert.equal(nextShardLocation(state).id, LOCATIONS.shards[0].id);
  state = questReducer(state, { type: 'collect-shard', id: LOCATIONS.shards[0].id }).state;
  assert.equal(nextShardLocation(state).id, LOCATIONS.shards[1].id);
});

test('reducer does not mutate the input state', () => {
  const state = createQuestState();
  questReducer(state, { type: 'talk', npc: 'wisp' });
  assert.equal(state.stage, STAGES.AWAKEN);
});
