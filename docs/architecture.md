# Aetherfall — Architecture

> Always-current inventory of every file in the project: its purpose and the
> functions it exposes. Update this file whenever code changes.

Aetherfall is an original, fully procedural 3D open-world fantasy game built
with **Three.js** and **Vite**. There are no binary art assets: terrain,
textures, characters, structures, sky, water and audio are all generated at
runtime from seeded noise and canvas drawing.

---

## 1. Project layout

```
aetherfall/
├── index.html          # shell: canvas, HUD, menus, overlays
├── package.json        # scripts + dependencies
├── public/             # (empty) static assets — none required
├── src/
│   ├── main.js         # entry point
│   ├── style.css       # all UI styling
│   ├── core/           # engine orchestration
│   ├── player/         # movement, camera, character rig
│   ├── gameplay/       # magic, combat, quests, enemies, FX
│   ├── world/          # terrain, sky, water, flora, structures
│   ├── ui/             # HUD, menus, dialogue, minimap, toasts
│   └── util/           # math, noise, RNG
├── tests/              # node:test suites (single runner: `npm test`)
└── docs/               # architecture / suggestions / to-do
```

---

## 2. Root files

### `index.html`
Single-page shell. Contains the WebGL canvas, the loading screen, title screen,
pause/settings/rematch/death/ending overlays, the full HUD (vitals, spellbar,
objective card, minimap, region row, master-mode badge, crosshair, soft-aim lock
brackets, interaction prompt, boss bar with phase pips, boss name card, dialogue
panel with skip button, toasts) and the ending panel. The rematch overlay lets a finished
player pick which phase of Vaelor to refight.
No inline logic — all behaviour is bound in `src/ui/*` and `src/core/Game.js`.

### `README.md`
Player-facing overview: how to run/build/test, controls, master-mode keys, the
spell list, the Vaelor finale and the movement feature summary.

### `docs/`
- `architecture.md` — this file; always-current file/function inventory and env vars.
- `suggestions.md` — date-stamped improvements, feature ideas and known risks.
- `to-do.md` — session task list, done items and verification commands.

### `package.json`
Project metadata and scripts:
- `npm run dev` — Vite dev server on `127.0.0.1:4173`.
- `npm run build` — production build (also the syntax/bundle check).
- `npm run preview` — preview the built bundle.
- `npm test` — single test entry point (`node --test tests/`).
Dependencies: `three@^0.186.1`. Dev: `vite@^8.3.5`.

### `src/main.js`
Boots the game. Creates `Game`, exposes it as `window.aetherfall` for debugging,
and catches fatal boot errors so the loading screen shows the failure instead of
a blank canvas.

### `src/style.css`
All presentation: design tokens (`--gold`, `--text-dim`, …), HUD layout, vitals
bars, spell slots (ready / cooling / dry states), objective card, minimap frame,
crosshair (gold dot + ring + four ticks with `cast` / `hit` states), master-mode
badge, dialogue panel and skip button, toasts, the soft-aim target bracket, every
menu screen, the rematch overlay, the HUD-free photo-mode frame, and the
responsive tweaks (including a narrow-screen hotbar that keeps all ten spell
slots inside the viewport).

---

## 3. `src/core/`

### `Game.js`
The orchestrator and single source of truth. Owns the renderer, scene, camera,
composer, entities, UI wiring, the state machine and save/load.

State machine: `loading → title → playing ⇄ paused (incl. settings) → dead → playing`,
plus the finale chain `finale (Sovereign intro) → playing (boss fight) → finale (victory) → ending → playing`.
A death during the boss fight sets `_bossRetry`, so `_respawn()` rebuilds the
arena fight at the temple instead of returning to Emberfall Camp.

Key members:
- `constructor({canvas})` — builds renderer, composer, world, entities, UI, input, then `boot()`.
- `boot()` — loads settings/save, builds the world with progress, shows the title screen.
- `_setupRenderer()` — WebGL renderer, ACES tone mapping (exposure 1.06), shadows.
- `_setupComposer()` — `EffectComposer` + `RenderPass` + `UnrealBloomPass` (0.38 / 0.72 / 0.86) + `OutputPass`.
- `_setupEntities()` — world, player, camera rig, effects, enemies, magic, NPCs, collectibles, boss, minimap, toasts, HUD, dialogue, menus.
- `_setupUI()`, `_setupInput()` — DOM handlers and key bindings.
- `_enterTitleCamera()`, `_startNewGame()`, `_continueGame()`, `_pause()`, `_resume()`, `_returnToTitle()`.
  `_continueGame()` re-derives every shard-bound power from `quest.shards` after
  hydration, so an older or partially-written save can never restore a shard
  without its spell/passive. If the save is at `FINALE`, it also repositions the
  player at the altar and toasts "The Sovereign waits…" so the boss can be retried.
- `_applySettings(next)` — normalises and persists settings, applies volume,
  FOV, camera mode and the soft-aim options (`magic.setAimOptions`), and rebuilds
  quality-dependent systems when the preset changes. Called once at boot so the
  saved aim settings are active before the first cast.
- `_resetRun()` — restores powers, quest, effects, collectibles, structures, altar
  brightness, boss state, time and spawn; also clears rematch state and photo
  mode so a new journey cannot inherit either.
- `_spawnEnemies()` — ambient spawns plus wardens for active shard stages,
  plus three staged stalkers near the camp while the veil hunt is open; syncs
  lantern visuals with side-quest progress; reattaches the boss enemy proxy
  after `Enemies.reset()`.
- `_stageAtLeast(stage)` — quest ordering helper.
- `toggleMaster()`, `setMaster(on)`, `_applyMaster()` — testing sandbox: all spells/passives, all shards, `FREE` stage, restored beacon, full vitals, unlimited mana (`powers.infinite`), cleared cooldowns; also dismisses an active boss.
- `toggleFly()`, `_shiftTime(hours)` — master-mode look-direction flight and clock nudging.
- `_teleportNext()`, `_teleportTo(poi)` — master-mode quick travel: `T` cycles
  `POI_LIST` (spawn, camp, temple, shards); `F1`–`F6` warp directly to a landmark.
- `_togglePhoto(force)`, `_updatePhoto(dt)` — HUD-free photo mode (`P`): freezes
  player movement and world combat, keeps camera look/zoom live, and shows a
  small "PHOTO MODE" caption instead of the HUD.
