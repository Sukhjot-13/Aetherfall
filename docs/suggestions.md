# Aetherfall — Suggestions

Ideas, improvements and known weaknesses. Newest entries are date-stamped and
old ones are kept until implemented.

## 🟢 Improvements

### 2026-10-28 — Restored Beacon whites out a rematch — ✅ fixed
After the ending the Beacon beam and its 28 m glow sprite stay lit. Starting a
rematch put them at the centre of the arena and bloom turned the fight into a
white screen. `setAltarDimmed(true)` now hides both and restores them when the
altar is undimmed. Remaining idea: temporarily set `sky.setRestored(false)` for
the rematch so its lighting matches the first fight.

### 2026-10-28 — First-person muzzle flashes could white out the screen — ✅ fixed
Additive flash sprites spawned 0.8 m from the eye plus bloom turned the whole
frame white. Directed spell origins now shift 2.1 m forward in first person,
Rime Spear's muzzle ring/flash are reduced, and `Effects` fades close flashes
much more aggressively. Still worth a dedicated "muzzle flash" sprite that is
authored for the first-person camera rather than reusing the world flash.

### 2026-10-28 — Pyre Wave needed a readable silhouette — ✅ improved
The cone was six thin ground rings that buried themselves on slopes. It now
conforms each band to the terrain, adds rising ember bursts, and uses 12 pooled
normal-blended flame billboards (`createFlameTexture`). Remaining idea: a
curved wall mesh for the leading edge so the wave has a solid crest.

### 2026-10-28 — Add a visible target-lock indicator
Soft aim now predicts the impact point and flashes a ring there, but there is no
persistent "locked" marker on the enemy itself. A subtle bracket on the locked
target (plus a faint line for Thunderfall) would teach players when assist is
active without making it feel like a full lock-on. *(Impact marker implemented;
enemy bracket still open.)*

### 2026-10-26 — Soft aim can currently snap through terrain — ✅ implemented 2026-10-28
`pickAimTarget` now accepts a `filter`, and `Magic` passes `hasLineOfSight()`
(heightfield march with 0.3 m clearance) before a target can steal the aim.

### 2026-10-26 — Soft aim should be tunable per input device
The new aim assist uses one 18° cone and 0.7 blend for every player. Gamepad
players usually want a wider cone and stronger magnetism; mouse players often
want none. Expose `aimAssist` strength/cone in Settings and store it with the
other options.

### 2026-10-26 — Flight body orientation — ✅ implemented 2026-10-28
`_updateFly` derives `flightPitch`/`flightRoll`; `PlayerModel` pitches the torso
and hips toward the velocity vector and banks into strafes.

### 2026-10-26 — Grass is still the weakest visual — ✅ implemented 2026-10-28
Each tuft is now a seven-triangle fan with a dark base and sunlit tip baked into
vertex colours. Remaining idea: add a low-detail distance ring so the 40 m
follow-field can shrink without exposing its rim.

### 2026-10-26 — Terrain needs macro variation
Vertex colours are per-vertex only, so the island looks like one flat green from
altitude. Add a large-scale colour splat (meadows, moss, dry patches) sampled
from a second FBM, and a subtle detail texture at two scales.

### 2026-10-26 — Trees are sparse from the air — ⚠️ partially implemented 2026-10-28
Preset counts are now 760 / 1500 / 2400 / 3600. Still worth clustering trees into
forest blobs with a denser instanced understory instead of uniform scatter.

### 2026-10-26 — Loose waystone sprite in the sky — ✅ audited 2026-10-28
The high sprites in aerial shots are cloud banks (opacity 0.17, scale ~300) and
floating-islet glows, not stray waystones. `_waystone` itself uses box meshes
with a glow material and no sprite. No fix needed.

### 2026-10-26 — Staff viewmodel could be an actual hand + sleeve — ✅ implemented 2026-10-28
The viewmodel now has a bare-skinned palm, a leather half-glove, three wrapped
fingers, a bracer and a sleeve.

### 2026-10-26 — Wisp follows the player into the air — ✅ implemented 2026-10-28
The Wisp stops closing/backing away while `player.fly`, and all interaction
prompts are suppressed in flight.

### 2026-10-26 — Add an in-game photo mode — ✅ implemented 2026-10-28
`P` freezes player/combat, hides the HUD, keeps look and zoom live, and shows a
small caption. Remaining idea: depth-of-field and focal-length controls.

### 2026-10-26 — Title screen ghost buttons are low contrast
Secondary title buttons were nearly invisible over the dark cinematic. Raised in
`style.css`, but a slightly stronger backdrop behind `.title-actions` would help
on bright frames.

### 2026-10-26 — Loading is frame-driven
`World.build()` awaits one animation frame per step, so a background/throttled
tab can sit on "Raising mountains…" for a long time. Consider a time-sliced
build that does not depend on rAF, or a visible "tab hidden" hint.

## 🟡 New Features

### 2026-10-26 — Boss rematch / phase select — ✅ implemented 2026-10-28
The free-roam altar opens a phase-select overlay. `FinalBoss.begin(startPhase)`
sets starting health via `phaseStartRatio()`, armour and enrage; a rematch
victory returns to exploration instead of replaying the ending.

### 2026-10-28 — Label the rematch difficulty
Starting at Phase III gives Vaelor 693 HP, phase-3 armour and full enrage. The
Beacon already fully restores the player before every attempt, so it is fair —
but the overlay should say so, and could label Phase III "Unbound" so the jump
in aggression is clearly intentional.

### 2026-10-26 — Dedicated boss score
The encounter currently uses procedural stings (`bossIntro`, `bossPhase`,
`bossSlam`, `bossVolley`, `bossDeath`). A layered procedural loop that adds a
choir pad in phase 2 and a percussion pulse in phase 3 would carry the fight.

### 2026-10-26 — Master-mode teleport palette
Add number-key teleports (temple, camp, each shrine, summit) plus a "return to
spawn" key so testing specific areas does not require flying across the island.

### 2026-10-26 — Training dummies
A master-mode-only cluster of immortal dummies near spawn would let spell FX and
damage numbers be inspected without hunting enemies.

### 2026-10-26 — Spell loadout customisation
Let the player bind any unlocked spell to slots 1–0 instead of the fixed order.

### 2026-10-26 — Photo/recording mode
Free camera, HUD toggle, depth-of-field and a screenshot key.

## 🔴 Vulnerabilities

### 2026-10-26 — `window.aetherfall` exposes full game state
Intentional for debugging, but it means any script on the page (or a pasted
console snippet) can call `setMaster(true)` and bypass progression. Acceptable
for a single-player local game; if the game is ever shipped with leaderboards or
multiplayer, remove the global and gate cheats behind an explicit dev flag.

### 2026-10-26 — Save data is trusted after validation
`validateSaveData` checks shape and ranges, but a crafted localStorage value can
still grant powers/shards. Again harmless for a local single-player game; note it
if saves ever sync to a server.
