/**
 * The island mesh. Samples the analytic heightfield, colours vertices by
 * biome/slope/height and adds procedural detail + normal maps.
 */

import * as THREE from 'three';
import { smoothstep } from '../util/math.js';
import { fbm2 } from '../util/noise.js';
import { WORLD, LOCATIONS } from './locations.js';
import { createNoiseTexture, createNormalTexture } from './textures.js';

const C = {
  deep: new THREE.Color('#1d2a31'),
  wetSand: new THREE.Color('#a8926a'),
  sand: new THREE.Color('#d9c79b'),
  grass: new THREE.Color('#7c9c5a'),
  grassDark: new THREE.Color('#567343'),
  // Large-scale meadow variation so the island is not one flat green.
  grassWarm: new THREE.Color('#9aa963'),
  grassCool: new THREE.Color('#4a6b47'),
  forestFloor: new THREE.Color('#33502c'),
  dirt: new THREE.Color('#7d6748'),
  rock: new THREE.Color('#77756f'),
  rockDark: new THREE.Color('#55534f'),
  snow: new THREE.Color('#e8eef4'),
};

export class Terrain {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./heightfield.js').Heightfield} heightfield
   * @param {object} settings
   */
  constructor(scene, heightfield, settings) {
    this.scene = scene;
    this.heightfield = heightfield;
    this.settings = settings;
    this.mesh = null;
  }

  /** Build the terrain mesh. */
  build() {
    const detail = this.settings?.terrainDetail ?? 1;
    const segments = Math.max(96, Math.floor(WORLD.terrainSegments * detail));
    const geometry = new THREE.PlaneGeometry(WORLD.size, WORLD.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    const hf = this.heightfield;

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const h = hf.height(x, z);
      position.setY(i, h);
      this._vertexColor(x, z, h, hf.slope(x, z), color);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const map = createNoiseTexture({ size: 512, scale: 9, seed: 41, contrast: 0.42, base: 0.86 });
    map.repeat.set(150, 150);
    const normalMap = createNormalTexture({ size: 256, scale: 10, seed: 77, strength: 2.1 });
    // A 110× tiling produced a visible diagonal weave from the air. Larger
    // tiles keep the surface relief without turning it into hatching.
    normalMap.repeat.set(40, 40);
    normalMap.anisotropy = 8;

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughness: 0.94,
      metalness: 0.02,
      dithering: true,
    });

    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'Terrain';
    this.scene.add(this.mesh);
    return this.mesh;
  }

  /** Blend biome colours for one vertex. */
  _vertexColor(x, z, h, slope, out) {
    const n = fbm2(x * 0.028, z * 0.028, 3, 12) * 0.5 + 0.5;
    const macro = fbm2(x * 0.0045, z * 0.0045, 3, 5) * 0.5 + 0.5;
    // Mid-scale patches: sun-dried meadow vs. damp mossy hollows.
    const patchN = fbm2(x * 0.012, z * 0.012, 4, 19) * 0.5 + 0.5;

    const sandW = 1 - smoothstep(1.8, 3.2, h);
    const snowW = smoothstep(76, 88, h);
    const rockW = smoothstep(0.42, 0.7, slope) * (1 - snowW);
    const grassW = Math.max(0, 1 - sandW - snowW - rockW);

    const grass = C.grass.clone().lerp(C.grassDark, n * 0.55 + macro * 0.22);
    // Warm, drier meadows on the patches; cooler moss in the dips between them.
    const warm = smoothstep(0.46, 0.74, patchN);
    grass.lerp(C.grassWarm, warm * 0.5);
    grass.lerp(C.grassCool, (1 - warm) * 0.34);
    // Paint the woodland mask into the ground itself. The tree instances use the
    // same noise field, so sparse trunks still read as a dark forest floor
    // instead of an empty lawn seen from the air.
    const forest = fbm2(x * 0.0055, z * 0.0055, 3, 33) * 0.5 + 0.5;
    const canopy = smoothstep(0.42, 0.72, forest);
    grass.lerp(C.forestFloor, canopy * 0.82);
    // Bare rock breaks through on the steeper shoulders.
    const outcrop = smoothstep(0.58, 0.8, fbm2(x * 0.017, z * 0.017, 3, 71) * 0.5 + 0.5);
    grass.lerp(C.rock, outcrop * smoothstep(0.22, 0.46, slope) * 0.7);
    // High ground reads cooler, low meadows warmer.
    grass.lerp(C.grassCool, smoothstep(30, 70, h) * 0.22);
    const rock = C.rock.clone().lerp(C.rockDark, n);
    const sand = C.sand.clone().lerp(C.wetSand, smoothstep(0.6, 2.0, 1 - (h / 4)) * 0.6);

    out.setRGB(
      sand.r * sandW + grass.r * grassW + rock.r * rockW + C.snow.r * snowW,
      sand.g * sandW + grass.g * grassW + rock.g * rockW + C.snow.g * snowW,
      sand.b * sandW + grass.b * grassW + rock.b * rockW + C.snow.b * snowW,
    );

    // Dirt clearing around the camp.
    const dCamp = Math.hypot(x - LOCATIONS.camp.x, z - LOCATIONS.camp.z);
    if (dCamp < 22) out.lerp(C.dirt, (1 - smoothstep(10, 22, dCamp)) * 0.55);

    // Darker seabed.
    if (h < 0) {
      const depth = smoothstep(0, 14, -h);
      out.lerp(C.deep, depth * 0.85);
    }

    // Subtle brightness variation to break up flat areas.
    const shade = 0.9 + n * 0.1 + patchN * 0.08;
    out.multiplyScalar(shade);
  }

  /** Adjust detail for a quality change. */
  setQuality(settings) {
    if (!this.material) return;
    const detail = settings?.terrainDetail ?? 1;
    // Keep the surface readable without letting the normal map moiré at range.
    if (this.material.normalScale) this.material.normalScale.setScalar(0.18 + detail * 0.1);
  }
}