- `_openRematch()`, `_startRematch(phase)`, `_completeRematch()` — post-ending
  altar rematch: opens the phase-select overlay, begins the fight at the chosen
  phase (health/armour/enrage scaled to it) and returns straight to free roam on
  victory instead of replaying the ending.
- `_dialogueCooldown` — 0.45 s grace after a skip so the same keypress cannot re-open a conversation or fire an interaction.
- `_save()`, `_manualSave()` — autosave / manual save (master mode is never saved).
- `_updateInteraction()`, `_interact()`, `_talk(npc)`, `_wakeLantern()` —
  proximity prompts and dialogue; the altar offers "Challenge Vaelor" when a
  save is resumed at `FINALE` and "Challenge Vaelor Again" in `FREE` (opens the
  rematch overlay). The next Lantern Way lantern offers a wake prompt. All
  prompts are suppressed while flying.
- `_claimShard(id)`, `_questEvent(event)`, `_handleQuestEffect(effect)` —
  quest progression, including mission-complete and side-quest-complete
  rewards (max vitals).
- `_cast(id)` — validates and executes a spell, drives HUD cast feedback.
- `_onEnemyKilled()`, `_onPlayerHit()`, `_onPickup()`, `_onDeath()`, `_respawn()`.
  `_onEnemyKilled()` now routes through the quest reducer as `enemy-killed` so
  kills advance the missions and the side quest as well as the kill counter.
  `_respawn()` has an arena branch: if the player died during the boss, it revives,
  resets/restarts the encounter, teleports to the south side of the ring and keeps
  the fight going.
- `_startFinale()`, `_beginBossFight()`, `_onBossPhase(phase)`, `_onBossDefeated()`,
  `_completeFinale()`, `_continueExplore()` — the altar ritual, intro dialogue,
  hand-over to combat, phase cards, victory dialogue, ending card and free roam.
  Each phase break heals 25 health, restores 35 mana and refills stamina — the
  Beacon's answer to the Sovereign's escalation.
- `_dimAltar` is not a separate method: `_startFinale()` calls
  `world.structures.setAltarDimmed(true)` and `_onBossDefeated()` clears it before
  `world.restoreBeacon()`.
- `frame()` — RAF loop: delta clamp, state update, world/effects/magic/NPC updates, HUD sync, render.
- `_updatePlaying(dt)`, `_updatePaused(dt)`, `_updateDead(dt)`, `_updateFinale(dt)`.
  `_updatePlaying()` steps the boss after enemies and aborts if a boss hit killed
  the player; `_updateFinale()` animates the intro and opens the Sovereign dialogue.
- `_syncModel()` — first-person/third-person and Aether Form model swaps.
- `_updateHud()` — vitals, objective, boss bar, interaction prompt, minimap and
  the soft-aim target bracket; `_updateAudioNight()`, `_render()`.

#### Finale flow (first draft)

1. `RETURN` + all three shards + altar interaction → `_questEvent({type:'interact-altar'})`
   advances to `FINALE` and emits `{type:'finale'}` → `_startFinale()`.
2. `_startFinale()` dims the altar crystal, raises the boss arena, starts Vaelor's
   intro and orbits a cinematic camera around the altar.
3. After 2.4 s the Sovereign intro dialogue opens; closing/skipping it calls
   `_beginBossFight()`, which restores the player's vitals, teleports them to the
   south side of the ring, snaps the third-person camera, activates the boss and
   shows the phase bar/name card.
4. `_updatePlaying()` drives `boss.update(dt)` after enemies; phase breaks call
   `_onBossPhase()` for the card/toast and a 25 HP / 35 mana / full-stamina
   breather. Death sets `_bossRetry`.
5. Boss death runs the dissolution, then `_onBossDefeated()` restores the Beacon,
   clears the altar dim, plays the victory dialogue and finally `_completeFinale()`
   emits `finale-complete`, advances to `FREE`, shows the ending card and saves.
6. Continue Exploring returns to `playing` with `DIALOGUES.freeRoam`. A save taken
   at `FINALE` reloads at the altar with the prompt **"Challenge Vaelor"**, so the
   fight can always be retried; master mode dismisses the encounter.
7. In free roam the altar offers **"Challenge Vaelor Again"**: a phase-select
   overlay starts the encounter at Phase I, II or III. A rematch victory returns
   to exploration (`_completeRematch()`) without replaying the ending.

### `Input.js`
Keyboard/mouse abstraction with pointer lock. Maps `KeyboardEvent.code` to
actions (`forward`, `back`, `left`, `right`, `sprint`, `jump`, `dodge`, `cast`,
`spell1…10`, `interact`, `view`, `mute`, `skipDialogue`, `fly`, `descend`,
`teleport`, `master`, `timeBack`, `timeForward`, `photo`, `warp1…6`, `pause`)
and tracks per-frame press edges. `Ctrl` (either side) and right mouse both emit
`dodge`; `KeyT` cycles landmarks and `F1`–`F6` warp directly in master mode;
`KeyP` toggles photo mode.

Functions: `constructor(canvas)`, `_bind()`, `isDown(action)`, `wasPressed(action)`,
`consumeMouseDelta()`, `consumeWheel()`, `endFrame()`, `requestLock()`,
`exitLock()`, `destroy()`.

### `settings.js`
Graphics/audio/camera settings, persisted separately from the save slot.
`QUALITY_PRESETS` = `low` / `medium` / `high` / `ultra` (pixel ratio, shadow map,
bloom, grass count 8k/18k/32k/46k, tree count 760/1500/2400/3600, water
segments, terrain detail). Tests assert the presets are strictly monotonic.
`DEFAULT_SETTINGS` also carries the soft-aim options: `aimAssist` (default on),
`aimCone` (18°, clamped 2–45) and `aimStrength` (1.0 multiplier, clamped 0–1.5).
Functions: `normalizeSettings(raw)`, `qualityPreset(settings)`,
`loadSettings(storage)`, `saveSettings(settings, storage)`.

### `saveState.js`
Versioned save slot. Functions: `createSaveData(snapshot)`,
`validateSaveData(raw)`, `hydrateSaveData(data)`, `loadSave(storage)`,
`writeSave(snapshot, storage)`, `clearSave(storage)`. Master mode and flight are
deliberately not persisted.

