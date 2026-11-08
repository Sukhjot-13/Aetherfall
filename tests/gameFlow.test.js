import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createQuestState, questReducer, STAGES } from '../src/gameplay/questState.js';
import { createPowerState } from '../src/gameplay/powerState.js';
import { LOCATIONS } from '../src/world/locations.js';

// The game module builds canvas textures at import; the flow tests need no WebGL.
globalThis.document = { createElement: () => ({ getContext: () => ({
  createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
}) }) };
const { Game } = await import('../src/core/Game.js');

test('adaptive resolution resizes render targets only once when dimensions are unchanged', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 };
  try {
    const game = Object.create(Game.prototype);
    const calls = [];
    const target = (name) => ({
      setPixelRatio: () => calls.push(`${name} ratio`),
      setSize: () => calls.push(`${name} size`),
    });
    game.renderer = target('renderer'); game.composer = target('composer');
    game.camera = { updateProjectionMatrix() {} };
    game.preset = { pixelRatio: 1 }; game._renderScale = 1;
    game._resize();
    calls.length = 0;
    game._updateAdaptiveRenderScale(-0.12);
    assert.deepEqual(calls, ['renderer ratio', 'composer ratio']);
    calls.length = 0;
    globalThis.window.innerWidth = 900;
    game._resize();
    assert.deepEqual(calls, ['renderer size', 'composer size']);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('the gameplay camera receives player velocity and dodge state', () => {
  const game = Object.create(Game.prototype);
  let cameraPlayer;
  Object.assign(game, {
    clock: { getDelta: () => 1 / 60 }, elapsed: 0, state: 'playing', quest: {},
    _pacerActive: true, _framePacer: { sample: () => null, reset() {} },
    _shadowTimer: 0, renderer: { shadowMap: {} }, _dialogueCooldown: 0,
    dialogue: { isOpen: false, update() {} },
    player: { position: new THREE.Vector3(), velocity: new THREE.Vector3(3, 0, -2), speed: 4, dodgeTime: 0.2 },
    camera: { position: new THREE.Vector3() },
    cameraRig: { update(dt, player) { cameraPlayer = player; } },
    world: { update() {} }, effects: { update() {} }, magic: { update() {} },
    npcs: { update() {} }, collectibles: { update() {} }, photo: { active: false },
    input: { endFrame() {} }, _updatePlaying() {}, _updateAudioNight() {}, _syncModel() {}, _updateHud() {}, _render() {},
  });
  game.frame();
  assert.equal(cameraPlayer.velocity, game.player.velocity);
  assert.equal(cameraPlayer.dodging, true);
});

function talkGame(stage) {
  const game = Object.create(Game.prototype);
  game.quest = createQuestState(); game.quest.stage = stage;
  game.player = { position: new THREE.Vector3(), model: { root: { rotation: {} } } };
  game.audio = { talk() {} };
  game.dialogue = { show(lines, opts) { this.lines = lines; this.options = opts; } };
  game._questEvent = (event) => { game.quest = questReducer(game.quest, event).state; };
  return game;
}

test('finishing Sable’s introduction starts the shard quest', () => {
  const game = talkGame(STAGES.MEET_SABLE);
  game._talk({ id: 'sable', position: new THREE.Vector3(1, 0, 0) });
  assert.equal(game.quest.stage, STAGES.MEET_SABLE);
  game.dialogue.options.onComplete();
  assert.equal(game.quest.stage, STAGES.SHARDS);
  assert.equal(game.quest.sableMet, true);
});

test('the Wisp gives the main return guidance before optional lantern dialogue', () => {
  const game = talkGame(STAGES.RETURN);
  game._talk({ id: 'wisp', position: new THREE.Vector3(1, 0, 0) });
  assert.match(game.dialogue.lines[0].text, /trial of embers/i);
});

test('a shard cannot be removed from the world before the quest accepts it', () => {
  const game = Object.create(Game.prototype);
  game.quest = createQuestState();
  let removed = false, events = 0;
  game.world = { shardSites: new Map([['grove', { sealed: false, collected: false }]]),
    structures: { collectShard() { removed = true; } } };
  game._questEvent = () => { events++; return false; };
  game._claimShard('grove');
  assert.equal(removed, false);
  assert.equal(events, 0);
  game.quest.stage = STAGES.SHARDS;
  game._claimShard('grove');
  assert.equal(events, 1);
  assert.equal(removed, false);
});

test('both required trials receive enough targets in order after all shards', () => {
  const game = Object.create(Game.prototype);
  game.quest = createQuestState(); game.quest.stage = STAGES.RETURN;
  game.quest.shards = LOCATIONS.shards.map((s) => s.id);
  const spawned = [];
  game.enemies = { spawn: (type, x, z) => spawned.push({ type, x, z }) };
  game._trialSpawned = false; game._huntSpawned = false;
  game._ensureHuntTargets();
  assert.equal(spawned.length, 3);
  game._ensureHuntTargets();
  assert.equal(spawned.length, 3);
  game.quest.missions.emberTrial = 3;
  game.quest.missions.veilHunt = 2;
  game._ensureHuntTargets();
  assert.equal(spawned.length, 6);
  game._ensureHuntTargets();
  assert.equal(spawned.length, 6);
});

test('Master Mode snapshots the live run and never writes sandbox progress', () => {
  const game = Object.create(Game.prototype);
  game.quest = createQuestState(); game.quest.stage = STAGES.SHARDS;
  game.powers = createPowerState({ health: 54, cooldowns: { emberBolt: 0.7 } });
  game.player = { position: new THREE.Vector3(12, 4, -9), yaw: 0.3, fly: false };
  game.cameraRig = { mode: 'third', state: { yaw: 0.7, pitch: -0.2, distance: 5, mode: 'third' } };
  const warden = { type: 'warden', shardId: 'grove', name: 'Guardian', dormant: false,
    spawnPoint: new THREE.Vector3(20, 4, -9), position: new THREE.Vector3(21, 4, -9),
    yaw: 1, health: 0, alive: false, aggro: false, engaged: false, attackCooldown: 1, slows: [] };
  game.enemies = { all: () => [warden] };
  game.world = { timeOfDay: 12, shardSites: new Map(), structures: { setAltarDimmed() {} },
    restoreBeacon() {}, sky: { setRestored() {} } };
  game.master = { enabled: false, fly: false };
  game.hud = { setMaster() {} }; game.toasts = { push() {} }; game.audio = { quest() {}, ui() {} };
  game._trialSpawned = false; game._huntSpawned = false;
  let restored;
  game._continueGame = (snapshot) => { restored = snapshot; };
  let writes = 0;
  globalThis.localStorage = { setItem() { writes++; }, getItem() { return null; } };
  game.setMaster(true);
  assert.equal(game.quest.stage, STAGES.FREE);
  assert.equal(game._save(), false);
  assert.equal(writes, 0);
  game.setMaster(false);
  assert.equal(restored.quest.stage, STAGES.SHARDS);
  assert.equal(restored.powers.health, 54);
  assert.equal(restored.powers.cooldowns.emberBolt, 0.7);
  assert.equal(restored.cameraState.yaw, 0.7);
  assert.equal(restored.enemies[0].alive, false);
  assert.equal(game.master.enabled, false);
});

test('sandbox restore preserves an unclaimed defeated Warden and its open seal', () => {
  const game = Object.create(Game.prototype);
  game.quest = createQuestState(); game.quest.stage = STAGES.SHARDS;
  let unsealed;
  game.world = { structures: { setShardSealed(id, sealed) { unsealed = { id, sealed }; }, setLanternsLit() {} } };
  let made;
  game.enemies = { reset() {}, spawn(type, x, z, opts) {
    made = { type, isWarden: type === 'warden', shardId: opts.shardId,
      position: new THREE.Vector3(), group: { rotation: {}, visible: true } };
    return made;
  } };
  game._spawnEnemies({ enemies: [{ type: 'warden', shardId: 'grove', name: 'Guardian', dormant: false,
    spawnX: 2, spawnZ: 3, x: 4, y: 5, z: 6, yaw: 0.4, health: 0, alive: false,
    aggro: false, engaged: false, attackCooldown: 1, slows: [] }], trialSpawned: false, huntSpawned: false });
  assert.equal(made.alive, false);
  assert.equal(made.group.visible, false);
  assert.deepEqual(unsealed, { id: 'grove', sealed: false });
});

test('trial targets spawn outside the camp respawn’s immediate aggro range', () => {
  const game = Object.create(Game.prototype);
  game.quest = createQuestState(); game.quest.stage = STAGES.RETURN;
  const points = [];
  game.enemies = { spawn: (type, x, z) => points.push({ type, x, z }) };
  game._trialSpawned = false; game._huntSpawned = false;
  game._ensureHuntTargets();
  game.quest.missions.emberTrial = 3;
  game._ensureHuntTargets();
  const respawn = { x: LOCATIONS.camp.x + 3, z: LOCATIONS.camp.z + 6 };
  for (const point of points) {
    assert.ok(Math.hypot(point.x - respawn.x, point.z - respawn.z) > 45, point.type);
  }
});

test('a phase-selected boss rematch retries from the selected phase', () => {
  const game = Object.create(Game.prototype);
  game.powers = createPowerState({ health: 0, dead: true });
  game.magic = { clear() {} };
  let phase;
  game.boss = { center: new THREE.Vector3(), reset() {}, begin(p) { phase = p; }, activate() {}, hudState: () => null };
  game._bossRetry = true; game._bossStartPhase = 3;
  game.player = { teleport() {} };
  game.world = { heightAt: () => 0 };
  game.cameraRig = { state: {}, setCinematic() {}, snap() {} };
  game.menus = { hideAll() {} }; game.hud = { show() {}, setCinematic() {} };
  game.input = { requestLock() {} }; game.toasts = { push() {} }; game._save = () => true;
  game._respawn();
  assert.equal(phase, 3);
  assert.equal(game.state, 'playing');
  assert.equal(game.powers.dead, false);
});


test('return dialogue follows the active trial and directs completed players to the Beacon', () => {
  const game = talkGame(STAGES.RETURN);
  const sable = { id: 'sable', position: new THREE.Vector3(1, 0, 0) };
  game._talk(sable);
  assert.match(game.dialogue.lines[0].text, /Trial of Embers/);
  game.quest.missions.emberTrial = 3;
  game._talk(sable);
  assert.match(game.dialogue.lines[1].text, /Turning Veil/);
  game.quest.missions.veilHunt = 5;
  game._talk(sable);
  assert.match(game.dialogue.lines[0].text, /trials are done/i);
});

test('returning to title from the sandbox keeps the regular run available in memory', () => {
  const game = Object.create(Game.prototype);
  const snapshot = { quest: { stage: STAGES.SHARDS } };
  game.master = { enabled: true, fly: true }; game._masterSnapshot = snapshot;
  game.player = { fly: true }; game.state = 'playing';
  game.dialogue = { onComplete: () => {}, close() {} };
  game.world = { structures: { setAltarDimmed() {} } };
  game.hud = { hideBossCard() {}, hide() {}, setCinematic() {} };
  game.boss = { dismiss() {} }; game.toasts = { clear() {} };
  let canContinue = false;
  game.menus = { hideAll() {}, showTitle(value) { canContinue = value; } };
  game.input = { exitLock() {} }; game._enterTitleCamera = () => {};
  let writes = 0; globalThis.localStorage = { setItem() { writes++; }, getItem() { return null; } };
  game._returnToTitle();
  assert.equal(writes, 0);
  assert.equal(game.saveSlot, snapshot);
  assert.equal(canContinue, true);
  assert.equal(game.master.enabled, false);
  assert.equal(game.state, 'title');
});
