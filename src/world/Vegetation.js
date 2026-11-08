/**
 * Living scenery: instanced trees and rocks across the island, a dense grass
 * field that follows the player, and drifting fireflies at night.
 */

import * as THREE from 'three';
import { ShaderChunk } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../util/rng.js';
import { partitionInstances, countRanksBelow } from './instanceChunks.js';
import { fbm2 } from '../util/noise.js';
import { clamp, smoothstep } from '../util/math.js';
import { LOCATIONS, WORLD } from './locations.js';
import { trailWeight } from './trails.js';
import { createBarkTexture, createGlowTexture, createLeafTexture, createNeedleTexture } from './textures.js';

/** Radius of the player-following grass field, in metres. */
const GRASS_RADIUS = 40;

/** Concentrate some scenery near the main quest while still populating the frontier. */
export function sampleIslandScatter(rng, coreChance = 0.7, edgeFraction = 0.94) {
  const angle = rng.next() * Math.PI * 2;
  const radiusLimit = rng.next() < coreChance ? 1100 : WORLD.islandRadius * edgeFraction;
  const radius = Math.sqrt(rng.next()) * radiusLimit;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/**
 * Patch a standard material to sway vertices in the wind.
 * @param {THREE.MeshStandardMaterial} material
 * @param {{sway?:number, speed?:number, key:string, bothSides?:boolean}} opts
 */
function addWind(material, { sway = 0.08, speed = 1.1, key = 'wind', bothSides = false, windUniform = null } = {}) {
  const uniform = windUniform ?? { value: 0 };
  material.userData.windUniform = uniform;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = uniform;
    shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 windOrigin = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
        #else
          vec3 windOrigin = vec3(0.0);
        #endif
        float windPhase = uWindTime * ${speed.toFixed(2)} + windOrigin.x * 0.23 + windOrigin.z * 0.17;
        transformed.x += sin(windPhase) * ${sway.toFixed(3)} * max(transformed.y, 0.0);
        transformed.z += cos(windPhase * 0.83) * ${(sway * 0.55).toFixed(3)} * max(transformed.y, 0.0);
      `,
    );
    if (bothSides) {
      // Grass blades are vertical quads whose normals all point up. Three flips
      // the normal for back faces, which turns half of every tuft black when
      // the camera looks at the unlit side. Inline the chunk with the flip
      // forced off so both faces keep the up-facing normal and light evenly.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        ShaderChunk.normal_fragment_begin.replace(
          'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;',
          'float faceDirection = 1.0;',
        ),
      );
    }
  };
  material.customProgramCacheKey = () => key;
  return material;
}

export class Vegetation {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./heightfield.js').Heightfield} heightfield
   * @param {object} settings
   */
  constructor(scene, heightfield, settings) {
    this.scene = scene;
    this.heightfield = heightfield;
    this.settings = settings;
    this.rng = createRng(9173);
    /** @type {Array<{x:number,z:number,r:number}>} */
    this.colliders = [];
    this.windMaterials = [];
    this.grassCenter = null;
    this._grassQueue = null;
    this._grassStep = 0;
    this._fireflyTimer = 0;
    this.grassMesh = null;
    this.grassOffsets = [];
    this.treeMeshes = [];
    this.spatialChunks = [];
    this._chunkVisibilityTimer = 0;
    this.fireflies = null;
    this.fireflyData = [];
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
  }

  build() {
    this._buildTrees();
    this._buildRocks();
    this._partitionScenery();
    this._buildGrass();
    this._buildFireflies();
    this.setQuality(this.settings);
    return this;
  }

  /** Static forest scatter. */
  _buildTrees() {
    const preset = this.settings;
    const target = preset?.forestFocus ? (preset.treeCount ?? 520) : Math.max(3000, preset?.treeCount ?? 520);
    // Focus mode (capture scenes): concentrate the scatter inside a small
    // radius so a close-up actually shows woods, not one tree in 300 m².
    const focus = preset?.forestFocus ?? null;
    const focusRadius = preset?.forestFocusRadius ?? 120;

    // ------------------------------------------------------------------
    // Alpha-card realism (no Christmas cones):
    // Pine: trunk + root flare + needle-card tiers. Each tier is a ring of
    // 4 crossed needle planes at a height, jittered so no two tiers align.
    // Top is a small spire of 3 upright cards. Vertex colors bake AO.
    // Broadleaf: dark volumetric core + leaf-card shell. The core gives
    // silhouette depth in shadow; the cards give fine texture in light.
    // ------------------------------------------------------------------
    const pineParts = [];
    const card = (w, h, ry, tilt = 0, dark = 0) => {
      // Vertical crossed planes: the needle texture reads as a drooping
      // branch only when the card stands up. (Laying it flat made every
      // tier a dark horizontal plate.)
      const g = new THREE.PlaneGeometry(w, h, 1, 2);
      g.rotateX(tilt);
      g.rotateY(ry);
      const pos = g.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const yy = pos.getY(i);
        const t = (yy + h / 2) / h;
        const shade = 0.82 + t * 0.45 - dark;
        cols[i * 3] = shade; cols[i * 3 + 1] = shade; cols[i * 3 + 2] = shade;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return g;
    };
    const addTier = (r, y, droop) => {
      for (let k = 0; k < 4; k++) {
        const g = card(r * 2.05, 1.35, (k / 4) * Math.PI + y * 0.7, droop, 0.1);
        g.translate(0, y, 0);
        pineParts.push(g);
      }
    };
    addTier(2.05, 1.15, 0.28);
    addTier(1.85, 2.05, 0.26);
    addTier(1.62, 2.95, 0.24);
    addTier(1.38, 3.85, 0.22);
    addTier(1.14, 4.72, 0.2);
    addTier(0.92, 5.55, 0.18);
    addTier(0.72, 6.32, 0.16);
    addTier(0.55, 7.05, 0.14);
    // Spire: 3 upright cards converging.
    for (let k = 0; k < 3; k++) {
      const g = card(0.85, 1.7, (k / 3) * Math.PI + 0.3, 0, 0.06);
      g.translate(0, 8.0, 0);
      pineParts.push(g);
    }
    const pineGeo = mergeGeometries(pineParts, false);
    pineGeo.computeVertexNormals();
    this.pineVertexColors = true;

    // Broadleaf: overlapping cards form a layered crown around the trunk.
    const broadParts = [];
    const leafCard = (x, y, z, ry, tilt, s) => {
      const g = new THREE.PlaneGeometry(2.4 * s, 1.8 * s, 1, 1);
      g.rotateX(tilt);
      g.rotateY(ry);
      g.translate(x, y, z);
      const pos = g.attributes.position;
      const cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const up = (pos.getY(i) / (1.8 * s)) * 0.5 + 0.5;
        const shade = 0.7 + up * 0.35;
        cols[i * 3] = shade; cols[i * 3 + 1] = shade; cols[i * 3 + 2] = shade;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return g;
    };
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      broadParts.push(leafCard(Math.cos(a) * 1.2, 4.2, Math.sin(a) * 1.2, -a, 0.5, 1.05));
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.6;
      broadParts.push(leafCard(Math.cos(a) * 0.9, 5.1, Math.sin(a) * 0.9, -a, -0.3, 0.8));
    }
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + 0.3;
      broadParts.push(leafCard(Math.cos(a) * 0.7, 4.65, Math.sin(a) * 0.7, -a + 0.3, 0.1, 0.72));
    }
    // Crossed layers give the crown depth from multiple viewpoints.
    const nonIndexed = (g) => g.index ? g.toNonIndexed() : g;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      broadParts.push(leafCard(Math.cos(a) * 0.35, 4.45, Math.sin(a) * 0.35, -a, 0.6, 0.7));
    }
    const broadGeo = mergeGeometries(broadParts.map(nonIndexed), false);
    broadGeo.computeVertexNormals();
    this.broadVertexColors = true;

    // Trunk: 4 segments with progressive lean + knuckled gnarl + 5 limbs
    // fanning into the crown + root flare.
    const trunkParts = [];
    const trunkSeg = (rTop, rBottom, h, y, ox, oz, tilt) => {
      const g = new THREE.CylinderGeometry(rTop, rBottom, h, 7, 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i);
        const pz = pos.getZ(i);
        const wob = Math.sin((pos.getY(i) + h / 2) * 9 + px * 6) * 0.018;
        pos.setX(i, px + wob);
        pos.setZ(i, pz + wob * 0.7);
      }
      g.translate(0, h * 0.5, 0);
      if (tilt) g.applyMatrix4(new THREE.Matrix4().makeRotationZ(tilt));
      g.translate(ox, y, oz);
      return g;
    };
    trunkParts.push(trunkSeg(0.18, 0.26, 0.6, 0, 0, 0, 0));
    trunkParts.push(trunkSeg(0.14, 0.18, 0.5, 0.55, 0.03, 0.01, 0.07));
    trunkParts.push(trunkSeg(0.10, 0.14, 0.45, 1.0, 0.07, 0.02, 0.11));
    trunkParts.push(trunkSeg(0.07, 0.10, 0.4, 1.4, 0.11, 0.03, 0.13));
    // Root flare.
    trunkParts.push(trunkSeg(0.26, 0.4, 0.35, -0.12, 0, 0, 0));
    const branch = (len, angle, y, ox, oz = 0) => {
      const g = new THREE.CylinderGeometry(0.03, 0.06, len, 5, 1);
      g.translate(0, len * 0.5, 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
      g.translate(ox, y, oz);
      return g;
    };
    trunkParts.push(branch(0.55, 0.78, 0.72, 0.06));
    trunkParts.push(branch(0.48, -0.86, 0.86, -0.04));
    trunkParts.push(branch(0.42, 0.65, 1.25, 0.1, 0.05));
    trunkParts.push(branch(0.38, -0.7, 1.45, -0.08, 0.05));
    trunkParts.push(branch(0.34, 0.5, 1.7, 0.12, -0.04));
    const trunkGeo = mergeGeometries(trunkParts, false);
    trunkGeo.computeVertexNormals();

    // Trunk: procedural bark map in natural bark tones. (The old warm
    // emissive + tan tint turned every trunk into a bright orange pole.)
    const barkTex = createBarkTexture(256);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: '#8a7358',
      map: barkTex,
      roughness: 0.96,
      flatShading: true,
    });
    // Foliage: alpha-tested cards. Instance colour multiplies material white;
    // vertex colors bake AO. customDepthMaterial cuts the alpha in shadows.
    const needleTex = createNeedleTexture();
    const leafTex = createLeafTexture();
    const pineMat = addWind(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, vertexColors: true, map: needleTex, alphaTest: 0.4, side: THREE.DoubleSide, emissive: '#2a4a2e', emissiveIntensity: 0.22, emissiveMap: needleTex }),
      { sway: 0.045, speed: 0.7, key: 'pine-card' },
    );
    const broadMat = addWind(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, vertexColors: true, map: leafTex, alphaTest: 0.38, side: THREE.DoubleSide, emissive: '#2e4a22', emissiveIntensity: 0.22, emissiveMap: leafTex }),
      { sway: 0.05, speed: 0.6, key: 'broad-card' },
    );
    // Shadow maps must use the same alpha cutout and wind displacement as
    // foliage; customDepthMaterial belongs to the mesh, not its material.
    pineMat.userData.depthMaterial = addWind(
      new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: needleTex, alphaTest: 0.4, side: THREE.DoubleSide }),
      { sway: 0.045, speed: 0.7, key: 'pine-depth', windUniform: pineMat.userData.windUniform },
    );
    broadMat.userData.depthMaterial = addWind(
      new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.38, side: THREE.DoubleSide }),
      { sway: 0.05, speed: 0.6, key: 'broad-depth', windUniform: broadMat.userData.windUniform },
    );
    this.windMaterials.push(pineMat, broadMat);

    // Enhanced tree generation: richer palettes, denser woods, taller conifers.
    const positions = [];
    const rng = this.rng;
    let attempts = 0;
    while (positions.length < target && attempts < target * 30) {
      attempts++;
      // In focus mode, cluster the scatter around the focus point so the
      // capture frame actually fills with woods.
      let x; let z;
      if (focus) {
        const angle = rng.next() * Math.PI * 2;
        const radius = Math.sqrt(rng.next()) * focusRadius;
        x = focus.x + Math.cos(angle) * radius;
        z = focus.z + Math.sin(angle) * radius;
      } else {
        ({ x, z } = sampleIslandScatter(rng));
      }
      const h = this.heightfield.height(x, z);
      if (h < 3.4 || h > 74) continue;
      if (this.heightfield.slope(x, z) > 0.48) continue;
      if (!this._clearOfPOIs(x, z, 7)) continue;
      // Forest mask tuned for the 39x island: trees bunch into woods with
      // real density variance — lush groves next to sparse clearings.
      // Two scales (grove + stand) keep the island fulfilling without a
      // uniform forest carpet or artificial edge rows.
      const forest = fbm2(x * 0.0055, z * 0.0055, 3, 33) * 0.5 + 0.5;
      const stand = fbm2(x * 0.016 + 40.2, z * 0.016 - 31.7, 2, 88) * 0.5 + 0.5;
      const density = 0.06 + forest * forest * 1.5 + stand * stand * 0.45;
      // In focus mode drop the mask gate: the point is already chosen for
      // density, and re-gating at 5.5‰ thinning would starve it again.
      const pass = focus ? (rng.next() <= 0.92) : (rng.next() <= density);
      if (!pass) continue;
      // One scale per tree, shared by trunk + crown so the canopy always
      // sits on its own trunk (separate RNG draws drifted them apart).
      positions.push({ x, z, h, forest, scale: 0.8 + rng.next() * 0.8, rank: positions.length });
      // Grow small stands around each accepted seed. A few thousand trees
      // spread uniformly over the island looked nearly treeless everywhere.
      const neighbors = focus ? 0 : Math.floor(rng.range(3, 8));
      for (let n = 0; n < neighbors && positions.length < target; n++) {
        const a = rng.next() * Math.PI * 2;
        const r = 4 + Math.sqrt(rng.next()) * 12;
        const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
        if (!this._clearOfPOIs(nx, nz, 7)) continue;
        const nh = this.heightfield.height(nx, nz);
        if (nh < 3.4 || nh > 74 || this.heightfield.slope(nx, nz) > 0.48) continue;
        positions.push({ x: nx, z: nz, h: nh, forest, scale: 0.75 + rng.next() * 0.85, rank: positions.length });
      }
    }

    const pines = positions.filter((_, i) => i % 9 < 5);
    const broad = positions.filter((_, i) => i % 9 >= 5);
    const makeInstances = (list, geometry, material, palette, lift = 0, addColliders = true) => {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Trees';
      if (material.userData.depthMaterial) mesh.customDepthMaterial = material.userData.depthMaterial;
      mesh.userData.treeRanks = list.map((p) => p.rank);
      list.forEach((p, i) => {
        const scale = p.scale;
        const rot = rng.next() * Math.PI * 2;
        this._dummy.position.set(p.x, p.h + lift, p.z);
        this._dummy.rotation.set(0, rot, 0);
        this._dummy.scale.set(scale, scale, scale);
        this._dummy.updateMatrix();
        mesh.setMatrixAt(i, this._dummy.matrix);
        this._color.set(palette[Math.floor(rng.next() * palette.length)]);
        this._color.multiplyScalar(0.82 + rng.next() * 0.32);
        mesh.setColorAt(i, this._color);
        if (addColliders && scale > 0.9) this.colliders.push({ x: p.x, z: p.z, r: 0.28 + scale * 0.22, treeRank: p.rank });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this.treeMeshes.push({ mesh, max: list.length });
      return mesh;
    };

    // Deeper values at the bottom of the ramp give forests real depth; the
    // occasional copper tone keeps the canopy from reading as one flat green.
    // Instance colour MULTIPLIES the card texture, so these are tints
    // around white — the texture already carries the green.
    const pinePalette = ['#d8ecd8', '#c4e2c8', '#b0d8b8', '#9ecca8', '#8cc098', '#b8e0c0'];
    const broadPalette = ['#e4f2d4', '#d0e8bc', '#bcdea6', '#a8d292', '#c8e8b0', '#d8f0c4'];
    makeInstances(pines, pineGeo, pineMat, pinePalette, 0.55);
    makeInstances(broad, broadGeo, broadMat, broadPalette, 0);

    // Trunks share a single instanced mesh.
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    trunks.name = 'Trunks';
    trunks.userData.treeRanks = positions.map((p) => p.rank);
    this.trunkMax = positions.length;
    positions.forEach((p, i) => {
      const scale = p.scale;
      this._dummy.position.set(p.x, p.h - 0.2, p.z);
      this._dummy.rotation.set(0, rng.next() * Math.PI * 2, 0);
      // Trunk geometry is ~1.9 m tall; stretch it to meet the crown base.
      this._dummy.scale.set(scale, scale * 1.9, scale);
      this._dummy.updateMatrix();
      trunks.setMatrixAt(i, this._dummy.matrix);
    });

    // Undergrowth ring: a second, denser belt of small shrubs and saplings
    // tucked under the canopy line so the forest reads as depth from the air
    // instead of one tree per square metre.
    const shrubParts = [];
    const shrubBlob = (r, x, y, z) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.translate(x, y, z);
      return g;
    };
    shrubParts.push(shrubBlob(0.5, 0, 0.1, 0));
    shrubParts.push(shrubBlob(0.34, 0.34, 0.28, 0.12));
    shrubParts.push(shrubBlob(0.3, -0.3, 0.22, -0.18));
    const shrubGeo = mergeGeometries(shrubParts, false);
    shrubGeo.computeVertexNormals();
    const shrubMat = addWind(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }),
      { sway: 0.05, speed: 0.9, key: 'shrub' },
    );
    this.windMaterials.push(shrubMat);
    const shrubCount = Math.floor(positions.length * 0.5);
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubCount);
    shrubs.castShadow = false;
    shrubs.receiveShadow = true;
    shrubs.name = 'Shrubs';
    shrubs.userData.treeRanks = [];
    let shrubPlaced = 0;
    let shrubGuard = 0;
    while (shrubPlaced < shrubCount && shrubGuard < shrubCount * 10) {
      shrubGuard++;
      const parent = positions[Math.floor(rng.next() * positions.length)];
      const angle = rng.next() * Math.PI * 2;
      const radius = 2 + Math.sqrt(rng.next()) * 10;
      const x = parent.x + Math.cos(angle) * radius;
      const z = parent.z + Math.sin(angle) * radius;
      const h = this.heightfield.height(x, z);
      if (h < 2.6 || h > 74) continue;
      if (this.heightfield.slope(x, z) > 0.52) continue;
      if (!this._clearOfPOIs(x, z, 6)) continue;
      const forest = fbm2(x * 0.0055, z * 0.0055, 3, 33) * 0.5 + 0.5;
      const pass = focus ? (rng.next() <= 0.92) : (rng.next() <= 0.1 + forest * forest * 1.6);
      if (!pass) continue;
      const s = 0.7 + rng.next() * 1.1;
      this._dummy.position.set(x, h + 0.12, z);
      this._dummy.rotation.set(0, rng.next() * Math.PI * 2, 0);
      this._dummy.scale.set(s, s * (0.8 + rng.next() * 0.4), s);
      this._dummy.updateMatrix();
      shrubs.setMatrixAt(shrubPlaced, this._dummy.matrix);
      this._color.set(['#4b7a45', '#5d8f52', '#3f6b3a', '#6aa35b', '#7fa854'][Math.floor(rng.next() * 5)]);
      this._color.multiplyScalar(0.85 + rng.next() * 0.3);
      shrubs.setColorAt(shrubPlaced, this._color);
      shrubs.userData.treeRanks[shrubPlaced] = parent.rank;
      shrubPlaced++;
    }
    shrubs.count = shrubPlaced;
    shrubs.instanceMatrix.needsUpdate = true;
    if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
    this.scene.add(shrubs);
    this.shrubs = shrubs;
    trunks.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks);
    this.trunks = trunks;

    // Ferns: star-shaped fronds (three crossed tapered planes) tucked under
    // the trees. Instanced with the same two-scale mask so they follow the
    // woods instead of forming an even carpet.
    const fernParts = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(0.55, 0.85, 1, 3);
      const pos = g.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const y = pos.getY(v);
        const t = (y + 0.425) / 0.85; // 0 base → 1 tip
        pos.setX(v, pos.getX(v) * (1 - t * 0.75));
        pos.setZ(v, pos.getZ(v) - t * t * 0.16); // gentle arc
      }
      g.translate(0, 0.32, 0);
      g.rotateY((i / 3) * Math.PI);
      g.computeVertexNormals();
      fernParts.push(g);
    }
    const fernGeo = mergeGeometries(fernParts, false);
    const fernMat = addWind(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, side: THREE.DoubleSide, flatShading: true }),
      { sway: 0.06, speed: 0.95, key: 'fern' },
    );
    this.windMaterials.push(fernMat);
    const fernCount = Math.floor(positions.length * 0.4);
    const ferns = new THREE.InstancedMesh(fernGeo, fernMat, fernCount);
    ferns.castShadow = false;
    ferns.receiveShadow = true;
    ferns.name = 'Ferns';
    ferns.userData.treeRanks = [];
    let fernPlaced = 0;
    let fernGuard = 0;
    while (fernPlaced < fernCount && fernGuard < fernCount * 10) {
      fernGuard++;
      const parent = positions[Math.floor(rng.next() * positions.length)];
      const angle = rng.next() * Math.PI * 2;
      const radius = 2 + Math.sqrt(rng.next()) * 10;
      const x = parent.x + Math.cos(angle) * radius;
      const z = parent.z + Math.sin(angle) * radius;
      const h = this.heightfield.height(x, z);
      if (h < 2.6 || h > 74 || this.heightfield.slope(x, z) > 0.52) continue;
      if (!this._clearOfPOIs(x, z, 6)) continue;
      const forest = fbm2(x * 0.0055, z * 0.0055, 3, 33) * 0.5 + 0.5;
      const pass = focus ? (rng.next() <= 0.9) : (rng.next() <= 0.08 + forest * forest * 1.5);
      if (!pass) continue;
      const s = 0.6 + rng.next() * 0.9;
      this._dummy.position.set(x, h + 0.05, z);
      this._dummy.rotation.set(0, rng.next() * Math.PI * 2, 0);
      this._dummy.scale.set(s, s, s);
      this._dummy.updateMatrix();
      ferns.setMatrixAt(fernPlaced, this._dummy.matrix);
      this._color.set(['#3f6b3a', '#4d7f45', '#5d9455', '#6fa860'][Math.floor(rng.next() * 4)]);
      this._color.multiplyScalar(0.85 + rng.next() * 0.3);
      ferns.setColorAt(fernPlaced, this._color);
      ferns.userData.treeRanks[fernPlaced] = parent.rank;
      fernPlaced++;
    }
    ferns.count = fernPlaced;
    ferns.instanceMatrix.needsUpdate = true;
    if (ferns.instanceColor) ferns.instanceColor.needsUpdate = true;
    this.scene.add(ferns);
    this.ferns = ferns;

    // Wildflowers: tiny stem + coloured head, dotted through meadows so the
    // grass reads as lived-in rather than uniformly green. Density follows
    // meadow clumps, not the forest mask.
    const stemGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.34, 4).toNonIndexed();
    stemGeo.translate(0, 0.17, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.05, 0);
    headGeo.translate(0, 0.36, 0);
    const flowerGeo = mergeGeometries([stemGeo, headGeo], false);
    const flowerMat = addWind(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }),
      { sway: 0.1, speed: 1.05, key: 'flower' },
    );
    this.windMaterials.push(flowerMat);
    const flowerCount = Math.floor(positions.length * 0.45);
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
    flowers.castShadow = false;
    flowers.receiveShadow = true;
    flowers.name = 'Flowers';
    let flowerPlaced = 0;
    let flowerGuard = 0;
    while (flowerPlaced < flowerCount && flowerGuard < flowerCount * 12) {
      flowerGuard++;
      let x; let z;
      if (focus) {
        const angle = rng.next() * Math.PI * 2;
        const radius = Math.sqrt(rng.next()) * focusRadius;
        x = focus.x + Math.cos(angle) * radius;
        z = focus.z + Math.sin(angle) * radius;
      } else {
        ({ x, z } = sampleIslandScatter(rng, 0.8, 0.93));
      }
      const h = this.heightfield.height(x, z);
      if (h < 2.6 || h > 68 || this.heightfield.slope(x, z) > 0.45) continue;
      if (!this._clearOfPOIs(x, z, 6)) continue;
      const clump = fbm2(x * 0.045 + 7.3, z * 0.045 - 5.1, 2, 131) * 0.5 + 0.5;
      if (!focus && rng.next() > 0.05 + clump * clump * 0.7) continue;
      const s = 0.8 + rng.next() * 0.7;
      this._dummy.position.set(x, h + 0.02, z);
      this._dummy.rotation.set(0, rng.next() * Math.PI * 2, 0);
      this._dummy.scale.set(s, s, s);
      this._dummy.updateMatrix();
      flowers.setMatrixAt(flowerPlaced, this._dummy.matrix);
      this._color.set(['#fef9e7', '#f5b8d0', '#b8c8ff', '#ffd97a', '#d8c8ff', '#ffb08a'][Math.floor(rng.next() * 6)]);
      this._color.multiplyScalar(0.9 + rng.next() * 0.2);
      flowers.setColorAt(flowerPlaced, this._color);
      flowerPlaced++;
    }
    flowers.count = flowerPlaced;
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    this.scene.add(flowers);
    this.flowers = flowers;
  }

  /** Boulders and outcrops. */
  _buildRocks() {
    const rng = createRng(5511);
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, flatShading: true });
    const count = 520;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'Rocks';
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 25) {
      guard++;
      const { x, z } = sampleIslandScatter(rng, 0.65, 0.97);
      const h = this.heightfield.height(x, z);
      if (h < 0.6) continue;
      if (!this._clearOfPOIs(x, z, 5)) continue;
      const scale = 0.35 + rng.next() * 1.9;
      this._dummy.position.set(x, h + scale * 0.18, z);
      this._dummy.rotation.set(rng.next() * 0.6, rng.next() * Math.PI * 2, rng.next() * 0.6);
      this._dummy.scale.set(scale * (0.8 + rng.next() * 0.7), scale * (0.55 + rng.next() * 0.5), scale * (0.8 + rng.next() * 0.7));
      this._dummy.updateMatrix();
      mesh.setMatrixAt(placed, this._dummy.matrix);
      this._color.set(['#7d7a72', '#6e6c65', '#8a877d', '#615f59'][Math.floor(rng.next() * 4)]);
      mesh.setColorAt(placed, this._color);
      if (scale > 1.25) this.colliders.push({ x, z, r: scale * 0.75 });
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.rocks = mesh;
    this.rockMax = placed;
  }

  /** Smaller bounds let Three cull off-screen trees instead of submitting
   *  every instance across the entire island for each camera and shadow. */
  _partitionScenery() {
    const sources = [
      ...this.treeMeshes.map((entry) => [entry.mesh, 'trees']),
      [this.trunks, 'trees'], [this.shrubs, 'undergrowth'],
      [this.ferns, 'undergrowth'], [this.flowers, 'flowers'], [this.rocks, 'rocks'],
    ];
    this.treeMeshes = [];
    for (const [mesh, kind] of sources) {
      if (!mesh) continue;
      const chunks = partitionInstances(mesh, 512);
      for (const chunk of chunks) {
        chunk.kind = kind;
        this.scene.add(chunk.mesh);
        this.spatialChunks.push(chunk);
        if (chunk.ranks) this.treeMeshes.push(chunk);
      }
      this.scene.remove(mesh);
      mesh.dispose(); // instance buffers only; geometry and material are shared
    }
  }

  _updateChunkVisibility(playerPos) {
    if (!playerPos) return;
    const treeDistance = { low: 700, medium: 950, high: 1250, ultra: 1550 }[this.settings?.id] ?? 1250;
    for (const chunk of this.spatialChunks) {
      const sphere = chunk.mesh.boundingSphere;
      const distance = chunk.kind === 'trees' ? treeDistance : chunk.kind === 'rocks' ? 950 : chunk.kind === 'flowers' ? 260 : 450;
      const dx = playerPos.x - sphere.center.x, dz = playerPos.z - sphere.center.z;
      const reach = distance + sphere.radius;
      chunk.mesh.visible = dx * dx + dz * dz <= reach * reach;
    }
  }

  /** A dense grass field that follows the player. */
  _buildGrass() {
    // Groomed meadow tufts: many short, wide blades in a filled clump so the
    // field reads as a lawn, not giant spear silhouettes. Scale stays small;
    // density carries the coverage.
    const positions = [];
    const colors = [];
    const baseColor = new THREE.Color('#3f5228');
    const tipColor = new THREE.Color('#6f8f42');
    const bladeCount = 11;
    for (let i = 0; i < bladeCount; i++) {
      const a = (i / bladeCount) * Math.PI * 2 + (i % 2) * 0.37;
      const radius = 0.015 + (i % 3) * 0.022;
      const bx = Math.cos(a) * radius;
      const bz = Math.sin(a) * radius;
      const width = 0.032 + (i % 4) * 0.006;
      const height = 0.13 + (i % 5) * 0.018;
      const lean = 0.02 + (i % 3) * 0.012;
      const tx = bx + Math.cos(a) * lean;
      const tz = bz + Math.sin(a) * lean;
      const px = -Math.sin(a) * width;
      const pz = Math.cos(a) * width;
      positions.push(
        bx - px, 0, bz - pz,
        bx + px, 0, bz + pz,
        tx, height, tz,
      );
      colors.push(
        baseColor.r, baseColor.g, baseColor.b,
        baseColor.r, baseColor.g, baseColor.b,
        tipColor.r, tipColor.g, tipColor.b,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    // Blades lit like the ground they grow from: without up-facing normals the
    // vertical triangles turn black whenever the sun is low or behind them.
    const normals = new Float32Array(positions.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();

    const material = addWind(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.95,
        metalness: 0,
        color: '#ffffff',
        emissive: '#16240f',
        emissiveIntensity: 0.12,
      }),
      { sway: 0.14, speed: 1.25, key: 'grass-tuft', bothSides: true },
    );
    this.windMaterials.push(material);

    const preset = this.settings;
    const requested = preset?.grassCount ?? 16000;
    const count = preset?.forestFocus ? requested : Math.max(32000, requested);
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'Grass';
    // Hide uninitialized instance matrices until the first refill completes.
    mesh.count = 0;
    this._grassTargetCount = requested;
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.grassMesh = mesh;

    const rng = createRng(7741);
    this.grassOffsets = [];
    for (let i = 0; i < count; i++) {
      const angle = rng.next() * Math.PI * 2;
      // Start at the player's feet: a hole in the middle of the field follows
      // the camera and looks like the grass is being erased as you walk.
      // The exponent biases tufts toward the camera, where the eye can see the
      // individual blades, instead of spreading them evenly into the haze.
      const radius = 0.2 + Math.pow(rng.next(), 0.62) * GRASS_RADIUS;
      const near = radius < 9;
      this.grassOffsets.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        r: radius,
        scale: (near ? 0.68 : 0.55) + rng.next() * 0.3,
        rot: rng.next() * Math.PI * 2,
        tiltX: (rng.next() - 0.5) * 0.22,
        tiltZ: (rng.next() - 0.5) * 0.22,
      });
      // Mottled meadow: dry golden-green patches against deeper shaded clumps.
      // Near-white tints — vertex colours already carry the green, so a dark
      // instance tint here double-darkened every tuft into a spike dot.
      const dry = rng.next();
      this._color.setHSL(
        0.21 + dry * 0.05,
        0.34 + rng.next() * 0.2,
        0.66 + rng.next() * 0.16,
        THREE.SRGBColorSpace,
      );
      mesh.setColorAt(i, this._color);
      this.grassOffsets[i].color = this._color.clone();
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this._fillGrass(new THREE.Vector3(LOCATIONS.spawn.x, 0, LOCATIONS.spawn.z));
  }

  /** Rebuild the grass instances around a new centre. */
  /** Slice budget so a recenter never janks: ~32k tufts cost seconds. */
  _fillGrass(center) {
    if (!this.grassMesh) return;
    this.grassCenter = { x: center.x, z: center.z };
    // Snapshot the position: the player vector is mutated every frame.
    this._grassQueue = { x: center.x, z: center.z, heights: new Map() };
    this._grassStep = 0;
    this._fillGrassChunk();
  }

  _fillGrassChunk() {
    const center = this._grassQueue;
    if (!center || !this.grassMesh) return;
    const hf = this.heightfield;
    const dummy = this._dummy;
    const start = this._grassStep;
    const end = Math.min(this._grassTargetCount, start + 512);
    // Nearby tufts share a small, world-aligned height grid. Sampling the
    // analytic heightfield (and its finite-difference slope) per blade was
    // responsible for large CPU spikes whenever the field followed the player.
    const cell = 2;
    const heightAtGrid = (gx, gz) => {
      const key = `${gx},${gz}`;
      if (!center.heights.has(key)) center.heights.set(key, hf.height(gx * cell, gz * cell));
      return center.heights.get(key);
    };
    for (let i = start; i < end; i++) {
      const o = this.grassOffsets[i];
      const x = center.x + o.x;
      const z = center.z + o.z;
      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      const tx = x / cell - gx;
      const tz = z / cell - gz;
      const h00 = heightAtGrid(gx, gz);
      const h10 = heightAtGrid(gx + 1, gz);
      const h01 = heightAtGrid(gx, gz + 1);
      const h11 = heightAtGrid(gx + 1, gz + 1);
      const a = h00 + (h10 - h00) * tx;
      const b = h01 + (h11 - h01) * tx;
      const h = a + (b - a) * tz;
      const dx = ((h10 - h00) * (1 - tz) + (h11 - h01) * tz) / cell;
      const dz = (b - a) / cell;
      const slope = 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz);
      // Clump noise gives patches of tall meadow grass next to grazed turf,
      // which is what stops a field from looking like a uniform bristle mat.
      // Sampled in world space so the patches stay put as you walk.
      const clump = fbm2(x * 0.085, z * 0.085, 2, 57) * 0.5 + 0.5;
      // Fade in from the beach so blades do not sprout out of wet sand.
      const shore = smoothstep(1.5, 2.6, h);
      // Fade out at the rim of the follow-field so the patch has no hard edge.
      const edge = 1 - smoothstep(GRASS_RADIUS * 0.72, GRASS_RADIUS, o.r);
      const visible = h < 72 && slope < 0.5 && shore > 0.02 && edge > 0.02;
      dummy.position.set(x, h, z);
      dummy.rotation.set(o.tiltX, o.rot, o.tiltZ);
      const path = trailWeight(x, z);
      const s = visible ? Math.max(0.0001, o.scale * (0.45 + 0.55 * shore) * edge * (0.78 + clump * 0.6) * (1 - path)) : 0.0001;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.grassMesh.setMatrixAt(i, dummy.matrix);
      // Sparse wildflower tint per tuft so meadows sparkle in patches while
      // staying green overall. World-space noise keeps the patch fixed.
      const flower = visible && path < 0.5 ? this._flowerTint(x, z) : null;
      if (flower) {
        const base = this.grassOffsets[i].color;
        this._color.copy(base).lerp(flower, 0.42);
        this.grassMesh.setColorAt(i, this._color);
      } else if (visible && this.grassMesh.instanceColor) {
        this.grassMesh.setColorAt(i, this.grassOffsets[i].color);
      }
    }
    this._grassStep = end;
    // Upload once at the end — flagging every chunk re-uploaded the whole
    // multi-MB buffer 8× per refill.
    if (this._grassStep < this._grassTargetCount) {
      this._grassQueue = center;
    } else {
      this.grassMesh.instanceMatrix.needsUpdate = true;
      this.grassMesh.count = Math.min(this._grassTargetCount ?? this.grassOffsets.length, this.grassOffsets.length);
      if (this.grassMesh.instanceColor) this.grassMesh.instanceColor.needsUpdate = true;
      this._grassQueue = null;
    }
  }

  /**
   * Fireflies anchored to fixed places in the world. They used to be positioned
   * relative to the player every frame, so the swarm appeared to travel with
   * you; now each one drifts around its own home.
   */
  _buildFireflies() {
    const count = 520;
    const rng = createRng(4477);
    const hf = this.heightfield;
    const positions = new Float32Array(count * 3);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 14) {
      guard++;
      const angle = rng.next() * Math.PI * 2;
      const radius = Math.sqrt(rng.next()) * (WORLD.islandRadius * 0.86);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = hf.height(x, z);
      if (h < 1.2 || h > 76) continue;
      const y = h + 0.5 + rng.next() * 3.2;
      positions[placed * 3] = x;
      positions[placed * 3 + 1] = y;
      positions[placed * 3 + 2] = z;
      this.fireflyData.push({
        x,
        y,
        z,
        phase: rng.next() * Math.PI * 2,
        drift: 0.35 + rng.next() * 0.8,
        speed: 0.25 + rng.next() * 0.55,
      });
      placed++;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, placed);
    const material = new THREE.PointsMaterial({
      map: createGlowTexture(64, 'rgba(255, 240, 170, 1)', 'rgba(255, 220, 120, 0)'),
      color: '#ffe9a0',
      size: 0.55,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.fireflies = new THREE.Points(geometry, material);
    this.fireflies.frustumCulled = false;
    this.scene.add(this.fireflies);
  }

  /** True when (x,z) is clear of every point of interest clearing. */
  _clearOfPOIs(x, z, pad = 4) {
    // Keep solid scatter and undergrowth out of the navigable trail.
    if (trailWeight(x, z) > 0.1) return false;
    const all = [LOCATIONS.spawn, LOCATIONS.camp, LOCATIONS.temple, ...(LOCATIONS.frontier ?? []), ...LOCATIONS.shards];
    for (const loc of all) {
      if (Math.hypot(x - loc.x, z - loc.z) < (loc.radius ?? 20) + pad) return false;
    }
    return true;
  }

  /** Wildflower tint for a grass instance at a world position; 0 = none. */
  _flowerTint(x, z) {
    const f = fbm2(x * 0.045 + 7.3, z * 0.045 - 5.1, 2, 131) * 0.5 + 0.5;
    if (f < 0.78) return null;
    const roll = fbm2(x * 0.09 - 4.2, z * 0.09 + 8.7, 1, 147);
    if (roll > 0.22) return new THREE.Color('#fef9e7');
    if (roll > 0.05) return new THREE.Color('#f5b8d0');
    return new THREE.Color('#b8c8ff');
  }

  /**
   * Per-frame update.
   * @param {number} dt
   * @param {number} elapsed
   * @param {THREE.Vector3} playerPos
   * @param {number} nightFactor
   */
  update(dt, elapsed, playerPos, nightFactor) {
    this._chunkVisibilityTimer -= dt;
    if (this._chunkVisibilityTimer <= 0) {
      this._chunkVisibilityTimer = 0.25;
      this._updateChunkVisibility(playerPos);
    }
    for (const mat of this.windMaterials) {
      const u = mat?.userData?.windUniform;
      if (u) u.value = elapsed;
    }

    // Finish a sliced grass refill one chunk per frame; never block.
    if (this._grassQueue) this._fillGrassChunk();
    else if (!this.grassCenter || Math.hypot(playerPos.x - this.grassCenter.x, playerPos.z - this.grassCenter.z) > 12) {
      this._fillGrass(playerPos);
    }

    // Fireflies drift at 1/3 rate and skip entirely in daylight.
    this._fireflyTimer = (this._fireflyTimer ?? 0) + dt;
    if (this.fireflies && nightFactor > 0.04 && this._fireflyTimer > 0.05) {
      this._fireflyTimer = 0;
      const pos = this.fireflies.geometry.attributes.position;
      const data = this.fireflyData;
      for (let i = 0; i < data.length; i++) {
        const f = data[i];
        const t = elapsed * f.speed + f.phase;
        pos.setXYZ(
          i,
          f.x + Math.cos(t) * f.drift,
          f.y + Math.sin(t * 1.3) * f.drift * 0.55,
          f.z + Math.sin(t * 0.8) * f.drift,
        );
      }
      pos.needsUpdate = true;
      this.fireflies.material.opacity = clamp(nightFactor * 0.95, 0, 0.95);
    }
  }

  /** Apply a quality preset by trimming instance counts. */
  setQuality(settings) {
    // In focus mode (capture scenes) keep every instance — trimming by
    // global treeCount would starve the concentrated woods back to sparse.
    if (settings?.forestFocus) return;
    if (this.grassMesh) {
      const target = Math.min(settings?.grassCount ?? 14000, this.grassOffsets.length);
      const previous = this._grassTargetCount;
      this._grassTargetCount = target;
      if (target < this.grassMesh.count) this.grassMesh.count = target;
      if (target > previous && this.grassCenter) this._fillGrass(this.grassCenter);
      this.grassMesh.visible = target > 0;
    }
    this.settings = settings;
    const target = settings?.treeCount ?? 520;
    for (const entry of this.treeMeshes) entry.mesh.count = countRanksBelow(entry.ranks, target);
    for (const collider of this.colliders) {
      if (collider.treeRank !== undefined) collider.active = collider.treeRank < target;
    }
    this._chunkVisibilityTimer = 0;
  }
}