### `AudioManager.js`
Fully procedural Web Audio: ambience noise beds (wind, sea wash, night
insects), night pad, spell/hit/pickup stings. Functions: `constructor(volume)`,
`init()`, `setVolume(v)`, `toggleMute()`, `setNight(factor)`,
`setBiomeBlend(shoreDistance)`, `_makeNoise(seconds)`, `_startAmbience()`,
`_startNightPad()`, `_tone(...)`, `_noise(...)`, `cast(spellId)`, `hit()`,
`enemyHit()`, `enemyDeath()`, `wardenDeath()`, `damage()`, `death()`, `jump()`,
`doubleJump()`, `dodge()`, `land(force)`, `footstep(surface)` (grass/sand/rock/
water), `pickup()`, `wisp()`, `talk()`, `quest()`, `beacon()`, `bossIntro()`,
`bossPhase()`, `bossSlam()`, `bossVolley()`, `bossDeath()`, `ui()`, `error()`.

---

## 4. `src/player/`

### `Player.js`
Terrain-following capsule controller with a AAA-style movement layer: asymmetric
ground/air acceleration, a sprint ramp with stamina drain, slope speed response,
steep-slope slide, variable-height jumps with jump cut, coyote time and jump
buffering, Sky Leap double jump, a stamina dodge with i-frames, heavy-landing
recovery rolls, dash, swimming, collider push-out, world clamp, and the
master-mode free-flight mode.

Functions: `constructor(...)`, `spawnAt(x,z)`, `teleport(x,y,z,yaw)`,
`_resetTransient()`, `respawn()`, `applyImpulse(x,y,z)`,
`startDash(dirX,dirZ,speed,duration)`, `startDodge(dirX,dirZ)`, `get dashing`,
`get invulnerable`, `update(dt, actions, cameraYaw, cameraPitch)`,
`_land(impact, horizontalSpeed)`, `_updateFly(dt, actions, cameraYaw, cameraPitch)`,
`_resolveColliders()`, `_clampToWorld()`, `eyePosition()`, `facing()`.

Movement notes:
- Ground acceleration is 26 m/s², braking 34 m/s²; air acceleration is 11 m/s² and
  decays with air time. Steering against momentum gets a 1.35× turn assist.
- Sprint ramps over 0.62 s, drains 34 stamina/s and blends into the target speed;
  `sprintBlend` also drives the model lean and camera FOV.
- Jump speed is 8.9 m/s (9.6 m/s for Sky Leap), with a 0.46× jump cut on early
  release, 0.12 s coyote time and a 0.16 s input buffer. Gravity is 25 m/s² rising,
  17.5 m/s² near the apex and 31 m/s² falling.
- Dodge (Ctrl / right mouse) lasts 0.3 s at 13.6 m/s with 0.34 s of i-frames,
  costs 16 stamina and has a 0.52 s cooldown. With no direction input it is a
  defensive backstep.
- `_land(impact, horizontalSpeed)` converts touchdown speed into a 0..1 force,
  squashes the rig (`model.land(force, heavy)`), plays `audio.land(force)`, emits
  biome-tinted dust plus a ring on heavy landings, dips the camera
  (`cameraRig.land(force)`) and classifies fast moving landings as rolls.
- Footstep cadence uses `strideLength(speed)` rather than a fixed timer, so
  sprinting naturally produces faster steps.
- `_updateFly` is true 3D camera-relative flight: forward follows the full look
  direction (yaw **and** pitch), so looking up climbs, looking down dives, and
  strafing stays level. Space/C remain optional vertical thrusters, Shift gives a
  2.6× boost, and the controller is clamped to the terrain floor and a 430 m
  ceiling; it skips colliders entirely so the island can be inspected freely.
  `_updateFly` also derives `flightPitch` (climb/dive angle) and `flightRoll`
  (strafe bank) and passes them to the rig, so the body leans into flight.

### `movement.js`
Pure movement maths, unit-tested without a WebGL canvas. Exports `MOVE` (all
tuning constants), `approach`, `approachAxis`, `sprintBlend`, `targetSpeed`,
`slopeSpeedFactor`, `slopeSlide`, `airControl`, `gravityFor`, `jumpCut`,
`landingForce`, `shouldRoll`, `rollProgress`, `dodgeDirection`, `canDodge`,
`dodgeSpeedAt`, `strideLength` and `flightDirection` (3D look-direction flight).
Keeping the curves here means the controller can be tuned against tests instead
of by feel alone.

### `CameraRig.js`
First/third-person camera with orbit, collision, zoom, look, shake and the title
cinematic orbit. Functions: `constructor(camera, world, settings)`, `get mode`,
`get firstPerson`, `setMode(mode)`, `toggle()`, `snap()`, `look(dx,dy,sensitivity,invertY)`,
`zoom(delta)`, `addShake(amount)`, `land(force)`, `setCinematic(active, focus, opts)`,
`update(dt, player)`, `_collide(pivot, desired)`, `_applyShake(dt)`,
`serialize()`, `restore(mode)`.

Camera feel: `land(force)` adds a short downward dip plus shake on touchdown; the
third-person pivot leads the player's horizontal velocity (up to ~1.15 m), the
boom extends slightly with speed and during dodges, and FOV widens with speed,
sprint and dodge (up to +7°). The dip decays at 8/s so landings read as a thump
rather than a lurch.

### `cameraLogic.js`
Pure camera math (unit-tested). `CAMERA_MODES`, `THIRD_PERSON`, `FIRST_PERSON`,
`createCameraState`, `toggleCameraMode`, `clampPitch`, `applyLook`,
`lookDirection`, `forwardFromYaw`, `rightFromYaw`, `thirdPersonPosition`,
`firstPersonPosition`, `isFirstPerson`, `clampDistance`, `yawFromDirection`,
`angleDelta`, `compassFraction`.

### `PlayerModel.js`
Procedural low-poly character, **rebuilt 2026-11-03**: a 3/4-scale young
traveler with a big friendly face (layered eyes with iris/pupil/catchlight,
rosy cheeks, soft smile, brows that lift when looking around), wide-brim travel
hat with red band and teal feather, black fringe and high ponytail tied in
gold, cream shirt, ox-blood vest with pale trim, teal mantle, orange scarf,
brown belt with pouch and scroll, knee wraps, lace-up boots, gold ankle rings
and a carved-wood staff with brass rings, a three-prong claw, bright teal
crystal, orbiting shards and a visible point light. Aether Form aura and a
separate first-person staff viewmodel are unchanged in structure.

