# Aetherfall

An original open-world fantasy adventure that runs in the browser. You are the
last spark on a dying island: recover the Aether Shards, relight the Beacon, and
face **Vaelor, the Veil Sovereign**. Everything — terrain, sky, water, trees,
characters, magic, the boss arena and sound — is generated procedurally at
runtime. No external art assets.

## Run it

```bash
cd aetherfall
npm install
npm run dev      # http://127.0.0.1:4173/
```

Production build:

```bash
npm run build
npm run preview
```

Tests (single entry point):

```bash
npm test
```

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Sprint |
| `Ctrl` / Right mouse | Dodge roll (brief invulnerability) |
| `Space` | Jump / double jump (after Sky Leap) |
| `1`–`0` | Cast spell in that slot |
| Mouse wheel | Zoom camera |
| Left click / `E` | Cast / interact |
| `V` | First / third person |
| `P` | Photo mode (HUD-free look/zoom) |
| `X` | Skip dialogue |
| `M` | Mute |
| `Esc` | Pause |

## Master mode (testing sandbox)

Press `` ` `` (backquote) or use **Pause → Master Mode**. It grants every spell
and passive, all shards, the restored Beacon, unlimited mana and stamina, and
infinite vitals, without touching your save.

| Input | Action |
| --- | --- |
| `F` | Toggle look-direction flight |
| `Space` / `C` | Optional vertical thrust (up / down) |
| `Shift` | Flight boost |
| `[` / `]` | Shift time ±2 hours |
| `T` | Teleport to the next landmark |
| `F1`–`F6` | Warp straight to a landmark |
| `` ` `` | Leave master mode |

Flight is true 3D: `W` follows the camera's full look direction, so looking up
climbs, looking down dives, and `A`/`D` strafe horizontally.

## Finale — Vaelor, the Veil Sovereign

The first draft ends with a dedicated three-phase boss at the Beacon of Aether.
Place all three shards, then interact with the altar to start the encounter.
Vaelor fights with telegraphed cleaves, orb volleys, ground slams and shockwaves,
void rifts, radial storms and summoned Veil Echoes. Cleave, slam and rift
wind-ups are readable in his body pose and on the floor. Phase breaks at 66 % and
33 % health shift his palette and attack pattern, and restore some of the
Wayfarer's health, mana and stamina. Dying during the fight rebuilds the arena and respawns
you at its edge; a save taken during the finale reloads at the altar so the fight
can always be retried. Victory restores the Beacon, opens the ending card and
then returns you to free roam.

After the ending, the altar offers **Challenge Vaelor Again** with a phase
selector, so the fight can be replayed from Phase I, II or III without touching
your save. Rematch victories return straight to exploration.

## Movement

The controller uses asymmetric acceleration/braking, a sprint ramp with stamina,
slope speed and steep-slide response, variable-height jumps with coyote time and
jump buffering, air control, Sky Leap, a stamina dodge with i-frames, heavy-landing
rolls, camera look-ahead/dip and stride-based footsteps.

## Magic

- **Ember Bolt** — explosive fire projectile.
- **Frost Nova** — radial ice burst that slows.
- **Gale Dash** — wind dash that damages on contact.
- **Storm Lance** — chained, jagged lightning.
- **Aegis** — golden damage-absorbing shield.
- **Aether Form** — temporary ascension: faster, stronger, higher jumps.
- **Rime Spear** — piercing ice lance that impales a line and slows.
- **Pyre Wave** — wide rolling cone of fire with heavy knockback.
- **Thunderfall** — telegraphed storm pillar at the predicted impact point.
- **Aether Barrage** — six seeking motes that split across nearby enemies.

Directed spells have soft aim assist with **predictive impact aiming**: a shot
fired inside the spell's cone locks a visible target, checks terrain line of
sight, and leads moving enemies so the projectile lands where they will actually
be. A small ring marks the predicted impact point and gold brackets stay on the
locked enemy for a moment. Aim assist can be tuned or disabled in **Settings**
(cone and strength), and it is a nudge, not a lock-on — wide misses stay wide.

## Project docs

- [`docs/architecture.md`](docs/architecture.md) — every file, its purpose and functions, plus env vars.
- [`docs/suggestions.md`](docs/suggestions.md) — improvements, feature ideas, known risks.
- [`docs/to-do.md`](docs/to-do.md) — current task list and verification commands.

## Tech

- Three.js `0.186` (WebGL, `EffectComposer` + Unreal Bloom + ACES tone mapping)
- Procedural seven-triangle grass tufts, denser forests, flight body pitch/bank
- Vite `8`
- Node's built-in test runner (`node --test`)
