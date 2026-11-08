/**
 * Game: the single orchestrator. Owns the renderer, post-processing, the world,
 * every gameplay system and the screen state machine.
 *
 * States: loading -> title -> playing <-> paused / settings
 *                                    -> dead -> playing
 *                                    -> finale -> ending -> playing
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { AudioManager } from './AudioManager.js';
import { FramePacer } from './FramePacer.js';
import { Input } from './Input.js';
import { loadSettings, normalizeSettings, qualityPreset, saveSettings } from './settings.js';
import { createSaveData, hydrateSaveData, loadSave, writeSave } from './saveState.js';

import { World } from '../world/World.js';
import { LOCATIONS, POI_LIST, SHARD_LOCATIONS, WORLD, regionNameAt } from '../world/locations.js';
import { formatClock } from '../util/math.js';
import { fbm2 } from '../util/noise.js';

/** Forest mask (mirrors the vegetation field) as a 0..1 weight. */
function fbm2At(x, z) {
  return fbm2(x, z, 3, 33) * 0.5 + 0.5;
}

import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { CAMERA_MODES, THIRD_PERSON } from '../player/cameraLogic.js';

import { Effects } from '../gameplay/Effects.js';
import { Magic } from '../gameplay/Magic.js';
import { Enemies } from '../gameplay/Enemies.js';
import { FinalBoss } from '../gameplay/FinalBoss.js';
import { NPCs } from '../gameplay/NPCs.js';
import { Collectibles } from '../gameplay/Collectibles.js';
import {
  castFailMessage,
  createPowerState,
  isFormActive,
  powerName,
  restoreMana,
  revive,
  tickPowers,
  unlockPowers,
} from '../gameplay/powerState.js';
import { SPELLS, SPELL_ORDER } from '../gameplay/spellData.js';
import {
  MISSIONS,
  SIDE_QUEST,
  STAGES,
  STAGE_ORDER,
  createQuestState,
  missionDone,
  objectiveFor,
  objectiveTarget,
  questReducer,
  sideQuestDone,
} from '../gameplay/questState.js';
import { DIALOGUES, DEATH_TEXT, ENDING_LINES, buildEndingStats, dialogueForShard } from '../gameplay/story.js';

import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { Dialogue } from '../ui/Dialogue.js';
import { Toasts } from '../ui/Toasts.js';
import { Menus } from '../ui/Menus.js';

const AUTOSAVE_SECONDS = 55;
const START_YAW = -0.38;