Functions: `makeGradientMap()`, `toon(color)`, `part(...)`,
`constructor()`, `_build()`, `_buildViewModel()`, `setFirstPerson(first)`,
`setForm(form)`, `triggerCast()`, `land(force, heavy)`, `jump()`, `dodge()`,
`update(dt, state)`, `get eyeHeight`, `faceYaw(yaw, dt, lambda)`.

The rig is split into `hips` and `chest` groups so the pelvis and shoulders can
counter-rotate. The model faces **-Z**; positive X swings a hanging limb
forward, knees bend on negative X and elbows on positive X. `update()` consumes
`{ speed, grounded, vy, dashing, dodging, roll, form, sprinting, sprintBlend,
slope, airTime, flying, turn, flightPitch, flightRoll }`, samples the pure gait
module, and adds
heel-strike/toe-off ankle roll, body bob and sway, turn banking, landing squash,
jump stretch, dodge tuck, roll tuck, heavy-landing brace, idle
weight shift/breathing/head look, cape/scarf/coat-tail/ponytail spring lag, hat
lag, staff trail, brow lift, Aether Form hover + ground ring and the first-person
staff bob. In flight the torso and hips pitch toward the velocity vector and the
body banks into strafes. The first-person viewmodel has a bare-skinned gripping
hand with a leather half-glove and three fingers wrapped around the shaft; its
position pulls inward on portrait/narrow aspect ratios so it stays on screen.

### `gait.js`
Pure procedural gait maths, unit-tested without a WebGL canvas.
Exports `RUN_SPEED` (7.2 m/s), `runBlend(speed)`, `gaitPose(phase, speed)`,
`landSquash(elapsed, duration, strength)` and `capeLift(speed, vy)`.
`gaitPose()` returns hip/knee/ankle/arm/elbow rotations, vertical bob, lateral
sway and hip/chest counter-rotation for one stride.

---

## 5. `src/gameplay/`

### `spellData.js`
Pure data: `SPELLS` (ten hotbar spells: ember bolt, frost nova, gale dash,
storm lance, aegis, aether form, rime spear, pyre wave, thunderfall, aether
barrage), `SPELL_ORDER`, `PASSIVES`, `POWER_UNLOCKS`, `STARTING_SPELLS`,
`getPower(id)`, `isSpell(id)`, `isPassive(id)`, `unlocksForShard(shardId)`.

Every directed spell declares an `aim` mode (`lead` / `snap` / `strike` /
`none`), an optional `aimStrength`, and `projectileSpeed` where leading matters.
`POWER_UNLOCKS` grants `rimeSpear` with the Grove shard, `pyreWave` with the
Ruins shard, and `thunderfall` + `aetherBarrage` with the Peak shard.

### `powerState.js`
Authoritative magic rules — mana, health, stamina, shields, cooldowns, slows and
Aether Form. Pure and unit-tested so the UI can never bypass costs.
`MAX_HEALTH/MANA/STAMINA`, `createPowerState`, `hasPower`, `hasSkyLeap`,
`unlockPowers`, `spellStatus`, `canCast`, `castSpell`, `tickPowers`,
`applyDamage`, `healPlayer`, `restoreMana`, `consumeStamina`, `isFormActive`,
`formSpeedMultiplier`, `formDamageMultiplier`, `formJumpMultiplier`, `revive`,
`serializePowers`, `deserializePowers`, `castFailMessage`, `powerName`.

`createPowerState()` includes an `infinite` flag (default `false`). Master mode
sets it so `canCast` ignores mana, `castSpell` spends none, and `spellStatus`
reports every spell affordable. The flag is never serialized, so loading a save
always restores normal costs.

### `combat.js`
Pure combat maths. `explosionFalloff`, `mitigate`, `pickChainTargets`,
`combineSlows`, `tickSlows`, `knockbackVector`, `computeDamage`, `healthRatio`.

### `aim.js`
Pure soft-aim selection, predictive intercept and line-of-sight. Exports
`aimPoint(enemy)` (centre mass at `position.y + hitHeight * 0.7`),
`pickAimTarget(origin, direction, enemies, opts)` (cone/range filtering, boss
bias, optional `filter` callback), `predictIntercept(origin, point, velocity,
speed, maxLead)` (solves the projectile/target quadratic, clamps the lead and
falls back to the current point), `solveAim(direction, origin, target, opts)`
(returns the blended `direction`, predicted impact `point` and lead distance),
`assistedDirection(...)` (compatibility wrapper), `hasLineOfSight(origin,
point, heightAt, opts)` (heightfield march that rejects targets behind terrain)
and `aimConfig({enabled,cone,strength})` (converts the player's degree/multiplier
settings into a clamped runtime cone in radians and strength multiplier).
Unit-tested without WebGL.

### `Magic.js`
Spell execution and all spell FX. Owns projectile, dash and shield visuals.
Functions: `constructor({... onHit})`, `_buildShield()`, `_buildProjectilePool()`,
`_buildPiercePool()`, `_buildBarragePool()`, `_buildPyrePool()`, `_buildAimMarker()`,
`_clearShot(origin,point)`, `_strikePoint(target)`, `_groundAimPoint(origin,direction,range)`,
`_showAimMarker(point,color)`, `_updateAimMarker(dt)`, `setAimOptions(options)`,
`cast(spellId, aim)`,
`_forward()`, `aimFromCamera(camera)`, `_spawnProjectile(origin, direction)`,
`_castEmber`, `_castNova`, `_castDash`, `_jaggedBeam(from,to,opts)`, `_castLance`,
`_castAegis`, `_castForm`, `_castRimeSpear`, `_castPyreWave`, `_castThunderfall`,
`_impactThunderfall(strike)`, `_castBarrage`, `shieldBreak()`, `update(dt)`,
`_explodeEmber(position, directHit)`, `get formActive`, `clear()`.

