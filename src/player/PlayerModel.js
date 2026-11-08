/**
 * The Wayfarer — a procedural, articulated travelling mage.
 *
 * Explorer-medieval wayfinder: grounded and windworn, with a readable
 * silhouette from every angle and no wide-hair look.
 * - ~6.5-heads proportions: long legs, deeper waist, slim chest.
 * - Warm tan skin, teal-green eyes, quiet confident smile.
 * - Short dark-brown side-swept hair under a slouch hat with teal band.
 * - Cream tunic, brown leather vest with brass clasps, teal waist sash,
 *   dark trousers, waxed-leather boots, rolled cloak + satchel.
 * - Carved wood staff with brass rings, three-prong claw, faceted
 *   teal crystal, orbiting shards and a visible point light.
 *
 * Rig conventions: the model faces -Z, so a positive X rotation swings a
 * hanging limb forward. Knees therefore bend on negative X and elbows on
 * positive X. Cloth pivots lift on positive X.
 *
 * An original Aetherfall character — no existing character is copied. The
 * `ponytail`/`halo` group slots are kept for animation compat but now hold
 * the hood-tail and the hat respectively.
 */


import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, dampAngle, TAU } from '../util/math.js';
import { createGlowTexture } from '../world/textures.js';
import { CharacterAsset } from './CharacterAsset.js';
import { capeLift, gaitPose, landSquash, runBlend, springDamp, secondaryLag, strideRate } from './gait.js';

const PALETTE = {
  skin: '#e8b98e',
  skinDark: '#c9996a',
  blush: '#e0a08a',
  hair: '#3a2a1e',
  hairShadow: '#241a12',
  shirt: '#a99d7d',
  vest: '#4e4131',
  vestDark: '#4a3320',
  sash: '#155e4f',
  sashDark: '#0e443a',
  shorts: '#343d39',
  shortsDark: '#2a2a24',
  boots: '#4a3626',
  leather: '#8a6a45',
  leatherDark: '#5a4630',
  wrap: '#a89878',
  hat: '#5a4630',
  hatDark: '#3a2d1e',
  hatBand: '#1f7a5f',
  scarf: '#155e4f',
  scarfDark: '#0e443a',
  wood: '#6b4a2f',
  gold: '#ad8d53',
  crystal: '#8ef2e0',
  eye: '#ffffff',
  iris: '#1f7a5f',
  pupil: '#0a0d0f',
  mouth: '#8a3a32',
  // New zero-hero v2 (from scratch):
  cloak: '#2e5a4f',
  cloakDark: '#1f4139',
  trim: '#d8c08a',
  buckle: '#c9a95c',
  hood: '#24544a',
  hoodDark: '#183b34',
  satchel: '#7a5a3a',
};

export const HERO_PROPORTIONS = Object.freeze({
  // metres, body origin at waist
  bodyY: 0.84,
  chestY: 0.07,
  legSpread: 0.118,
  headY: 0.80,
});

// Standard PBR materials keep the character affordable alongside the world.
function toon(color, options = {}) {
  const { side, roughness, ...rest } = options;
  return new THREE.MeshStandardMaterial({
    color,
    roughness: roughness ?? 0.82,
    metalness: 0.02,
    side: side ?? THREE.FrontSide,
    ...rest,
  });
}

const MAT = {
  skin: new THREE.MeshStandardMaterial({
    color: PALETTE.skin,
    roughness: 0.58,
    metalness: 0.02,
  }),
  skinDark: new THREE.MeshStandardMaterial({
    color: PALETTE.skinDark,
    roughness: 0.62,
    metalness: 0.02,
  }),
  hair: toon(PALETTE.hair),
  shirt: toon(PALETTE.shirt),
  vest: toon(PALETTE.vest),
  vestDark: toon(PALETTE.vestDark),
  sash: toon(PALETTE.sash),
  sashDark: toon(PALETTE.sashDark),
  mantle: toon(PALETTE.vestDark, { side: THREE.DoubleSide }),
  shorts: toon(PALETTE.shorts),
  boots: toon(PALETTE.boots),
  leather: toon(PALETTE.leather),
  leatherDark: toon(PALETTE.leatherDark),
  cloak: toon(PALETTE.cloak, { side: THREE.DoubleSide }),
  cloakDark: toon(PALETTE.cloakDark, { side: THREE.DoubleSide }),
  trim: toon(PALETTE.trim),
  buckle: toon(PALETTE.buckle),
  hood: toon(PALETTE.hood, { side: THREE.DoubleSide }),
  hoodDark: toon(PALETTE.hoodDark, { side: THREE.DoubleSide }),
  satchel: toon(PALETTE.satchel),
  hat: toon(PALETTE.hat),
  hatDark: toon(PALETTE.hatDark),
  hatBand: toon(PALETTE.hatBand),
  wood: toon(PALETTE.wood),
  eye: toon(PALETTE.eye),
  iris: new THREE.MeshBasicMaterial({ color: PALETTE.iris }),
  pupil: new THREE.MeshBasicMaterial({ color: PALETTE.pupil }),
  blush: toon(PALETTE.blush),
  mouth: toon(PALETTE.mouth),
  wrap: toon(PALETTE.wrap),
  scarf: toon(PALETTE.scarf, { side: THREE.DoubleSide }),
  scarfDark: toon(PALETTE.scarfDark, { side: THREE.DoubleSide }),
  gold: new THREE.MeshStandardMaterial({
    color: PALETTE.gold,
    emissive: '#000000',
    emissiveIntensity: 0,
    metalness: 0.68,
    roughness: 0.34,
  }),
  crystal: new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.crystal).multiplyScalar(0.5),
    emissive: PALETTE.crystal,
    emissiveIntensity: 1.5,
    roughness: 0.3,
  }),
  outline: new THREE.MeshBasicMaterial({ color: '#0a0c10', side: THREE.BackSide }),
};

const OUTLINE_SCALE = 1.018;

/**
 * Add a mesh to a parent, with an inverted-hull ink outline.
 * @returns {THREE.Mesh}
 */
function part(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], outline = false) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (outline) {
    const shell = new THREE.Mesh(geometry, MAT.outline);
    shell.scale.setScalar(OUTLINE_SCALE);
    shell.castShadow = false;
    shell.receiveShadow = false;
    mesh.add(shell);
  }
  return mesh;
}

/**
 * A flat cloth slab that tapers from `wBottom` at its hem to `wTop` at the
 * pivot. The origin sits at the middle of the panel.
 */
function taperedPanel(wTop, wBottom, height, thickness = 0.03) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = y + 0.5;
    position.setX(i, position.getX(i) * (wBottom + (wTop - wBottom) * t));
    position.setY(i, y * height);
    position.setZ(i, position.getZ(i) * thickness);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A tapered prism used for hanging coat tails and scarf ends. */
function cloth(parent, wTop, wBottom, height, material, position, rotation = [0, 0, 0]) {
  const mesh = part(parent, taperedPanel(wTop, wBottom, height, 0.03), material, position, [1, 1, 1], false);
  mesh.rotation.set(...rotation);
  return mesh;
}

/** Merge static meshes that share a material within one animated bone. */
function batchBoneMeshes(bone, excluded = []) {
  const batches = new Map();
  for (const child of bone.children) {
    if (!child.isMesh || child.children.length || excluded.includes(child) || Array.isArray(child.material)) continue;
    const list = batches.get(child.material) ?? [];
    list.push(child);
    batches.set(child.material, list);
  }
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrix);
      return geometry;
    });
    const merged = mergeGeometries(geometries);
    geometries.forEach((geometry) => geometry.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bone.add(mesh);
    for (const old of meshes) {
      bone.remove(old);
      old.geometry.dispose();
    }
  }
}