export class Game {
  /** @param {{canvas?:HTMLCanvasElement}} [opts] */
  constructor({ canvas } = {}) {
    this.canvas = canvas ?? document.getElementById('scene');
    this.settings = loadSettings();
    this.preset = qualityPreset(this.settings);
    this.saveSlot = loadSave();

    this.state = 'loading';
    this.elapsed = 0;
    this.fps = 60;
    this.autosaveTimer = 0;
    this.interaction = null;
    this.finaleTimer = 0;
    this.finalePhase = 0;
    this.useComposer = false;
    /** Testing cheats: everything unlocked, flight, infinite resources. */
    this.master = { enabled: false, fly: false };
    /** HUD-free look-around mode for screenshots. */
    this.photo = { active: false };
    /** Index into POI_LIST for master-mode teleport cycling. */
    this._teleportIndex = 0;
    this._lastFirstPerson = null;
    this._lastForm = null;
    this._lastCastHint = 0;
    this._lastNight = -1;
    /** Short grace period after a skip so the same press cannot re-open dialogue. */
    this._dialogueCooldown = 0;
    this._renderScale = 1;
    this._framePacer = new FramePacer();
    this._pacerActive = false;
    this._nightAccum = 0;
    this._bossRetry = false;
    this._rematch = false;

    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      3400,
    );
    this.camera.position.set(LOCATIONS.spawn.x, 26, LOCATIONS.spawn.z + 46);
    this.scene.add(this.camera);
    this.titleFocus = new THREE.Vector3();
  }

  /* ------------------------------------------------------------------ boot */

  async boot() {
    this._setupRenderer();
    const bootStart = performance.now();

    this.menus = new Menus({
      handlers: {
        begin: () => this._startNewGame(),
        continueGame: () => this._continueGame(),
        resume: () => this._resume(),
        save: () => this._manualSave(),
        master: () => {
          this.toggleMaster();
          if (this.master.enabled) this._resume();
        },
        title: () => this._returnToTitle(),
        respawn: () => this._respawn(),
        continueExplore: () => this._continueExplore(),
        rematch: (phase) => this._startRematch(phase),
      },
      getSettings: () => this.settings,
      onSettingsChange: (next) => this._applySettings(next),
    });

    this.menus.setLoading(0.02, 'Calling the tide…');
    this.world = new World(this.scene, this.renderer, this.preset);
    const worldStart = performance.now();
    await this.world.build((progress, label) => this.menus.setLoading(0.04 + progress * 0.86, label));
    this.bootWorldMs = performance.now() - worldStart;
    this.menus.setLoading(0.9, 'Warming the shaders…');
    // Compiling up-front used to stall the loading screen for seconds.
    // Defer it to an idle slice after the title is up so the island
    // appears instantly and shaders warm without blocking.
    // The slice is timed so the win is measurable: the old sync path paid
    // compileMs on the critical path before the title could paint.
    this.compileMs = 0;
    void (async () => {
      // Let the title paint first.
      await new Promise((r) => setTimeout(r, 60));
      const compileStart = performance.now();
      try { this.renderer.compile(this.scene, this.camera); } catch { /* non-fatal */ }
      this.compileMs = performance.now() - compileStart;
    })();

    this._setupComposer();
    this._setupEntities();
    this._setupUI();
    this._setupInput();
    this._applyQuality();
    this._applySettings(this.settings);

    this.menus.hideLoading();
    this.menus.showTitle(Boolean(this.saveSlot));
    this._enterTitleCamera();
    this.state = 'title';

    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this._pause();
    });

    this.renderer.setAnimationLoop(() => this.frame());
    /** Critical-path boot time: renderer setup → title ready (excludes the
     *  deferred shader compile, which runs after the title paints). */
    this.bootMs = performance.now() - bootStart;
    return this;
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    // Cap at 1.5: 1.75 on a retina display is ~3x the pixels for a
    // barely-visible gain and was the main source of hangs.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Math.min(1.5, this.preset.pixelRatio)));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = this.preset.shadows;
    // r186 removed PCFSoftShadowMap; asking for it silently fell back to
    // PCFShadowMap (and logged a warning), so use the supported type directly.
    // Shadows are expensive to render; update them at 30 Hz while the main
    // scene remains at display rate. Motion and the day cycle still advance.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this._shadowTimer = 0;
  }

  _setupComposer() {
    // EffectComposer renders via a render target, so the renderer's own
    // antialias flag has no effect — without MSAA samples every silhouette
    // stair-steps. 2x MSAA restores smooth edges with a smaller GPU cost
    // than 4x on high-density screens.
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      samples: 2,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.38,
      0.72,
      0.86,
    );
    this.bloomPass.enabled = this.preset.bloom;
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.useComposer = this.preset.bloom;
  }

  _setupEntities() {
    this.powers = createPowerState();
    this.quest = createQuestState();
    this.effects = new Effects(this.scene, { camera: this.camera });
    this.audio = new AudioManager(this.settings.volume);
    this.cameraRig = new CameraRig(this.camera, this.world, this.settings);

    this.player = new Player({
      scene: this.scene,
      world: this.world,
      powers: this.powers,
      effects: this.effects,
      audio: this.audio,
      camera: this.camera,
      cameraRig: this.cameraRig,
    });

    this.enemies = new Enemies({
      scene: this.scene,
      world: this.world,
      player: this.player,
      powers: this.powers,
      effects: this.effects,
      audio: this.audio,
      camera: this.cameraRig,
      onKill: (enemy) => this._onEnemyKilled(enemy),
      onPlayerHit: (result) => this._onPlayerHit(result),
    });

    this.magic = new Magic({
      scene: this.scene,
      world: this.world,
      player: this.player,
      powers: this.powers,
      enemies: this.enemies,
      effects: this.effects,
      audio: this.audio,
      camera: this.cameraRig,
      onHit: () => this.hud.flashHit(),
    });
    this.enemies.onShieldBreak = () => this.magic.shieldBreak();

    this.npcs = new NPCs({
      scene: this.scene,
      world: this.world,
      player: this.player,
      structures: this.world.structures,
      audio: this.audio,
    });

    this.collectibles = new Collectibles({
      scene: this.scene,
      world: this.world,
      player: this.player,
      powers: this.powers,
      effects: this.effects,
      audio: this.audio,
      onPickup: (kind) => this._onPickup(kind),
    });

    this._spawnEnemies();

    this.boss = new FinalBoss({
      scene: this.scene,
      world: this.world,
      player: this.player,
      powers: this.powers,
      enemies: this.enemies,
      effects: this.effects,
      audio: this.audio,
      camera: this.cameraRig,
      onDefeated: () => this._onBossDefeated(),
      onPhase: (phase) => this._onBossPhase(phase),
    });
    this.boss.attach();
  }

  _setupUI() {
    this.hud = new HUD(document);
    this.minimap = new Minimap(document.getElementById('minimap'), this.world);
    this.dialogue = new Dialogue(document);
    this.toasts = new Toasts(document);
    this.hud.hide();
    this.hud.setCrosshair(false);
  }

  _setupInput() {
    this.input = new Input(this.canvas);
    this.input.onCanvasClick = () => {
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.dialogue.isOpen && !this.menus.settingsOpen) {
        this._pause();
      }
    };
  }

  /* ------------------------------------------------------- run management */

  _enterTitleCamera() {
    const y = this.world.heightAt(LOCATIONS.temple.x, LOCATIONS.temple.z);
    this.titleFocus.set(LOCATIONS.temple.x, y + 6, LOCATIONS.temple.z);
    this.cameraRig.setCinematic(true, this.titleFocus, { radius: 54, height: 28, speed: 0.055 });
  }

  /** Reset the mutable run state without touching the built world. */
  _resetRun() {
    Object.assign(this.powers, createPowerState());
    Object.assign(this.quest, createQuestState());
    this.effects.clear();
    this.magic.clear();
    this.collectibles.reset();
    this.world.structures.reset();
    this.world.structures.setAltarDimmed(false);
    this.world.sky?.setRestored(false);
    this.world.setTimeOfDay(WORLD.startHour);

    this.player.spawnAt(LOCATIONS.spawn.x, LOCATIONS.spawn.z);
    this.player.fly = false;
    this.master.fly = false;
    this.player.yaw = START_YAW;
    this.player.model.root.rotation.y = START_YAW;
    this.cameraRig.setMode(this.settings.cameraMode === 'first' ? CAMERA_MODES.FIRST : CAMERA_MODES.THIRD);
    this.cameraRig.state.yaw = START_YAW;
    this.cameraRig.state.pitch = -0.08;
    this.cameraRig.state.distance = THIRD_PERSON.distance;
    this.cameraRig.snap();

    this._lastForm = null;
    this._lastFirstPerson = null;
    this.interaction = null;
    this.autosaveTimer = 0;
    this.finaleTimer = 0;
    this.finalePhase = 0;
    this._bossRetry = false;
    this._bossStartPhase = 1;
    this._rematch = false;
    if (this.photo) {
      this.photo.active = false;
      document.body.classList.remove('photo-mode');
    }
    this.boss?.reset();
    this.hud.setCinematic(false);
    this.hud.hideBossCard();
  }

  _spawnEnemies(snapshot = null) {
    this.enemies.reset();
    if (Array.isArray(snapshot?.enemies)) {
      // Restore the live pre-sandbox encounters, including an unclaimed
      // shrine whose Warden was already defeated.
      for (const saved of snapshot.enemies) {
        const enemy = this.enemies.spawn(saved.type, saved.spawnX, saved.spawnZ, {
          shardId: saved.shardId, name: saved.name, dormant: saved.dormant,
        });
        enemy.position.set(saved.x, saved.y, saved.z);
        enemy.yaw = saved.yaw;
        enemy.group.rotation.y = saved.yaw;
        enemy.health = saved.health;
        enemy.alive = saved.alive;
        enemy.aggro = saved.aggro && saved.alive;
        enemy.engaged = saved.engaged && saved.alive;
        enemy.attackCooldown = saved.attackCooldown;
        enemy.slows = saved.slows.map((slow) => ({ ...slow }));
        if (!saved.alive) {
          enemy.deadTimer = 0;
          enemy.group.visible = false;
          if (enemy.isWarden && enemy.shardId) this.world.structures.setShardSealed(enemy.shardId, false);
        }
      }
      this._trialSpawned = snapshot.trialSpawned;
      this._huntSpawned = snapshot.huntSpawned;
    } else {
      this.enemies.spawnAmbient(26);
      const active = this._stageAtLeast(STAGES.SHARDS);
      for (const loc of LOCATIONS.shards) {
        if (this.quest.shards.includes(loc.id)) continue;
        const warden = this.enemies.spawnWarden(loc.id);
        if (warden) warden.dormant = !active;
      }
      this._trialSpawned = false;
      this._huntSpawned = false;
      this._ensureHuntTargets();
    }
    this.world.structures?.setLanternsLit(this.quest.sideQuest?.lanternWay ?? 0);
    this.boss?.attach();
  }

  /** Keep both required trials completable even if earlier enemies died. */
  _ensureHuntTargets() {
    if (this.quest.stage !== STAGES.RETURN) return;
    const trialDone = missionDone(this.quest, 'emberTrial');
    if (!trialDone && !this._trialSpawned) {
      this._trialSpawned = true;
      const remaining = MISSIONS.emberTrial.target - (this.quest.missions.emberTrial ?? 0);
      this._spawnTrialTargets(remaining, [[-48, 50], [54, 40], [-35, -58]]);
    } else if (trialDone && !this._huntSpawned && !missionDone(this.quest, 'veilHunt')) {
      this._huntSpawned = true;
      const remaining = MISSIONS.veilHunt.target - (this.quest.missions.veilHunt ?? 0);
      this._spawnTrialTargets(remaining, [[-48, 52], [58, 30], [-20, -64], [65, -28], [-64, -25]]);
    }
  }

  _spawnTrialTargets(count, spots) {
    const camp = LOCATIONS.camp;
    for (let i = 0; i < count; i++) {
      this.enemies.spawn(i % 2 ? 'drifter' : 'stalker', camp.x + spots[i][0], camp.z + spots[i][1]);
    }
  }

  _stageAtLeast(stage) {
    return STAGE_ORDER.indexOf(this.quest.stage) >= STAGE_ORDER.indexOf(stage);
  }

  /* ------------------------------------------------------------ master mode */

  /** Toggle the testing sandbox (backtick). */
  toggleMaster() {
    this.setMaster(!this.master.enabled);
  }

  /**
   * Enable/disable master mode: every power, every shard, restored beacon,
   * infinite resources and (optionally) free flight.
   * @param {boolean} on
   */
  setMaster(on) {
    const enabled = Boolean(on);
    if (enabled === this.master.enabled) return;
    if (enabled) {
      // Preserve the live run separately; sandbox changes must never be
      // written to the durable save or leak back into regular play.
      this._masterSnapshot = this._captureSandboxSnapshot();
      this.master.enabled = true;
      this._applyMaster();
      this.hud?.setMaster(true, false);
      this.toasts?.push('Master mode ON — unlimited mana · F fly · [ ] time · ` exit', 'gold', 5200);
      this.audio?.quest();
      return;
    }

    const snapshot = this._masterSnapshot;
    this._masterSnapshot = null;
    this.master.enabled = false;
    this.master.fly = false;
    this.player.fly = false;
    this.powers.infinite = false;
    if (snapshot) this._continueGame(snapshot);
    this.hud?.setMaster(false);
    this.toasts?.push('Master mode off — your journey is restored.', 'mint', 2600);
    this.audio?.ui();
  }

  /** Copy the current run without writing to storage. */
  _captureSandboxSnapshot() {
    const snapshot = hydrateSaveData(createSaveData(this._saveSnapshot()));
    // Transient powers and camera orientation are meaningful when returning
    // to an in-progress run, even though normal disk saves omit them.
    snapshot.powers = { ...this.powers, unlocked: [...this.powers.unlocked], cooldowns: { ...this.powers.cooldowns } };
    snapshot.cameraState = { ...this.cameraRig.state };
    snapshot.enemies = this.enemies.all().filter((enemy) => !enemy.isBoss && !enemy.summoned).map((enemy) => ({
      type: enemy.type, shardId: enemy.shardId, name: enemy.name, dormant: enemy.dormant,
      spawnX: enemy.spawnPoint.x, spawnZ: enemy.spawnPoint.z,
      x: enemy.position.x, y: enemy.position.y, z: enemy.position.z, yaw: enemy.yaw,
      health: enemy.health, alive: enemy.alive, aggro: enemy.aggro, engaged: enemy.engaged,
      attackCooldown: enemy.attackCooldown, slows: (enemy.slows ?? []).map((slow) => ({ ...slow })),
    }));
    snapshot.trialSpawned = this._trialSpawned;
    snapshot.huntSpawned = this._huntSpawned;
    return snapshot;
  }

  /** Grant everything and restore the world without touching the save file. */
  _applyMaster() {
    if (!this.powers) return;
    this.world.structures?.setAltarDimmed(false);
    this.boss?.dismiss();
    this._bossRetry = false;
    for (const id of Object.keys(SPELLS)) {
      if (!this.powers.unlocked.includes(id)) this.powers.unlocked.push(id);
    }
    if (!this.powers.unlocked.includes('skyLeap')) this.powers.unlocked.push('skyLeap');
    this.powers.health = this.powers.maxHealth;
    this.powers.mana = this.powers.maxMana;
    this.powers.stamina = this.powers.maxStamina;
    this.powers.cooldowns = {};
    this.powers.infinite = true;
    this.powers.dead = false;

    Object.assign(this.quest, {
      stage: STAGES.FREE,
      shards: LOCATIONS.shards.map((shard) => shard.id),
      sableMet: true,
      beaconRestored: true,
      missions: {
        emberTrial: MISSIONS.emberTrial.target,
        veilHunt: MISSIONS.veilHunt.target,
      },
      sideQuest: { lanternWay: SIDE_QUEST.target },
    });

    for (const [id] of this.world.shardSites) {
      this.world.structures.collectShard(id);
      this.world.structures.setShardSealed(id, false);
    }
    this.world.restoreBeacon();
    this.world.sky?.setRestored(true);
    for (const enemy of this.enemies.all()) {
      if (enemy.isWarden) enemy.dormant = true;
    }
  }

  /** Toggle look-direction flight (master mode only). */
  toggleFly() {
    if (!this.master.enabled) return;
    this.master.fly = !this.master.fly;
    this.player.fly = this.master.fly;
    if (this.player.fly) {
      this.player.velocity.y = 0;
      this.player.position.y = Math.max(
        this.player.position.y,
        this.world.heightAt(this.player.position.x, this.player.position.z) + 4,
      );
      this.cameraRig.snap();
      this.toasts?.push('Flight on — look to steer · Space/C lift · Shift fast', 'mint', 3600);
    } else {
      this.toasts?.push('Flight off.', 'mint', 1800);
    }
    this.hud?.setMaster(true, this.master.fly);
    this.audio?.ui();
  }

  /** Nudge the clock while in master mode. */
  _shiftTime(hours) {
    if (!this.master.enabled) return;
    const next = (((this.world.timeOfDay + hours) % 24) + 24) % 24;
    this.world.setTimeOfDay(next);
    this.toasts?.push(`Time set to ${formatClock(next)}`, 'mint', 1400);
  }

  _startNewGame() {
    this.audio.init();
    this._resetRun();
    this._spawnEnemies();
    if (this.master.enabled) this._applyMaster();

    this.menus.hideAll();
    this.hud.show();
    this.hud.setCinematic(false);
    this.hud.setMaster(this.master.enabled, this.master.fly);
    this.state = 'playing';
    this.cameraRig.setCinematic(false);
    this.cameraRig.snap();
    this.input.requestLock();

    if (this.master.enabled) {
      this.toasts.push('Master mode — F fly · T travel · [ ] time · ` exit.', 'gold', 4200);
    } else {
      this.dialogue.show(DIALOGUES.intro, {
        onComplete: () => this._questEvent({ type: 'talk', npc: 'wisp' }),
      });
    }
    this.toasts.push('Aetherfall — the isle remembers you.', 'gold', 4200);
    this._save();
  }

  _continueGame(snapshot = null) {
    const save = snapshot ?? this.saveSlot ?? loadSave();
    if (!save) {
      this._startNewGame();
      return;
    }

    this.audio.init();
    this._resetRun();
    Object.assign(this.powers, save.powers);
    Object.assign(this.quest, save.quest);
    // Self-heal older or partially-written saves: a recovered shard must always
    // grant the powers bound to it, even if the save predates that unlock or
    // was captured between the two writes.
    for (const id of this.quest.shards) unlockPowers(this.powers, id);
    // Old saves lack maxHealth/maxMana/maxStamina: replay earned mission
    // rewards from quest state so those characters keep their upgrades.
    if (missionDone(this.quest, 'emberTrial') && this.powers.maxHealth === 100) this.powers.maxHealth = 112;
    if (missionDone(this.quest, 'veilHunt') && this.powers.maxMana === 100) this.powers.maxMana = 112;
    if (sideQuestDone(this.quest) && this.powers.maxStamina === 100) this.powers.maxStamina = 110;
    this.powers.health = Math.min(this.powers.health, this.powers.maxHealth);
    this.powers.mana = Math.min(this.powers.mana, this.powers.maxMana);
    this.powers.stamina = Math.min(this.powers.stamina, this.powers.maxStamina);

    this.world.setTimeOfDay(save.world.timeOfDay);
    this.world.sky?.setRestored(this.quest.beaconRestored);
    this.cameraRig.setMode(save.camera.mode === CAMERA_MODES.FIRST ? CAMERA_MODES.FIRST : CAMERA_MODES.THIRD);
    this.cameraRig.state.yaw = save.player.yaw;
    this.cameraRig.state.pitch = -0.08;
    this.player.teleport(save.player.x, save.player.y, save.player.z, save.player.yaw);
    if (save.cameraState) Object.assign(this.cameraRig.state, save.cameraState);
    this.cameraRig.snap();

    // A save taken during the finale restarts at the altar so the Sovereign
    // encounter is always one interaction away, not an empty arena.
    if (this.quest.stage === STAGES.FINALE) {
      const altar = this.world.altar;
      if (altar) {
        this.player.teleport(altar.position.x, altar.position.y, altar.position.z, 0);
        this.cameraRig.state.yaw = 0;
        this.cameraRig.state.pitch = -0.08;
        this.cameraRig.snap();
      }
    }

    for (const id of this.quest.shards) this.world.structures.collectShard(id);
    for (const [id] of this.world.shardSites) {
      this.world.structures.setShardSealed(id, !this.quest.shards.includes(id));
    }
    if (this.quest.beaconRestored) this.world.restoreBeacon();

    this._spawnEnemies(save);
    if (this._stageAtLeast(STAGES.SHARDS)) this.enemies.activateWardens();
    if (this.master.enabled) this._applyMaster();

    this.menus.hideAll();
    this.hud.show();
    this.hud.setMaster(this.master.enabled, this.master.fly);
    this.state = 'playing';
    this.cameraRig.setCinematic(false);
    this.input.requestLock();
    this.toasts.push('Journey restored.', 'mint', 2600);
    if (this.quest.stage === STAGES.FINALE) {
      this.toasts.push('The Sovereign waits. Challenge him at the altar.', 'warn', 4600);
    }
  }

  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._save();
    this.input.exitLock();
    this.menus.showPause();
    this.audio.ui();
  }

  _resume() {
    if (this.state !== 'paused') return;
    this.menus.hideAll();
    this.hud.show();
    this.state = 'playing';
    this.input.requestLock();
    this.audio.ui();
  }

  _returnToTitle() {
    const sandboxSnapshot = this.master.enabled ? this._masterSnapshot : null;
    if (this.state === 'playing' || this.state === 'paused') this._save();
    this.master.enabled = false;
    this.master.fly = false;
    this.player.fly = false;
    this._masterSnapshot = null;
    this._rematch = false;
    this.dialogue.onComplete = null;
    this.dialogue.close();
    this.world.structures?.setAltarDimmed(false);
    this.hud?.hideBossCard();
    this.boss?.dismiss();
    this._bossRetry = false;
    this.toasts.clear();
    this.menus.hideAll();
    this.saveSlot = sandboxSnapshot ?? loadSave();
    this.menus.showTitle(Boolean(this.saveSlot));
    this.hud.hide();
    this.hud.setCinematic(false);
    this.state = 'title';
    this.input.exitLock();
    this._enterTitleCamera();
  }

  _manualSave() {
    if (this.master.enabled) {
      this.toasts.push('Master mode is a sandbox; your regular journey is kept separately.', 'warn', 3200);
      this.audio.ui();
      return;
    }
    const ok = this._save();
    this.toasts.push(ok ? 'Journey saved.' : 'Could not write the save.', ok ? 'mint' : 'warn');
    this.audio.ui();
  }

  _saveSnapshot() {
    return {
      quest: this.quest,
      powers: this.powers,
      player: {
        x: this.player.position.x, y: this.player.position.y,
        z: this.player.position.z, yaw: this.player.yaw,
      },
      world: { timeOfDay: this.world.timeOfDay },
      camera: { mode: this.cameraRig.mode },
      stats: {},
    };
  }

  _save() {
    if (this.master.enabled) return false;
    try {
      const ok = writeSave(this._saveSnapshot());
      if (ok) this.saveSlot = loadSave();
      return ok;
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------- interactions */

  _updateInteraction() {
    this.interaction = null;
    if (this.state !== 'playing' || this.dialogue.isOpen) return;
    if (this.boss?.active) return;
    const p = this.player.position;
    // Mid-flight prompts are noise: you cannot meaningfully talk to anyone
    // while airborne, even when skimming the ground.
    if (this.player.fly) return;

    const altar = this.world.altar;
    if (altar && (this.quest.stage === STAGES.RETURN || this.quest.stage === STAGES.FINALE || this.quest.stage === STAGES.FREE)) {
      const d = Math.hypot(p.x - altar.position.x, p.z - altar.position.z);
      if (d < 11) {
        const label = this.quest.stage === STAGES.FINALE
          ? 'Challenge Vaelor'
          : this.quest.stage === STAGES.FREE
            ? 'Challenge Vaelor Again'
            : 'Place the Aether Shards';
        this.interaction = { kind: 'altar', label };
        return;
      }
    }

    for (const [id, site] of this.world.shardSites) {
      if (this.quest.stage !== STAGES.SHARDS || site.collected || site.sealed) continue;
      const d = Math.hypot(p.x - site.location.x, p.z - site.location.z);
      if (d < 7) {
        this.interaction = { kind: 'shard', id, label: 'Claim the Aether Shard' };
        return;
      }
    }

    // Side quest: the Lantern Way. Only the next unlit lantern can be woken.
    const lanterns = this.world.structures?.lanterns ?? [];
    const litCount = this.quest.sideQuest?.lanternWay ?? 0;
    const next = lanterns[litCount];
    if (next && !sideQuestDone(this.quest)) {
      const d = Math.hypot(p.x - next.x, p.z - next.z);
      if (d < 6) {
        this.interaction = { kind: 'lantern', label: 'Wake the old lantern' };
        return;
      }
    }

    const npc = this.npcs.nearest(p, 6);
    if (npc) this.interaction = { kind: 'talk', npc, label: `Speak with ${npc.name}` };
  }

  _interact() {
    const action = this.interaction;
    if (!action) return;
    if (action.kind === 'talk') this._talk(action.npc);
    else if (action.kind === 'shard') this._claimShard(action.id);
    else if (action.kind === 'lantern') this._wakeLantern();
    else if (action.kind === 'altar') {
      if (this.quest.stage === STAGES.FINALE) this._startFinale();
      else if (this.quest.stage === STAGES.FREE) this._openRematch();
      else this._questEvent({ type: 'interact-altar' });
    }
  }

  /** Wake one lantern on the Lantern Way; the reward is a steadier breath. */
  _wakeLantern() {
    const lit = this.quest.sideQuest?.lanternWay ?? 0;
    if (lit >= SIDE_QUEST.target) return;
    this.quest.sideQuest.lanternWay = lit + 1;
    this.world.structures?.setLanternsLit(this.quest.sideQuest.lanternWay);
    const lantern = this.world.structures?.lanterns?.[lit];
    const point = new THREE.Vector3(lantern?.x ?? this.player.position.x, (lantern?.y ?? 0) + 4, lantern?.z ?? this.player.position.z);
    this.effects.ring(point, { color: '#ffd27a', radius: 8, life: 0.9, opacity: 0.9 });
    this.effects.burst(point, { count: 40, color: '#ffe9a8', speed: 6, size: 0.35, life: 1, gravity: -1, drag: 1.5 });
    this.effects.light(point, { color: '#ffd27a', intensity: 14, distance: 44, life: 1.2 });
    this.audio?.quest();
    const done = this.quest.sideQuest.lanternWay >= SIDE_QUEST.target;
    this.toasts.push(
      done
        ? 'The Lantern Way burns bright — your breath deepens, your step lightens.'
        : `Lantern woke ${this.quest.sideQuest.lanternWay} / ${SIDE_QUEST.target}`,
      'gold',
      4600,
    );
    if (done) {
      this.powers.maxStamina += SIDE_QUEST.reward.maxStaminaBonus;
      this.powers.stamina = this.powers.maxStamina;
    }
    this._save();
  }

  _talk(npc) {
    const stage = this.quest.stage;
    let lines;
    if (npc.id === 'sable') {
      if (stage === STAGES.MEET_SABLE) lines = DIALOGUES.sableIntro;
      else if (stage === STAGES.RETURN) lines = !missionDone(this.quest, 'emberTrial') ? DIALOGUES.sableTrialPending : missionDone(this.quest, 'veilHunt') ? DIALOGUES.sableReady : DIALOGUES.sableReturn;
      else if (stage === STAGES.FREE) lines = DIALOGUES.sableFree;
      else lines = DIALOGUES.sableHint;
    } else if (npc.id === 'wisp') {
      if (stage === STAGES.AWAKEN) lines = DIALOGUES.intro;
      else if (stage === STAGES.RETURN) lines = !missionDone(this.quest, 'emberTrial') ? DIALOGUES.wispTrialPending : missionDone(this.quest, 'veilHunt') ? DIALOGUES.wispReady : DIALOGUES.allShards;
      else if (stage === STAGES.FREE) lines = DIALOGUES.freeRoam;
      else if (sideQuestDone(this.quest)) lines = DIALOGUES.lanternDone;
      else lines = DIALOGUES.lanternWay;
    } else if (stage === STAGES.AWAKEN) {
      lines = DIALOGUES.wispHint;
    } else if (stage === STAGES.RETURN) {
      lines = DIALOGUES.allShards;
    } else if (stage === STAGES.FREE) {
      lines = DIALOGUES.freeRoam;
    } else {
      lines = DIALOGUES.wispHint;
    }

    const dx = npc.position.x - this.player.position.x;
    const dz = npc.position.z - this.player.position.z;
    if (Math.hypot(dx, dz) > 0.2) {
      this.player.yaw = Math.atan2(-dx, -dz);
      this.player.model.root.rotation.y = this.player.yaw;
    }

    // First wisp chat is the intro — talking to the Wisp advances the quest.
    // Later chats are side-quest flavour or hints and do not advance anything.
    const isIntro = npc.id === 'wisp' && stage === STAGES.AWAKEN;
    const beginsShardHunt = npc.id === 'sable' && stage === STAGES.MEET_SABLE;
    this.dialogue.show(lines, {
      onComplete: () => {
        if (isIntro || beginsShardHunt) this._questEvent({ type: 'talk', npc: npc.id });
      },
    });
    this.audio?.talk?.();
  }

  /**
   * Master-mode quick travel: hop to the next named landmark. Testing tool —
   * never part of a normal run, and never saved.
   */
  _teleportNext() {
    const list = POI_LIST;
    const poi = list[this._teleportIndex % list.length];
    this._teleportIndex = (this._teleportIndex + 1) % list.length;
    this._teleportTo(poi);
  }

  /** Master-mode direct warp to a named landmark. */
  _teleportTo(poi) {
    if (!poi) return;
    const y = this.world.heightAt(poi.x, poi.z);
    this.player.position.set(poi.x, y + 0.05, poi.z);
    this.player.velocity.set(0, 0, 0);
    this.player.yaw = this.cameraRig.state.yaw;
    this.cameraRig.state.pitch = -0.12;
    this.cameraRig.snap();
    this.world.vegetation?._fillGrass?.(this.player.position);
    this.audio?.ui();
    this.toasts.push(poi.name, 'mint', 1800);
  }

  _claimShard(id) {
    const site = this.world.shardSites.get(id);
    if (!site || site.sealed || site.collected || this.quest.stage !== STAGES.SHARDS) return;
    if (!this._questEvent({ type: 'collect-shard', id })) return;
    this.world.structures.collectShard(id);
    const point = new THREE.Vector3(site.location.x, site.baseY + 3, site.location.z);
    this.effects.ring(new THREE.Vector3(point.x, site.baseY + 0.2, point.z), {
      color: site.location.color,
      radius: 9,
      life: 1.1,
      opacity: 0.95,
    });
    this.effects.burst(point, {
      count: 70,
      color: site.location.color,
      speed: 8,
      size: 0.4,
      life: 1.4,
      gravity: -1.4,
      drag: 1.6,
      jitter: 0.6,
    });
    this.effects.light(point, { color: site.location.color, intensity: 16, distance: 48, life: 1 });
    this.cameraRig.addShake(0.35);
    this.audio.quest();

  }

  /**
   * Apply a quest event and run its side effects.
   * @param {object} event
   */
  _questEvent(event) {
    const { state, changed, effects } = questReducer(this.quest, event);
    Object.assign(this.quest, state);
    if (changed && this._stageAtLeast(STAGES.SHARDS)) this.enemies.activateWardens();
    for (const effect of effects) this._handleQuestEffect(effect);
    if (changed) this._ensureHuntTargets();
    // Durable progress saves immediately: shards, stage changes, mission
    // completes and the finale all survive a crash without waiting up to
    // 55 s for the autosave. Plain kill counters ride the autosave.
    if (changed && effects.some((e) => ['unlock', 'mission-complete', 'side-quest-complete', 'finale', 'beacon-restored', 'objective'].includes(e.type))) {
      this._save();
    }
    return changed;
  }

  _handleQuestEffect(effect) {
    switch (effect.type) {
      case 'toast':
        this.toasts.push(effect.text, 'gold', 4200);
        break;
      case 'unlock': {
        const gained = unlockPowers(this.powers, effect.shardId);
        if (!gained.length) break;
        const spells = gained.filter((id) => SPELLS[id]);
        if (spells.length) this.hud.markNew(spells);
        this.toasts.push(`Awakened: ${gained.map((id) => powerName(id)).join(' · ')}`, 'mint', 4600);
        this.audio.quest();
        break;
      }
      case 'shard-collected': {
        const lines = dialogueForShard(effect.shardId);
        if (lines?.length) this.dialogue.show(lines);
        break;
      }
      case 'mission-complete': {
        const mission = MISSIONS[effect.missionId];
        if (!mission) break;
        if (mission.reward?.maxHealthBonus) {
          this.powers.maxHealth += mission.reward.maxHealthBonus;
          this.powers.health = this.powers.maxHealth;
        }
        if (mission.reward?.maxManaBonus) {
          this.powers.maxMana += mission.reward.maxManaBonus;
          this.powers.mana = this.powers.maxMana;
        }
        this.toasts.push(`${mission.name} complete — the Beacon deepens your spark.`, 'gold', 5200);
        this.audio.quest();
        break;
      }
      case 'side-quest-complete':
        this.powers.maxStamina += SIDE_QUEST.reward.maxStaminaBonus;
        this.powers.stamina = this.powers.maxStamina;
        break;
      case 'finale':
        this._startFinale();
        break;
      case 'beacon-restored':
        this.toasts.push('The Beacon of Aether burns again.', 'gold', 6000);
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- combat */

  _cast(id) {
    if (this.state !== 'playing' || this.dialogue.isOpen) return;
    const aim = this.magic.aimFromCamera(this.camera);
    const result = this.magic.cast(id, aim);
    if (result.ok) {
      this.hud.flashSpell(id);
      this.hud.pulseCast();
      this.player.model.triggerCast();
      return;
    }
    if (result.reason === 'locked' || result.reason === 'mana') {
      const now = performance.now();
      if (now - this._lastCastHint > 1600) {
        this._lastCastHint = now;
        this.toasts.push(castFailMessage(result.reason), 'warn', 2000);
      }
    }
  }

  _onEnemyKilled(enemy) {
    // Route through the quest reducer so kills also advance missions and the
    // side quest, and so the counters can never drift apart.
    this._questEvent({ type: 'enemy-killed' });
    if (enemy.isWarden && enemy.shardId) {
      this.world.structures.setShardSealed(enemy.shardId, false);
      const loc = SHARD_LOCATIONS[enemy.shardId];
      this.toasts.push(`${loc?.name ?? 'The shrine'} — the seal breaks.`, 'gold', 4200);
    }
    restoreMana(this.powers, enemy.isWarden ? 35 : 6);
  }

  _onPlayerHit(result) {
    if (!result) return;
    if (result.healthLost > 0) this.hud.flashDamage();
    if (result.dead) this._onDeath();
  }

  _onPickup(kind) {
    if (kind === 'bloom') this.toasts.push('Emberbloom — vitality restored.', 'warn', 2000);
  }

  _onDeath() {
    if (this.state !== 'playing') return;
    this._bossRetry = Boolean(this.boss?.active);
    this.state = 'dead';
    this.quest.deaths += 1;
    this.audio.death();
    this.hud.flashDamage();
    this.input.exitLock();
    this.menus.showDeath();
    this.toasts.clear();
  }

  _respawn() {
    revive(this.powers);
    this.magic.clear();
    if (this._bossRetry && this.boss) {
      this.boss.reset();
      this.boss.begin(this._bossStartPhase ?? 1);
      this.boss.activate();
      const x = this.boss.center.x;
      const z = this.boss.center.z + 18;
      const y = this.world.heightAt(x, z);
      this.player.teleport(x, y + 0.05, z, 0);
      this.cameraRig.state.yaw = 0;
      this.cameraRig.state.pitch = -0.08;
      this.cameraRig.setCinematic(false);
      this.cameraRig.snap();
      this.menus.hideAll();
      this.hud.show();
      this.hud.setCinematic(false);
      this.state = 'playing';
      this.input.requestLock();
      const info = this.boss.hudState();
      if (info) this.hud.showBossCard({ kicker: 'The Veil Reforms', name: info.name, title: info.phaseName }, 2800);
      this.toasts.push('Vaelor reforms. The ring will not let you leave.', 'warn', 3600);
      this._bossRetry = false;
      this._save();
      return;
    }

    this.player.respawn();
    this.cameraRig.state.yaw = this.player.yaw;
    this.cameraRig.state.pitch = -0.1;
    this.cameraRig.snap();
    for (const enemy of this.enemies.all()) {
      enemy.aggro = false;
      enemy.engaged = false;
      enemy.cancelTelegraph?.();
      enemy.cancelTelegraph = null;
      enemy.windup = 0;
      enemy.lunge = 0;
      if (!enemy.isBoss && enemy.alive) enemy.returning = true;
      enemy.attackCooldown = 1.5;
    }
    this.menus.hideAll();
    this.hud.show();
    this.state = 'playing';
    this.input.requestLock();
    this.toasts.push(DEATH_TEXT.body, 'mint', 3200);
    this._save();
  }

  /* ---------------------------------------------------------------- finale */

  /** Open the altar's phase-select overlay after the ending. */
  _openRematch() {
    this.state = 'paused';
    this.input.exitLock();
    this.menus.showRematch();
    this.audio.ui();
  }

  /** Begin a post-ending rematch at the chosen phase. */
  _startRematch(phase = 1) {
    this.menus.hideAll();
    this.hud.show();
    this._rematch = true;
    this._startFinale(phase);
  }

  _startFinale(startPhase = 1) {
    if (this.state === 'finale' || this.boss?.active) return;
    this.state = 'finale';
    this._bossStartPhase = startPhase;
    this.finaleTimer = 0;
    this.finalePhase = 0;
    this.player.velocity.set(0, 0, 0);
    this.input.exitLock();
    this.hud.setCinematic(true);
    this.cameraRig.setCinematic(true, this.world.altar?.position ?? this.titleFocus, {
      radius: 30,
      height: 15,
      speed: 0.16,
    });

    // The Sovereign answers the ritual before the Beacon can take the light.
    this.world.structures?.setAltarDimmed(true);
    this.boss?.begin(startPhase);
    this.audio.beacon();
    this.cameraRig.addShake(0.7);

    const center = (this.world.altar?.position ?? this.titleFocus).clone();
    const ground = new THREE.Vector3(center.x, center.y - 3, center.z);
    this.effects.ring(ground, { color: '#ffe9a8', radius: 34, life: 1.6, opacity: 1 });
    this.effects.ring(ground, { color: '#fff6d8', radius: 22, life: 1.2, opacity: 0.85 });
    this.effects.burst(center, {
      count: 170,
      color: '#ffe9a8',
      speed: 15,
      size: 0.55,
      life: 2.4,
      gravity: -2.4,
      drag: 1.2,
      jitter: 1.5,
    });
    this.effects.burst(center, {
      count: 90,
      color: '#b48cff',
      speed: 9,
      size: 0.5,
      life: 2.8,
      gravity: -1.2,
      drag: 1,
      jitter: 1,
    });
    this.effects.light(center, { color: '#ffe9a8', intensity: 42, distance: 240, life: 3.2 });
    this._save();
  }

  /** Leave the intro cinematic and hand control back for the boss fight. */
  _beginBossFight() {
    if (!this.boss?.active) return;
    this.state = 'playing';
    this.hud.setCinematic(false);
    this.cameraRig.setCinematic(false);
    // Place the Wayfarer on the south side of the ring with the Sovereign
    // between them and the altar, so the opening beat reads cleanly.
    const sx = this.boss.center.x;
    const sz = this.boss.center.z + 18;
    this.player.teleport(sx, this.world.heightAt(sx, sz) + 0.05, sz, 0);
    this.player.velocity.set(0, 0, 0);
    this.cameraRig.state.yaw = 0;
    this.cameraRig.state.pitch = -0.05;
    this.cameraRig.snap();
    this.input.requestLock();
    // The Beacon answers the challenge by restoring the Wayfarer.
    this.magic.clear();
    this.powers.health = this.powers.maxHealth;
    this.powers.mana = this.powers.maxMana;
    this.powers.stamina = this.powers.maxStamina;
    this.powers.cooldowns = {};
    this.boss.activate();
    const info = this.boss.hudState();
    if (info) {
      this.hud.showBossCard({ kicker: 'The Veil Sovereign', name: info.name, title: info.phaseName }, 3800);
    }
    this.toasts.push('Vaelor — The Veil Sovereign', 'warn', 4200);
    this._bossRetry = false;
    this._updateHud();
    this._save();
  }

  _onBossPhase(phase) {
    const info = this.boss?.hudState();
    if (!info) return;
    // Each phase break is a breather: the Beacon lends the Wayfarer strength.
    this.powers.health = Math.min(this.powers.maxHealth, this.powers.health + 25);
    this.powers.mana = Math.min(this.powers.maxMana, this.powers.mana + 35);
    this.powers.stamina = this.powers.maxStamina;
    this.effects.ring(this.player.position.clone().setY(this.player.position.y + 0.1), {
      color: '#ffe9a8',
      radius: 4.5,
      life: 0.8,
      opacity: 0.75,
    });
    this.hud.showBossCard(
      { kicker: `Phase ${phase} of ${info.phaseCount}`, name: info.name, title: info.phaseName },
      3200,
    );
    this.toasts.push(`Vaelor shifts — ${info.phaseName}`, 'warn', 3600);
  }

  _onBossDefeated() {
    this._bossRetry = false;
    this.hud.hideBossCard();
    this.world.structures?.setAltarDimmed(false);
    this.world.restoreBeacon();
    this.audio.beacon();
    this.state = 'finale';
    this.finaleTimer = 0;
    this.finalePhase = 2;
    this.input.exitLock();
    this.hud.setCinematic(true);
    const focus = (this.world.altar?.position ?? this.titleFocus).clone();
    this.cameraRig.setCinematic(true, focus, { radius: 24, height: 12, speed: 0.12 });
    this.cameraRig.addShake(0.5);

    const ground = new THREE.Vector3(focus.x, focus.y - 2, focus.z);
    this.effects.ring(ground, { color: '#ffe9a8', radius: 40, life: 2.2, opacity: 1 });
    this.effects.ring(ground, { color: '#fff6d8', radius: 26, life: 1.6, opacity: 0.9 });
    this.effects.burst(focus, {
      count: 220,
      color: '#ffe9a8',
      speed: 16,
      size: 0.6,
      life: 3,
      gravity: -2.6,
      drag: 1.2,
      jitter: 1.6,
    });
    this.effects.light(focus, { color: '#ffe9a8', intensity: 52, distance: 260, life: 4 });

    this.dialogue.show(DIALOGUES.sovereignVictory, {
      onComplete: () => (this._rematch ? this._completeRematch() : this._completeFinale()),
    });
    this._updateHud();
    this._save();
  }

  _completeFinale() {
    this._questEvent({ type: 'finale-complete' });
    this.hud.hideBossCard();
    this.world.structures?.setAltarDimmed(false);
    this.boss?.dismiss();
    this.state = 'ending';
    this.finalePhase = 0;
    this.hud.setCinematic(false);
    this.hud.hide();
    this.toasts.clear();
    this.menus.showEnding({
      lines: ENDING_LINES,
      stats: buildEndingStats(this.quest),
    });
    this._save();
  }

  /** Return to free roam after a rematch instead of replaying the ending. */
  _completeRematch() {
    this.hud.hideBossCard();
    this.world.structures?.setAltarDimmed(false);
    this.boss?.dismiss();
    this.state = 'playing';
    this._rematch = false;
    this.hud.setCinematic(false);
    this.hud.show();
    this.cameraRig.setCinematic(false);
    this.cameraRig.snap();
    this.input.requestLock();
    this.toasts.push('The Sovereign yields again. The isle is yours.', 'gold', 4200);
    this._save();
  }

  _continueExplore() {
    this.menus.hideEnding();
    this.hud.show();
    this.hud.setCinematic(false);
    this.cameraRig.setCinematic(false);
    this.cameraRig.snap();
    this.state = 'playing';
    this.input.requestLock();
    this.dialogue.show(DIALOGUES.freeRoam);
    this._save();
  }

  /* ---------------------------------------------------------------- update */

  frame() {
    const frameTime = this.clock.getDelta() || 0.016;
    const dt = Math.min(0.05, frameTime);
    this.elapsed += dt;
    const pacingActive = (this.state === 'playing' || this.state === 'finale') && !document.hidden;
    if (pacingActive !== this._pacerActive) {
      this._framePacer.reset();
      this._pacerActive = pacingActive;
    }
    if (pacingActive) {
      const sample = this._framePacer.sample(frameTime);
      if (sample) {
        this.fps = sample.fps;
        this._updateAdaptiveRenderScale(sample.step);
      }
    }
    this._shadowTimer += dt;
    if (this._shadowTimer >= 1 / 30) {
      this._shadowTimer %= 1 / 30;
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.state === 'playing') this.quest.playSeconds = (this.quest.playSeconds ?? 0) + dt;
    if (this.dialogue?.isOpen) {
      // X (or Esc) drops the entire conversation in one press; E/click just
      // finishes the current line. Handled before the state switch so a skip
      // can never also fall through into pause or a cast this frame.
      if (this.input?.wasPressed('skipDialogue') || this.input?.wasPressed('pause')) {
        this.dialogue.skip();
        this._dialogueCooldown = 0.45;
        this.input?.endFrame();
        this._render();
        return;
      }
      if (this.input?.wasPressed('interact')) this.dialogue.advance();
    }
    if (this._dialogueCooldown > 0) this._dialogueCooldown = Math.max(0, this._dialogueCooldown - dt);

    switch (this.state) {
      case 'playing':
        this._updatePlaying(dt);
        break;
      case 'finale':
        this._updateFinale(dt);
        break;
      case 'paused':
        this._updatePaused(dt);
        break;
      case 'dead':
        this._updateDead(dt);
        break;
      case 'title':
      case 'ending':
      case 'loading':
      default:
        break;
    }

    if (this.state !== 'paused' && this.state !== 'loading') {
      const advance = this.state === 'playing' || this.state === 'title' || this.state === 'finale';
      this.world.update(dt, this.camera.position, this.player.position, { advance });
      this.effects.update(dt);
      if (!this.photo.active) this.magic.update(dt);
      this.npcs.update(dt, this.elapsed, this.player.position);
      if (this.state === 'playing') this.collectibles.update(dt, this.elapsed);
      this.dialogue.update(dt);
      this._updateAudioNight(dt);
    }

    this._syncModel();
    this.cameraRig.update(dt, {
      position: this.player.position,
      speed: this.state === 'playing' ? this.player.speed : 0,
      velocity: this.player.velocity,
      dodging: this.state === 'playing' && this.player.dodgeTime > 0,
    });

    if (this.state !== 'paused' && this.state !== 'loading') this._updateHud();
    this._render();
    this.input?.endFrame();
  }

  _updatePlaying(dt) {
    const input = this.input;
    const talking = this.dialogue.isOpen;

    if (!talking && input.wasPressed('photo')) {
      this._togglePhoto();
      return;
    }
    if (this.photo.active) {
      this._updatePhoto(dt);
      return;
    }

    if (!talking && input.locked) {
      const { dx, dy } = input.consumeMouseDelta();
      if (dx || dy) this.cameraRig.look(dx, dy, this.settings.sensitivity, this.settings.invertY);
    } else {
      input.consumeMouseDelta();
    }

    const wheel = input.consumeWheel();
    if (wheel && !talking) this.cameraRig.zoom(wheel);

    if (!talking && input.wasPressed('view')) {
      const mode = this.cameraRig.toggle();
      this.settings = normalizeSettings({ ...this.settings, cameraMode: mode });
      saveSettings(this.settings);
    }

    if (input.wasPressed('mute')) {
      const muted = this.audio.toggleMute();
      this.toasts.push(muted ? 'Audio muted' : 'Audio on', 'mint', 1600);
    }

    if (!talking && input.wasPressed('master')) this.toggleMaster();
    if (this.master.enabled) {
      if (input.wasPressed('fly')) this.toggleFly();
      if (input.wasPressed('timeBack')) this._shiftTime(-2);
      if (input.wasPressed('timeForward')) this._shiftTime(2);
      for (let i = 0; i < POI_LIST.length; i++) {
        if (input.wasPressed(`warp${i + 1}`)) {
          this._teleportTo(POI_LIST[i]);
          break;
        }
      }
    }

    if (!talking) {
      for (let i = 0; i < SPELL_ORDER.length; i++) {
        if (input.wasPressed(`spell${i + 1}`)) {
          this._cast(SPELL_ORDER[i]);
          break;
        }
      }
      if (input.wasPressed('cast')) this._cast('emberBolt');
    }

    const actions = {
      forward: !talking && input.isDown('forward'),
      back: !talking && input.isDown('back'),
      left: !talking && input.isDown('left'),
      right: !talking && input.isDown('right'),
      sprint: !talking && input.isDown('sprint'),
      jumpPressed: !talking && input.wasPressed('jump'),
      jumpHeld: !talking && input.isDown('jump'),
      dodgePressed: !talking && input.wasPressed('dodge'),
      up: !talking && input.isDown('jump'),
      down: !talking && input.isDown('descend'),
    };
    this.player.update(dt, actions, this.cameraRig.state.yaw, this.cameraRig.state.pitch);

    if (this.master.enabled) {
      this.powers.health = this.powers.maxHealth;
      this.powers.mana = this.powers.maxMana;
      this.powers.stamina = this.powers.maxStamina;
      this.powers.dead = false;
      this.powers.cooldowns = {};
    }

    const inCombat = this.enemies
      .all()
      .some(
        (enemy) =>
          enemy.alive &&
          enemy.aggro &&
          Math.hypot(enemy.position.x - this.player.position.x, enemy.position.z - this.player.position.z) < 42,
      );
    tickPowers(this.powers, dt, { inCombat });
    if (this.powers.dead) {
      this._onDeath();
      return;
    }

    this.enemies.update(dt, this.elapsed);
    if (this.state !== 'playing') return;
    this.boss?.update(dt);
    if (this.state !== 'playing') return;

    this._updateInteraction();
    if (!talking && this._dialogueCooldown <= 0 && input.wasPressed('interact') && this.interaction) {
      this._interact();
      return;
    }

    if (input.wasPressed('pause')) {
      this._pause();
      return;
    }

    if (this.master.enabled && input.wasPressed('teleport')) {
      this._teleportNext();
      return;
    }

    this.autosaveTimer += dt;
    if (this.autosaveTimer > AUTOSAVE_SECONDS) {
      this.autosaveTimer = 0;
      this._save();
    }
  }

  /** Toggle the HUD-free photo camera. */
  _togglePhoto(force) {
    const active = typeof force === 'boolean' ? force : !this.photo.active;
    if (active === this.photo.active) return;
    this.photo.active = active;
    this.hud.doc.body.classList.toggle('photo-mode', active);
    if (active) {
      this.player.speed = 0;
      this.hud.hide();
      this.input.requestLock();
    } else {
      this.hud.show();
    }
  }

  /** Photo mode: look and zoom only, with the world frozen. */
  _updatePhoto(dt) {
    const input = this.input;
    if (input.wasPressed('photo') || input.wasPressed('pause')) {
      this._togglePhoto(false);
      return;
    }
    if (input.locked) {
      const { dx, dy } = input.consumeMouseDelta();
      if (dx || dy) this.cameraRig.look(dx, dy, this.settings.sensitivity, this.settings.invertY);
    } else {
      input.consumeMouseDelta();
    }
    const wheel = input.consumeWheel();
    if (wheel) this.cameraRig.zoom(wheel);
    this.player.speed = 0;
    void dt;
  }

  _updateFinale(dt) {
    this.boss?.update(dt);
    this.finaleTimer += dt;
    if (this.finalePhase === 0 && this.finaleTimer > 2.4) {
      this.finalePhase = 1;
      this.hud.showBossCard(
        { kicker: 'The Veil Sovereign', name: 'Vaelor', title: 'Keeper of the Last Dark' },
        4200,
      );
      this.dialogue.show(DIALOGUES.sovereignIntro, { onComplete: () => this._beginBossFight() });
    }
  }

  _updatePaused() {
    if (!this.input.wasPressed('pause')) return;
    if (this.menus.settingsOpen) this.menus.closeSettings();
    else this._resume();
  }

  _updateDead() {
    if (this.input.wasPressed('interact') || this.input.wasPressed('jump')) this._respawn();
  }

  _syncModel() {
    const first = this.cameraRig.firstPerson;
    if (first !== this._lastFirstPerson) {
      this.player.model.setFirstPerson(first);
      this._lastFirstPerson = first;
    }
    const form = isFormActive(this.powers);
    if (form !== this._lastForm) {
      this.player.model.setForm(form);
      this._lastForm = form;
    }
  }

  _updateAudioNight(dt) {
    this._nightAccum += dt;
    if (this._nightAccum < 0.5) return;
    this._nightAccum = 0;
    const night = this.world.nightFactor;
    if (Math.abs(night - this._lastNight) > 0.02) {
      this._lastNight = night;
      this.audio?.setNight(night);
    }
    // Environment follows the player: shore wash near water, leaf whisper
    // under the canopy, thin gusts at altitude. Forest mask mirrors the
    // vegetation field so the sound matches the trees you see.
    const p = this.player?.position;
  // Biological sound thread: dawn chorus arpeggios by day, frog croaks at
    // water, owl hoots at night, thin keening at altitude. Throttled to
    // ~0.8 Hz so it reads as creatures in the background, not a beep.
    this._bioTimer = (this._bioTimer ?? 0) + dt;
    if (this._bioTimer > 1.25 && p && this.audio?.biomeSting) {
      this._bioTimer = 0;
      const h = this.world.heightAt(p.x, p.z);
      const shore = Math.max(0, Math.min(1, (h - 0.5) / 9));
      const forest = fbm2At(p.x * 0.0055, p.z * 0.0055);
      const altitude = Math.max(0, Math.min(1, (h - 35) / 60));
      const nightF = this.world.nightFactor ?? 0;
      this.audio.biomeSting({ shore, forest, altitude, night: nightF });
    }
    if (p && this.audio?.setEnvironment) {
      const h = this.world.heightAt(p.x, p.z);
      const shore = Math.max(0, Math.min(1, (h - 0.5) / 9));
      const forest = fbm2At(p.x * 0.0055, p.z * 0.0055);
      const altitude = Math.max(0, Math.min(1, (h - 35) / 60));
      this.audio.setEnvironment({ shore, forest, altitude });
      if (this.player.speed > 8) this.audio.whoosh((this.player.speed - 8) / 4);
    }
  }

  _updateHud() {
    if (!this.hud || this.state === 'title') return;
    const objective = objectiveFor(this.quest);
    const warden = this.enemies.activeWarden();
    const boss = this.boss?.hudState?.() ?? null;
    const playing = this.state === 'playing';
    this.hud.setCrosshair(playing && this.cameraRig.firstPerson && !this.dialogue.isOpen);
    this.hud.update({
      powers: this.powers,
      quest: this.quest,
      objective,
      region: regionNameAt(this.player.position.x, this.player.position.z),
      clock: this.world.timeOfDay,
      fps: this.fps,
      showFps: this.settings.showFps,
      formActive: isFormActive(this.powers),
      formRemaining: this.powers.formRemaining,
      formDuration: this.powers.formDuration || 1,
      boss: boss ?? (warden ? { name: warden.name, health: warden.health, maxHealth: warden.maxHealth } : null),
      interact: playing && !this.dialogue.isOpen ? this.interaction?.label ?? null : null,
    });
    this.hud.updateAimLock(playing && !this.dialogue.isOpen ? this.magic.aimTarget : null, this.camera);

    // Minimap redraws at ~15 Hz — full-rate canvas work was pure waste.
    this._minimapTimer = (this._minimapTimer ?? 0) + 1;
    if ((playing || this.state === 'finale') && this._minimapTimer % 4 === 0) {
      this.minimap.draw(this.player.position, this.cameraRig.state.yaw, {
        quest: this.quest,
        enemies: this.enemies.all(),
        lanterns: this.world.structures?.lanterns ?? [],
        lanternLit: this.quest.sideQuest?.lanternWay ?? 0,
      });
    }
  }

  _render() {
    if (this.useComposer && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /* -------------------------------------------------------------- settings */

  _applySettings(next) {
    const previousQuality = this.settings.quality;
    this.settings = normalizeSettings(next);
    saveSettings(this.settings);

    this.audio?.setVolume(this.settings.volume);
    if (this.cameraRig) {
      this.cameraRig.baseFov = this.settings.fov;
      const wanted = this.settings.cameraMode === 'first' ? CAMERA_MODES.FIRST : CAMERA_MODES.THIRD;
      if (this.cameraRig.mode !== wanted) this.cameraRig.setMode(wanted);
    }
    this.magic?.setAimOptions({
      enabled: this.settings.aimAssist,
      cone: this.settings.aimCone,
      strength: this.settings.aimStrength,
    });
    if (previousQuality !== this.settings.quality) this._applyQuality();
  }

  _applyQuality() {
    this.preset = qualityPreset(this.settings);
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.world?.setQuality(this.preset);
    if (this.bloomPass) this.bloomPass.enabled = this.preset.bloom;
    this.useComposer = this.preset.bloom;
    this._resize();
  }

  _resize() {
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    // Hard 1.5 cap: preset ratios above this (ultra 1.75) cost ~2x fill for
    // invisible gain and were the main reason the game lagged on retina.
    const dpr = Math.min(window.devicePixelRatio || 1, Math.min(1.5, this.preset.pixelRatio)) * this._renderScale;
    const old = this._lastRenderSize;
    const dimensionsChanged = !old || old.w !== w || old.h !== h;
    const ratioChanged = !old || old.dpr !== dpr;
    // setPixelRatio already resizes both renderer and composer. Avoid doing
    // the expensive allocation twice when only adaptive resolution changes.
    if (ratioChanged) this.renderer.setPixelRatio(dpr);
    if (dimensionsChanged) this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      if (ratioChanged) this.composer.setPixelRatio(dpr);
      if (dimensionsChanged) this.composer.setSize(w, h);
    }
    this._lastRenderSize = { w, h, dpr };
  }

  /** Adaptive resolution: trade pixels for frame rate under sustained load. */
  _updateAdaptiveRenderScale(step) {
    if (!step) return;
    const next = Math.max(0.6, Math.min(1, this._renderScale + step));
    if (next === this._renderScale) return;
    this._renderScale = next;
    this._resize();
  }
}
