/**
 * Hand-placed landmarks: the Beacon temple, Emberfall Camp, three shard
 * shrines, ruins, waystones, floating islets and atmospheric cloud banks.
 */

import * as THREE from 'three';
import { createRng } from '../util/rng.js';
import { fbm2 } from '../util/noise.js';
import { clamp, smoothstep, TAU } from '../util/math.js';
import { LOCATIONS } from './locations.js';
import { LocalLights } from './LocalLights.js';
import { batchStaticMeshes } from './batchStaticMeshes.js';
import { castleWallColliders } from './landmarkCollision.js';
import { createBeamTexture, createCloudTexture, createGlowTexture, createNoiseTexture, createStoneTexture, createWoodTexture } from './textures.js';

const _stoneTex = createStoneTexture(256);
_stoneTex.repeat.set(2, 1);
const _woodTex = createWoodTexture(256);
_woodTex.repeat.set(1, 1);

const MAT = {
  stone: new THREE.MeshStandardMaterial({ color: '#b8b6aa', map: _stoneTex, roughness: 0.92, flatShading: true }),
  stoneDark: new THREE.MeshStandardMaterial({ color: '#7e7f78', map: _stoneTex, roughness: 0.95, flatShading: true }),
  stoneWarm: new THREE.MeshStandardMaterial({ color: '#c4b294', map: _stoneTex, roughness: 0.9, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ color: '#b09a7a', map: _woodTex, roughness: 0.92, flatShading: true }),
  cloth: new THREE.MeshStandardMaterial({ color: '#a8433a', roughness: 0.86, flatShading: true, side: THREE.DoubleSide }),
  clothMuted: new THREE.MeshStandardMaterial({ color: '#7d6b4d', roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
  gold: new THREE.MeshStandardMaterial({
    color: '#c9a95c',
    metalness: 0.65,
    roughness: 0.32,
    emissive: '#3a2a0a',
    emissiveIntensity: 0.6,
  }),
};

/** Emissive material for runes/crystals. */
function glowMaterial(color, intensity = 2.2) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.4),
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.1,
  });
}

/** Add a mesh with optional transform. */
function add(parent, geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.scale.setScalar(scale);
  // Default off: hundreds of casters doubled the shadow pass. Structural
  // pieces that need shadows set castShadow = true explicitly.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.staticStructure = true;
  parent.add(mesh);
  return mesh;
}