Aim: `cast()` accepts either a `THREE.Vector3` or a plain `{x,y,z}` for
`origin`/`direction`. Directed spells run a soft-aim pass through
`pickAimTarget` + `solveAim`: the target must be inside the spell's range cone
and have terrain line of sight, and lead-aim spells solve the intercept so the
shot is fired at the point the enemy **will occupy on arrival**. The last cast
exposes `aimTarget`, `aimPoint` (predicted impact point) and `aimLead` (metres of
lead), and a billboard marker flashes at the impact point. `aimAssist` can be
switched off, and `setAimOptions({enabled, cone, strength})` feeds the player's
cone/strength settings into `pickAimTarget`/`solveAim`. A successful lock keeps
`aimTarget` for 1.2 s (`aimLockTimer`) so the HUD can draw a bracket on it.

New offensive spells:
- **Rime Spear** (`pierce`): fast ice lance that impales every enemy in a line,
  applies a slow and shatters on terrain/water/range.
- **Pyre Wave** (`cone`): 14 m, ~109° rolling flame arc with distance falloff
  and heavy knockback. Ground rings, ember bursts and 12 pooled flame billboards
  (`_buildPyrePool`) hug the terrain, so the wave does not bury itself on slopes.
- **Thunderfall** (`strike`): 0.32 s telegraphed pillar at the target's predicted
  ground point; heavy AoE damage and a screen-shaking impact.
- **Aether Barrage** (`barrage`): six seeking motes that split across nearby
  enemies and steer toward their assigned target.
- In first person, directed spell origins are pushed 2.1 m forward before the
  muzzle FX spawn, and Rime Spear's muzzle ring/flash are reduced, so casting
  does not white out the camera.

Notable behaviour:
- Ember Bolt: layered halo/core/glow projectile, dense trail, three-burst
  detonation with two flash billboards, ring and light.
- Frost Nova: three rings, rising ice sparks, white motes, central flash.
- Gale Dash: chest flash, wind cone, two rings, light, camera shake.
- Storm Lance: `_jaggedBeam()` builds a segmented lightning path (wide violet +
  thin white core) between each chain target, with impact flashes.
- Aegis: dome rings, gold motes, flash, light; the bubble is hidden in
  first person because the camera would sit inside the wireframe.
- Aether Form: three rings, two flashes, 170 particles and a large light.
- `onHit` callback drives the HUD crosshair hit marker.

### `Effects.js`
Pre-allocated FX pools: spark particles (`Points` + custom shader), expanding
rings, beams, floating damage numbers, short-lived point lights and billboard
flashes. Functions: `constructor(scene, opts)`, `burst(position, opts)`,
`ring(position, opts)`, `beam(from, to, opts)`, `damageNumber(position, value, opts)`,
`light(position, opts)`, `flash(position, opts)`, `update(dt)`, `clear()`.

Flash opacity now falls off aggressively with camera proximity
(`0.06 + 0.94 * near²` over a 2.4× radius window), so a muzzle blast or close
detonation stays readable instead of turning into a bloom white-out.

The optional `camera` passed in `opts` is used to fade a flash that is very
close to the lens — without it a 7 m additive sprite two metres from the camera
plus bloom whites out the whole frame (this was a real bug with Frost Nova and
Aether Form).

### `Enemies.js`
Enemy factory, AI, projectiles and damage. Functions: `part(...)`,
`glowSprite(...)`, `buildBody(type)`, `constructor(...)`, `_buildProjectiles()`,
`spawnAmbient(count)`, `spawnWarden(shardId)`, `spawn(type,x,z,opts)`, `all()`,
`inRadius(position,radius)`, `nearestAlive(position,maxDist)`, `activeWarden()`,
`wardenFor(shardId)`, `activateWardens()`, `damage(enemy,amount,opts)`,
`damagePlayer(damage,opts)`, `slow(enemy,factor,duration)`, `_kill(enemy)`,
`_fireProjectile(enemy)`, `_hitPlayer(...)`, `despawn(enemy)`, `update(dt,elapsed)`,
`reset()`.

Every enemy carries a world-space `velocity` vector refreshed each AI tick
(zeroed while dead or dormant) so predictive aim can lead moving targets.

Boss support: enemies flagged `isBoss` are skipped by `Enemies.update` because
`FinalBoss` drives their movement and attacks. `damage()` respects an
`invulnerable` flag (showing a blue 0), and calls `enemy.onDefeat` instead of the
normal kill path when present. `damagePlayer()` is the single gate for every
source of player damage (melee, projectiles, boss orbs, shockwaves); it checks
`player.invulnerable` so dodge i-frames cannot be bypassed by any attacker.

### `bossPhases.js`
Pure boss tuning and rules for Vaelor: `BOSS` (id, name, title, 2100 HP, 25.5 m
arena, 3 phases, phase names, cooldowns, projectile/summon counts, damage tables),
`healthRatio`, `bossPhase`, `nextPhase`, `phaseStartRatio`, `attackCooldown`,
`volleyCount`, `riftCount`, `summonCount`, `slamDamage`, `cleaveDamage`,
`volleyDamage`, `telegraphDuration`, `bossArmor`, `shouldPhaseTransition`,
`clampToArena`, `attackPattern`, `phaseColor`, `enrageAmount`.

### `bossPose.js`
Pure body-language targets for Vaelor, unit-tested without WebGL. Exports
`NEUTRAL_POSE`, `neutralPose()`, `idlePose(time)` and
`actionPose(kind, phase, progress, recovering)`. `actionPose` coils the torso
and blade for cleave, raises both arms for slam, channels volleys/storms, spreads
the arms for rifts/summon, and blends back to neutral during recovery. Later
phases exaggerate the same silhouette. The renderer damps toward these targets in
`FinalBoss._animatePose()`.

### `FinalBoss.js`
The first-draft finale encounter: **Vaelor — The Veil Sovereign**, a fully
procedural three-phase boss at the Beacon. Builds the arena dome/lattice/ring,
runes and corruption disc, the Sovereign model (layered robe, ragged hem, plate
armour, pauldrons, masked head, crown shards, halo, cape panels, floating rings,
orbiting shards, Veilblade), pooled orbs/telegraphs/shockwaves, and an enemy proxy
registered with `Enemies` so every existing spell, chain, damage number and hit
marker works.

