/**
 * Living scenery: instanced trees and rocks across the island, a dense grass
 * field that follows the player, and drifting fireflies at night.
 */

import * as THREE from 'three';
import { ShaderChunk } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng } from '../util/rng.js';
import { fbm2 } from '../util/noise.js';
import { clamp, smoothstep } from '../util/math.js';
import { LOCATIONS, WORLD } from './locations.js';
import { createGlowTexture } from './textures.js';

/** Radius of the player-following grass field, in metres. */
const GRASS_RADIUS = 40;

/**
 * Patch a standard material to sway vertices in the wind.
 * @param {THREE.MeshStandardMaterial} material
 * @param {{sway?:number, speed?:number, key:string, bothSides?:boolean}} opts
 */
function addWind(material, { sway = 0.08, speed = 1.1, key = 'wind', bothSides = false } = {}) {
  const uniform = { value: 0 };
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
    this.grassMesh = null;
    this.grassOffsets = [];
    this.treeMeshes = [];
    this.fireflies = null;
    this.fireflyData = [];
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
  }

  build() {
    this._buildTrees();
    this._buildRocks();
    this._buildGrass();
    this._buildFireflies();
    return this;
  }

  /** Static forest scatter. */
  _buildTrees() {
    const preset = this.settings;
    const target = preset?.treeCount ?? 520;

    // Layered conifer: three stacked cones read as a real pine silhouette from
    // every angle, where a single cone read as a flat pyramid.
    const pineParts = [];
    const cone = (r, h, y, sides = 7) => {
      const g = new THREE.ConeGeometry(r, h, sides, 1);
      g.translate(0, y, 0);
      return g;
    };
    pineParts.push(cone(1.62, 2.5, 1.55, 8));
    pineParts.push(cone(1.28, 2.4, 2.85, 7));
    pineParts.push(cone(0.92, 2.2, 4.05, 7));
    pineParts.push(cone(0.55, 1.7, 5.15, 6));
    const pineGeo = mergeGeometries(pineParts, false);
    pineGeo.computeVertexNormals();

    // Broadleaf canopy: a cluster of overlapping blobs, not one floating ball.
    const broadParts = [];
    const blob = (r, x, y, z) => {
      const g = new THREE.IcosahedronGeometry(r, 1);
      g.translate(x, y, z);
      return g;
    };
    broadParts.push(blob(1.5, 0, 0.1, 0));
    broadParts.push(blob(1.12, 1.02, 0.72, 0.25));
    broadParts.push(blob(1.05, -0.88, 0.62, -0.42));
    broadParts.push(blob(1.0, 0.12, 1.28, 0.38));
    broadParts.push(blob(0.86, -0.25, 1.0, -1.0));
    const broadGeo = mergeGeometries(broadParts, false);
    broadGeo.computeVertexNormals();

    // A single straight cylinder read as a black rectangle once the canopy
    // shadowed it. Three slightly offset segments plus two branch stubs give
    // the trunk a natural silhouette from every angle.
    const trunkParts = [];
    const trunkSeg = (rTop, rBottom, h, y, ox, oz, tilt) => {
      const g = new THREE.CylinderGeometry(rTop, rBottom, h, 6, 1);
      g.translate(0, h * 0.5, 0);
      if (tilt) g.applyMatrix4(new THREE.Matrix4().makeRotationZ(tilt));
      g.translate(ox, y, oz);
      return g;
    };
    trunkParts.push(trunkSeg(0.2, 0.28, 0.55, 0, 0, 0, 0));
    trunkParts.push(trunkSeg(0.15, 0.2, 0.4, 0.52, 0.03, 0, 0.06));
    trunkParts.push(trunkSeg(0.1, 0.15, 0.32, 0.9, 0.07, 0.02, 0.1));
    const branch = (len, angle, y, ox) => {
      const g = new THREE.CylinderGeometry(0.035, 0.06, len, 5, 1);
      g.translate(0, len * 0.5, 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(angle));
      g.translate(ox, y, 0);
      return g;
    };
    trunkParts.push(branch(0.44, 0.72, 0.62, 0.05));
    trunkParts.push(branch(0.36, -0.82, 0.74, -0.03));
    const trunkGeo = mergeGeometries(trunkParts, false);
    trunkGeo.computeVertexNormals();

    // The canopy shadows the trunk for most of the day, so a pure dark brown
    // collapsed to black. A warm emissive lifts the shadow side without
    // flattening the lit faces.
    const trunkMat = new THREE.MeshStandardMaterial({
      color: '#7a5a3e',
      emissive: '#241a10',
      emissiveIntensity: 0.55,
      roughness: 0.95,
      flatShading: true,
    });
    // Instanced trees carry their colour in instanceColor, which multiplies the
    // material colour — keep the material white or the foliage turns black.
    const pineMat = addWind(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }),
      { sway: 0.05, speed: 0.9, key: 'pine' },
    );
    const broadMat = addWind(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: true }),
      { sway: 0.06, speed: 0.75, key: 'broad' },
    );
    this.windMaterials.push(pineMat, broadMat);

    const positions = [];
    const rng = this.rng;
    let attempts = 0;
    while (positions.length < target && attempts < target * 30) {
      attempts++;
      const angle = rng.next() * Math.PI * 2;
      const radius = Math.sqrt(rng.next()) * (WORLD.islandRadius * 0.94);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = this.heightfield.height(x, z);
      if (h < 3.4 || h > 74) continue;
      if (this.heightfield.slope(x, z) > 0.48) continue;
      if (!this._clearOfPOIs(x, z, 7)) continue;
      // Squared mask so trees bunch into real woods instead of dusting the
      // whole island evenly.
      const forest = fbm2(x * 0.0055, z * 0.0055, 3, 33) * 0.5 + 0.5;
      if (rng.next() > 0.06 + forest * forest * 1.35) continue;
      positions.push({ x, z, h, forest });
    }

    const pines = positions.filter((_, i) => i % 9 < 5);
    const broad = positions.filter((_, i) => i % 9 >= 5);
    const makeInstances = (list, geometry, material, palette, lift = 0) => {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Trees';
      list.forEach((p, i) => {
        const scale = 0.75 + rng.next() * 0.85;
        const rot = rng.next() * Math.PI * 2;
        this._dummy.position.set(p.x, p.h + lift, p.z);
        this._dummy.rotation.set(0, rot, 0);
        this._dummy.scale.set(scale, scale * (0.85 + rng.next() * 0.5), scale);
        this._dummy.updateMatrix();
        mesh.setMatrixAt(i, this._dummy.matrix);
        this._color.set(palette[Math.floor(rng.next() * palette.length)]);
        this._color.multiplyScalar(0.82 + rng.next() * 0.32);
        mesh.setColorAt(i, this._color);
        if (scale > 0.9) this.colliders.push({ x: p.x, z: p.z, r: 0.28 + scale * 0.22 });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this.treeMeshes.push({ mesh, max: list.length });
      return mesh;
    };

    // Deeper values at the bottom of the ramp give forests real depth; the
    // occasional copper tone keeps the canopy from reading as one flat green.
    const pinePalette = ['#3d7a5a', '#4a8c69', '#356b4d', '#5aa37b', '#6cb389', '#7fa85c'];
    const broadPalette = ['#5d9950', '#74b164', '#4f8a44', '#86c274', '#9ccb7f', '#b3a65a'];
    makeInstances(pines, pineGeo, pineMat, pinePalette, 0.55);
    makeInstances(broad, broadGeo, broadMat, broadPalette, 3.0);

    // Trunks share a single instanced mesh.
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
    trunks.castShadow = true;
    trunks.receiveShadow = true;
    positions.forEach((p, i) => {
      const scale = 0.75 + rng.next() * 0.7;
      this._dummy.position.set(p.x, p.h - 0.2, p.z);
      this._dummy.rotation.set(0, rng.next() * Math.PI * 2, 0);
      this._dummy.scale.set(scale, 2.6 + rng.next() * 1.8, scale);
      this._dummy.updateMatrix();
      trunks.setMatrixAt(i, this._dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks);
    this.trunks = trunks;
  }

  /** Boulders and outcrops. */
  _buildRocks() {
    const rng = createRng(5511);
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, flatShading: true });
    const count = 240;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'Rocks';
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 25) {
      guard++;
      const angle = rng.next() * Math.PI * 2;
      const radius = Math.sqrt(rng.next()) * (WORLD.islandRadius * 0.97);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const h = this.heightfield.height(x, z);
      if (h < 0.6) continue;
      if (!this._clearOfPOIs(x, z, 5)) continue;
      const scale = 0.35 + rng.next() * 1.9;
      this._dummy.position.set(x, h + scale * 0.18, z);
      this._dummy.rotation.set(rng.next() * 0.6, rng.next() * Math.PI * 2, rng.next() * 0.6);
      this._dummy.scale.set(scale * (0.8 + rng.next() * 0.7), scale * (0.55 + rng.next() * 0.5), scale * (0.8 + rng.next() * 0.7));
      this._dummy.updateMatrix();
      mesh.setMatrixAt(placed, this._dummy.matrix);
      this._color.set(['#9d9a92', '#8a8881', '#aeaaa1', '#7b7973'][Math.floor(rng.next() * 4)]);
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

  /** A dense grass field that follows the player. */
  _buildGrass() {
    // A real tuft, not a billboard: seven tapered triangles fan out from a
    // small root cluster, with a dark base and sunlit tip baked into vertex
    // colours. Seven triangles is cheaper than the old three crossed quads and
    // gives the meadow a genuine silhouette from every angle.
    const positions = [];
    const colors = [];
    const baseColor = new THREE.Color('#4b6632');
    const tipColor = new THREE.Color('#a8c56d');
    const bladeCount = 7;
    for (let i = 0; i < bladeCount; i++) {
      const a = (i / bladeCount) * Math.PI * 2 + (i % 2) * 0.37;
      const radius = 0.025 + (i % 3) * 0.045;
      const bx = Math.cos(a) * radius;
      const bz = Math.sin(a) * radius;
      const width = 0.046 + (i % 4) * 0.011;
      const height = 0.3 + (i % 5) * 0.045;
      const lean = 0.055 + (i % 3) * 0.035;
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
    const count = preset?.grassCount ?? 16000;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = 'Grass';
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
        scale: (near ? 0.7 : 0.54) + rng.next() * 0.34,
        rot: rng.next() * Math.PI * 2,
        tiltX: (rng.next() - 0.5) * 0.22,
        tiltZ: (rng.next() - 0.5) * 0.22,
      });
      // Mottled meadow: dry golden-green patches against deeper shaded clumps.
      // Colours are authored in sRGB: linear-space HSL at these lightness
      // values rendered the darker tufts almost black.
      const dry = rng.next();
      this._color.setHSL(
        0.18 + dry * 0.08,
        0.12 + rng.next() * 0.16,
        0.8 + rng.next() * 0.2,
        THREE.SRGBColorSpace,
      );
      mesh.setColorAt(i, this._color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this._fillGrass(new THREE.Vector3(LOCATIONS.spawn.x, 0, LOCATIONS.spawn.z));
  }

  /** Rebuild the grass instances around a new centre. */
  _fillGrass(center) {
    if (!this.grassMesh) return;
    this.grassCenter = { x: center.x, z: center.z };
    const hf = this.heightfield;
    const dummy = this._dummy;
    for (let i = 0; i < this.grassOffsets.length; i++) {
      const o = this.grassOffsets[i];
      const x = center.x + o.x;
      const z = center.z + o.z;
      const h = hf.height(x, z);
      const slope = hf.slope(x, z);
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
      const s = visible ? o.scale * (0.45 + 0.55 * shore) * edge * (0.78 + clump * 0.6) : 0.0001;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.grassMesh.setMatrixAt(i, dummy.matrix);
    }
    this.grassMesh.instanceMatrix.needsUpdate = true;
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
    for (const loc of [LOCATIONS.spawn, LOCATIONS.camp, LOCATIONS.temple, ...LOCATIONS.shards]) {
      if (Math.hypot(x - loc.x, z - loc.z) < (loc.radius ?? 20) + pad) return false;
    }
    return true;
  }

  /**
   * Per-frame update.
   * @param {number} dt
   * @param {number} elapsed
   * @param {THREE.Vector3} playerPos
   * @param {number} nightFactor
   */
  update(dt, elapsed, playerPos, nightFactor) {
    for (const mat of this.windMaterials) {
      const u = mat?.userData?.windUniform;
      if (u) u.value = elapsed;
    }

    if (!this.grassCenter || Math.hypot(playerPos.x - this.grassCenter.x, playerPos.z - this.grassCenter.z) > 3) {
      this._fillGrass(playerPos);
    }

    if (this.fireflies) {
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
    if (this.grassMesh) {
      const target = settings?.grassCount ?? 14000;
      this.grassMesh.count = Math.min(target, this.grassOffsets.length);
      this.grassMesh.visible = target > 0;
    }
    if (this.rocks) {
      const target = Math.round((settings?.treeCount ?? 520) * 0.46);
      this.rocks.count = Math.min(target, this.rockMax ?? this.rocks.count);
    }
    if (this.treeMeshes.length) {
      const target = Math.max(40, Math.round((settings?.treeCount ?? 520) / 2));
      for (const entry of this.treeMeshes) entry.mesh.count = Math.min(target, entry.max);
    }
  }
}