/** Irregular rock with coherent surface variation and no masonry pattern. */
function weatheredRock(radius, seed) {
  const geometry = new THREE.IcosahedronGeometry(radius, 2);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const n = fbm2(x * 0.22 + y * 0.14, z * 0.22 - y * 0.1, 3, seed);
    const scale = 1 + n * 0.19;
    positions.setXYZ(i, x * scale, y * scale, z * scale);
    const tone = clamp(0.82 + n * 0.32 + y / radius * 0.10, 0.55, 1.1);
    colors[i * 3] = tone * 0.96;
    colors[i * 3 + 1] = tone;
    colors[i * 3 + 2] = tone * 0.91;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Repeated small structural details in one draw call. */
function boxInstances(parent, material, entries, name) {
  if (!entries.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, entries.length);
  mesh.name = name;
  mesh.receiveShadow = true;
  const dummy = new THREE.Object3D();
  entries.forEach((entry, i) => {
    dummy.position.set(...entry.position);
    dummy.rotation.set(0, entry.yaw ?? 0, entry.roll ?? 0);
    dummy.scale.set(...entry.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
  return mesh;
}

/** A soft additive glow sprite. Texture is shared — previously every call
 *  allocated its own 128px canvas texture. */
const _sharedGlowMap = createGlowTexture(128, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
function glowSprite(color, size = 4, opacity = 0.7) {
  const map = _sharedGlowMap;
  const material = new THREE.SpriteMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(size);
  return sprite;
}

export class Structures {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./heightfield.js').Heightfield} heightfield
   */
  constructor(scene, heightfield) {
    this.scene = scene;
    this.heightfield = heightfield;
    this.group = new THREE.Group();
    this.group.name = 'Structures';
    this.colliders = [];
    /** @type {Map<string, any>} */
    this.shardSites = new Map();
    this.animated = [];
    this.floatingIslands = [];
    this.fireSprites = [];
    this.clouds = [];
    this.beaconBeam = null;
    this.altar = null;
    this.altarDimmed = false;
    this.campfireLight = null;
    this.sableSpot = null;
    this.runeRings = [];
    this.restored = false;
  }

  build() {
    this._buildTemple();
    this._buildCamp();
    this._buildShrines();
    this._buildRuins();
    this._buildWaystones();
    this._buildLanterns();
    this._buildFrontier();
    this._buildWaterfall();
    this._buildFloatingIslands();
    this._buildClouds();
    this._buildCrystals();
    const dynamic = new Set(this.runeRings);
    for (const item of this.animated) {
      if (item.mesh) dynamic.add(item.mesh);
      if (item.crystal) dynamic.add(item.crystal);
      if (item.site) {
        dynamic.add(item.site.shard);
        dynamic.add(item.site.ring);
        dynamic.add(item.site.seal);
      }
    }
    for (const lantern of this.lanterns ?? []) dynamic.add(lantern.flame);
    this.batchedDrawCalls = batchStaticMeshes(this.group, dynamic);
    this.scene.add(this.group);
    this.localLights = new LocalLights(this.scene, this.group);
    return this;
  }

  /**
   * Stormpeak waterfall: a high mountain spring spills over a cliff ledge
   * at (-340,-240). A scrolling streak texture gives the fall motion, a
   * foam pool and drifting mist sprites sell the impact, and a shallow
   * rock channel carries the stream in. Procedural — no downloaded assets.
   */
  _buildWaterfall() {
    // Mesa falls: a freestanding rock tower on the southern mesa edge
    // (750,1150) spilling toward the low southern valley. A wedge side
    // faces open grass so the sheet reads from outside the plateau.
    const x = 750;
    const z = 1150;
    const baseGround = this._heightAt(x, z);
    const topY = baseGround + 26;
    const fall = 24;
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    g.rotation.y = 1.14; // sheet normal faces the southern valley camera
    this.group.add(g);

    // Cliff anchoring the fall: a broad rock face behind the sheet so the
    // ledge never floats in the air when seen from below.
    const cliffMat = new THREE.MeshStandardMaterial({ color: '#b8b4a8', roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
    const face = add(g, new THREE.CylinderGeometry(2.2, 6.5, fall + 4, 7, 1, true), cliffMat, 0, -fall / 2 - 1.5, -1.8);
    face.castShadow = false;
    // Stream channel on the ledge feeding the fall.
    const channelMat = cliffMat;
    add(g, new THREE.BoxGeometry(4.5, 0.5, 10), channelMat, 0, -0.25, 3.5);
    const streamMat = new THREE.MeshStandardMaterial({ color: '#7ec8e8', roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85, emissive: '#20404f', emissiveIntensity: 0.4 });
    add(g, new THREE.BoxGeometry(2.6, 0.12, 9), streamMat, 0, 0.05, 3.5).castShadow = false;

    // Falling sheet: canvas streaks scrolling downward.
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(150,210,240,0.55)';
    ctx.fillRect(0, 0, 128, 256);
    const wrng = createRng(5555);
    for (let i = 0; i < 90; i++) {
      const sx = wrng.range(0, 128);
      const sy = wrng.range(0, 256);
      const len = wrng.range(30, 120);
      ctx.fillStyle = `rgba(255,255,255,${wrng.range(0.25, 0.85)})`;
      ctx.fillRect(sx, sy, wrng.range(1, 3), len);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 2.2);
    const sheetMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.92, roughness: 0.3, metalness: 0.05, side: THREE.DoubleSide, emissive: '#2a4a5f', emissiveIntensity: 0.35 });
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(3.4, fall, 1, 1), sheetMat);
    sheet.position.set(0, -fall / 2, 3.2);
    sheet.castShadow = false;
    sheet.receiveShadow = false;
    g.add(sheet);
    this.waterfallSheet = sheet;
    this.waterfallTex = tex;

    // Foam pool disc at the base.
    const foam = new THREE.Mesh(new THREE.CircleGeometry(5, 20), new THREE.MeshStandardMaterial({ color: '#d8f0f8', transparent: true, opacity: 0.75, roughness: 0.4 }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, -fall + 0.35, 2.5);
    g.add(foam);
    // Mist.
    const mist = glowSprite('#d8f0f8', 7, 0.28);
    mist.position.set(0, -fall + 2.2, 2.5);
    g.add(mist);
    this.animated.push({ type: 'glowPulse', sprite: mist, base: 0.28, phase: 0.4 });
    // Ledge lip blocks so the stream visibly pours over.
    for (const [lx, lz] of [[-2.2, 0], [2.2, 0], [-1.2, -1.5], [1.4, -2]]) {
      add(g, new THREE.DodecahedronGeometry(0.5, 0), channelMat, lx, 0.2, lz);
    }
  }

  /** Expanded-world frontier: mine, castle, village, crypt, sky-temple.
   *  Each site sits on its own flattened POI so the 34× island reads as
   *  intentional places rather than empty heightfield. */
  _buildFrontier() {
    const f = LOCATIONS.frontier ?? [];
    const byId = Object.fromEntries(f.map((l) => [l.id, l]));

    // --- Aether Mine: cliff-shaft entrance, timber frames, ore glow ---
    const mine = byId.aetherMine;
    if (mine) {
      const g = new THREE.Group();
      g.position.set(mine.x, this._heightAt(mine.x, mine.z), mine.z);
      this.group.add(g);
      // Uneven weathered rock uses its own mineral surface rather than the
      // coursed masonry texture used by buildings.
      const rockDetail = createNoiseTexture({ size: 128, scale: 14, octaves: 3, seed: 997, contrast: 0.7 });
      const rockMat = new THREE.MeshStandardMaterial({ color: '#8b8d80', map: rockDetail, roughness: 1, vertexColors: true, flatShading: true });
      const face = add(g, weatheredRock(6.5, 991), rockMat, 0, 3.6, -7);
      face.scale.set(1.5, 0.95, 0.55);
      face.rotation.set(0.2, 0.5, 0.1);
      const lip = add(g, weatheredRock(3.4, 993), rockMat, -5.5, 2.4, -4.5);
      lip.scale.set(1.4, 0.8, 0.5);
      lip.rotation.set(-0.15, 0.9, 0.2);
      const scree = add(g, weatheredRock(2.2, 995), rockMat, 6.5, 1.1, -3.5);
      scree.scale.set(1.6, 0.7, 0.6);
      scree.rotation.set(0.3, -0.4, -0.1);
      // Mouth: inset tunnel with side walls and a warm back-glow so it
      // reads as a hole in rock, not a black box on a slab.
      const mouth = add(g, new THREE.BoxGeometry(4.6, 3.8, 0.6), new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1 }), 1.2, 1.9, -2.9);
      mouth.castShadow = false;
      add(g, new THREE.BoxGeometry(0.5, 3.8, 2.2), MAT.stoneDark, -1.1, 1.9, -3.4);
      add(g, new THREE.BoxGeometry(0.5, 3.8, 2.2), MAT.stoneDark, 3.5, 1.9, -3.4);
      // Collapsed boards make the blocked, non-enterable shaft clear.
      for (const [y, angle] of [[1.2, 0.18], [2.35, -0.15]]) {
        add(g, new THREE.BoxGeometry(4.25, 0.32, 0.24), MAT.wood, 1.2, y, -2.52, 0, 0, angle);
      }
      // timber frames
      for (const [x, z] of [[1.2, -1.8], [1.2, 3.5]]) {
        add(g, new THREE.CylinderGeometry(0.28, 0.34, 5.2, 6), MAT.wood, x - 2.2, 2.6, z);
        add(g, new THREE.CylinderGeometry(0.28, 0.34, 5.2, 6), MAT.wood, x + 2.2, 2.6, z);
        add(g, new THREE.BoxGeometry(5.4, 0.5, 0.8), MAT.wood, x, 5, z);
      }
      // A worked approach leads the eye into the shaft: two iron rails,
      // sleepers, braced frames and a battered ore cart.
      const iron = new THREE.MeshStandardMaterial({ color: '#4c504d', metalness: 0.68, roughness: 0.58 });
      const sleepers = [];
      for (let z = -2; z <= 19; z += 1.25) {
        sleepers.push({ position: [1.2, 0.08, z], scale: [2.25, 0.16, 0.3] });
      }
      boxInstances(g, MAT.wood, sleepers, 'Mine sleepers');
      for (const x of [0.43, 1.97]) {
        add(g, new THREE.BoxGeometry(0.12, 0.13, 21.5), iron, x, 0.19, 8.5);
      }
      for (const z of [-1.8, 3.5]) {
        for (const side of [-1, 1]) {
          add(g, new THREE.BoxGeometry(0.3, 2.4, 0.32), MAT.wood,
            1.2 + side * 1.65, 4.1, z, 0, 0, side * -0.6);
        }
      }
      const cart = new THREE.Group(); cart.position.set(1.2, 0, 9.5); g.add(cart);
      add(cart, new THREE.BoxGeometry(2, 0.2, 2.5), MAT.wood, 0, 0.8, 0);
      for (const side of [-1, 1]) {
        const plank = add(cart, new THREE.BoxGeometry(0.16, 0.85, 2.5), MAT.wood, side * 0.9, 1.26, 0);
        plank.rotation.z = side * -0.12;
        for (const z of [-0.8, 0.8]) {
          const wheel = add(cart, new THREE.CylinderGeometry(0.39, 0.39, 0.14, 12), iron, side * 1.05, 0.38, z);
          wheel.rotation.z = Math.PI / 2;
          const hub = add(cart, new THREE.CylinderGeometry(0.13, 0.13, 0.17, 10), MAT.wood, side * 1.14, 0.38, z);
          hub.rotation.z = Math.PI / 2;
        }
      }
      add(cart, new THREE.BoxGeometry(2, 0.85, 0.16), MAT.wood, 0, 1.26, -1.17);
      add(cart, new THREE.BoxGeometry(2, 0.85, 0.16), MAT.wood, 0, 1.26, 1.17);
      const rubble = [];
      const mineRng = createRng(451);
      for (let i = 0; i < 38; i++) {
        const side = i % 2 ? -1 : 1;
        const x = 1.2 + side * mineRng.range(3.3, 10.5);
        const z = mineRng.range(-6, 11);
        const size = mineRng.range(0.18, 0.68);
        rubble.push({ position: [x, size * 0.25, z], scale: [size * 1.3, size * 0.55, size], yaw: mineRng.range(0, Math.PI) });
      }
      boxInstances(g, MAT.stoneDark, rubble, 'Mine scree');
      // ore veins + cart crates
      const ore = glowMaterial('#76cbb9', 0.65);
      for (const [x, y, z, scale] of [[-6.2, 1.6, -3.6, 0.44], [-5.2, 2.8, -4, 0.3],
        [5.2, 1.2, -3.4, 0.4], [6.5, 1.6, -3.5, 0.3]]) {
        const vein = add(g, new THREE.OctahedronGeometry(scale, 0), ore, x, y, z);
        vein.rotation.set(0.3, 0.5, -0.25);
      }
      add(g, new THREE.BoxGeometry(1.4, 1, 1.4), MAT.wood, 4.5, 0.5, 1);
      add(g, new THREE.BoxGeometry(1.2, 0.8, 1.2), MAT.stoneWarm, 5.8, 0.4, -0.5);
      const gl = glowSprite('#8ef2e0', 6, 0.35); gl.position.set(1.2, 3, -1.5); g.add(gl);
      this.animated.push({ type: 'glowPulse', sprite: gl, base: 0.35, phase: 0 });
      this.colliders.push({ x: mine.x + 1.2, z: mine.z - 3, r: 2.6 });
      this.colliders.push({ x: mine.x - 6, z: mine.z - 4, r: 3 });
    }

    // --- Embercastle: keep, four corner towers, gatehouse, banner glow ---
    const castle = byId.emberCastle;
    if (castle) {
      const g = new THREE.Group();
      g.position.set(castle.x, this._heightAt(castle.x, castle.z), castle.z);
      this.group.add(g);
      const castleMap = _stoneTex.clone();
      castleMap.repeat.set(6, 2.5);
      castleMap.needsUpdate = true;
      const stone = new THREE.MeshStandardMaterial({ color: '#c3c0b3', map: castleMap, roughness: 0.95 });
      const roof = new THREE.MeshStandardMaterial({ color: '#5a3a3a', roughness: 0.9, flatShading: true });
      // A walkable open gate, layered ramparts, and a tall central keep.
      // The wall and tower details are instanced so the silhouette stays rich
      // without turning every merlon and arrow slit into a separate draw call.
      const masonry = (geometry, x, y, z) => {
        const mesh = add(g, geometry, stone, x, y, z);
        mesh.castShadow = true;
        return mesh;
      };
      masonry(new THREE.BoxGeometry(26, 7, 2), 0, 3.5, -12);
      masonry(new THREE.BoxGeometry(2, 7, 26), -12, 3.5, 0);
      masonry(new THREE.BoxGeometry(2, 7, 26), 12, 3.5, 0);
      for (const side of [-1, 1]) {
        masonry(new THREE.BoxGeometry(10.5, 7, 2), side * 7.75, 3.5, 12);
      }
      masonry(new THREE.BoxGeometry(10, 15, 10), 0, 7.5, -3);
      add(g, new THREE.BoxGeometry(10.7, 0.45, 10.7), MAT.stoneDark, 0, 13.7, -3);
      add(g, new THREE.ConeGeometry(7.8, 5.5, 4), roof, 0, 17.6, -3, 0, Math.PI / 4, 0);
      const merlons = [];
      for (let p = -10; p <= 10; p += 2.5) {
        for (const side of [-1, 1]) {
          merlons.push({ position: [p, 7.55, side * 12], scale: [1.35, 1.1, 2.1] });
          if (Math.abs(p) > 3 || side < 0) {
            merlons.push({ position: [side * 12, 7.55, p], scale: [2.1, 1.1, 1.35] });
          }
        }
      }
      boxInstances(g, stone, merlons, 'Curtain battlements');
      for (const [tx, tz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
        masonry(new THREE.CylinderGeometry(3, 3.5, 12, 12), tx, 6, tz);
        add(g, new THREE.CylinderGeometry(3.3, 3.3, 0.45, 12), MAT.stoneDark, tx, 10.9, tz);
        add(g, new THREE.ConeGeometry(3.9, 4.8, 12), roof, tx, 14.5, tz);
        add(g, new THREE.CylinderGeometry(0.1, 0.12, 1.4, 6), MAT.gold, tx, 17.4, tz);
        this.colliders.push({ x: castle.x + tx, z: castle.z + tz, r: 3.4 });
      }
      const embrasures = [];
      for (const [tx, tz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
        for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
          const x = tx + Math.sin(angle) * 3.03;
          const z = tz + Math.cos(angle) * 3.03;
          for (const y of [4.8, 8.3]) {
            embrasures.push({ position: [x, y, z], yaw: angle, scale: [0.36, 1.4, 0.10] });
          }
        }
      }
      const slit = new THREE.MeshStandardMaterial({ color: '#171c1c', roughness: 1 });
      boxInstances(g, slit, embrasures, 'Tower arrow slits');
      // The gate opening is clear in both the geometry and collision layout.
      for (const side of [-1, 1]) {
        masonry(new THREE.BoxGeometry(1.8, 8.5, 4.2), side * 3.35, 4.25, 13);
        const leaf = add(g, new THREE.BoxGeometry(2.1, 5.2, 0.25), MAT.wood, side * 2.6, 2.6, 14.2);
        leaf.rotation.y = side * 1.1;
      }
      masonry(new THREE.BoxGeometry(8.5, 2.6, 4.2), 0, 7.2, 13);
      const gateCrests = [];
      for (let x = -3.5; x <= 3.5; x += 1.75) {
        gateCrests.push({ position: [x, 9.1, 13], scale: [1.0, 1.2, 4.3] });
      }
      boxInstances(g, stone, gateCrests, 'Gate battlements');
      // Frames, banners, and a worn approach make the gate legible at range.
      for (const side of [-1, 1]) {
        add(g, new THREE.BoxGeometry(0.35, 4.8, 0.24), MAT.stoneDark, side * 2.5, 2.4, 15.2);
        const banner = add(g, new THREE.BoxGeometry(1.0, 3.4, 0.10), MAT.cloth, side * 4.3, 5.6, 15.2);
        banner.rotation.z = side * 0.035;
        add(g, new THREE.BoxGeometry(0.16, 2.2, 0.12), MAT.gold, side * 4.3, 5.65, 15.28);
      }
      const paving = [];
      const pavingRng = createRng(728);
      for (let row = 0; row < 10; row++) {
        for (let col = -1; col <= 1; col++) {
          const width = pavingRng.range(1.3, 1.7);
          paving.push({ position: [col * 1.55 + (row % 2) * 0.2, 0.03, 15 + row * 1.65], scale: [width, 0.08, 1.45], yaw: pavingRng.range(-0.04, 0.04) });
        }
      }
      boxInstances(g, MAT.stoneWarm, paving, 'Castle approach');
      // Narrow colliders follow the walls, leaving the central gate usable.
      this.colliders.push(...castleWallColliders(castle));
      // ember torches
      for (const [tx, tz] of [[-3.2, 14.6], [3.2, 14.6]]) {
        add(g, new THREE.OctahedronGeometry(0.4, 0), glowMaterial('#ffb066', 2.2), tx, 6.2, tz);
        const tl = glowSprite('#ffb066', 3, 0.5); tl.position.set(tx, 6.2, tz); g.add(tl);
        const li = new THREE.PointLight('#ffb066', 2.2, 18, 1.8); li.position.set(tx, 6.2, tz); g.add(li);
        this.animated.push({ type: 'fire', light: li, base: 2.2, phase: tx });
      }
      // courtyard well + crates
      add(g, new THREE.CylinderGeometry(1.2, 1.4, 1.1, 8), MAT.stoneDark, 6.5, 0.55, 6);
      add(g, new THREE.BoxGeometry(1.2, 1.2, 1.2), MAT.wood, 5, 0.6, 5);
      add(g, new THREE.BoxGeometry(1, 1, 1), MAT.wood, 6.2, 0.5, 3);
      this.colliders.push({ x: castle.x + 0, z: castle.z - 2, r: 5.2 });
    }

    // --- Saltmere Village: huts, dock, barrels, lamps ---
    const vil = byId.saltVillage;
    if (vil) {
      const g = new THREE.Group();
      g.position.set(vil.x, this._heightAt(vil.x, vil.z), vil.z);
      this.group.add(g);
      const wall = new THREE.MeshStandardMaterial({ color: '#c9b088', roughness: 0.92, flatShading: true });
      const thatch = new THREE.MeshStandardMaterial({ color: '#8a6a3e', roughness: 0.95, flatShading: true });
      const rng = createRng(99);
      const hut = (x, z, ry) => {
        const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = ry; g.add(h);
        add(h, new THREE.BoxGeometry(5, 3, 4.2), wall, 0, 1.5, 0);
        add(h, new THREE.ConeGeometry(3.9, 2.2, 4), thatch, 0, 4.1, 0, 0, Math.PI / 4, 0);
        add(h, new THREE.BoxGeometry(1.1, 2, 0.3), MAT.wood, 0, 1, 2.15);
        // Warm emissive window: the village reads inhabited, not abandoned.
        add(h, new THREE.BoxGeometry(1, 0.9, 0.15), glowMaterial('#ffb45e', 1.6), -1.4, 1.9, 2.15);
        add(h, new THREE.BoxGeometry(0.9, 0.8, 0.15), glowMaterial('#ffb45e', 1.2), 1.5, 1.7, 2.15);
        this.colliders.push({ x: vil.x + x, z: vil.z + z, r: 3 });
      };
      hut(-9, -6, 0.2); hut(7, -9, -0.4); hut(-6, 8, 0.7); hut(10, 6, -1.1); hut(0, -18, 0.1);
      // dock toward the sea (local +Z)
      for (let i = 0; i < 6; i++) add(g, new THREE.BoxGeometry(3.4, 0.3, 2.4), MAT.wood, (i % 2 ? 1.5 : -1.5), 0.6, 16 + i * 2.2);
      for (let i = 0; i < 3; i++) add(g, new THREE.CylinderGeometry(0.18, 0.22, 3, 5), MAT.wood, i % 2 ? 1.4 : -1.4, 0.4, 18 + i * 5);
      // barrels + lamps
      for (let i = 0; i < 4; i++) add(g, new THREE.CylinderGeometry(0.55, 0.6, 1.1, 8), MAT.wood, -3 + i * 1.5, 0.55, 12);
      for (const [lx, lz] of [[-2, 2], [3, -2], [0, 10]]) {
        add(g, new THREE.CylinderGeometry(0.12, 0.16, 3.2, 5), MAT.wood, lx, 1.6, lz);
        const flame = add(g, new THREE.OctahedronGeometry(0.28, 0), glowMaterial('#ffe9a8', 2), lx, 3.4, lz);
        flame.castShadow = false;
        const li = new THREE.PointLight('#ffe9a8', 1.6, 14, 1.8); li.position.set(lx, 3.4, lz); g.add(li);
        this.animated.push({ type: 'fire', light: li, base: 1.6, phase: lx * 0.2 });
      }
      this.colliders.push({ x: vil.x + 0, z: vil.z + 18, r: 1.4 });
    }

    // --- Sunken Crypt: broken arch, sarcophagus vault, moss glows ---
    const crypt = byId.sunkenCrypt;
    if (crypt) {
      const g = new THREE.Group();
      g.position.set(crypt.x, this._heightAt(crypt.x, crypt.z), crypt.z);
      this.group.add(g);
      const moss = new THREE.MeshStandardMaterial({ color: '#5a7d58', roughness: 0.95, flatShading: true });
      const cryptMass = add(g, new THREE.BoxGeometry(14, 5.5, 10), MAT.stone, 0, 2.75, -4);
      cryptMass.rotation.y = 0.06;
      // Mossy broken roofline so the mass reads as a ruin, not a bunker.
      const roof = add(g, new THREE.BoxGeometry(14.6, 0.9, 10.6), moss, 0, 5.6, -4);
      roof.rotation.set(0.03, 0.06, -0.02);
      const roofGap = add(g, new THREE.BoxGeometry(5, 1, 10.6), MAT.stoneDark, 4.5, 6.05, -4);
      roofGap.rotation.set(0.08, 0.06, 0.05);
      const porch = add(g, new THREE.BoxGeometry(7, 4.4, 5), MAT.stoneDark, 0, 2.2, 1.8);
      porch.rotation.y = -0.04;
      const inner = add(g, new THREE.BoxGeometry(4.2, 3, 0.5), new THREE.MeshStandardMaterial({ color: '#101a14', roughness: 1 }), 0, 1.5, 1.6);
      inner.castShadow = false;
      // broken arch + pillars
      const arch = new THREE.Group(); arch.position.set(0, 0, 6); g.add(arch);
      add(arch, new THREE.TorusGeometry(3.2, 0.4, 6, 16, Math.PI), MAT.stone, 0, 0.4, 0);
      for (const [px, pz] of [[-5, 5], [5, 5], [-5, -2], [5, -2]]) {
        add(g, new THREE.CylinderGeometry(0.55, 0.7, 4.2, 7), MAT.stone, px, 2.1, pz);
        this.colliders.push({ x: crypt.x + px, z: crypt.z + pz, r: 0.9 });
      }
      // sarcophagus + crypt glow
      add(g, new THREE.BoxGeometry(3.6, 1, 2), MAT.stoneWarm, 0, 0.5, 4);
      add(g, new THREE.BoxGeometry(3, 0.5, 1.6), MAT.stone, 0, 1.2, 4);
      for (let i = 0; i < 4; i++) {
        add(g, new THREE.OctahedronGeometry(0.35, 0), glowMaterial('#8ef2e0', 1), -4 + i * 2.6, 1 + (i % 2) * 0.6, -1);
      }
      const cg = glowSprite('#8ef2e0', 5, 0.3); cg.position.set(0, 3, 4); g.add(cg);
      this.animated.push({ type: 'glowPulse', sprite: cg, base: 0.3, phase: 2 });
      void moss;
    }

    // --- Sky-Thread Temple: tall spires + sky beam marker ---
    const skyT = byId.skyTemple;
    if (skyT) {
      const g = new THREE.Group();
      g.position.set(skyT.x, this._heightAt(skyT.x, skyT.z), skyT.z);
      this.group.add(g);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        const px = Math.cos(a) * 14, pz = Math.sin(a) * 14;
        add(g, new THREE.CylinderGeometry(1.1, 1.6, 14 + i * 2, 8), MAT.stone, px, 7 + i, pz);
        add(g, new THREE.ConeGeometry(1.6, 4, 8), MAT.stoneDark, px, 16 + i * 2, pz);
        this.colliders.push({ x: skyT.x + px, z: skyT.z + pz, r: 1.7 });
      }
      add(g, new THREE.CylinderGeometry(4, 5, 4, 12), MAT.stoneWarm, 0, 2, 0);
      const beamMat = new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 3.4, 180, 12, 1, true), beamMat);
      beam.position.set(0, 90, 0); g.add(beam);
      this.animated.push({ type: 'float', mesh: beam, baseY: 90, phase: 0, amp: 0 });
      const sg = glowSprite('#ffe9a8', 10, 0.4); sg.position.set(0, 5, 0); g.add(sg);
    }

    // --- Glasshollow: crystal cavern spires, teal glow ---
    const glass = byId.glassHollow;
    if (glass) {
      const g = new THREE.Group();
      g.position.set(glass.x, this._heightAt(glass.x, glass.z), glass.z);
      this.group.add(g);
      const glassMat = glowMaterial('#8ef2e0', 1.5);
      const glassMat2 = glowMaterial('#c6a8ff', 1.3);
      const glng = createRng(4242);
      for (let i = 0; i < 11; i++) {
        const a = glng.range(0, TAU);
        const r = glng.range(6, 38);
        const px = Math.cos(a) * r;
        const pz = Math.sin(a) * r;
        const h = glng.range(2.2, 9);
        const shard = add(g, new THREE.ConeGeometry(glng.range(0.5, 1.2), h, 5), i % 2 ? glassMat : glassMat2, px, h * 0.5 - 0.3, pz, glng.range(-0.18, 0.18), glng.range(0, TAU), glng.range(-0.18, 0.18));
        shard.castShadow = true;
        if (i % 3 === 0) this.colliders.push({ x: glass.x + px, z: glass.z + pz, r: 1 });
      }
      const gg = glowSprite('#8ef2e0', 9, 0.3); gg.position.set(0, 4, 0); g.add(gg);
      this.animated.push({ type: 'glowPulse', sprite: gg, base: 0.3, phase: 1.1 });
    }

    // --- The Ember Wastes: burnt spires + ember glow ---
    const wastes = byId.emberWastes;
    if (wastes) {
      const g = new THREE.Group();
      g.position.set(wastes.x, this._heightAt(wastes.x, wastes.z), wastes.z);
      this.group.add(g);
      const charMat = new THREE.MeshStandardMaterial({ color: '#2b2320', roughness: 0.95, flatShading: true, emissive: '#3a1404', emissiveIntensity: 0.5 });
      const wnrg = createRng(7771);
      for (let i = 0; i < 9; i++) {
        const a = wnrg.range(0, TAU);
        const r = wnrg.range(8, 44);
        const px = Math.cos(a) * r;
        const pz = Math.sin(a) * r;
        const h = wnrg.range(3, 11);
        add(g, new THREE.CylinderGeometry(0.5, 1.4, h, 6), charMat, px, h * 0.5 - 0.5, pz, wnrg.range(-0.22, 0.22), wnrg.range(0, TAU), wnrg.range(-0.22, 0.22));
        if (i % 3 === 0) this.colliders.push({ x: wastes.x + px, z: wastes.z + pz, r: 1.3 });
      }
      for (let i = 0; i < 5; i++) {
        const ex = wnrg.range(-30, 30);
        const ez = wnrg.range(-30, 30);
        add(g, new THREE.OctahedronGeometry(0.45, 0), glowMaterial('#ffb066', 2), ex, 0.6, ez);
        const li = new THREE.PointLight('#ff8a3d', 1.4, 14, 1.8); li.position.set(ex, 1.4, ez); g.add(li);
        this.animated.push({ type: 'fire', light: li, base: 1.4, phase: ex * 0.3 });
      }
      const wg = glowSprite('#ff8a3d', 8, 0.3); wg.position.set(0, 3, 0); g.add(wg);
      this.animated.push({ type: 'glowPulse', sprite: wg, base: 0.3, phase: 2.2 });
    }

    // --- Moonlit Docks: piers, lamps, crates over the water ---
    const docks = byId.moonlitDocks;
    if (docks) {
      const g = new THREE.Group();
      g.position.set(docks.x, this._heightAt(docks.x, docks.z), docks.z);
      this.group.add(g);
      for (let i = 0; i < 4; i++) {
        const w = 2.2, d = 14;
        const pier = new THREE.Group();
        pier.position.set(-16 + i * 11, 0, 0);
        pier.rotation.y = (i % 2 ? -1 : 1) * 0.2;
        for (let j = 0; j < 5; j++) add(pier, new THREE.BoxGeometry(w, 0.25, d / 5), MAT.wood, 0, 0.6, -d / 2 + j * (d / 5));
        for (let j = 0; j < 4; j++) add(pier, new THREE.CylinderGeometry(0.14, 0.18, 2, 5), MAT.wood, j % 2 ? 0.8 : -0.8, 0.2, -d / 2 + j * 4);
        g.add(pier);
        this.colliders.push({ x: docks.x + pier.position.x, z: docks.z + pier.position.z, r: 2 });
      }
      for (const [lx, lz] of [[-10, 6], [0, 10], [10, 6]]) {
        add(g, new THREE.CylinderGeometry(0.12, 0.16, 3, 5), MAT.wood, lx, 1.5, lz);
        const fl = add(g, new THREE.OctahedronGeometry(0.26, 0), glowMaterial('#d8e8ff', 2), lx, 3.1, lz);
        fl.castShadow = false;
        const li = new THREE.PointLight('#bcd6ff', 1.6, 15, 1.8); li.position.set(lx, 3.1, lz); g.add(li);
        this.animated.push({ type: 'fire', light: li, base: 1.6, phase: lx * 0.2 });
      }
      for (let i = 0; i < 5; i++) add(g, new THREE.BoxGeometry(1.1, 1.1, 1.1), MAT.wood, -6 + i * 2, 0.55, -4);
      const dg = glowSprite('#bcd6ff', 7, 0.3); dg.position.set(0, 4, 0); g.add(dg);
    }

    // --- Stormspire: twin lightning spires ---
    const spire = byId.stormSpire;
    if (spire) {
      const g = new THREE.Group();
      g.position.set(spire.x, this._heightAt(spire.x, spire.z), spire.z);
      this.group.add(g);
      const stormMat = glowMaterial('#8fb4ff', 1.8);
      for (const [px, pz, tall] of [[-6, 0, 26], [6, 0, 20], [0, -8, 14], [0, 8, 16]]) {
        add(g, new THREE.CylinderGeometry(1.4, 2.2, tall, 8), MAT.stone, px, tall / 2, pz);
        add(g, new THREE.ConeGeometry(1.8, 6, 8), MAT.stoneDark, px, tall + 3, pz);
        add(g, new THREE.OctahedronGeometry(0.7, 0), stormMat, px, tall + 7, pz);
        this.colliders.push({ x: spire.x + px, z: spire.z + pz, r: 2 });
      }
      const sg = glowSprite('#8fb4ff', 12, 0.35); sg.position.set(0, 12, 0); g.add(sg);
      this.animated.push({ type: 'glowPulse', sprite: sg, base: 0.35, phase: 0.8 });
    }

    // --- Frostfjord: ice shards + cold glow at the coast ---
    const fjord = byId.frostFjord;
    if (fjord) {
      const g = new THREE.Group();
      g.position.set(fjord.x, this._heightAt(fjord.x, fjord.z), fjord.z);
      this.group.add(g);
      const iceMat = new THREE.MeshStandardMaterial({ color: '#bfe8ff', roughness: 0.25, metalness: 0.1, flatShading: true, emissive: '#2a5a7f', emissiveIntensity: 0.4 });
      const frng = createRng(31337);
      for (let i = 0; i < 8; i++) {
        const a = frng.range(0, TAU);
        const r = frng.range(6, 34);
        const px = Math.cos(a) * r;
        const pz = Math.sin(a) * r;
        const h = frng.range(2.5, 8);
        const ice = add(g, new THREE.ConeGeometry(frng.range(0.5, 1.1), h, 5), iceMat, px, h * 0.5 - 0.4, pz, frng.range(-0.2, 0.2), frng.range(0, TAU), 0);
        ice.castShadow = true;
        if (i % 3 === 0) this.colliders.push({ x: fjord.x + px, z: fjord.z + pz, r: 1 });
      }
      const fg = glowSprite('#bfe8ff', 8, 0.3); fg.position.set(0, 4, 0); g.add(fg);
      this.animated.push({ type: 'glowPulse', sprite: fg, base: 0.3, phase: 1.6 });
    }
  }

  // Old sailing lanterns of the Lantern Way — the side quest's landmarks.
  // Eight stone posts in a broken road from the south shore to the temple ring.
  // Their glow can be woken one by one as the player advances the quest.
  _buildLanterns() {
    const defs = [
      { x: 44, z: 468, r: 3.4 },
      { x: 62, z: 392, r: 3.2 },
      { x: 88, z: 310, r: 3.3 },
      { x: 58, z: 210, r: 3.1 },
      { x: 10, z: 108, r: 3.4 },
      { x: -34, z: 8, r: 3.2 },
      { x: -12, z: -120, r: 3.3 },
      { x: 8, z: -240, r: 3.5 },
    ];
    this.lanterns = [];
    const stoneMat = new THREE.MeshStandardMaterial({ color: '#6e6c63', roughness: 0.92, flatShading: true });
    const glowMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#8a6a1f').multiplyScalar(0.5),
      emissive: '#ffd27a',
      emissiveIntensity: 0.35,
      roughness: 0.4,
    });
    for (const def of defs) {
      const y = this._heightAt(def.x, def.z);
      const g = new THREE.Group();
      g.position.set(def.x, y, def.z);
      add(g, new THREE.CylinderGeometry(0.55, 0.75, 3.2, 6), stoneMat, 0, 1.6, 0);
      add(g, new THREE.BoxGeometry(0.72, 0.72, 0.72), stoneMat, 0, 3.2, 0);
      const flame = add(g, new THREE.OctahedronGeometry(0.34, 0), glowMat.clone(), 0, 3.95, 0);
      flame.castShadow = false;
      const halo = glowSprite('#ffd27a', 4.2, 0.0);
      halo.position.y = 3.95;
      g.add(halo);
      const light = new THREE.PointLight('#ffd27a', 0, 30, 1.8);
      light.position.y = 4.0;
      light.visible = false; // unlit lanterns must not add shader light cost
      g.add(light);
      this.group.add(g);
      this.lanterns.push({ x: def.x, z: def.z, y, group: g, flame, halo, light, lit: false });
    }
  }

  /** Wake the first `count` lanterns along the Lantern Way. */
  setLanternsLit(count) {
    if (!this.lanterns) return;
    for (let i = 0; i < this.lanterns.length; i++) {
      const lantern = this.lanterns[i];
      const shouldBeLit = i < count;
      if (shouldBeLit === lantern.lit) continue;
      lantern.lit = shouldBeLit;
      lantern.flame.material.emissiveIntensity = shouldBeLit ? 2.6 : 0.35;
      lantern.halo.material.opacity = shouldBeLit ? 0.62 : 0.0;
      lantern.light.intensity = shouldBeLit ? 3.2 : 0;
      lantern.light.visible = shouldBeLit;
    }
  }

  /** Number of lanterns the quest has woken. */
  get lanternProgress() {
    return (this.lanterns ?? []).filter((l) => l.lit).length;
  }

  /** Next unlit lantern the player should seek, if any. */
  nextLantern() {
    return (this.lanterns ?? []).find((l) => !l.lit) ?? null;
  }

  _heightAt(x, z) {
    return this.heightfield.height(x, z);
  }

  _buildTemple() {
    const loc = LOCATIONS.temple;
    const y = this._heightAt(loc.x, loc.z);
    const g = new THREE.Group();
    g.position.set(loc.x, y, loc.z);
    this.group.add(g);

    // Decorative floor ring, flush with the plateau.
    const floor = new THREE.Mesh(
      new THREE.RingGeometry(4.4, 27, 64),
      new THREE.MeshStandardMaterial({ color: '#7c7a71', roughness: 0.94, side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.04;
    floor.receiveShadow = true;
    g.add(floor);

    // Eight columns.
    const columnGeo = new THREE.CylinderGeometry(0.85, 1.05, 10.5, 10);
    const baseGeo = new THREE.CylinderGeometry(1.5, 1.7, 0.55, 10);
    const capGeo = new THREE.BoxGeometry(2.2, 0.55, 2.2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const cx = Math.cos(a) * 20;
      const cz = Math.sin(a) * 20;
      add(g, baseGeo, MAT.stoneDark, cx, 0.28, cz);
      add(g, columnGeo, MAT.stone, cx, 5.5, cz);
      add(g, capGeo, MAT.stoneDark, cx, 10.9, cz, 0, a, 0);
      this.colliders.push({ x: loc.x + cx, z: loc.z + cz, r: 1.35 });
      if (i % 2 === 0) {
        const rune = add(g, new THREE.BoxGeometry(0.12, 2.2, 0.06), glowMaterial('#8ef2e0', 1.6), cx * 0.985, 6.5, cz * 0.985, 0, a, 0);
        rune.castShadow = false;
      }
    }

    // Lintel ring.
    const lintel = new THREE.Mesh(new THREE.TorusGeometry(20, 0.4, 8, 72), MAT.stoneDark);
    lintel.rotation.x = Math.PI / 2;
    lintel.position.y = 11.2;
    lintel.castShadow = true;
    g.add(lintel);

    // Altar.
    add(g, new THREE.CylinderGeometry(3.6, 4.2, 1.1, 20), MAT.stoneWarm, 0, 0.55, 0);
    add(g, new THREE.CylinderGeometry(2.6, 3.0, 0.9, 20), MAT.stone, 0, 1.55, 0);
    const crystal = add(g, new THREE.OctahedronGeometry(1.25, 0), glowMaterial('#ffe9a8', 3.2), 0, 4.2, 0);
    crystal.castShadow = false;
    const crystalGlow = glowSprite('#ffe9a8', 9, 0.65);
    crystalGlow.position.set(0, 4.2, 0);
    g.add(crystalGlow);
    const crystalLight = new THREE.PointLight('#ffd98a', 5, 55, 1.8);
    crystalLight.position.set(0, 5, 0);
    g.add(crystalLight);

    // Rune rings.
    const ringMat = glowMaterial('#8ef2e0', 1.8);
    for (const radius of [8.5, 12.5]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.09, 6, 96), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.09;
      g.add(ring);
      this.runeRings.push(ring);
    }

    // Low steps to the south.
    for (let i = 0; i < 6; i++) {
      add(g, new THREE.BoxGeometry(10 - i * 0.8, 0.3, 1.4), MAT.stoneDark, 0, 0.15, 22 + i * 1.5);
    }

    // Floating stones.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const rock = add(
        g,
        new THREE.DodecahedronGeometry(0.8 + (i % 3) * 0.35, 0),
        MAT.stoneDark,
        Math.cos(a) * 14,
        7 + (i % 4) * 2.2,
        Math.sin(a) * 14,
      );
      this.animated.push({ type: 'float', mesh: rock, baseY: rock.position.y, phase: i * 1.3, amp: 0.5 });
    }

    // Beacon beam.
    const beamMat = new THREE.MeshBasicMaterial({
      map: createBeamTexture(),
      color: '#ffe9a8',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.8, 420, 20, 1, true), beamMat);
    beam.position.set(0, 210, 0);
    beam.visible = false;
    beam.renderOrder = 3;
    g.add(beam);

    const beamGlow = glowSprite('#ffe9a8', 28, 0.0);
    beamGlow.position.set(0, 8, 0);
    g.add(beamGlow);

    this.altar = {
      group: g,
      position: new THREE.Vector3(loc.x, y + 3.2, loc.z),
      crystal,
      crystalLight,
      crystalGlow,
      beam,
      beamGlow,
      restored: false,
    };
    this.animated.push({
      type: 'altar',
      crystal,
      light: crystalLight,
      glow: crystalGlow,
      phase: 0,
    });
  }

  _buildCamp() {
    const loc = LOCATIONS.camp;
    const y = this._heightAt(loc.x, loc.z);
    const g = new THREE.Group();
    g.position.set(loc.x, y, loc.z);
    this.group.add(g);

    // Two tents.
    const tent = (x, z, rot, material, scale = 1) => {
      const tentGroup = new THREE.Group();
      tentGroup.position.set(x, 0, z);
      tentGroup.rotation.y = rot;
      add(tentGroup, new THREE.CylinderGeometry(0.1, 3.2, 3.4, 8, 1, true), material, 0, 1.7, 0);
      add(tentGroup, new THREE.CylinderGeometry(0.12, 0.12, 3.8, 6), MAT.wood, 0, 1.9, 0);
      add(tentGroup, new THREE.BoxGeometry(1.2, 0.05, 2.4), MAT.clothMuted, 0, 0.06, 2.2);
      tentGroup.scale.setScalar(scale);
      g.add(tentGroup);
      this.colliders.push({ x: loc.x + x, z: loc.z + z, r: 2.8 * scale });
    };
    tent(-7, 4, 0.3, MAT.cloth, 1);
    tent(7, -1, -0.5, MAT.clothMuted, 0.85);

    // Campfire.
    const fireBase = new THREE.Group();
    fireBase.position.set(0, 0, 2.5);
    g.add(fireBase);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      add(fireBase, new THREE.DodecahedronGeometry(0.32, 0), MAT.stoneDark, Math.cos(a) * 1.15, 0.18, Math.sin(a) * 1.15);
    }
    for (let i = 0; i < 3; i++) {
      add(fireBase, new THREE.CylinderGeometry(0.12, 0.12, 1.5, 6), MAT.wood, 0, 0.28, 0, 0.5, (i / 3) * TAU, 0);
    }
    const fireGlow = glowSprite('#ff9a3d', 5.5, 0.8);
    fireGlow.position.set(0, 1.1, 0);
    fireBase.add(fireGlow);
    this.fireSprites.push({ sprite: fireGlow, phase: 0 });
    const light = new THREE.PointLight('#ff8a3d', 3.2, 26, 1.8);
    light.position.set(0, 1.8, 0);
    fireBase.add(light);
    this.campfireLight = light;
    this.animated.push({ type: 'fire', light, base: 3.2, phase: 0.4 });

    // Banner pole.
    const pole = new THREE.Group();
    pole.position.set(-11, 0, -5);
    add(pole, new THREE.CylinderGeometry(0.1, 0.14, 5.6, 6), MAT.wood, 0, 2.8, 0);
    const banner = add(pole, new THREE.PlaneGeometry(2.2, 3.2), MAT.cloth, 1.15, 4.0, 0);
    banner.castShadow = true;
    g.add(pole);
    this.animated.push({ type: 'banner', mesh: banner, phase: 0.2 });

    // Crates and logs.
    const rng = createRng(441);
    for (let i = 0; i < 4; i++) {
      add(
        g,
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        MAT.wood,
        -9 + rng.range(-2, 2),
        0.4,
        -3 + rng.range(-2, 2),
        0,
        rng.range(0, TAU),
        0,
      );
    }
    for (let i = 0; i < 3; i++) {
      add(g, new THREE.CylinderGeometry(0.35, 0.35, 2.2, 8), MAT.wood, 4.4, 0.36, 5.4 + i * 0.1, Math.PI / 2, 0, 0.2 * i);
    }

    // Waystone marking the camp.
    this._waystone(g, 12, 8, '#ffcf8a');

    // Sable's anchor (world space).
    this.sableSpot = new THREE.Vector3(loc.x + 4.5, y, loc.z + 3.2);
  }

  _buildShrines() {
    for (const loc of LOCATIONS.shards) {
      const y = this._heightAt(loc.x, loc.z);
      const g = new THREE.Group();
      g.position.set(loc.x, y, loc.z);
      this.group.add(g);

      add(g, new THREE.CylinderGeometry(3.6, 4.1, 0.35, 24), MAT.stoneDark, 0, 0.18, 0);
      add(g, new THREE.CylinderGeometry(1.4, 1.7, 1.0, 12), MAT.stoneWarm, 0, 0.9, 0);

      const pillarGeo = new THREE.CylinderGeometry(0.42, 0.52, 4.4, 8);
      for (const side of [-1, 1]) {
        add(g, pillarGeo, MAT.stone, side * 2.6, 2.2, 0);
        this.colliders.push({ x: loc.x + side * 2.6, z: loc.z, r: 0.7 });
      }
      add(g, new THREE.BoxGeometry(6.2, 0.6, 0.9), MAT.stone, 0, 4.55, 0);
      add(g, new THREE.BoxGeometry(0.18, 0.18, 2.4), glowMaterial(loc.color, 1.4), 0, 4.4, 0);

      const shard = add(g, new THREE.OctahedronGeometry(0.62, 0), glowMaterial(loc.color, 3.4), 0, 3.05, 0);
      shard.castShadow = false;
      const shardGlow = glowSprite(loc.color, 4.5, 0.75);
      shardGlow.position.set(0, 3.05, 0);
      g.add(shardGlow);
      const light = new THREE.PointLight(loc.color, 3.4, 26, 1.8);
      light.position.set(0, 3.4, 0);
      g.add(light);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.06, 6, 64), glowMaterial(loc.color, 1.6));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.4;
      g.add(ring);

      const seal = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 24, 18),
        new THREE.MeshBasicMaterial({
          color: loc.color,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      seal.position.y = 2.9;
      g.add(seal);

      const site = {
        id: loc.id,
        group: g,
        location: loc,
        baseY: y,
        shard,
        shardGlow,
        light,
        ring,
        seal,
        sealed: true,
        collected: false,
      };
      this.shardSites.set(loc.id, site);
      this.animated.push({ type: 'shard', site, phase: Math.random() * TAU });
    }
  }

  _buildRuins() {
    const loc = LOCATIONS.shards[1];
    const rng = createRng(6612);
    const g = new THREE.Group();
    g.position.set(loc.x + 12, 0, loc.z + 8);
    g.position.y = this._heightAt(g.position.x, g.position.z);
    this.group.add(g);

    for (let i = 0; i < 8; i++) {
      const x = rng.range(-12, 12);
      const z = rng.range(-10, 10);
      const h = rng.range(1.2, 5.5);
      const r = rng.range(0.4, 0.8);
      const broken = add(
        g,
        new THREE.CylinderGeometry(r * 0.8, r, h, 7),
        i % 2 ? MAT.stone : MAT.stoneDark,
        x,
        h / 2 - 0.2,
        z,
        rng.range(-0.08, 0.08),
        rng.range(0, TAU),
        rng.range(-0.08, 0.08),
      );
      broken.castShadow = true;
      this.colliders.push({ x: g.position.x + x, z: g.position.z + z, r: r + 0.4 });
    }
    for (let i = 0; i < 5; i++) {
      const w = rng.range(2.5, 6);
      const h = rng.range(1.2, 3.2);
      add(
        g,
        new THREE.BoxGeometry(w, h, 0.6),
        MAT.stoneDark,
        rng.range(-14, 14),
        h / 2 - 0.3,
        rng.range(-12, 12),
        0,
        rng.range(0, TAU),
        rng.range(-0.05, 0.05),
      );
    }
    // Half-buried arch.
    const arch = new THREE.Group();
    arch.position.set(-3, 0, -6);
    add(arch, new THREE.TorusGeometry(3, 0.35, 6, 18, Math.PI), MAT.stone, 0, 0.4, 0);
    arch.rotation.z = 0.12;
    g.add(arch);
  }

  _waystone(parent, x, z, color) {
    const stone = add(parent, new THREE.BoxGeometry(1.2, 4.2, 0.7), MAT.stoneDark, x, 2.0, z, 0, 0.3, 0.04);
    stone.castShadow = true;
    add(parent, new THREE.BoxGeometry(0.5, 2.2, 0.05), glowMaterial(color, 1.5), x, 2.3, z + 0.38, 0, 0.3, 0.04);
  }

  _buildWaystones() {
    const points = [
      [LOCATIONS.spawn.x - 10, LOCATIONS.spawn.z - 30],
      [LOCATIONS.camp.x - 24, LOCATIONS.camp.z - 10],
      [LOCATIONS.camp.x - 40, LOCATIONS.camp.z - 60],
      [LOCATIONS.camp.x + 40, LOCATIONS.camp.z - 50],
      [LOCATIONS.temple.x + 10, LOCATIONS.temple.z + 46],
    ];
    const g = new THREE.Group();
    g.name = 'Waystones';
    this.group.add(g);
    for (const [x, z] of points) {
      const h = this._heightAt(x, z);
      const wg = new THREE.Group();
      wg.position.set(x, h, z);
      this._waystone(wg, 0, 0, '#8ef2e0');
      g.add(wg);
      this.colliders.push({ x, z, r: 0.9 });
    }
  }

  _buildFloatingIslands() {
    const rng = createRng(8821);
    const defs = [
      { x: 360, y: 132, z: -230, s: 1.25 },
      { x: -420, y: 106, z: 260, s: 0.95 },
      { x: 250, y: 176, z: 380, s: 0.7 },
    ];
    const cliffMat = new THREE.MeshStandardMaterial({ color: '#7b6f62', roughness: 0.96, flatShading: true, emissive: '#241f1a', emissiveIntensity: 0.55 });
    const cliffDark = new THREE.MeshStandardMaterial({ color: '#584f45', roughness: 0.98, flatShading: true, emissive: '#1c1815', emissiveIntensity: 0.6 });
    const mossMat = new THREE.MeshStandardMaterial({ color: '#5c8a4c', roughness: 0.95, flatShading: true });
    const rootMat = new THREE.MeshStandardMaterial({ color: '#4a3a28', roughness: 0.95, flatShading: true });

    for (const def of defs) {
      const g = new THREE.Group();
      g.position.set(def.x, def.y, def.z);
      const s = def.s;

      // Underside: two offset inverted cones give a craggy silhouette instead
      // of the single flat pyramid that used to read as a grey paper plane.
      const main = add(g, new THREE.ConeGeometry(15 * s, 30 * s, 9), cliffMat, 0, -15 * s, 0, Math.PI, 0, 0);
      main.castShadow = false;
      const spur = add(g, new THREE.ConeGeometry(8.5 * s, 19 * s, 7), cliffDark, 4.5 * s, -12 * s, -3.2 * s, Math.PI, 0.6, 0.14);
      spur.castShadow = false;
      const spur2 = add(g, new THREE.ConeGeometry(6.2 * s, 14 * s, 6), cliffDark, -5.2 * s, -10 * s, 2.8 * s, Math.PI, 1.2, -0.2);
      spur2.castShadow = false;

      // Soil cap and grassy plateau.
      const soil = add(g, new THREE.CylinderGeometry(15 * s, 12.4 * s, 2.6 * s, 11), cliffMat, 0, 0, 0);
      soil.castShadow = false;
      const grass = add(g, new THREE.CylinderGeometry(14.2 * s, 14.6 * s, 0.5, 11), mossMat, 0, 1.5 * s, 0);
      grass.castShadow = false;

      // Hanging roots under the rim.
      for (let i = 0; i < 9; i++) {
        const a = rng.range(0, TAU);
        const r = rng.range(6, 13) * s;
        const len = rng.range(2.5, 9) * s;
        const root = add(
          g,
          new THREE.CylinderGeometry(0.09 * s, 0.22 * s, len, 4),
          rootMat,
          Math.cos(a) * r,
          -len * 0.5 - 0.4,
          Math.sin(a) * r,
        );
        root.castShadow = false;
      }

      // Vegetation on top.
      for (let i = 0; i < 5; i++) {
        const a = rng.range(0, TAU);
        const r = rng.range(2.5, 10) * s;
        const tree = new THREE.Group();
        tree.position.set(Math.cos(a) * r, 1.5 * s, Math.sin(a) * r);
        const scale = rng.range(0.8, 1.5);
        add(tree, new THREE.CylinderGeometry(0.22, 0.36, 3.4, 5), rootMat, 0, 1.7 * scale, 0, 0, 0, 0, scale);
        add(tree, new THREE.IcosahedronGeometry(2.0, 0), mossMat, 0, 4.1 * scale, 0, 0, 0, 0, scale);
        add(tree, new THREE.IcosahedronGeometry(1.3, 0), mossMat, 0.9 * scale, 4.9 * scale, 0.4 * scale, 0, 0, 0, scale);
        g.add(tree);
      }

      // Debris orbiting the chunk.
      for (let i = 0; i < 6; i++) {
        const a = rng.range(0, TAU);
        const r = rng.range(16, 22) * s;
        const rock = add(
          g,
          new THREE.DodecahedronGeometry(rng.range(0.6, 1.7) * s, 0),
          cliffDark,
          Math.cos(a) * r,
          rng.range(-8, 4) * s,
          Math.sin(a) * r,
        );
        rock.castShadow = false;
      }

      // A small glow at the island's heart.
      const glow = glowSprite('#8ef2e0', 11 * s, 0.32);
      glow.position.y = -2;
      g.add(glow);
      this.group.add(g);
      this.floatingIslands.push({ group: g, baseY: def.y, phase: rng.range(0, TAU), speed: rng.range(0.15, 0.3) });
    }
  }

  _buildClouds() {
    const rng = createRng(9210);
    const texture = createCloudTexture(256);
    // Three layers: high cirrus, mid cumulus banks and a low haze band near the
    // horizon. One sparse layer made the sky read as flat poster blue.
    const layers = [
      { count: 16, yMin: 120, yMax: 210, rMin: 260, rMax: 780, sMin: 150, sMax: 340, op: 0.2, flat: 0.42 },
      { count: 14, yMin: 70, yMax: 120, rMin: 150, rMax: 620, sMin: 90, sMax: 220, op: 0.26, flat: 0.55 },
      { count: 10, yMin: 42, yMax: 72, rMin: 220, rMax: 760, sMin: 220, sMax: 420, op: 0.14, flat: 0.34 },
    ];
    for (const layer of layers) {
      for (let i = 0; i < layer.count; i++) {
        const material = new THREE.SpriteMaterial({
          map: texture,
          color: i % 3 === 0 ? '#f3ece2' : '#e2edf5',
          transparent: true,
          opacity: layer.op + rng.next() * 0.1,
          depthWrite: false,
        });
        const sprite = new THREE.Sprite(material);
        const angle = rng.range(0, TAU);
        const radius = rng.range(layer.rMin, layer.rMax);
        sprite.position.set(Math.cos(angle) * radius, rng.range(layer.yMin, layer.yMax), Math.sin(angle) * radius);
        const s = rng.range(layer.sMin, layer.sMax);
        sprite.scale.set(s, s * layer.flat, 1);
        this.group.add(sprite);
        this.clouds.push({ sprite, drift: rng.range(0.15, 0.5), phase: rng.range(0, TAU) });
      }
    }
  }

  _buildCrystals() {
    const rng = createRng(3319);
    const material = glowMaterial('#8ef2e0', 1.9);
    const material2 = glowMaterial('#c6a8ff', 1.6);
    for (let i = 0; i < 16; i++) {
      const angle = rng.range(0, TAU);
      const radius = rng.range(60, 480);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = this._heightAt(x, z);
      if (h < 1) continue;
      const g = new THREE.Group();
      g.position.set(x, h, z);
      const crystal = add(g, new THREE.OctahedronGeometry(rng.range(0.3, 0.8), 0), i % 3 ? material : material2, 0, rng.range(0.3, 0.8), 0);
      crystal.rotation.set(rng.range(-0.3, 0.3), rng.range(0, TAU), rng.range(-0.3, 0.3));
      crystal.castShadow = false;
      this.group.add(g);
      this.animated.push({ type: 'crystal', mesh: crystal, baseY: crystal.position.y, phase: rng.range(0, TAU) });
    }
  }

  /** Break the seal on a shard shrine. */
  setShardSealed(id, sealed) {
    const site = this.shardSites.get(id);
    if (!site) return;
    site.sealed = sealed;
    site.seal.visible = sealed;
    site.light.intensity = sealed ? 1.2 : 3.4;
    site.shard.material.emissiveIntensity = sealed ? 1.1 : 3.4;
    site.shardGlow.material.opacity = sealed ? 0.25 : 0.8;
  }

  /** Put every landmark back to its "new game" state. */
  reset() {
    this.restored = false;
    this.altarDimmed = false;
    this.setLanternsLit(0);
    for (const [id, site] of this.shardSites) {
      site.collected = false;
      site.group.visible = true;
      this.setShardSealed(id, true);
    }
    if (this.altar) {
      this.altar.restored = false;
      this.altar.crystal.visible = true;
      this.altar.crystalGlow.visible = true;
      this.altar.beam.visible = false;
      this.altar.beam.material.opacity = 0;
      this.altar.beam.scale.set(1, 1, 1);
      this.altar.crystal.material.emissiveIntensity = 3.2;
      this.altar.crystal.position.y = 4.2;
      this.altar.crystalLight.intensity = 5;
      this.altar.crystalLight.distance = 55;
      this.altar.beamGlow.material.opacity = 0;
      this.altar.beamGlow.scale.setScalar(28);
    }
  }

  /**
   * Dim the altar crystal while the Sovereign holds the arena. The altar's
   * update loop reads this flag so the glow cannot bloom out the boss.
   * @param {boolean} dimmed
   */
  setAltarDimmed(dimmed) {
    this.altarDimmed = Boolean(dimmed);
    if (!this.altar) return;
    this.altar.crystal.visible = !this.altarDimmed;
    this.altar.crystalGlow.visible = !this.altarDimmed;
    this.altar.crystal.material.emissiveIntensity = this.altarDimmed ? 0.2 : 3.2;
    // A restored Beacon's 420 m beam and 28 m glow sprite sit in the middle of
    // the boss arena. During a rematch they turn the whole fight into a white
    // bloom, so hide them with the altar and bring them back afterwards.
    const lit = !this.altarDimmed && this.restored;
    if (this.altar.beam) {
      this.altar.beam.visible = lit;
      this.altar.beam.material.opacity = lit ? 0.17 : 0;
    }
    if (this.altar.beamGlow) {
      this.altar.beamGlow.visible = lit;
      this.altar.beamGlow.material.opacity = lit ? 0.55 : 0;
    }
  }

  /** Mark a shard as taken and hide its visual. */
  collectShard(id) {
    const site = this.shardSites.get(id);
    if (!site) return;
    site.collected = true;
    site.group.visible = false;
  }

  /** Restore the beacon: beam, glow, warm light. */
  restoreBeacon() {
    if (!this.altar) return;
    this.restored = true;
    this.altar.restored = true;
    this.altar.crystal.visible = true;
    this.altar.crystalGlow.visible = true;
    this.altar.beam.visible = true;
    this.altar.crystal.material.emissiveIntensity = 3.2;
    this.altar.crystalLight.intensity = 6;
    this.altar.crystalLight.distance = 110;
    this.altar.beamGlow.visible = true;
    this.altar.beamGlow.material.opacity = 0.55;
    this.altar.beam.material.opacity = 0.17;
  }

  /** Animate shards, fire, banner, islands and the beacon. */
  update(dt, elapsed, playerPos) {
    for (const item of this.animated) {
      switch (item.type) {
        case 'glowPulse': {
          item.sprite.material.opacity = item.base + Math.sin(elapsed * 1.8 + item.phase) * item.base * 0.35;
          break;
        }
        case 'float': {
          item.mesh.position.y = item.baseY + Math.sin(elapsed * 0.8 + item.phase) * item.amp;
          item.mesh.rotation.y += dt * 0.15;
          break;
        }
        case 'altar': {
          item.crystal.rotation.y += dt * 0.35;
          item.crystal.position.y = 4.2 + Math.sin(elapsed * 0.9) * 0.22;
          const pulse = 0.85 + Math.sin(elapsed * 1.6) * 0.15;
          const dim = this.altarDimmed;
          item.light.intensity = (dim ? 1.1 : this.restored ? 9 : 4.6) * pulse;
          item.glow.material.opacity = (dim ? 0.1 : this.restored ? 0.6 : 0.4) * pulse;
          item.glow.scale.setScalar((dim ? 3.1 : this.restored ? 9.5 : 7) * pulse);
          break;
        }
        case 'fire': {
          const flicker = 0.82 + Math.sin(elapsed * 7.3) * 0.12 + Math.sin(elapsed * 13.1) * 0.06;
          item.light.intensity = item.base * flicker;
          break;
        }
        case 'banner': {
          item.mesh.rotation.y = Math.sin(elapsed * 1.3 + item.phase) * 0.16;
          break;
        }
        case 'shard': {
          const site = item.site;
          if (site.collected) break;
          site.shard.rotation.y += dt * 0.9;
          site.shard.position.y = 3.05 + Math.sin(elapsed * 1.4 + item.phase) * 0.16;
          site.ring.rotation.z += dt * 0.25;
          site.seal.rotation.y -= dt * 0.15;
          const pulse = 0.8 + Math.sin(elapsed * 2.1 + item.phase) * 0.2;
          site.light.intensity = (site.sealed ? 1.2 : 3.4) * pulse;
          break;
        }
        case 'crystal': {
          item.mesh.rotation.y += dt * 0.4;
          item.mesh.position.y = item.baseY + Math.sin(elapsed * 1.1 + item.phase) * 0.18;
          break;
        }
        default:
          break;
      }
    }

    for (const fire of this.fireSprites) {
      const s = 4.6 + Math.sin(elapsed * 8 + fire.phase) * 0.5 + Math.sin(elapsed * 17.3) * 0.25;
      fire.sprite.scale.setScalar(s);
      fire.sprite.material.opacity = 0.55 + Math.sin(elapsed * 11) * 0.12;
    }

    for (const ring of this.runeRings) {
      ring.rotation.z += dt * 0.04;
      ring.material.emissiveIntensity = 1.3 + Math.sin(elapsed * 1.5) * 0.4;
    }

    for (const island of this.floatingIslands) {
      island.group.position.y = island.baseY + Math.sin(elapsed * island.speed + island.phase) * 2.4;
      island.group.rotation.y += dt * 0.008;
    }

    for (const cloud of this.clouds) {
      cloud.sprite.position.x += Math.sin(elapsed * 0.05 + cloud.phase) * cloud.drift * dt;
      cloud.sprite.material.opacity = 0.14 + Math.sin(elapsed * 0.1 + cloud.phase) * 0.04;
    }

    if (this.waterfallTex) this.waterfallTex.offset.y = -elapsed * 0.55;

    if (this.altar?.restored) {
      const pulse = 0.3 + Math.sin(elapsed * 1.4) * 0.08;
      this.altar.beam.material.opacity = pulse;
      this.altar.beam.scale.x = 1 + Math.sin(elapsed * 1.1) * 0.08;
      this.altar.beam.scale.z = this.altar.beam.scale.x;
      this.altar.beamGlow.material.opacity = 0.7 + Math.sin(elapsed * 1.6) * 0.15;
    }
    this.localLights?.update(playerPos);
  }

  /** Apply a quality preset (cloud/beam visuals stay). */
  setQuality() {
    /* Structures are cheap; nothing to trim. */
  }
}