Functions: `part(...)`, `glowSprite(...)`, `clothPanel(...)`, `constructor(...)`,
`_buildArena()`, `_buildModel()`, `_buildOrbs()`, `_buildTelegraphs()`,
`_buildShockwaves()`, `_buildEnemy()`, `attach()`, `begin(startPhase)`, `activate()`,
`reset()`, `dismiss()`, `get active`, `hudState()`, `_restoreMaterials()`,
`_applyPhaseVisuals()`, `_enterPhase(phase)`, `update(dt)`, `_animate(dt)`,
`_animatePose(dt,t)`, `_updateRimLight(t)`, `_placeSlash()`, `_move(dt)`,
`_updateAction(dt)`, `_chooseAttack()`, `_startAction(kind)`,
`_fireAction(kind)`, `_stylizeEcho(enemy)`, `_beginDeath()`, `_updateDeath(dt)`, `_spawnOrb(...)`,
`_updateProjectiles(dt)`, `_deactivateOrb(slot)`, `_clearOrbs()`,
`_spawnTelegraph(...)`, `_updateTelegraphs(dt)`, `_triggerTelegraph(slot)`,
`_clearTelegraphs()`, `_spawnShockwave(...)`, `_updateShockwaves(dt)`,
`_clearShockwaves()`, `_clearAdds()`, `_clampPlayer()`, `_updateBarrierFx(dt)`.

Flow: `begin(startPhase = 1)` raises the arena, scales Vaelor in from 0.08 and
makes the proxy invulnerable; an optional start phase (1–3) sets his starting
health (`phaseStartRatio`), armour and enrage for the post-ending rematch.
`activate()` starts combat. Phase breaks at 66 % and 33 % health
clear orbs/telegraphs/adds, tint the model (violet → pink → red), play
`audio.bossPhase()`, and call `onPhase`. Attacks are pattern-driven per phase:
cleave (frontal arc), volley (3/5/9 orbs), slam (telegraph + expanding shockwave),
void rifts (3/5 telegraphed strikes), storm (radial orb ring + homing lances) and
summon (masked **Veil Echo** adds: smaller, violet-tinted drifters with a glowing
mask, aura and shoulder ring, 52 HP). `_beginDeath()` plays the dissolution, then calls
`onDefeated` after 3.4 s. `hudState()` returns `{name, health, maxHealth, phase,
phaseCount, phaseName, enraged}` while the fight is active. `_clampPlayer()` keeps
the player inside the ring; `_move()` keeps Vaelor inside a 20.5 m inner radius
and outside a 5.5 m altar exclusion so he never clips the pedestal.
The model's front lights, core glow and aura were deliberately toned down so
bloom does not turn the Sovereign into a white silhouette. Readability pass:
glowing armour trim (collar, chest bars, belt, pauldron rims), a visor slit and
forehead gem, a camera-facing rim light, a normal-blended cleave wedge with a
bright outer edge, a soft radial corruption pool, and a blob shadow under the
hovering boss. `_animatePose()` coils the body during wind-ups and follows
through during recovery, so cleave/slam/rift telegraphs read from the body as
well as the floor.

### `NPCs.js`
Wisp companion and Sable the hermit. Functions: `toon(color)`,
`constructor(...)`, `_buildWisp()`, `_buildSable()`, `get(id)`,
`nearest(position,maxDist)`, `moveWispTo(position)`, `update(dt,elapsed,playerPos)`.

The Wisp is a loose companion: it keeps a ~4 m standoff, only starts drifting
toward the player past 6.2 m, eases away under 4.2 m and otherwise wanders
around its own position. While the player is flying it stops closing/backing
away and simply drifts, so it does not chase a player crossing the island. Its four motes are small, dim sprites in a 0.5 m orbit
so they read as a creature's aura rather than bubbles glued to the camera.

### `Collectibles.js`
Aether motes (mana) and Emberblooms (health) with respawn timers.
Functions: `constructor(...)`, `_build()`, `_create(kind,x,y,z,rng)`,
`update(dt,elapsed)`, `setVisible(visible)`, `reset()`.

### `questState.js`
Pure quest reducer. `STAGES`, `STAGE_ORDER`, `MISSIONS` (emberTrial 3, veilHunt
5), `SIDE_QUEST` (lanternWay 8), `createQuestState`, `totalKills`,
`missionDone`, `sideQuestDone`, `missionList`, `shardCount`,
`hasAllShards`, `nextShardLocation`, `questReducer`, `objectiveFor`,
`objectiveTarget`, `serializeQuest`, `deserializeQuest`.

The `RETURN` objective is gated by the two pre-finale missions: the altar
will not fire `finale` until both are complete (it emits a toast instead).
`enemy-killed` is the only event that advances missions/side quest; the ember
trial is open from `SHARDS` onward, the veil hunt only from `RETURN` onward,
and the lantern way is open for the whole run. The `FINALE` objective is
**"Face the Veil Sovereign"** with the hint "Vaelor guards the Beacon. Break
him." and the temple marker.

### `story.js`
All narrative text: `SPEAKERS` (wisp, sable, player, beacon, sovereign),
`DIALOGUES`, `ENDING_LINES`, `DEATH_TEXT`, `dialogueForShard(shardId)`,
`buildEndingStats(...)`.

Boss content: `DIALOGUES.sovereignIntro` (Vaelor tears free of the ritual and
challenges the Wayfarer) and `DIALOGUES.sovereignVictory` (his last words, the
wisp, Sable and the Beacon). `SPEAKERS.sovereign` is named **Vaelor** with a
violet name colour; the ending lines acknowledge his defeat.

---

## 6. `src/world/`

### `World.js`
Composition root for the island. Builds terrain → sky → water → vegetation →
structures with progress callbacks and one frame between steps.
Functions: `nextFrame()`, `constructor(scene,renderer,quality)`, `build(onProgress)`,
`heightAt`, `rawHeightAt`, `slopeAt`, `biomeAt`, `isLand`, `get timeOfDay`,
`setTimeOfDay`, `get nightFactor`, `get shardSites`, `get altar`,
`update(dt,cameraPos,playerPos,opts)`, `restoreBeacon()`, `get beaconRestored`,
`setQuality(preset)`.

### `heightfield.js`
Analytic island heightfield (seeded FBM + ridged mountains + flatten zones).
`createHeightfield(options)` returns `height`, `rawHeight`, `slope`, `normal`,
`biome`, `isLand`, `islandRadius`.

### `locations.js`
World constants and POIs: `WORLD`, `LOCATIONS`, `SHARD_LOCATIONS`,
`FLATTEN_ZONES`, `POI_LIST`, `regionNameAt(x,z,locations)`.

