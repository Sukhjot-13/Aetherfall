# Aetherfall — To-do

## Done this session (2026-10-26)

### Movement overhaul
- [x] `src/player/movement.js` pure tuning module: asymmetric accel/braking,
      sprint ramp, slope response/slide, air control, apex gravity, jump cut,
      landing force/roll classification, dodge vector/i-frames, stride length.
- [x] `Player.js` rewritten around the module: sprint stamina ramp, slope speed,
      steep-slide, jump buffer + coyote + variable height, dodge with i-frames,
      heavy-landing rolls, camera dip, visual-Y smoothing, stride footsteps.
- [x] `PlayerModel` dodge tuck, roll tuck, heavy-landing brace, sprint/slope lean.
- [x] `CameraRig` touchdown dip, velocity look-ahead, speed/dodge FOV kick, sprint
      boom extension.
- [x] `Ctrl` / right mouse dodge; `Input` action added.
- [x] `tests/movement.test.js`.

### Final boss — Vaelor, the Veil Sovereign
- [x] `src/gameplay/bossPhases.js` pure phase/attack/arena rules.
- [x] `src/gameplay/FinalBoss.js` procedural arena + model, three phases,
      cleave/volley/slam/rifts/storm/summon attacks, telegraphs, shockwaves,
      adds, death sequence, HUD payload.
- [x] `Enemies` boss proxy support, invulnerability, `onDefeat`, central
      `damagePlayer`, `despawn`.
- [x] `Game` altar → intro → fight → victory → ending flow, arena respawn on
      death, save/load retry at `FINALE`, master-mode dismiss.
- [x] Boss HUD: phase counter, pips, phase name, bottom final-boss bar, name card.
- [x] Sovereign dialogue + ending copy; FINALE objective.
- [x] Altar crystal dim during the fight so bloom cannot white out the arena.
- [x] `tests/boss.test.js`, `tests/story.test.js`; `npm test` → 140 passing.

### Boss readability & telegraphs (2026-10-28)
- [x] `src/gameplay/bossPose.js` pure pose targets: idle sway, cleave coil and
      follow-through, slam rise/drop, volley/storm channel, rift/summon spread,
      phase exaggeration, recovery settle.
- [x] `FinalBoss._animatePose()` damped body/head/arm/blade poses; wind-ups and
      recoveries now read from the body, not only the floor FX.
- [x] Cleave telegraph is a normal-blended floor wedge with a bright outer edge.
- [x] Glowing armour trim (collar, chest bars, belt, pauldron rims), visor slit,
      forehead gem, camera-facing rim light.
- [x] Soft radial corruption pool and a blob shadow under the hovering boss.
- [x] Unique **Veil Echo** adds: smaller violet drifters with a glowing mask,
      aura, shoulder ring and 52 HP, created by `_stylizeEcho()`.
- [x] `tests/bossPose.test.js`; `npm test` → 140 passing.

### Earlier this session
- [x] True 3D master-mode flight: `W` follows camera yaw **and** pitch (look up to
      climb, look down to dive), strafe stays level, Space/C remain thrusters.
- [x] Soft aim assist for Ember Bolt / Storm Lance: 18° cone, 70 m range, boss
      bias, centre-mass blending; `src/gameplay/aim.js` + `tests/aim.test.js`.
- [x] Master mode now has genuinely unlimited mana (`powers.infinite`, never
      saved) instead of only refilling on toggle.
