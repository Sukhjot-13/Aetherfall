/**
 * The Wayfarer: a procedural, rigged low-poly hero with a straw hat, layered
 * traveller's coat and an aether staff. Limbs are animated procedurally (no
 * clips) so movement blends smoothly between idle, walk, run, jump, dash and
 * Aether Form.
 *
 * Rig conventions: the model faces -Z, so a positive X rotation swings a
 * hanging limb forward. Knees therefore bend on negative X and elbows on
 * positive X. Cloth pivots lift on positive X.
 */

import * as THREE from 'three';
import { clamp, damp, dampAngle, TAU } from '../util/math.js';
import { createGlowTexture } from '../world/textures.js';
import { capeLift, gaitPose, landSquash, runBlend } from './gait.js';

const PALETTE = {
  skin: '#d9a578',
  skinDark: '#b9825c',
  hair: '#241a17',
  shirt: '#e8e0cf',
  vest: '#a83a30',
  vestDark: '#75261f',
  mantle: '#256d64',
  shorts: '#2f4a6b',
  boots: '#3e2c21',
  leather: '#6a4a2c',
  leatherDark: '#3f2d1e',
  hat: '#d8b46a',
  hatDark: '#b28d4a',
  hatBand: '#8f2f2a',
  scarf: '#2f8f83',
  wood: '#6b4a2f',
  gold: '#d9b463',
  crystal: '#8ef2e0',
  eye: '#f4f1e6',
};

/** Build a shared toon ramp. */
function makeGradientMap() {
  const data = new Uint8Array([34, 96, 176, 255]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const GRADIENT = makeGradientMap();

function toon(color, options = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT, ...options });
}