### `Terrain.js`
Island mesh with per-vertex biome colours (sand → grass → rock → snow), detail
and normal maps. `_vertexColor` layers a mid-scale warm/cool patch mask, an
altitude cooling term, the same forest mask the tree scatter uses (so woods read
as dark ground from the air), slope-gated rock outcrops, dirt patches in the
meadows and a fine grain FBM so close-ups do not look single-coloured.
Functions: `constructor`, `build()`, `_vertexColor(x,z,h,slope,out)`,
`setQuality(settings)`. The detail normal map tiles 40× (an earlier 110× tiling
produced visible diagonal hatching from the air), uses 8× anisotropy, and
`normalScale` runs 0.23–0.28 across quality presets.

### `Sky.js`
Procedural sky dome (gradient, sun disk/halo, moon, stars, clouds), sun/moon/
hemisphere lights and exponential fog driven by time of day.
Functions: `constructor(scene,renderer,settings)`, `setTimeOfDay(hours)`,
`setRestored(value)`, `getSunDirection()`, `update(...)`, `_refresh(...)`,
`setQuality(settings)`.

### `Water.js`
Animated ocean plane with a custom shader: gerstner-ish vertex swells plus a
`waveNormal()` fragment function that samples a scrolling FBM field three times
to build per-pixel wave normals (strong near the camera, blended back to the
geometric normal past ~280 m), fresnel sky mix, crest lighting, tight specular,
a broad sun-glitter path and shoreline foam.
Functions: `constructor(scene,heightfield,settings)`, `build()`,
`update(elapsed, sky)`.

### `Vegetation.js`
Instanced trees (pines + broadleaf), a second instanced shrub undergrowth,
boulders, the player-following grass field (with sparse wildflower-tinted
tufts) and night fireflies. Functions: `addWind(material, opts)`,
`constructor(scene,heightfield,settings)`, `build()`, `_buildTrees()` (now also
builds the shrub layer), `_buildRocks()`, `_buildGrass()`, `_fillGrass(center)`,
`_buildFireflies()`, `_clearOfPOIs(x,z,pad)`, `_flowerTint(x,z)`,
`update(dt,elapsed,playerPos,nightFactor)`, `setQuality(settings)`.

Grass notes: each tuft is a real seven-triangle fan (tapered blades with a
dark base and sunlit tip baked into vertex colours), not crossed billboards.
Per-instance tilt, a world-space clump-noise height mask, gentle HSL brightness
tints, a beach fade and a rim fade keep the follow-field varied and edge-free.
Sparse wildflower tints (cream/pink/blue) are sampled in world space so the
patches stay fixed while walking. `addWind(..., { bothSides: true })` inlines
`ShaderChunk.normal_fragment_begin` with `float faceDirection = 1.0;`, so the
unlit back face of a blade keeps the up-facing normal instead of flipping
black. The field is a 40 m radius disc (`GRASS_RADIUS`) whose instance radii
are biased toward the camera (`pow(rng, 0.62)`), and it re-centres once the
player is 3 m from the last centre.

Tree notes: layered four-cone pines and five-blob broadleaf canopies; trunks are
three offset cylinder segments plus two branch stubs with a warm emissive term,
so canopy-shadowed trunks no longer read as black rectangles. The shrub layer
is a three-blob blob cluster scattered with the same forest mask (density
raised), so forests read as depth from the air instead of a single-tree grid.

### `Structures.js`
Temple, camp, shard shrines, ruins, waystones, the Lantern Way lanterns,
floating islands, clouds and crystals, plus shard/beacon state. Functions:
`glowMaterial`, `add(...)`, `glowSprite(...)`, `constructor(scene,heightfield)`,
`build()`, `_heightAt`, `_buildTemple()`, `_buildCamp()`, `_buildShrines()`,
`_buildRuins()`, `_waystone(...)`, `_buildWaystones()`, `_buildLanterns()`,
`setLanternsLit(count)`, `get lanternProgress`, `nextLantern()`,
`_buildFloatingIslands()`, `_buildClouds()`, `_buildCrystals()`,
`setShardSealed(id,sealed)`, `reset()`, `setAltarDimmed(dimmed)`,
`collectShard(id)`, `restoreBeacon()`, `update(dt,elapsed,questState)`,
`setQuality()`.

The eight Lantern Way lanterns (side quest) are stone posts with a gold
flame, halo and point light. `setLanternsLit(count)` lights the first *count*
of them; the next one is shown ringed on the minimap.

`setAltarDimmed(true)` hides the altar crystal and its glow and dims the crystal
light while the boss holds the arena; the `altar` animation case reads
`altarDimmed` so the per-frame pulse cannot override the dim. It also hides the
restored Beacon's 420 m beam and 28 m glow sprite — both sit at the arena centre
and otherwise turn a rematch into a white bloom. `_onBossDefeated()` clears the
flag before `restoreBeacon()` so the Beacon blazes back at full strength.

Floating islands are built from a main inverted cone plus two offset spurs, a
soil cap, a moss plateau, nine hanging roots, five trees and six orbiting
debris rocks, with a low emissive term so the undersides do not read as black
silhouettes. The beacon beam uses `createBeamTexture()` (vertical alpha ramp)
at 0.17 opacity so it dissolves into the sky instead of ending on a hard edge.

### `textures.js`
Procedural canvas textures. `canvas2d`, `createNoiseTexture`,
`createNormalTexture`, `createGrassTexture`, `createBeamTexture`,
`createGlowTexture`, `createFlameTexture`, `createNameTag`, `createHealthBar`,
`createCloudTexture`.

`createGrassTexture()` draws a tuft: a thatch base plus two layers of curved,
tapering leaves (18 total) and a 1.1 px softening pass. Straight triangular
blades were the reason the old field looked like a bristle brush.

`createFlameTexture()` draws a transparent flame silhouette (bright core, ragged
orange tongues) for Pyre Wave's normal-blended billboards, so the fire wall stays
readable in daylight instead of washing out like an additive sprite.

---

## 7. `src/ui/`

### `HUD.js`
Vitals, spellbar, objective card, region/clock, shard count, boss bar (warden and
final-boss variants), form timer, interaction prompt, damage flash, crosshair,
master badge and the boss name card.