- [x] `npm test` → 140 passing.
- [x] Master mode: `` ` `` toggle + pause-menu button, all spells/passives,
      all shards, `FREE` stage, restored beacon, infinite vitals, cleared cooldowns.
- [x] Master-mode flight: `F` toggle, look-direction 3D movement, Space/C lift,
      Shift boost, terrain clamp, no colliders, flying character pose.
- [x] Master-mode clock control: `[` / `]` ±2 h.
- [x] HUD master badge with FLYING state.
- [x] Crosshair redesign: gold dot, thin ring, four ticks, cast/hit feedback.
- [x] Crosshair hit marker wired from spell damage via `Magic.onHit`.
- [x] Grass fixes: no centre hole, up-facing normals, brighter texture, tinted
      transparent texels (no black mip fringes), beach fade, rim fade, denser
      field, smaller blades.
- [x] Tree/rock instance colours no longer multiply an already-dark material
      colour (they were rendering almost black).
- [x] First-person staff viewmodel scaled and repositioned; crystal glow toned down.
- [x] Aegis bubble hidden in first person (wireframe no longer smears the screen).
- [x] Spell FX upgrade: flash pool, layered Ember Bolt detonation, jagged Storm
      Lance beams, Frost Nova shards, Gale Dash wind burst, Aegis motes, Aether
      Form double flash.
- [x] `ultra` quality preset; higher grass/tree counts across presets.
- [x] Reduced fog density and raised sun/hemi intensity for clearer vistas.
- [x] `tests/combat.test.js` added; docs updated.

### First-draft finish pass (2026-10-28)
- [x] Four new offensive spells: Rime Spear (piercing line + slow), Pyre Wave
      (wide fire cone), Thunderfall (delayed storm pillar), Aether Barrage (six
      seeking motes). Ten-slot hotbar with `1`–`0` bindings.
- [x] Predictive impact aiming: `solveAim()` / `predictIntercept()` lead moving
      targets by projectile travel time, `hasLineOfSight()` rejects shots through
      terrain, and a marker flashes at the predicted impact point.
- [x] Enemy velocity tracking (normal enemies + boss proxy) for lead aim.
- [x] Flight body pitch/bank (`flightPitch` / `flightRoll` through `PlayerModel`).
- [x] Photo mode (`P`): HUD-free look/zoom with a subtle mode caption.
- [x] Post-ending boss rematch with Phase I/II/III selection at the altar.
- [x] Real seven-triangle grass tufts (vertex-coloured dark base / sunlit tip)
      replacing crossed billboards; denser forests across every quality preset.
- [x] First-person staff hand rebuilt with bare skin, half-glove and fingers;
      the viewmodel pulls inward on portrait/narrow aspects.
- [x] First-person casting no longer whites out the screen: directed spell
      origins shift 2.1 m forward, Rime Spear's muzzle ring/flash shrink, and
      `Effects` fades close flashes far more aggressively.
- [x] Pyre Wave conforms to terrain, adds rising embers and 12 normal-blended
      flame billboards (`createFlameTexture`) so the fire wall reads in daylight.
- [x] NPC prompts and Wisp follow suppressed while flying.
- [x] Narrow-screen hotbar keeps all ten slots on screen (332 px viewport) with
      a second breakpoint at 820 px.
- [x] `tests/spells.test.js` + expanded `tests/aim.test.js`; `npm test` → 151.
- [x] Aerial sprite audit: high sprites are cloud banks / floating-islet glows,
      not stray waystones.
- [x] Live-verified full loop: shards → altar → three boss phases → victory →
      ending → free roam → phase-select rematch → free roam.
- [x] Rematch whiteout fixed: the restored Beacon beam/glow are hidden while the
      altar is dimmed and come back after the fight.
- [x] `_resetRun()` clears rematch/photo state so a new journey starts clean.
- [x] Per-device aim tuning: Settings now has a soft-aim toggle, 2–45° cone
      slider and 0–150 % strength slider; `Magic.setAimOptions()` consumes them.
- [x] Soft-aim target bracket: `#aim-lock` projects the locked enemy's chest to
      screen space for 1.2 s and hides for dead/off-screen targets.

## Next

- [ ] Human playtest of the boss: pacing, damage, dodge timing, phase readability,
      and a full victory run without master mode.
- [ ] Macro terrain colour variation.
- [ ] Additional Veil Echo variants for later phases.
- [ ] Photo-mode depth-of-field / focal-length controls.

## Done 2026-11-03

### Wayfarer redesign + missions/audio/graphics pass

- [x] `PlayerModel` rebuild: 3/4-scale young traveler, bigger friendly face
      (layered eyes with iris/pupil/catchlight, rosy cheeks, smile, brows that
      lift on look-around), wide-brim travel hat with red band and teal feather,
      black fringe + high gold-tied ponytail, cream shirt, ox-blood vest with
      pale trim, teal mantle, orange scarf, belt with pouch/scroll, knee wraps,
      lace-up boots, half-glove hands and a carved-wood staff with brass rings,
      three-prong claw, bright crystal, orbiting shards and a visible light.
- [x] `questState` gauntlet: Trial of Embers (3 kills, open from SHARDS) and The
      Turning Veil (5 kills, open from RETURN) must be done before the altar
      fires the finale; `enemy-killed` is the only event that advances them.
- [x] Side quest The Lantern Way: eight stone lanterns in a road from the shore
      to the temple (Structures `_buildLanterns` / `setLanternsLit`); waking
      them in order deepens stamina, +10 max stamina at the final lantern.
- [x] Rewards: +12 max health for the ember trial, +12 max mana for the veil
      hunt, applied once in `Game._handleQuestEffect`.
- [x] `_spawnEnemies` stages three stalkers near the camp while the veil hunt
      is open, so the mission is completable without a long wander.
- [x] Audio: sea-wash and night-insect beds (`setBiomeBlend`, `setNight`),
      layered cast sounds for all ten spells, `enemyDeath`/`wardenDeath` stings,
      `doubleJump`/`wisp`/`talk`, water-aware footsteps (grass/sand/rock/water).
- [x] Graphics: sky warm twilight band and altitude-gated stars, water foam
      laces and sunset shore warmth, terrain dirt patches + grain FBM,
      vegetation shrub undergrowth + wildflower-tinted grass tufts.
- [x] Water: shallow water and shore paddle you back on Space without blocking
      a normal jump's peak; wading splashes with a water footstep.
- [x] Minimap shows lit lanterns gold and rings the next one.
- [x] `npm test` → 153 passing; `npx vite build` OK.

> Baseline: commit `3 November` (5c2d32f, local, unpushed). Everything above is
> on top of that commit.

## Verification commands

```bash
cd aetherfall
npm test          # 153 tests
npx vite build    # bundle check
npm run dev       # http://127.0.0.1:4173/
```