export class PlayerModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'Wayfarer';
    this.root.scale.setScalar(0.94);
    this.time = 0;
    this.phase = 0;
    this.castTimer = 0;
    this.landTimer = 0;
    this.landElapsed = 0;
    this.landDuration = 0.3;
    this.landStrength = 0;
    this.jumpTimer = 0;
    this.dodgeTimer = 0;
    this.heavyLand = 0;
    this.form = false;
    this.firstPerson = false;
    this.aura = null;
    this.staffLight = null;
    this._build();
    this._buildViewModel();
    CharacterAsset.load(this.root, this.staff).then((asset) => {
      this.characterAsset = asset;
      this.body.visible = false;
    }).catch((error) => {
      console.warn('Using procedural hero fallback:', error);
    });
  }

  _build() {
    this._secondary = { hatX: 0, hatVX: 0, hatZ: 0, hatVZ: 0, cloth: 0, clothV: 0, staff: 0.05, staffV: 0 };
    const root = this.root;
    const body = new THREE.Group();
    body.position.y = HERO_PROPORTIONS.bodyY;
    root.add(body);
    this.body = body;

    const hips = new THREE.Group();
    body.add(hips);
    this.hips = hips;

    const chest = new THREE.Group();
    chest.position.y = HERO_PROPORTIONS.chestY;
    body.add(chest);
    this.chest = chest;

    // ---------------------------------------------------------------- pelvis
    // Noticeably longer legs, slimmer pelvis for a 7-heads-tall read.
    part(hips, new THREE.CylinderGeometry(0.175, 0.195, 0.17, 12), MAT.shorts, [0, -0.02, 0], [1.02, 1, 0.78]);

    // Belt, buckle and travelling kit.
    part(hips, new THREE.CylinderGeometry(0.212, 0.212, 0.085, 14), MAT.leatherDark, [0, 0.06, 0], [1.04, 1, 0.82]);
    part(hips, new THREE.BoxGeometry(0.115, 0.115, 0.05), MAT.gold, [0, 0.06, -0.172], [1, 1, 1], false);
    part(hips, new THREE.BoxGeometry(0.068, 0.068, 0.02), MAT.leatherDark, [0, 0.06, -0.198], [1, 1, 1], false);
    part(hips, new THREE.CylinderGeometry(0.215, 0.215, 0.018, 14), MAT.gold, [0, 0.1, 0], [1.04, 1, 0.82], false);

    const pouch = part(hips, new THREE.SphereGeometry(0.085, 10, 8), MAT.leather, [0.2, -0.01, 0.02], [1, 1.05, 0.7]);
    pouch.rotation.z = -0.15;
    part(hips, new THREE.BoxGeometry(0.15, 0.035, 0.1), MAT.leatherDark, [0.2, 0.06, 0.02], [1, 1, 0.8], false);
    part(hips, new THREE.SphereGeometry(0.014, 6, 5), MAT.gold, [0.2, 0.058, -0.03], [1, 1, 1], false);

    const scroll = part(hips, new THREE.CylinderGeometry(0.035, 0.035, 0.2, 7), MAT.wrap, [-0.19, -0.02, 0.1], [1, 1, 1], false);
    scroll.rotation.set(0.12, 0, 0.2);
    part(hips, new THREE.CylinderGeometry(0.038, 0.038, 0.018, 7), MAT.gold, [-0.171, 0.06, 0.089], [1, 1, 1], false).rotation.set(0.12, 0, 0.2);

    // Sash knot at the left hip — the purple sash colour, echoed at the waist.
    part(hips, new THREE.SphereGeometry(0.055, 8, 6), MAT.sash, [-0.21, 0.02, -0.06], [1, 1.2, 0.8], false);
    cloth(hips, 0.05, 0.075, 0.24, MAT.sash, [-0.225, -0.12, -0.055], [0.12, 0, 0.16]);

    // Split coat tails: two long at the back, two shorter at the sides.
    // A dark under-tail closes the gap so the shirt never shows through.
    cloth(hips, 0.1, 0.16, 0.3, MAT.vestDark, [0, -0.12, 0.135], [0.05, 0, 0]);
    this.coatTails = [];
    const tailSpec = [
      { x: -0.085, z: 0.145, w: 0.16, len: 0.46, yaw: 0.06 },
      { x: 0.085, z: 0.145, w: 0.16, len: 0.46, yaw: -0.06 },
      { x: -0.205, z: 0.03, w: 0.12, len: 0.33, yaw: 0.62 },
      { x: 0.205, z: 0.03, w: 0.12, len: 0.33, yaw: -0.62 },
    ];
    for (const spec of tailSpec) {
      const pivot = new THREE.Group();
      pivot.position.set(spec.x, 0.05, spec.z);
      pivot.rotation.y = spec.yaw;
      hips.add(pivot);
      cloth(pivot, spec.w, spec.w * 1.32, spec.len, MAT.vest, [0, -spec.len / 2, 0]);
      cloth(pivot, spec.w * 0.82, spec.w * 1.06, spec.len * 0.93, MAT.vestDark, [0, -spec.len / 2 - 0.005, 0.024]);
      part(pivot, new THREE.BoxGeometry(spec.w * 1.22, 0.018, 0.05), MAT.gold, [0, -spec.len + 0.008, 0], [1, 1, 1], false);
      this.coatTails.push(pivot);
    }

    // ------------------------------------------------------------------ legs
    // Longer legs + short waist: the hips sit at +0.06 above the body origin.
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.115, 0.06, 0);
      hips.add(hip);
      // Shorts cuff.
      part(hip, new THREE.CylinderGeometry(0.108, 0.118, 0.22, 9), MAT.shorts, [0, -0.08, 0], [1, 1, 1], false);
      part(hip, new THREE.CapsuleGeometry(0.085, 0.24, 4, 9), MAT.shorts, [0, -0.24, 0]);

      const knee = new THREE.Group();
      knee.position.y = -0.43;
      hip.add(knee);
      part(knee, new THREE.TorusGeometry(0.079, 0.017, 5, 10), MAT.leather, [0, 0, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
      // Cloth knee wrap that criss-crosses the joint.
      part(knee, new THREE.CylinderGeometry(0.082, 0.082, 0.11, 9), MAT.wrap, [0, -0.03, 0], [1, 1, 1], false);
      part(knee, new THREE.TorusGeometry(0.083, 0.012, 4, 10), MAT.wrap, [0, 0.02, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
      part(knee, new THREE.CapsuleGeometry(0.069, 0.2, 4, 9), MAT.shorts, [0, -0.14, 0]);

      const ankle = new THREE.Group();
      ankle.position.y = -0.32;
      knee.add(ankle);
      part(ankle, new THREE.CylinderGeometry(0.097, 0.086, 0.09, 9), MAT.leather, [0, -0.005, 0], [1, 1, 1], false);
      // Lace-up boot: straps and a brighter toe.
      part(ankle, new THREE.BoxGeometry(0.13, 0.11, 0.26), MAT.boots, [0, -0.06, -0.05]);
      part(ankle, new THREE.BoxGeometry(0.136, 0.07, 0.085), MAT.leatherDark, [0, -0.075, -0.185], [1, 1, 1], false);
      part(ankle, new THREE.BoxGeometry(0.142, 0.032, 0.28), MAT.leatherDark, [0, -0.116, -0.05], [1, 1, 1], false);
      part(ankle, new THREE.BoxGeometry(0.134, 0.018, 0.035), MAT.gold, [0, -0.005, -0.12], [1, 1, 1], false);
      part(ankle, new THREE.BoxGeometry(0.134, 0.018, 0.035), MAT.gold, [0, -0.035, -0.1], [1, 1, 1], false);
      part(ankle, new THREE.TorusGeometry(0.088, 0.012, 4, 10), MAT.gold, [0, 0.035, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
      return { hip, knee, ankle };
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    // ----------------------------------------------------------------- torso
    const torso = part(chest, new THREE.CapsuleGeometry(0.19, 0.24, 5, 12), MAT.shirt, [0, 0.3, 0], [1.04, 1, 0.76]);
    this.torso = torso;

    // Cream tunic under a brown leather vest: vest panels wrap the tunic,
    // with brass clasps down the centre and a tunic hem at the waist.
    part(chest, new THREE.BoxGeometry(0.13, 0.42, 0.05), MAT.vest, [-0.108, 0.32, -0.14], [1, 1, 1], false).rotation.z = 0.03;
    part(chest, new THREE.BoxGeometry(0.13, 0.42, 0.05), MAT.vest, [0.108, 0.32, -0.14], [1, 1, 1], false).rotation.z = -0.03;
    part(chest, new THREE.BoxGeometry(0.34, 0.44, 0.05), MAT.vest, [0, 0.32, 0.142], [1, 1, 1], false);
    part(chest, new THREE.BoxGeometry(0.06, 0.42, 0.05), MAT.shirt, [0, 0.32, -0.152], [1, 1, 1], false);
    part(chest, new THREE.BoxGeometry(0.28, 0.05, 0.1), MAT.vestDark, [0, 0.555, -0.07], [1, 1, 1], false);
    part(chest, new THREE.BoxGeometry(0.34, 0.028, 0.055), MAT.vestDark, [0, 0.105, 0.142], [1, 1, 1], false);
    // Brass clasps down the vest opening.
    for (let i = 0; i < 4; i++) {
      part(chest, new THREE.SphereGeometry(0.016, 7, 5), MAT.gold, [0, 0.48 - i * 0.11, -0.158], [1, 1, 1], false);
    }
    // Chest strap of the satchel (diagonal) — explorer kit, not decoration.
    part(chest, new THREE.BoxGeometry(0.055, 0.52, 0.03), MAT.leatherDark, [0.02, 0.3, 0.148], [1, 1, 1], false).rotation.z = 0.42;

    // Neck + jaw line so the head does not float on the torso.
    part(chest, new THREE.CylinderGeometry(0.068, 0.079, 0.14, 8), MAT.skin, [0, 0.62, 0]);
    part(chest, new THREE.SphereGeometry(0.07, 8, 6), MAT.skin, [0, 0.56, -0.01], [1, 0.55, 0.9], false);

    // Teal waist sash over the tunic hem.
    part(chest, new THREE.CylinderGeometry(0.212, 0.212, 0.14, 14), MAT.sash, [0, 0.02, 0], [1.04, 1, 0.82], false);
    part(chest, new THREE.CylinderGeometry(0.216, 0.216, 0.03, 14), MAT.sashDark, [0, 0.09, 0], [1.04, 1, 0.82], false);
    // Sash tail hanging front-left.
    cloth(chest, 0.1, 0.13, 0.34, MAT.sash, [-0.16, -0.18, -0.06], [0.08, 0.2, 0.1]);

    // A weathered travel mantle gives the silhouette a continuous back and
    // moves from the shoulders rather than being welded to the legs.
    const mantlePivot = new THREE.Group();
    mantlePivot.position.set(0, 0.52, 0.12);
    chest.add(mantlePivot);
    const mantleGeo = new THREE.PlaneGeometry(1, 1, 12, 8);
    const mantlePos = mantleGeo.attributes.position;
    for (let i = 0; i < mantlePos.count; i++) {
      const u = mantlePos.getX(i);
      const t = 0.5 - mantlePos.getY(i);
      const width = 0.34 + t * 0.20;
      mantlePos.setXYZ(i, u * width, -t * 0.82,
        0.025 + Math.sin((u + 0.5) * Math.PI * 6) * 0.012 * t + 0.035 * t);
    }
    mantleGeo.computeVertexNormals();
    part(mantlePivot, mantleGeo, MAT.cloak);
    this.mantle = mantlePivot;
    // A compact leather satchel and flap break up the rear silhouette.
    const satchel = new THREE.Group();
    satchel.position.set(-0.19, 0.02, 0.18);
    satchel.rotation.z = -0.12;
    chest.add(satchel);
    part(satchel, new THREE.BoxGeometry(0.21, 0.23, 0.10), MAT.satchel);
    part(satchel, new THREE.BoxGeometry(0.22, 0.07, 0.11), MAT.leatherDark, [0, 0.07, 0.006]);
    part(satchel, new THREE.BoxGeometry(0.035, 0.035, 0.012), MAT.gold, [0, 0.045, 0.06]);

    // ------------------------------------------------------------------- head
    // A compact head and restrained facial features suit the adult proportions.
    const headGroup = new THREE.Group();
    headGroup.position.y = HERO_PROPORTIONS.headY + 0.03;
    chest.add(headGroup);
    headGroup.scale.setScalar(0.82);
    this.head = headGroup;

    // Tunic collar at the neckline (explorer tunic, not a shirt).
    part(headGroup, new THREE.BoxGeometry(0.26, 0.06, 0.18), MAT.shirt, [0, -0.14, -0.06], [1, 1, 1], false).rotation.x = 0.15;

    part(headGroup, new THREE.SphereGeometry(0.19, 18, 16), MAT.skin, [0, 0.02, 0], [1, 1.02, 0.96]);
    // Ears.
    part(headGroup, new THREE.SphereGeometry(0.05, 8, 6), MAT.skin, [-0.201, 0.0, -0.005], [0.55, 1, 0.8], false);
    part(headGroup, new THREE.SphereGeometry(0.05, 8, 6), MAT.skin, [0.201, 0.0, -0.005], [0.55, 1, 0.8], false);

    // Short side-swept hair: tight cap, neat sideburns, a single swept fringe
    // mass across the forehead. No pompadour, no wide fringe, no ponytail.
    part(headGroup, new THREE.SphereGeometry(0.21, 18, 14, 0, TAU, 0, Math.PI * 0.46), MAT.hair, [0, 0.045, 0.015], [1.02, 1, 1.02]);
    part(headGroup, new THREE.BoxGeometry(0.045, 0.1, 0.05), MAT.hair, [-0.178, -0.015, -0.02], [1, 1, 1], false);
    part(headGroup, new THREE.BoxGeometry(0.045, 0.1, 0.05), MAT.hair, [0.178, -0.015, -0.02], [1, 1, 1], false);
    const sweep = part(headGroup, taperedPanel(0.09, 0.055, 0.14, 0.04), MAT.hair, [0.045, 0.135, -0.16], [1, 1, 1], false);
    sweep.rotation.set(0.5, -0.4, -0.2);
    const sweep2 = part(headGroup, taperedPanel(0.06, 0.04, 0.11, 0.035), MAT.hair, [-0.08, 0.125, -0.145], [1, 1, 1], false);
    sweep2.rotation.set(0.42, 0.25, 0.15);

    // Explorer hood-tail (animation compat: occupies the ponytail slot).
    // A rolled teal cloak hood rests at the back of the neck; its rotation
    // still streams with speed so the silhouette stays alive.
    const ponytail = new THREE.Group();
    ponytail.position.set(0, 0.04, 0.185);
    headGroup.add(ponytail);
    part(ponytail, new THREE.SphereGeometry(0.075, 9, 7), MAT.scarf, [0, -0.02, 0], [1, 0.9, 1], false);
    part(ponytail, new THREE.CylinderGeometry(0.045, 0.06, 0.16, 7), MAT.scarfDark, [0, -0.12, 0.03], [1, 1, 1], false).rotation.x = 0.5;
    this.ponytail = ponytail;

    // Face: calm explorer eyes — white, iris, pupil and catchlight — with
    // a quiet confident smile and straight brows.
    this.brows = [];
    for (const side of [-1, 1]) {
      // Eyes sit in the face shell (head radius 0.19, front at z ≈ -0.18).
      // Flattened discs hug the surface; the old full spheres bulged out
      // and the catchlight floated in front of them like a bubble.
      part(headGroup, new THREE.SphereGeometry(0.026, 12, 10), MAT.eye, [side * 0.072, 0.028, -0.178], [1.2, 0.68, 0.32], false);
      part(headGroup, new THREE.SphereGeometry(0.015, 10, 8), MAT.iris, [side * 0.072, 0.026, -0.19], [1, 1, 0.3], false);
      part(headGroup, new THREE.SphereGeometry(0.008, 8, 6), MAT.pupil, [side * 0.072, 0.024, -0.2], [1, 1, 0.3], false);
      part(headGroup, new THREE.SphereGeometry(0.004, 6, 5), MAT.eye, [side * 0.064, 0.039, -0.202], [1, 1, 0.4], false);
      const brow = part(headGroup, new THREE.BoxGeometry(0.065, 0.012, 0.014), MAT.hair, [side * 0.074, 0.092, -0.178], [1, 1, 1], false);
      brow.rotation.z = -side * 0.06;
      this.brows.push(brow);
    }
    // Nose points forward (-Z, the facing direction). The old +PI/2
    // rotation aimed the tip backwards into the head.
    part(headGroup, new THREE.ConeGeometry(0.018, 0.042, 8), MAT.skinDark, [0, -0.03, -0.2], [1, 1, 0.7], false).rotation.x = -Math.PI / 2;
    // Confident smile: a short warm line without a tooth grin.
    part(headGroup, new THREE.BoxGeometry(0.055, 0.006, 0.009), MAT.mouth, [0, -0.098, -0.178], [1, 1, 1], false);

    // Explorer slouch hat (animation compat: occupies the halo slot).
    // A tilted leather crown with a wide brim and teal band; the hat still
    // bobs and leans with the walk so the head reads alive.
    const halo = new THREE.Group();
    halo.position.y = 0.16;
    halo.rotation.set(0.1, -0.15, 0.06);
    headGroup.add(halo);
    part(halo, new THREE.CylinderGeometry(0.14, 0.16, 0.11, 14), MAT.hat, [0, 0.08, 0], [1, 1, 1], false);
    part(halo, new THREE.CylinderGeometry(0.165, 0.175, 0.035, 14), MAT.hatBand, [0, 0.005, 0], [1, 1, 1], false);
    part(halo, new THREE.CylinderGeometry(0.235, 0.245, 0.018, 16), MAT.hatDark, [0, -0.02, 0], [1, 1, 1], false);
    part(halo, new THREE.SphereGeometry(0.14, 12, 8, 0, TAU, 0, Math.PI * 0.5), MAT.hat, [0, 0.125, 0], [1, 0.5, 1], false);
    this.halo = halo;

    // ------------------------------------------------------------------- arms
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.285, 0.5, 0);
      chest.add(shoulder);
      part(shoulder, new THREE.CapsuleGeometry(0.064, 0.2, 4, 9), MAT.skin, [0, -0.12, 0]);
      part(shoulder, new THREE.CylinderGeometry(0.086, 0.076, 0.11, 10), MAT.shirt, [0, -0.035, 0], [1, 1, 1], false);
      part(shoulder, new THREE.TorusGeometry(0.083, 0.011, 4, 10), MAT.gold, [0, -0.09, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;

      const elbow = new THREE.Group();
      elbow.position.y = -0.27;
      shoulder.add(elbow);
      part(elbow, new THREE.CapsuleGeometry(0.056, 0.18, 4, 9), MAT.skin, [0, -0.11, 0]);
      // Leather bracer with two gold rings.
      part(elbow, new THREE.CylinderGeometry(0.073, 0.063, 0.16, 10), MAT.leather, [0, -0.135, 0], [1, 1, 1], false);
      part(elbow, new THREE.TorusGeometry(0.071, 0.011, 4, 10), MAT.gold, [0, -0.075, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
      part(elbow, new THREE.TorusGeometry(0.063, 0.009, 4, 10), MAT.gold, [0, -0.196, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;

      const hand = new THREE.Group();
      hand.position.y = -0.26;
      elbow.add(hand);
      // Half-glove: skin palm, leather knuckle bar, finger wraps.
      part(hand, new THREE.SphereGeometry(0.06, 8, 8), MAT.skin, [0, 0, 0], [1, 0.9, 0.9], false);
      part(hand, new THREE.BoxGeometry(0.11, 0.045, 0.09), MAT.leatherDark, [0, 0.015, -0.01], [1, 1, 1], false);
      for (let i = 0; i < 3; i++) {
        const fx = (i - 1) * 0.04;
        part(hand, new THREE.CapsuleGeometry(0.014, 0.035, 3, 5), MAT.skin, [fx, -0.04, -0.035], [1, 1, 1], false).rotation.x = 0.4;
      }
      part(hand, new THREE.CapsuleGeometry(0.018, 0.045, 3, 5), MAT.leatherDark, [-side * 0.045, -0.005, -0.015], [1, 1, 1], false).rotation.z = side * 0.7;
      return { shoulder, elbow, hand };
    };

    this.armL = makeArm(-1);
    this.armR = makeArm(1);

    // Layered pauldron on the free shoulder.
    part(this.armL.shoulder, new THREE.SphereGeometry(0.122, 12, 6, 0, TAU, 0, Math.PI * 0.52), MAT.leather, [0, 0.018, 0], [1.08, 0.55, 1.02], false);
    part(this.armL.shoulder, new THREE.SphereGeometry(0.1, 10, 5, 0, TAU, 0, Math.PI * 0.48), MAT.leatherDark, [-0.006, -0.045, 0], [1.12, 0.42, 1.06], false);
    part(this.armL.shoulder, new THREE.TorusGeometry(0.107, 0.009, 4, 12), MAT.gold, [0, -0.018, 0], [1.02, 1, 0.94], false).rotation.x = Math.PI / 2;
    part(this.armL.shoulder, new THREE.SphereGeometry(0.017, 6, 5), MAT.gold, [0, 0.06, -0.035], [1, 1, 1], false);

    // Teal explorer scarf: collar plus two trailing ends over the tunic.
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.04, 6, 14), MAT.scarf);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.655;
    chest.add(scarf);
    part(chest, new THREE.BoxGeometry(0.055, 0.055, 0.04), MAT.gold, [0, 0.655, -0.13], [1, 1, 1], false);
    this.scarf = scarf;

    this.scarfTails = [];
    const scarfSpec = [
      { x: -0.065, z: 0.105, len: 0.4, yaw: 0.2 },
      { x: 0.02, z: 0.115, len: 0.32, yaw: -0.15 },
    ];
    for (const spec of scarfSpec) {
      const pivot = new THREE.Group();
      pivot.position.set(spec.x, 0.615, spec.z);
      pivot.rotation.y = spec.yaw;
      chest.add(pivot);
      cloth(pivot, 0.075, 0.11, spec.len, MAT.scarf, [0, -spec.len / 2, 0], [0.12, 0, 0]);
      cloth(pivot, 0.062, 0.092, spec.len * 0.93, MAT.scarfDark, [0, -spec.len / 2 - 0.005, 0.024], [0.12, 0, 0]);
      this.scarfTails.push(pivot);
    }

    // ------------------------------------------------------------------ staff
    // Carved-wood shaft with brass rings and a claw holding a bright crystal.
    const staff = new THREE.Group();
    staff.position.set(0.02, -0.02, -0.03);
    staff.rotation.z = -0.28;
    this.armR.hand.add(staff);
    part(staff, new THREE.CylinderGeometry(0.026, 0.035, 1.5, 7), MAT.wood, [0, 0.4, 0], [1, 1, 1], false);
    part(staff, new THREE.CylinderGeometry(0.036, 0.036, 0.24, 8), MAT.leatherDark, [0, 0.02, 0], [1, 1, 1], false);
    part(staff, new THREE.CylinderGeometry(0.04, 0.042, 0.06, 8), MAT.gold, [0, 1.02, 0], [1, 1, 1], false);
    for (const y of [0.15, 0.62, 1.0]) {
      part(staff, new THREE.TorusGeometry(0.044, 0.014, 5, 10), MAT.gold, [0, y, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
    }
    // Three prongs cradle the crystal.
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * TAU + Math.PI / 6;
      const prong = part(staff, new THREE.CylinderGeometry(0.011, 0.018, 0.24, 5), MAT.gold, [Math.cos(angle) * 0.085, 1.1, Math.sin(angle) * 0.085], [1, 1, 1], false);
      prong.rotation.set(Math.sin(angle) * 0.32, 0, -Math.cos(angle) * 0.32);
    }
    const crystal = part(staff, new THREE.OctahedronGeometry(0.12, 0), MAT.crystal, [0, 1.23, 0], [1, 1.5, 1], false);
    crystal.castShadow = false;
    this.staff = staff;
    this.crystal = crystal;

    // Orbiting shards.
    const shards = new THREE.Group();
    shards.position.y = 1.23;
    staff.add(shards);
    this.shardGroup = shards;
    this.shards = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * TAU;
      const shard = part(
        shards,
        new THREE.OctahedronGeometry(0.036, 0),
        MAT.crystal,
        [Math.cos(angle) * 0.19, Math.sin(i * 2.1) * 0.03, Math.sin(angle) * 0.19],
        [1, 1.4, 1],
        false,
      );
      shard.castShadow = false;
      this.shards.push(shard);
    }

    const glowMap = createGlowTexture(64, 'rgba(180, 255, 240, 0.95)', 'rgba(120, 255, 230, 0)');
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowMap,
        color: PALETTE.crystal,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.scale.setScalar(0.52);
    glow.position.y = 1.23;
    staff.add(glow);
    this.staffGlow = glow;

    const light = new THREE.PointLight(PALETTE.crystal, 0.7, 5, 2);
    light.position.y = 1.21;
    staff.add(light);
    this.staffLight = light;

    // ------------------------------------------------------------- form aura
    const auraMap = createGlowTexture(128, 'rgba(255, 233, 168, 0.9)', 'rgba(255, 200, 90, 0)');
    const aura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: auraMap,
        color: '#ffe9a8',
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    aura.scale.setScalar(3.4);
    aura.position.y = 1.0;
    aura.visible = false;
    root.add(aura);
    this.aura = aura;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.022, 6, 36),
      new THREE.MeshBasicMaterial({
        color: '#ffe9a8',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    root.add(ring);
    this.formRing = ring;

    for (const bone of [this.legL.hip, this.legL.knee, this.legL.ankle,
      this.legR.hip, this.legR.knee, this.legR.ankle,
      this.armL.shoulder, this.armL.elbow, this.armL.hand,
      this.armR.shoulder, this.armR.elbow, this.armR.hand]) {
      batchBoneMeshes(bone);
    }
    batchBoneMeshes(this.hips);
    batchBoneMeshes(this.chest, [this.torso, this.scarf]);
    batchBoneMeshes(this.head, this.brows);
    batchBoneMeshes(this.halo);
    for (const tail of [...this.coatTails, ...this.scarfTails]) batchBoneMeshes(tail);

    root.traverse((o) => {
      if (o.isMesh) o.frustumCulled = true;
    });
  }

  _buildViewModel() {
    const view = new THREE.Group();
    view.name = 'FirstPersonStaff';
    view.position.set(0.32, -0.34, -0.6);
    view.rotation.set(-0.18, -0.1, -0.22);
    view.scale.setScalar(0.62);
    view.visible = false;
    this.viewModel = view;

    part(view, new THREE.CylinderGeometry(0.026, 0.034, 1.15, 7), MAT.wood, [0, 0.2, 0], [1, 1, 1], false);
    part(view, new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), MAT.leatherDark, [0, 0.01, 0], [1, 1, 1], false);
    for (const y of [0.12, 0.5, 0.78]) {
      part(view, new THREE.TorusGeometry(0.042, 0.012, 5, 10), MAT.gold, [0, y, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * TAU + Math.PI / 6;
      const prong = part(view, new THREE.CylinderGeometry(0.01, 0.016, 0.2, 5), MAT.gold, [Math.cos(angle) * 0.075, 0.84, Math.sin(angle) * 0.075], [1, 1, 1], false);
      prong.rotation.set(Math.sin(angle) * 0.3, 0, -Math.cos(angle) * 0.3);
    }
    const crystal = part(view, new THREE.OctahedronGeometry(0.11, 0), MAT.crystal, [0, 0.94, 0], [1, 1.5, 1], false);
    crystal.castShadow = false;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture(64, 'rgba(180, 255, 240, 0.9)', 'rgba(120, 255, 230, 0)'),
        color: PALETTE.crystal,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.scale.setScalar(0.75);
    glow.position.y = 0.94;
    view.add(glow);
    this.viewCrystal = crystal;
    this.viewGlow = glow;

    // Gripping hand, bracer and sleeve running off the bottom of the screen.
    // The palm is bare skin; a leather half-glove wraps the back of the hand.
    part(view, new THREE.SphereGeometry(0.062, 8, 8), MAT.skin, [0, 0.015, 0], [1, 0.9, 0.9], false);
    part(view, new THREE.SphereGeometry(0.058, 8, 6), MAT.leatherDark, [0, 0.012, 0.02], [1, 0.65, 0.55], false);
    for (let i = -1; i <= 1; i++) {
      const finger = part(
        view,
        new THREE.CapsuleGeometry(0.013, 0.042, 3, 5),
        MAT.skin,
        [0.043, 0.02 + i * 0.02, -0.018],
        [1, 1, 1],
        false,
      );
      finger.rotation.z = -0.72;
    }
    const bracer = part(view, new THREE.CylinderGeometry(0.068, 0.06, 0.14, 9), MAT.leather, [0.02, -0.1, 0.01], [1, 1, 1], false);
    bracer.rotation.z = -0.5;
    const sleeve = part(view, new THREE.CapsuleGeometry(0.052, 0.22, 4, 8), MAT.shirt, [0.1, -0.24, 0.03], [1, 1, 1], false);
    sleeve.rotation.z = -0.62;
  }

  /** Show/hide the body for first person and swap in the staff viewmodel. */
  setFirstPerson(first) {
    this.firstPerson = first;
    this.root.visible = !first;
    this.viewModel.visible = first;
  }

  /** Enable/disable the golden Aether Form aura. */
  setForm(form) {
    this.form = form;
    this.aura.visible = form;
    this.formRing.visible = form;
    this.staffLight.intensity = form ? 2.2 : 0.65;
    this.crystal.material.emissiveIntensity = form ? 3 : 1.2;
    this.viewCrystal.material.emissiveIntensity = form ? 3 : 1.2;
    MAT.gold.emissive.set(form ? '#7a5a1e' : '#000000');
    MAT.gold.emissiveIntensity = form ? 1.5 : 0;
  }

  /** Kick the casting animation. */
  triggerCast() {
    this.castTimer = 0.52;
  }

  /** React to a landing: `force` is 0 (soft) .. 1 (heavy). */
  land(force = 0.5, heavy = false) {
    const f = clamp(force, 0, 1);
    this.landStrength = f;
    this.heavyLand = heavy ? 1 : 0;
    this.landDuration = (heavy ? 0.34 : 0.26) + f * 0.16;
    this.landTimer = this.landDuration;
    this.landElapsed = 0;
  }

  /** Stretch upward on take-off. */
  jump() {
    this.jumpTimer = 0.24;
  }

  /** Kick the quick dodge lean. */
  dodge() {
    this.dodgeTimer = 0.34;
  }

  /**
   * Animate the rig.
   * @param {number} dt
   * @param {{speed?:number, grounded?:boolean, vy?:number, dashing?:boolean, dodging?:boolean, roll?:number, form?:boolean, sprinting?:boolean, sprintBlend?:number, slope?:number, flying?:boolean, turn?:number, airTime?:number, flightPitch?:number, flightRoll?:number}} state
   */
  update(dt, state = {}) {
    this.time += dt;
    const speed = state.speed ?? 0;
    const run = runBlend(speed);
    const grounded = state.grounded !== false;
    const flying = Boolean(state.flying);
    const dashing = Boolean(state.dashing);
    const dodging = Boolean(state.dodging);
    const roll = clamp(state.roll ?? 0, 0, 1);
    const form = Boolean(state.form);
    const turn = state.turn ?? 0;
    const vy = state.vy ?? 0;
    const sprintBlend = clamp(state.sprintBlend ?? (state.sprinting ? 1 : 0), 0, 1);
    const slope = clamp(state.slope ?? 0, 0, 1);
    const flightPitch = flying ? clamp(state.flightPitch ?? 0, -1.15, 1.15) : 0;
    const flightRoll = flying ? clamp(state.flightRoll ?? 0, -0.55, 0.55) : 0;

    // Walk phase advances with footfall (strideRate), not the clock, and
    // matches Player strideLength — so the cycle never moon-drifts.
    if (grounded) this.phase += dt * strideRate(speed);
    const gait = gaitPose(this.phase, speed);

    this.castTimer = Math.max(0, this.castTimer - dt);
    // Three-phase cast: windup 0-35%, strike 35-75%, settle 75-100%.
    // The old single-sine envelope popped at both ends; smoothstepped
    // halves make the staff lift, fire, and lower like a real swing.
    const castRaw = this.castTimer > 0 ? 1 - this.castTimer / 0.52 : 0;
    const castWin = castRaw < 0.35 ? castRaw / 0.35 : castRaw < 0.75 ? 1 : 1 - (castRaw - 0.75) / 0.25;
    const castS = castWin * castWin * (3 - 2 * castWin);
    const cast = castRaw > 0 ? castS : 0;
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    const dodge = this.dodgeTimer > 0 ? Math.sin((1 - this.dodgeTimer / 0.34) * Math.PI) : 0;
    const rollTuck = roll > 0 ? Math.sin(Math.PI * roll) : 0;

    // Landing crouch and take-off stretch.
    this.landTimer = Math.max(0, this.landTimer - dt);
    if (this.landTimer > 0) this.landElapsed += dt;
    const squash = this.landTimer > 0 ? landSquash(this.landElapsed, this.landDuration, this.landStrength) : 0;
    this.jumpTimer = Math.max(0, this.jumpTimer - dt);
    const stretch = this.jumpTimer > 0 ? Math.sin((1 - this.jumpTimer / 0.24) * Math.PI) : 0;
    this.characterAsset?.update(dt, state, cast, castRaw, squash);

    // The procedural body is hidden after the skinned model loads. Avoid
    // updating its many joints in third person; only shared effects remain.
    if (this.characterAsset && !this.firstPerson) {
      const pulse = 0.8 + Math.sin(this.time * 2.4) * 0.2;
      this.staffGlow.material.opacity = (form ? 0.7 : 0.22) * pulse;
      this.characterAsset.staffLightIntensity(form ? 2.2 * pulse : 0.65 * pulse);
      if (form) {
        this.aura.material.opacity = 0.5 + Math.sin(this.time * 3.1) * 0.12;
        this.aura.scale.setScalar(3.4 + Math.sin(this.time * 2.3) * 0.25);
        this.formRing.rotation.z += dt * 0.8;
        this.formRing.scale.setScalar(1 + Math.sin(this.time * 3) * 0.06);
        this.formRing.material.opacity = 0.45 + Math.sin(this.time * 3) * 0.12;
      }
      return;
    }

    const idleWeight = Math.sin(this.time * 0.55) * 0.012 * (1 - run);
    const bank = clamp(turn * 0.045, -0.2, 0.2) * (0.3 + 0.7 * run);
    const brace = this.heavyLand && this.landTimer > 0
      ? Math.sin((1 - this.landTimer / this.landDuration) * Math.PI)
      : 0;

    // Body: bob, hover, sway, crouch, dodge drop and roll tuck.
    // Soft torso: low spring rate so the chest lags behind the pelvis —
    // weight settling in, never snapping to the pose.
    const hover = form ? 0.14 + Math.sin(this.time * 2.6) * 0.035 : 0;
    const bob = grounded ? gait.bob : 0;
    const dodgeDrop = dodge * 0.16;
    const rollDrop = rollTuck * 0.36;
    const drop = squash * 0.17 + dodgeDrop + rollDrop;
    const targetY = 0.845 + bob + hover - drop + stretch * 0.05;
    this.body.position.y = springDamp(this.body.position.y, targetY, 7, dt);
    // Weight shift rolls the pelvis toward the planted leg; the light sway
    // rides on top so it reads as a person walking, not a metronome.
    this.body.position.x = springDamp(this.body.position.x, gait.sway + (gait.shift ?? 0) + idleWeight, 5, dt);
    this.body.position.z = springDamp(this.body.position.z, -rollTuck * 0.2 - dodge * 0.06, 7, dt);
    this.body.rotation.x = springDamp(this.body.rotation.x, -dodge * 0.2 - rollTuck * 0.8 + flightPitch * 0.55, 6, dt);
    this.body.rotation.z = springDamp(this.body.rotation.z, bank - dodge * 0.06 + flightRoll + (gait.shift ?? 0) * 1.1, 4.5, dt);

    // Pelvis and chest counter-rotate — softened so the turn reads as weight.
    this.hips.rotation.y = springDamp(this.hips.rotation.y, gait.hipYaw, 6, dt);
    this.hips.rotation.z = springDamp(this.hips.rotation.z, -bank * 0.3 + idleWeight * 1.2 + (gait.shift ?? 0) * 0.7, 4.5, dt);

    const sprintLean = sprintBlend * 0.13;
    const lean = dashing
      ? -0.52
      : -(run * 0.19 + Math.min(speed, 11) * 0.004 + sprintLean) * (grounded ? 1 : 0.5);
    const airLean = grounded ? 0 : clamp(-vy * 0.012, -0.18, 0.22);
    const dodgeLean = -dodge * 0.52 - rollTuck * 0.3 + brace * 0.22;
    const slopeLean = slope * 0.07;
    this.chest.rotation.x = springDamp(
      this.chest.rotation.x,
      lean + airLean + dodgeLean + slopeLean - squash * (this.heavyLand ? 0.5 : 0.32) + stretch * 0.12 + flightPitch * 0.45,
      5.5,
      dt,
    );
    this.chest.rotation.y = springDamp(this.chest.rotation.y, gait.chestYaw + cast * 0.25, 6, dt);
    this.chest.rotation.z = springDamp(this.chest.rotation.z, -bank * 0.5 + flightRoll * 0.45, 5, dt);

    // Breathing.
    const breath = Math.sin(this.time * 2.05) * 0.012 * (1 - run) + squash * 0.03;
    this.torso.scale.y = damp(this.torso.scale.y, 1 + breath, 8, dt);
    this.torso.scale.x = damp(this.torso.scale.x, 1.06 + breath * 0.4, 8, dt);

    // Head keeps its horizon while the chest leans — softest spring of all
    // so the gaze drifts instead of locking to the torso.
    const idleLook = (Math.sin(this.time * 0.31) * 0.07 + Math.sin(this.time * 0.13 + 1.9) * 0.045) * (1 - run);
    this.head.rotation.y = springDamp(this.head.rotation.y, idleLook - gait.chestYaw * 0.75 - cast * 0.15, 4, dt);
    this.head.rotation.x = springDamp(this.head.rotation.x, -this.chest.rotation.x * 0.7 + (form ? -0.06 : 0) - squash * 0.1, 4.5, dt);
    this.head.rotation.z = springDamp(this.head.rotation.z, -bank * 0.55, 4, dt);
    // Brows lift gently when the player is looking around — a friendlier face.
    if (this.brows) {
      const liftAmount = Math.abs(idleLook) * 0.5 + (form ? 0.02 : 0);
      this.brows[0].position.y = damp(this.brows[0].position.y, 0.09 + liftAmount, 10, dt);
      this.brows[1].position.y = damp(this.brows[1].position.y, 0.09 + liftAmount, 10, dt);
    }

    // ---------------------------------------------------------------- legs
    let hipL;
    let hipR;
    let kneeL;
    let kneeR;
    let ankleL;
    let ankleR;
    if (flying) {
      const drift = Math.sin(this.time * 1.7) * 0.07;
      hipL = -0.34 + drift - flightPitch * 0.45;
      hipR = -0.16 - drift - flightPitch * 0.45;
      kneeL = -0.6 - Math.max(0, flightPitch) * 0.25;
      kneeR = -0.38 - Math.max(0, flightPitch) * 0.25;
      ankleL = 0.28;
      ankleR = 0.16;
    } else if (grounded) {
      hipL = gait.hipL;
      hipR = gait.hipR;
      // Plant compensation: each metre the body drops bends the knees by
      // ~2.2 rad so the feet stay on the ground through landings, dodges
      // and rolls instead of sinking below the terrain.
      const plant = drop * 2.2;
      kneeL = gait.kneeL - plant;
      kneeR = gait.kneeR - plant;
      ankleL = gait.ankleL + drop * 1.1;
      ankleR = gait.ankleR + drop * 1.1;
    } else {
      const rise = clamp(vy / 8, -1, 1);
      hipL = 0.34 + rise * 0.34;
      hipR = 0.12 + rise * 0.2;
      kneeL = -(0.58 + Math.max(0, rise) * 0.5);
      kneeR = -(0.36 + Math.max(0, rise) * 0.3);
      ankleL = 0.22;
      ankleR = 0.12;
    }

    // Dodge tuck and heavy landing recovery override the gait.
    if (dodge > 0.02) {
      hipL = 0.62 * dodge;
      hipR = 0.3 * dodge;
      kneeL = -(0.45 + 0.7 * dodge);
      kneeR = -(0.3 + 0.5 * dodge);
      ankleL = 0.24 * dodge;
      ankleR = 0.18 * dodge;
    }
    if (rollTuck > 0.02) {
      hipL = 1.25 * rollTuck;
      hipR = 1.05 * rollTuck;
      kneeL = -(0.35 + 1.25 * rollTuck);
      kneeR = -(0.25 + 1.05 * rollTuck);
      ankleL = 0.3 * rollTuck;
      ankleR = 0.24 * rollTuck;
    }

    const legLambda = grounded ? 8 : 5;
    this.legL.hip.rotation.x = springDamp(this.legL.hip.rotation.x, hipL, legLambda, dt);
    this.legR.hip.rotation.x = springDamp(this.legR.hip.rotation.x, hipR, legLambda, dt);
    this.legL.knee.rotation.x = springDamp(this.legL.knee.rotation.x, kneeL, legLambda, dt);
    this.legR.knee.rotation.x = springDamp(this.legR.knee.rotation.x, kneeR, legLambda, dt);
    this.legL.ankle.rotation.x = springDamp(this.legL.ankle.rotation.x, ankleL, legLambda, dt);
    this.legR.ankle.rotation.x = springDamp(this.legR.ankle.rotation.x, ankleR, legLambda, dt);

    // ---------------------------------------------------------------- arms
    let armLX = gait.armL;
    let armRX = gait.armR;
    let armLZ = -0.12;
    let armRZ = 0.12;
    let elbowL = gait.elbowL;
    let elbowR = gait.elbowR + 0.12;
    const rise = clamp(vy / 8, -1, 1);

    if (flying) {
      armLX = -0.3;
      armRX = -0.24;
      armLZ = -0.88;
      armRZ = 0.88;
      elbowL = 0.3;
      elbowR = 0.32;
    } else if (!grounded) {
      armLX = -0.18 + rise * 0.22;
      armRX = -0.12 + rise * 0.18;
      armLZ = -0.55 - rise * 0.18;
      armRZ = 0.55 + rise * 0.18;
      elbowL = 0.35;
      elbowR = 0.4;
    }
    if (dashing) {
      armLX = -0.78;
      armRX = -0.66;
      armLZ = -0.32;
      armRZ = 0.32;
      elbowL = 0.55;
      elbowR = 0.5;
    }
    if (dodge > 0.02) {
      armLX = 0.55 + 0.35 * dodge;
      armRX = -0.42 * dodge;
      armLZ = -0.28;
      armRZ = 0.4;
      elbowL = 0.5;
      elbowR = 0.62;
    }
    if (rollTuck > 0.02) {
      armLX = 0.95 * rollTuck;
      armRX = 0.8 * rollTuck;
      armLZ = -0.42 * rollTuck;
      armRZ = 0.42 * rollTuck;
      elbowL = 0.7 * rollTuck;
      elbowR = 0.7 * rollTuck;
    }
    if (brace > 0.02) {
      armLX = armLX * (1 - brace) + 0.92 * brace;
      elbowL = elbowL * (1 - brace) + 0.18 * brace;
      armLZ = armLZ * (1 - brace) - 0.42 * brace;
    }
    if (cast > 0) {
      armRX = armRX * (1 - cast) + 1.32 * cast;
      elbowR = elbowR * (1 - cast) + 0.62 * cast;
      armRZ = 0.12 - 0.34 * cast;
      armLX = armLX * (1 - cast) - 0.35 * cast;
    }
    if (form) {
      armLX = -0.12;
      armRX = -0.08;
      armLZ = -0.88;
      armRZ = 0.88;
      elbowL = 0.28;
      elbowR = 0.32;
    }

    // Arms lag the torso (softer spring) so the contralateral swing reads as
    // weight, not as welded to the chest. Staff counter-sways in phase with
    // the opposite arm and lifts slightly at run.
    const armLag = 4.5;
    this.armL.shoulder.rotation.x = springDamp(this.armL.shoulder.rotation.x, armLX, armLag, dt);
    this.armR.shoulder.rotation.x = springDamp(this.armR.shoulder.rotation.x, armRX, armLag, dt);
    this.armL.shoulder.rotation.z = springDamp(this.armL.shoulder.rotation.z, armLZ, 5, dt);
    this.armR.shoulder.rotation.z = springDamp(this.armR.shoulder.rotation.z, armRZ, 5, dt);
    this.armL.elbow.rotation.x = springDamp(this.armL.elbow.rotation.x, elbowL, 6, dt);
    this.armR.elbow.rotation.x = springDamp(this.armR.elbow.rotation.x, elbowR, 6, dt);

    // Staff trails slightly while running and lifts on a cast; also sways
    // with the walk so it feels held, not bolted — via secondary spring lag.
    const staffSway = this.armR.shoulder.rotation.x * 0.18;
    const _s = this._secondary ?? (this._secondary = { hatX: 0, hatVX: 0, hatZ: 0, hatVZ: 0, cloth: 0, clothV: 0, staff: 0.05, staffV: 0 });
    const staffTarget = 0.05 + 0.28 * run + cast * 0.35 + staffSway;
    const staffSpring = secondaryLag(_s.staff, staffTarget, _s.staffV, dt, 18, 6.5);
    _s.staff = staffSpring.pos; _s.staffV = staffSpring.vel;
    this.staff.rotation.x = _s.staff;
    const staffZSpring = secondaryLag(this.staff.rotation.z, -0.28 - cast * 0.12 - staffSway * 0.3, (_s.staffZV ?? 0), dt, 18, 6.5);
    _s.staffZV = staffZSpring.vel;
    this.staff.rotation.z = staffZSpring.pos;

    // --------------------------------------------------------- cloth & hair
    // Soft secondary motion: cloth/hair/hat lag behind the body with spring
    // physics instead of rigid damp, so they trail, overshoot and settle.
    const lift = capeLift(speed, vy);
    const clothSpring = secondaryLag(_s.cloth, lift, _s.clothV, dt, 16, 5.5);
    _s.cloth = clothSpring.pos; _s.clothV = clothSpring.vel;
    const softLift = _s.cloth;
    this.mantle.rotation.x = springDamp(this.mantle.rotation.x, 0.06 + softLift * 0.55, 4, dt);
    this.mantle.rotation.z = springDamp(this.mantle.rotation.z, -turn * 0.05, 4, dt);
    this.coatTails.forEach((tail, i) => {
      const flutter = Math.sin(this.time * (4.6 + i * 0.35) + i * 1.7) * (0.035 + 0.07 * run);
      const target = softLift * (0.75 + i * 0.05) + flutter + (flying ? 0.2 : 0);
      tail.rotation.x = springDamp(tail.rotation.x, target, 5.5, dt);
      tail.rotation.z = springDamp(tail.rotation.z, -turn * 0.05 + Math.sin(this.time * 3.4 + i) * 0.05 * (0.3 + run), 4.5, dt);
    });

    const capeLiftTarget = softLift + cast * 0.25;
    this.scarfTails.forEach((tail, i) => {
      const flutter = Math.sin(this.time * (5.2 + i * 0.7) + i * 1.7) * 0.1 * (0.3 + run);
      tail.rotation.x = springDamp(tail.rotation.x, capeLiftTarget * 1.35 + flutter + 0.1, 5, dt);
      tail.rotation.z = springDamp(tail.rotation.z, Math.sin(this.time * 3.1 + i) * 0.08 - turn * 0.06, 4.5, dt);
    });

    this.ponytail.rotation.x = springDamp(this.ponytail.rotation.x, 0.18 + softLift * 0.45 + Math.sin(this.time * 4.2) * 0.05 * (0.3 + run), 5, dt);
    this.ponytail.rotation.z = springDamp(this.ponytail.rotation.z, -turn * 0.08, 5, dt);

    // The hat bobs like a roomy brim and leans into turns — spring-lagged.
    if (this.halo) {
      const hatXSpring = secondaryLag(_s.hatX, 0.12 - vy * 0.004 - squash * 0.05, _s.hatVX, dt, 20, 6);
      _s.hatX = hatXSpring.pos; _s.hatVX = hatXSpring.vel;
      const hatZSpring = secondaryLag(_s.hatZ, 0.08 - bank * 0.2, _s.hatVZ, dt, 20, 6);
      _s.hatZ = hatZSpring.pos; _s.hatVZ = hatZSpring.vel;
      this.halo.rotation.x = _s.hatX;
      this.halo.rotation.z = _s.hatZ;
      this.halo.position.y = springDamp(this.halo.position.y, 0.17 + Math.sin(this.time * 2.1) * 0.012, 5, dt);
    }

    // ---------------------------------------------------------- staff magic
    const pulse = 0.8 + Math.sin(this.time * 2.4) * 0.2;
    this.staffGlow.material.opacity = (form ? 0.7 : 0.22) * pulse;
    this.staffGlow.scale.setScalar((form ? 0.95 : 0.45) * pulse);
    this.staffLight.intensity = (form ? 2.2 : 0.65) * pulse;
    this.crystal.rotation.y += dt * 0.8;
    this.shardGroup.rotation.y += dt * (form ? 3.4 : 1.2);
    this.shardGroup.rotation.z = Math.sin(this.time * 0.9) * 0.15;
    this.shards.forEach((shard, i) => {
      shard.position.y = Math.sin(this.time * 1.8 + i * 2.1) * 0.04;
    });

    if (form) {
      this.aura.material.opacity = 0.5 + Math.sin(this.time * 3.1) * 0.12;
      this.aura.scale.setScalar(3.4 + Math.sin(this.time * 2.3) * 0.25);
      this.formRing.rotation.z += dt * 0.8;
      this.formRing.scale.setScalar(1 + Math.sin(this.time * 3) * 0.06);
      this.formRing.material.opacity = 0.45 + Math.sin(this.time * 3) * 0.12;
    } else {
      this.aura.material.opacity = damp(this.aura.material.opacity, 0, 6, dt);
      this.formRing.material.opacity = damp(this.formRing.material.opacity, 0, 6, dt);
    }

    // ------------------------------------------------------- first person
    if (this.firstPerson) {
      const t = this.time;
      const gaitBob = Math.sin(this.phase) * (0.008 + run * 0.02);
      const gaitLift = Math.abs(Math.cos(this.phase)) * (0.006 + run * 0.016);
      const breathe = Math.sin(t * 1.9) * 0.003;
      // Portrait / very narrow windows have a small horizontal FOV, which can
      // push the viewmodel off the right edge. Pull it inward as aspect drops.
      const aspect = this.viewModel.parent?.isPerspectiveCamera ? this.viewModel.parent.aspect : 1.7;
      const narrow = clamp((1.2 - aspect) / 0.8, 0, 1);
      this.viewModel.position.set(
        0.32 - narrow * 0.15 + gaitBob + Math.sin(t * 0.7) * 0.002,
        -0.34 - gaitLift - breathe - squash * 0.05 + stretch * 0.02,
        -0.6 - narrow * 0.06 - run * 0.03 - cast * 0.1,
      );
      this.viewModel.rotation.set(
        -0.18 - cast * 0.35 + gaitLift * 0.4,
        -0.1 + gaitBob * 0.5,
        -0.22 + Math.sin(t * 1.1) * 0.01 + gaitBob * 0.6,
      );
      this.viewCrystal.rotation.y += dt * 1.2;
      this.viewGlow.material.opacity = (form ? 1 : 0.7) * pulse;
    }
  }

  /** World-space eye height helper. */
  get eyeHeight() {
    return 1.66;
  }

  /** Compat alias: the old hat group is now the halo group. */
  get hat() {
    return this.halo ?? this._hatGroup;
  }

  /** Zero-hero tuning snapshot (for tests / tuning screens). */
  get proportions() {
    return HERO_PROPORTIONS;
  }

  /** Face a world yaw (model forward is -Z). */
  faceYaw(yaw, dt, lambda = 12) {
    this.root.rotation.y = dampAngle(this.root.rotation.y, yaw, lambda, dt);
  }
}