Functions: `constructor(doc)`, `_buildSpellbar()`, `show()`, `hide()`,
`setCrosshair(visible)`, `updateAimLock(target,camera)`, `setMaster(on, flying)`,
`pulseCast()`, `flashHit()`,
`_text`, `_bar`, `update(state)`, `_updateSpells(powers)`, `flashSpell(id)`,
`markNew(ids)`, `_setBossPips(phase,count)`, `showBossCard(data,duration)`,
`hideBossCard()`, `_pulseObjective()`, `flashDamage()`, `setCinematic(active)`.

`updateAimLock()` projects the locked enemy's chest into screen space and draws
four gold corner brackets (`#aim-lock`); it hides for null/dead/off-screen
targets. The final-boss HUD swaps the warden bar for a wide bottom bar with phase
counter, three phase pips and the phase name; `body.boss-fight` hides the objective card
and control hints so the bar does not collide with them. `showBossCard()` is used
for the intro and each phase break; it restarts its CSS animation and auto-hides.

### `Menus.js`
Screen manager for loading/title/pause/settings/rematch/death/ending.
Functions: `constructor(...)`, `_on(id,event,fn)`, `_bind()`, `_syncLabels()`,
`_readSettings()`, `_emitSettings()`, `applySettings(settings)`, `_show(id)`,
`_hide(id)`, `setLoading(progress,label)`, `hideLoading()`,
`showTitle(hasSave)`, `hideTitle()`, `showPause()`, `hidePause()`,
`showSettings(origin)`, `closeSettings()`, `showRematch()`, `hideRematch()`,
`showDeath()`, `hideDeath()`, `showEnding(...)`, `hideEnding()`,
`get overlayOpen`, `get settingsOpen`, `hideAll()`. The rematch overlay has one
button per boss phase plus a cancel button that resumes the game.

### `Dialogue.js`
Typewriter dialogue with speaker names, choices and a skip path that still fires
`onComplete` so quests advance. Functions: `constructor(doc)`, `show(lines,opts)`,
`_startLine()`, `advance()`, `skip()`, `close()`, `update(dt)`, `get isOpen`,
`get progress`.

### `Minimap.js`
Pre-baked island minimap with live player/shard/enemy/lantern markers.
Functions: `constructor(canvas,world)`, `_project(x,z,scale)`, `_bake()`,
`get metresPerPixel()`, `draw(player,yaw,state)` — `state` now also carries
`lanterns` (geometry) and `lanternLit` (count); lit lanterns are gold, the
next one is ringed.

### `Toasts.js`
Transient notifications. `constructor(doc)`, `push(text,kind,duration)`, `clear()`.

---

## 8. `src/util/`

### `math.js`
`TAU`, `clamp`, `lerp`, `invLerp`, `smoothstep`, `smootherstep`, `damp`,
`wrapAngle`, `dampAngle`, `distSq2D`, `dist2D`, `randomRange`, `randomInt`,
`pick`, `approach`, `formatClock`, `formatDuration`.

### `noise.js`
Seeded value noise: `hash2`, `hash1`, `valueNoise2`, `signedNoise2`, `fbm2`,
`ridged2`, `warpedFbm2`.

### `rng.js`
Deterministic RNG: `mulberry32(seed)`, `createRng(seed)` (returns `next`,
`range`, `int`, `pick`, `chance`).

---

## 9. Tests

Single entry point: **`npm test`** (`node --test tests/`).

| File | Covers |
| --- | --- |
| `tests/aim.test.js` | soft-aim cone/range filtering, target scoring, boss bias, centre-mass point, direction blending, predictive intercept/lead, LOS rejection, aim-config conversion/clamping |
| `tests/boss.test.js` | phase thresholds, attack pacing, telegraph fairness, arena clamp, patterns/colours |
| `tests/bossPose.test.js` | neutral/idle poses, cleave coil/follow-through, slam rise/drop, rift/summon silhouettes, phase exaggeration, recovery settle |
| `tests/camera.test.js` | camera state, look direction, mode toggle, positioning |
| `tests/combat.test.js` | falloff, mitigation, chain targeting, slows, knockback, damage, health ratio |
| `tests/gait.test.js` | run blend, gait symmetry/continuity, knee/ankle limits, heel strike, landing squash, cape lift |
| `tests/heightfield.test.js` | terrain height/slope/biome determinism |
| `tests/movement.test.js` | acceleration, sprint ramp, slopes, air control, jump cut, dodge vectors/i-frames, landing rolls, stride, 3D flight direction |
| `tests/noise.test.js` | hash/value noise/FBM ranges and determinism |
| `tests/powers.test.js` | mana, cooldowns, casting, damage, form, infinite mana, serialization |
| `tests/spells.test.js` | ten-slot hotbar integrity, new attack configs, unlock coverage, mana/cooldown rules |
| `tests/quest.test.js` | quest reducer stages, shard objectives, FINALE objective, mission gating and side-quest progress |
| `tests/save.test.js` | save validation, hydration, round-trip |
| `tests/settings.test.js` | defaults, clamping, aim options, presets incl. ultra, storage |
| `tests/story.test.js` | every dialogue speaker resolves, Sovereign intro/victory, ending copy, shard fallback |

---

## 10. Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Sprint (boost while flying) |
| `Ctrl` / Right mouse | Dodge roll (i-frames) |
| `Space` | Jump / double jump / optional lift in flight |
| `C` | Optional descend in flight |
| `F` | Toggle look-direction flight (master mode) |
| `` ` `` | Toggle master mode |
| `[` / `]` | Shift time ±2 h (master mode) |
| `T` | Teleport to the next landmark (master mode) |
| `F1`–`F6` | Warp to a specific landmark (master mode) |
| `1`–`0` | Cast spell in that slot |
| Mouse wheel | Zoom camera |
| `P` | Photo mode (HUD-free look/zoom) |
| `Left click` / `E` | Cast / interact |
| `V` | Toggle first/third person |
| `X` / Skip button | Skip dialogue |
| `M` | Mute |
| `Esc` | Pause |

---

## 11. Environment variables

Aetherfall has **no server component and no environment variables**. Everything
runs client-side:
- No `.env` file is read, and no `import.meta.env.*` values are referenced.
- Vite's built-in `NODE_ENV` / `MODE` are used only internally by the bundler.
- Persistence uses browser `localStorage` keys `aetherfall.save.v1` and
  `aetherfall.settings.v1` (see `src/core/saveState.js`).

If a backend, analytics or asset CDN is added later, document its variables here
with purpose and referencing file.
