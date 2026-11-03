/**
 * Hand-placed landmarks: the Beacon temple, Emberfall Camp, three shard
 * shrines, ruins, waystones, floating islets and atmospheric cloud banks.
 */

import * as THREE from 'three';
import { createRng } from '../util/rng.js';
import { clamp, smoothstep, TAU } from '../util/math.js';
import { LOCATIONS } from './locations.js';
import { createBeamTexture, createCloudTexture, createGlowTexture } from './textures.js';

const MAT = {
  stone: new THREE.MeshStandardMaterial({ color: '#8d8b81', roughness: 0.92, flatShading: true }),
  stoneDark: new THREE.MeshStandardMaterial({ color: '#5d5e59', roughness: 0.95, flatShading: true }),
  stoneWarm: new THREE.MeshStandardMaterial({ color: '#a08f74', roughness: 0.9, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ color: '#5a4330', roughness: 0.92, flatShading: true }),
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A soft additive glow sprite. */
function glowSprite(color, size = 4, opacity = 0.7) {
  const map = createGlowTexture(128, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
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
    this._buildFloatingIslands();
    this._buildClouds();
    this._buildCrystals();
    this.scene.add(this.group);
    return this;
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
  update(dt, elapsed, questState) {
    for (const item of this.animated) {
      switch (item.type) {
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

    if (this.altar?.restored) {
      const pulse = 0.3 + Math.sin(elapsed * 1.4) * 0.08;
      this.altar.beam.material.opacity = pulse;
      this.altar.beam.scale.x = 1 + Math.sin(elapsed * 1.1) * 0.08;
      this.altar.beam.scale.z = this.altar.beam.scale.x;
      this.altar.beamGlow.material.opacity = 0.7 + Math.sin(elapsed * 1.6) * 0.15;
    }
  }

  /** Apply a quality preset (cloud/beam visuals stay). */
  setQuality() {
    /* Structures are cheap; nothing to trim. */
  }
}