const MAT = {
  skin: toon(PALETTE.skin),
  skinDark: toon(PALETTE.skinDark),
  hair: toon(PALETTE.hair),
  shirt: toon(PALETTE.shirt),
  vest: toon(PALETTE.vest),
  vestDark: toon(PALETTE.vestDark),
  mantle: toon(PALETTE.mantle, { side: THREE.DoubleSide }),
  shorts: toon(PALETTE.shorts),
  boots: toon(PALETTE.boots),
  leather: toon(PALETTE.leather),
  leatherDark: toon(PALETTE.leatherDark),
  hat: toon(PALETTE.hat),
  hatDark: toon(PALETTE.hatDark),
  hatBand: toon(PALETTE.hatBand),
  scarf: toon(PALETTE.scarf, { side: THREE.DoubleSide }),
  wood: toon(PALETTE.wood),
  eye: toon(PALETTE.eye),
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

const OUTLINE_SCALE = 1.055;

/**
 * Add a mesh to a parent, with an inverted-hull ink outline.
 * @returns {THREE.Mesh}
 */
function part(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], outline = true) {
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
  }

  _build() {
    const root = this.root;
    const body = new THREE.Group();
    body.position.y = 0.88;
    root.add(body);
    this.body = body;

    const hips = new THREE.Group();
    body.add(hips);
    this.hips = hips;

    const chest = new THREE.Group();
    body.add(chest);
    this.chest = chest;

    // ---------------------------------------------------------------- pelvis
    part(hips, new THREE.CylinderGeometry(0.215, 0.235, 0.2, 12), MAT.shorts, [0, -0.08, 0], [1.02, 1, 0.84]);

    // Belt, buckle and travelling kit.
    part(hips, new THREE.CylinderGeometry(0.226, 0.226, 0.09, 14), MAT.leatherDark, [0, 0.02, 0], [1.04, 1, 0.82]);
    part(hips, new THREE.BoxGeometry(0.11, 0.11, 0.05), MAT.gold, [0, 0.02, -0.182], [1, 1, 1], false);
    part(hips, new THREE.BoxGeometry(0.065, 0.065, 0.02), MAT.leatherDark, [0, 0.02, -0.208], [1, 1, 1], false);

    const pouch = part(hips, new THREE.SphereGeometry(0.085, 10, 8), MAT.leather, [0.2, -0.045, 0.02], [1, 1.05, 0.7]);
    pouch.rotation.z = -0.15;
    part(hips, new THREE.BoxGeometry(0.15, 0.035, 0.1), MAT.leatherDark, [0.2, 0.022, 0.02], [1, 1, 0.8], false);
    part(hips, new THREE.SphereGeometry(0.014, 6, 5), MAT.gold, [0.2, 0.018, -0.03], [1, 1, 1], false);

    const scroll = part(hips, new THREE.CylinderGeometry(0.035, 0.035, 0.2, 7), MAT.leather, [-0.19, -0.055, 0.1], [1, 1, 1], false);
    scroll.rotation.set(0.12, 0, 0.2);
    part(hips, new THREE.CylinderGeometry(0.038, 0.038, 0.018, 7), MAT.gold, [-0.171, 0.045, 0.089], [1, 1, 1], false).rotation.set(0.12, 0, 0.2);

    // Sash knot at the left hip.
    part(hips, new THREE.SphereGeometry(0.055, 8, 6), MAT.scarf, [-0.21, 0.0, -0.06], [1, 1.2, 0.8], false);
    cloth(hips, 0.05, 0.075, 0.24, MAT.scarf, [-0.225, -0.14, -0.055], [0.12, 0, 0.16]);

    // Split coat tails: two long at the back, two shorter at the sides.
    // A dark under-tail closes the gap so the shirt never shows through.
    cloth(hips, 0.1, 0.16, 0.3, MAT.vestDark, [0, -0.14, 0.145], [0.05, 0, 0]);
    this.coatTails = [];
    const tailSpec = [
      { x: -0.085, z: 0.155, w: 0.16, len: 0.46, yaw: 0.06 },
      { x: 0.085, z: 0.155, w: 0.16, len: 0.46, yaw: -0.06 },
      { x: -0.205, z: 0.035, w: 0.12, len: 0.33, yaw: 0.62 },
      { x: 0.205, z: 0.035, w: 0.12, len: 0.33, yaw: -0.62 },
    ];
    for (const spec of tailSpec) {
      const pivot = new THREE.Group();
      pivot.position.set(spec.x, 0.015, spec.z);
      pivot.rotation.y = spec.yaw;
      hips.add(pivot);
      cloth(pivot, spec.w, spec.w * 1.32, spec.len, MAT.vest, [0, -spec.len / 2, 0]);
      cloth(pivot, spec.w * 0.82, spec.w * 1.06, spec.len * 0.93, MAT.vestDark, [0, -spec.len / 2 - 0.005, 0.024]);
      part(pivot, new THREE.BoxGeometry(spec.w * 1.22, 0.018, 0.05), MAT.gold, [0, -spec.len + 0.008, 0], [1, 1, 1], false);
      this.coatTails.push(pivot);
    }

    // ------------------------------------------------------------------ legs
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.115, 0, 0);
      hips.add(hip);
      // Shorts cuff.
      part(hip, new THREE.CylinderGeometry(0.108, 0.118, 0.22, 9), MAT.shorts, [0, -0.08, 0], [1, 1, 1], false);
      part(hip, new THREE.CapsuleGeometry(0.085, 0.24, 4, 9), MAT.skin, [0, -0.24, 0]);

      const knee = new THREE.Group();
      knee.position.y = -0.43;
      hip.add(knee);
      part(knee, new THREE.TorusGeometry(0.079, 0.017, 5, 10), MAT.leather, [0, 0, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
      part(knee, new THREE.CapsuleGeometry(0.069, 0.2, 4, 9), MAT.skin, [0, -0.14, 0]);

      const ankle = new THREE.Group();
      ankle.position.y = -0.32;
      knee.add(ankle);
      part(ankle, new THREE.CylinderGeometry(0.097, 0.086, 0.09, 9), MAT.leather, [0, -0.005, 0], [1, 1, 1], false);
      part(ankle, new THREE.BoxGeometry(0.13, 0.11, 0.26), MAT.boots, [0, -0.06, -0.05]);
      part(ankle, new THREE.BoxGeometry(0.136, 0.07, 0.085), MAT.leatherDark, [0, -0.075, -0.185], [1, 1, 1], false);
      part(ankle, new THREE.BoxGeometry(0.142, 0.032, 0.28), MAT.leatherDark, [0, -0.116, -0.05], [1, 1, 1], false);
      part(ankle, new THREE.TorusGeometry(0.088, 0.012, 4, 10), MAT.gold, [0, 0.035, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
      return { hip, knee, ankle };
    };
    this.legL = makeLeg(-1);
    this.legR = makeLeg(1);

    // ----------------------------------------------------------------- torso
    const torso = part(chest, new THREE.CapsuleGeometry(0.2, 0.22, 5, 12), MAT.shirt, [0, 0.3, 0], [1.06, 1, 0.78]);
    this.torso = torso;

    // Open vest: front panels, back panel, collar and clasps.
    part(chest, new THREE.BoxGeometry(0.14, 0.42, 0.05), MAT.vest, [-0.102, 0.32, -0.142], [1, 1, 1], false).rotation.z = 0.03;
    part(chest, new THREE.BoxGeometry(0.14, 0.42, 0.05), MAT.vest, [0.102, 0.32, -0.142], [1, 1, 1], false).rotation.z = -0.03;
    part(chest, new THREE.BoxGeometry(0.34, 0.44, 0.05), MAT.vest, [0, 0.32, 0.142], [1, 1, 1], false);
    part(chest, new THREE.BoxGeometry(0.3, 0.06, 0.12), MAT.vest, [0, 0.555, -0.075], [1, 1, 1], false);
    for (const side of [-1, 1]) {
      part(chest, new THREE.BoxGeometry(0.03, 0.03, 0.02), MAT.gold, [side * 0.035, 0.4, -0.172], [1, 1, 1], false);
      part(chest, new THREE.BoxGeometry(0.03, 0.03, 0.02), MAT.gold, [side * 0.035, 0.25, -0.172], [1, 1, 1], false);
    }

    // Leather bandolier across the chest.
    const strap = part(chest, new THREE.BoxGeometry(0.075, 0.46, 0.035), MAT.leather, [0.005, 0.31, -0.153], [1, 1, 1], false);
    strap.rotation.z = 0.62;
    part(chest, new THREE.BoxGeometry(0.07, 0.07, 0.02), MAT.gold, [0.1, 0.37, -0.175], [1, 1, 1], false).rotation.z = 0.62;

    // Short teal mantle over the shoulders with a gold rim.
    part(chest, new THREE.CylinderGeometry(0.205, 0.36, 0.22, 14, 1, true), MAT.mantle, [0, 0.49, 0], [1, 1, 0.82], false);
    part(chest, new THREE.TorusGeometry(0.357, 0.013, 4, 18), MAT.gold, [0, 0.382, 0], [1, 1, 0.82], false).rotation.x = Math.PI / 2;

    // Neck.
    part(chest, new THREE.CylinderGeometry(0.068, 0.079, 0.14, 8), MAT.skin, [0, 0.62, 0]);

    // ------------------------------------------------------------------- head
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.76;
    chest.add(headGroup);
    this.head = headGroup;

    part(headGroup, new THREE.SphereGeometry(0.19, 18, 16), MAT.skin, [0, 0.02, 0], [1, 1.02, 0.98]);
    // Ears.
    part(headGroup, new THREE.SphereGeometry(0.045, 8, 6), MAT.skin, [-0.183, 0.0, -0.005], [0.55, 1, 0.8], false);
    part(headGroup, new THREE.SphereGeometry(0.045, 8, 6), MAT.skin, [0.183, 0.0, -0.005], [0.55, 1, 0.8], false);

    // Hair cap, sideburns and a windswept fringe.
    part(headGroup, new THREE.SphereGeometry(0.197, 18, 14, 0, TAU, 0, Math.PI * 0.44), MAT.hair, [0, 0.04, 0.01], [1.02, 1, 1.02]);
    part(headGroup, new THREE.BoxGeometry(0.05, 0.13, 0.05), MAT.hair, [-0.165, -0.02, -0.02], [1, 1, 1], false);
    part(headGroup, new THREE.BoxGeometry(0.05, 0.13, 0.05), MAT.hair, [0.165, -0.02, -0.02], [1, 1, 1], false);
    const fringeSpec = [
      { x: -0.085, z: -0.15, tilt: 0.32, yaw: 0.25 },
      { x: -0.015, z: -0.172, tilt: 0.16, yaw: -0.05 },
      { x: 0.06, z: -0.158, tilt: 0.3, yaw: -0.28 },
      { x: 0.125, z: -0.125, tilt: 0.45, yaw: -0.5 },
    ];
    for (const lock of fringeSpec) {
      const mesh = part(headGroup, taperedPanel(0.03, 0.065, 0.12, 0.035), MAT.hair, [lock.x, 0.105, lock.z], [1, 1, 1], false);
      mesh.rotation.set(lock.tilt, lock.yaw, lock.yaw * 0.3);
    }

    // Ponytail.
    const ponytail = new THREE.Group();
    ponytail.position.set(0, 0.055, 0.165);
    headGroup.add(ponytail);
    part(ponytail, new THREE.TorusGeometry(0.045, 0.013, 4, 8), MAT.gold, [0, 0, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
    const ponyMain = part(ponytail, new THREE.CylinderGeometry(0.052, 0.072, 0.24, 7), MAT.hair, [0, -0.12, 0.035], [1, 1, 1], false);
    ponyMain.rotation.x = -0.55;
    const ponyTip = part(ponytail, new THREE.CylinderGeometry(0.018, 0.052, 0.18, 6), MAT.hair, [0, -0.26, 0.14], [1, 1, 1], false);
    ponyTip.rotation.x = -0.9;
    this.ponytail = ponytail;

    // Face.
    for (const side of [-1, 1]) {
      part(headGroup, new THREE.SphereGeometry(0.036, 10, 8), MAT.eye, [side * 0.067, 0.026, -0.173], [1, 1.06, 0.5], false);
      part(headGroup, new THREE.SphereGeometry(0.017, 8, 6), MAT.hair, [side * 0.069, 0.021, -0.198], [1, 1, 0.6], false);
      part(headGroup, new THREE.SphereGeometry(0.0065, 6, 5), MAT.eye, [side * 0.061, 0.036, -0.204], [1, 1, 1], false);
      const brow = part(headGroup, new THREE.BoxGeometry(0.072, 0.016, 0.022), MAT.hair, [side * 0.07, 0.078, -0.174], [1, 1, 1], false);
      brow.rotation.z = -side * 0.12;
    }
    part(headGroup, new THREE.ConeGeometry(0.026, 0.07, 6), MAT.skinDark, [0, -0.02, -0.2], [1, 1, 0.8], false).rotation.x = Math.PI / 2;
    part(headGroup, new THREE.BoxGeometry(0.07, 0.014, 0.02), MAT.skinDark, [0, -0.095, -0.176], [1, 1, 1], false);

    // Straw hat: brim, dark rim, crown, band and feather.
    const hat = new THREE.Group();
    hat.position.y = 0.15;
    hat.rotation.set(0.1, 0, -0.05);
    headGroup.add(hat);
    part(hat, new THREE.CylinderGeometry(0.37, 0.385, 0.035, 22), MAT.hat, [0, 0, 0], [1, 1, 1], false);
    part(hat, new THREE.TorusGeometry(0.379, 0.019, 5, 22), MAT.hatDark, [0, 0.002, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
    part(hat, new THREE.CylinderGeometry(0.125, 0.232, 0.27, 16), MAT.hat, [0, 0.165, 0], [1, 1, 1], false);
    part(hat, new THREE.SphereGeometry(0.125, 12, 8), MAT.hat, [0, 0.3, 0], [1, 0.5, 1], false);
    part(hat, new THREE.CylinderGeometry(0.236, 0.24, 0.06, 16), MAT.hatBand, [0, 0.055, 0], [1, 1, 1], false);
    part(hat, new THREE.BoxGeometry(0.06, 0.045, 0.02), MAT.gold, [0, 0.055, -0.238], [1, 1, 1], false);
    const feather = new THREE.Group();
    feather.position.set(0.2, 0.11, 0.02);
    feather.rotation.set(0.15, 0.2, -0.55);
    hat.add(feather);
    cloth(feather, 0.02, 0.07, 0.24, MAT.scarf, [0, 0.09, 0]);
    part(feather, new THREE.CylinderGeometry(0.006, 0.009, 0.25, 5), MAT.gold, [0, 0.09, 0.008], [1, 1, 1], false);
    this.hat = hat;

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
      part(hand, new THREE.SphereGeometry(0.06, 8, 8), MAT.leatherDark, [0, 0, 0], [1, 0.9, 0.9], false);
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

    // Scarf: collar plus two trailing ends.
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
      this.scarfTails.push(pivot);
    }

    // ------------------------------------------------------------------ staff
    const staff = new THREE.Group();
    staff.position.set(0.02, -0.02, -0.03);
    staff.rotation.z = -0.28;
    this.armR.hand.add(staff);
    part(staff, new THREE.CylinderGeometry(0.026, 0.035, 1.5, 7), MAT.wood, [0, 0.4, 0], [1, 1, 1], false);
    part(staff, new THREE.CylinderGeometry(0.036, 0.036, 0.24, 8), MAT.leatherDark, [0, 0.02, 0], [1, 1, 1], false);
    for (const y of [0.15, 0.62, 1.0]) {
      part(staff, new THREE.TorusGeometry(0.044, 0.014, 5, 10), MAT.gold, [0, y, 0], [1, 1, 1], false).rotation.x = Math.PI / 2;
    }
    // Three prongs cradle the crystal.
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * TAU + Math.PI / 6;
      const prong = part(staff, new THREE.CylinderGeometry(0.011, 0.018, 0.24, 5), MAT.gold, [Math.cos(angle) * 0.085, 1.06, Math.sin(angle) * 0.085], [1, 1, 1], false);
      prong.rotation.set(Math.sin(angle) * 0.32, 0, -Math.cos(angle) * 0.32);
    }
    const crystal = part(staff, new THREE.OctahedronGeometry(0.12, 0), MAT.crystal, [0, 1.19, 0], [1, 1.5, 1], false);
    crystal.castShadow = false;
    this.staff = staff;
    this.crystal = crystal;

    // Orbiting shards.
    const shards = new THREE.Group();
    shards.position.y = 1.19;
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
    glow.scale.setScalar(0.5);
    glow.position.y = 1.19;
    staff.add(glow);
    this.staffGlow = glow;

    const light = new THREE.PointLight(PALETTE.crystal, 0.65, 4.5, 2);
    light.position.y = 1.17;
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
    this.castTimer = 0.42;
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

    if (grounded) this.phase += dt * (2.5 + speed * 1.62);
    const gait = gaitPose(this.phase, speed);

    this.castTimer = Math.max(0, this.castTimer - dt);
    const cast = this.castTimer > 0 ? Math.sin((1 - this.castTimer / 0.42) * Math.PI) : 0;
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);
    const dodge = this.dodgeTimer > 0 ? Math.sin((1 - this.dodgeTimer / 0.34) * Math.PI) : 0;
    const rollTuck = roll > 0 ? Math.sin(Math.PI * roll) : 0;

    // Landing crouch and take-off stretch.
    this.landTimer = Math.max(0, this.landTimer - dt);
    if (this.landTimer > 0) this.landElapsed += dt;
    const squash = this.landTimer > 0 ? landSquash(this.landElapsed, this.landDuration, this.landStrength) : 0;
    this.jumpTimer = Math.max(0, this.jumpTimer - dt);
    const stretch = this.jumpTimer > 0 ? Math.sin((1 - this.jumpTimer / 0.24) * Math.PI) : 0;

    const idleWeight = Math.sin(this.time * 0.55) * 0.012 * (1 - run);
    const bank = clamp(turn * 0.045, -0.2, 0.2) * (0.3 + 0.7 * run);
    const brace = this.heavyLand && this.landTimer > 0
      ? Math.sin((1 - this.landTimer / this.landDuration) * Math.PI)
      : 0;

    // Body: bob, hover, sway, crouch, dodge drop and roll tuck.
    const hover = form ? 0.14 + Math.sin(this.time * 2.6) * 0.035 : 0;
    const bob = grounded ? gait.bob : 0;
    const dodgeDrop = dodge * 0.16;
    const rollDrop = rollTuck * 0.36;
    const targetY = 0.88 + bob + hover - squash * 0.17 - dodgeDrop - rollDrop + stretch * 0.05;
    this.body.position.y = damp(this.body.position.y, targetY, 20, dt);
    this.body.position.x = damp(this.body.position.x, gait.sway + idleWeight, 10, dt);
    this.body.position.z = damp(this.body.position.z, -rollTuck * 0.2 - dodge * 0.06, 16, dt);
    this.body.rotation.x = damp(this.body.rotation.x, -dodge * 0.2 - rollTuck * 0.8 + flightPitch * 0.55, 14, dt);
    this.body.rotation.z = damp(this.body.rotation.z, bank - dodge * 0.06 + flightRoll, 7, dt);

    // Pelvis and chest counter-rotate.
    this.hips.rotation.y = damp(this.hips.rotation.y, gait.hipYaw, 12, dt);
    this.hips.rotation.z = damp(this.hips.rotation.z, -bank * 0.3 + idleWeight * 1.2, 8, dt);

    const sprintLean = sprintBlend * 0.13;
    const lean = dashing
      ? -0.52
      : -(run * 0.19 + Math.min(speed, 11) * 0.004 + sprintLean) * (grounded ? 1 : 0.5);
    const airLean = grounded ? 0 : clamp(-vy * 0.012, -0.18, 0.22);
    const dodgeLean = -dodge * 0.52 - rollTuck * 0.3 + brace * 0.22;
    const slopeLean = slope * 0.07;
    this.chest.rotation.x = damp(
      this.chest.rotation.x,
      lean + airLean + dodgeLean + slopeLean - squash * (this.heavyLand ? 0.5 : 0.32) + stretch * 0.12 + flightPitch * 0.45,
      9,
      dt,
    );
    this.chest.rotation.y = damp(this.chest.rotation.y, gait.chestYaw + cast * 0.25, 10, dt);
    this.chest.rotation.z = damp(this.chest.rotation.z, -bank * 0.5 + flightRoll * 0.45, 7, dt);

    // Breathing.
    const breath = Math.sin(this.time * 2.05) * 0.012 * (1 - run) + squash * 0.03;
    this.torso.scale.y = damp(this.torso.scale.y, 1 + breath, 8, dt);
    this.torso.scale.x = damp(this.torso.scale.x, 1.06 + breath * 0.4, 8, dt);

    // Head keeps its horizon while the chest leans.
    const idleLook = (Math.sin(this.time * 0.31) * 0.07 + Math.sin(this.time * 0.13 + 1.9) * 0.045) * (1 - run);
    this.head.rotation.y = damp(this.head.rotation.y, idleLook - gait.chestYaw * 0.75 - cast * 0.15, 6, dt);
    this.head.rotation.x = damp(this.head.rotation.x, -this.chest.rotation.x * 0.7 + (form ? -0.06 : 0) - squash * 0.1, 7, dt);
    this.head.rotation.z = damp(this.head.rotation.z, -bank * 0.55, 6, dt);

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
      kneeL = gait.kneeL - squash * 0.55;
      kneeR = gait.kneeR - squash * 0.55;
      ankleL = gait.ankleL + squash * 0.2;
      ankleR = gait.ankleR + squash * 0.2;
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

    const legLambda = grounded ? 14 : 8;
    this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, hipL, legLambda, dt);
    this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, hipR, legLambda, dt);
    this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, kneeL, legLambda, dt);
    this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, kneeR, legLambda, dt);
    this.legL.ankle.rotation.x = damp(this.legL.ankle.rotation.x, ankleL, legLambda, dt);
    this.legR.ankle.rotation.x = damp(this.legR.ankle.rotation.x, ankleR, legLambda, dt);

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

    this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, armLX, 12, dt);
    this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, armRX, 12, dt);
    this.armL.shoulder.rotation.z = damp(this.armL.shoulder.rotation.z, armLZ, 8, dt);
    this.armR.shoulder.rotation.z = damp(this.armR.shoulder.rotation.z, armRZ, 8, dt);
    this.armL.elbow.rotation.x = damp(this.armL.elbow.rotation.x, elbowL, 10, dt);
    this.armR.elbow.rotation.x = damp(this.armR.elbow.rotation.x, elbowR, 10, dt);

    // Staff trails slightly while running and lifts on a cast.
    this.staff.rotation.x = damp(this.staff.rotation.x, 0.05 + 0.28 * run + cast * 0.35, 8, dt);
    this.staff.rotation.z = damp(this.staff.rotation.z, -0.28 - cast * 0.12, 8, dt);

    // --------------------------------------------------------- cloth & hair
    const lift = capeLift(speed, vy);
    this.coatTails.forEach((tail, i) => {
      const flutter = Math.sin(this.time * (4.6 + i * 0.35) + i * 1.7) * (0.035 + 0.07 * run);
      const target = lift * (0.75 + i * 0.05) + flutter + (flying ? 0.2 : 0);
      tail.rotation.x = damp(tail.rotation.x, target, 4.2, dt);
      tail.rotation.z = damp(tail.rotation.z, -turn * 0.05 + Math.sin(this.time * 3.4 + i) * 0.05 * (0.3 + run), 3.5, dt);
    });

    const capeLiftTarget = lift + cast * 0.25;
    this.scarfTails.forEach((tail, i) => {
      const flutter = Math.sin(this.time * (5.2 + i * 0.7) + i * 1.7) * 0.1 * (0.3 + run);
      tail.rotation.x = damp(tail.rotation.x, capeLiftTarget * 1.35 + flutter + 0.1, 4, dt);
      tail.rotation.z = damp(tail.rotation.z, Math.sin(this.time * 3.1 + i) * 0.08 - turn * 0.06, 3.5, dt);
    });

    this.ponytail.rotation.x = damp(this.ponytail.rotation.x, 0.18 + lift * 0.45 + Math.sin(this.time * 4.2) * 0.05 * (0.3 + run), 4, dt);
    this.ponytail.rotation.z = damp(this.ponytail.rotation.z, -turn * 0.08, 4, dt);

    this.hat.rotation.x = damp(this.hat.rotation.x, 0.1 - vy * 0.004 - squash * 0.05, 6, dt);
    this.hat.rotation.z = damp(this.hat.rotation.z, -0.05 - bank * 0.2, 6, dt);

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

  /** Face a world yaw (model forward is -Z). */
  faceYaw(yaw, dt, lambda = 12) {
    this.root.rotation.y = dampAngle(this.root.rotation.y, yaw, lambda, dt);
  }
}
