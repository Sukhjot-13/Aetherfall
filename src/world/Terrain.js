/**
 * The island mesh. Samples the analytic heightfield, colours vertices by
 * biome/slope/height and adds procedural detail + normal maps.
 */

import * as THREE from 'three';
import { smoothstep } from '../util/math.js';
import { fbm2 } from '../util/noise.js';
import { WORLD, LOCATIONS } from './locations.js';
import { trailShader } from './trails.js';
import { createNoiseTexture, createNormalTexture } from './textures.js';

const C = {
  deep: new THREE.Color('#1d2a31'),
  wetSand: new THREE.Color('#a8926a'),
  sand: new THREE.Color('#d9c79b'),
  grass: new THREE.Color('#56713f'),
  grassDark: new THREE.Color('#3d5529'),
  // Large-scale meadow variation so the island is not one flat green.
  grassWarm: new THREE.Color('#8a8f52'),
  grassCool: new THREE.Color('#35513a'),
  forestFloor: new THREE.Color('#243d1f'),
  dirt: new THREE.Color('#6f5a3c'),
  rock: new THREE.Color('#635f58'),
  rockDark: new THREE.Color('#403f39'),
  snow: new THREE.Color('#c2d2de'),
};

/** Patch a terrain material with world-space detail so close-ups get
 *  per-pixel grain even though the mesh is sampled at 15-25 m per vertex.
 *  Detail is sampled in world XZ (tile every ~5 m) and multiplied over the
 *  vertex colour, so inner and outer sheets share one scale — no seam. */
function addWorldDetail(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n{ vec4 wp = modelMatrix * vec4(transformed, 1.0); vWorldPos = wp.xyz; }',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uDetail;
varying vec3 vWorldPos;
${trailShader()}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 duv1 = vWorldPos.xz / 3.5;
  vec2 duv2 = vWorldPos.xz / 11.0;
  float d1 = texture2D(uDetail, duv1).r;
  float d2 = texture2D(uDetail, duv2).g;
  float detail = 0.86 + ((d1 * 0.65 + d2 * 0.35) - 0.5) * 0.42;
  diffuseColor.rgb *= detail;
  float trail = trailMask(vWorldPos.xz) * smoothstep(1.5, 3.2, vWorldPos.y);
  vec3 pathEarth = vec3(0.22, 0.145, 0.075) * (0.8 + d1 * 0.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, pathEarth, trail * 0.86);
}`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-world-detail';
  return material;
}

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
    this._innerCenterUniform = { value: new THREE.Vector2() };
    this._innerHalfUniform = { value: 0 };
    this._grassColor = new THREE.Color();
    this._rockColor = new THREE.Color();
    this._sandColor = new THREE.Color();
  }

  /** Build terrain in short batches so the loading screen can repaint.
   * @param {number} [segmentsOverride] resolution guard for low-spec devices
   * @param {()=>Promise<void>} [yieldControl] yield to the browser */
  async build(segmentsOverride, yieldControl = async () => {}) {
    const detail = this.settings?.terrainDetail ?? 1;
    const segments = segmentsOverride
      ?? Math.max(96, Math.floor(WORLD.terrainSegments * detail));
    this._detail = detail;
    this._segments = segments;

    // --- inner chunk: follows the player, dense sampling near the camera ---
    // Built first so the title screen already has crisp ground under it;
    // the outer sheet can be slightly coarser because it is distant.
    this._innerSize = 620;
    this._innerSegments = 160;
    // Spawn-centered: the title camera looks at the temple, but the chunk
    // must cover the spawn area where the player starts.
    this._startInnerBuild(LOCATIONS.spawn.x, LOCATIONS.spawn.z);
    let sliceStart = performance.now();
    while (this._pendingInner) {
      this._advanceInnerBuild(512);
      if (this._pendingInner && performance.now() - sliceStart >= 8) {
        await yieldControl();
        sliceStart = performance.now();
      }
    }
    // --- outer sheet: static, low density over the whole island ---
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
      if ((i & 511) === 511 && performance.now() - sliceStart >= 8) {
        await yieldControl();
        sliceStart = performance.now();
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const detailTex = createNoiseTexture({ size: 512, scale: 9, seed: 41, contrast: 0.55, base: 0.82 });
    detailTex.anisotropy = 8;
    const normalMap = createNormalTexture({ size: 256, scale: 10, seed: 77, strength: 1.6 });
    // Normal detail is a micro-surface effect: keep its tile small (outer
    // sheet repeats it ~880× for a ~12 m tile) and let mipmaps blur it out
    // at range. World-space detail above carries the close-up grain.
    normalMap.repeat.set(400, 400);
    normalMap.anisotropy = 8;

    const material = addWorldDetail(new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      normalMap,
      normalScale: new THREE.Vector2(0.1, 0.1),
      roughness: 0.96,
      metalness: 0.02,
      sheen: 0.08,
      sheenRoughness: 1,
      dithering: true,
    }));
    material.userData.detailTex = detailTex;
    // The detail texture must be bound via onBeforeCompile uniforms.
    const prevCompile = material.onBeforeCompile.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      prevCompile(shader, renderer);
      shader.uniforms.uDetail = { value: detailTex };
    };

    // The coarse island sheet may sit above the detailed local surface, even
    // inside a flattened landmark. Give the local sheet its own material and
    // cut the coarse sheet beneath it; keep a small overlap only at the edge.
    const innerMaterial = material.clone();
    innerMaterial.onBeforeCompile = material.onBeforeCompile;
    innerMaterial.customProgramCacheKey = () => 'terrain-detail-inner';
    this.innerMaterial = innerMaterial;
    const compileOuter = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compileOuter(shader, renderer);
      shader.uniforms.uInnerCenter = this._innerCenterUniform;
      shader.uniforms.uInnerHalf = this._innerHalfUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uInnerCenter;\nuniform float uInnerHalf;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          vec2 localTerrain = abs(vWorldPos.xz - uInnerCenter);
          if (localTerrain.x < uInnerHalf && localTerrain.y < uInnerHalf) discard;`);
    };
    material.customProgramCacheKey = () => 'terrain-detail-outer-cutout';
    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'Terrain';
    this.scene.add(this.mesh);
    // The inner chunk shares the outer material now that it exists.
    if (this.innerMesh) {
      this.innerMesh.material.dispose();
      this.innerMesh.material = innerMaterial;
    }
    return this.mesh;
  }
  /** Build the initial local chunk synchronously, before gameplay starts. */
  _buildInner(cx, cz) {
    this._startInnerBuild(cx, cz);
    this._advanceInnerBuild(Infinity);
  }

  /** Prepare a replacement without disturbing the currently visible chunk. */
  _startInnerBuild(cx, cz) {
    this._pendingInner?.geometry.dispose();
    const size = this._innerSize ?? 620;
    const segs = this._innerSegments ?? 160;
    const geometry = new THREE.PlaneGeometry(size, size, segs, segs);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    this._pendingInner = {
      cx, cz, size, geometry, position, index: 0,
      colors: new Float32Array(position.count * 3),
      color: new THREE.Color(),
    };
  }

  /** Sample a bounded batch of vertices, then atomically swap when ready. */
  _advanceInnerBuild(budget = 256) {
    const job = this._pendingInner;
    if (!job) return;
    const hf = this.heightfield;
    const end = Math.min(job.position.count, job.index + budget);
    for (let i = job.index; i < end; i++) {
      const x = job.cx + job.position.getX(i);
      const z = job.cz + job.position.getZ(i);
      const h = hf.height(x, z);
      job.position.setY(i, h);
      this._vertexColor(x, z, h, hf.slope(x, z), job.color);
      job.colors[i * 3] = job.color.r;
      job.colors[i * 3 + 1] = job.color.g;
      job.colors[i * 3 + 2] = job.color.b;
    }
    job.index = end;
    if (end < job.position.count) return;

    job.geometry.setAttribute('color', new THREE.BufferAttribute(job.colors, 3));
    job.geometry.computeVertexNormals();
    const innerMat = this.innerMaterial ?? new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.94, metalness: 0.02, dithering: true,
    });
    const nextMesh = new THREE.Mesh(job.geometry, innerMat);
    nextMesh.position.set(job.cx, 0.04, job.cz);
    nextMesh.receiveShadow = true;
    nextMesh.castShadow = false;
    nextMesh.name = 'TerrainInner';
    if (this.innerMesh) {
      this.scene.remove(this.innerMesh);
      this.innerMesh.geometry.dispose();
    }
    this.innerMesh = nextMesh;
    this.scene.add(nextMesh);
    this._innerCenter = { x: job.cx, z: job.cz };
    this._innerCenterUniform.value.set(job.cx, job.cz);
    this._innerHalfUniform.value = Math.max(0, job.size * 0.5 - 12);
    this._pendingInner = null;
  }

  /** Rebuild the local ground incrementally as the player travels. */
  update(playerPos) {
    if (!this.innerMesh || !playerPos) return;
    const size = this._innerSize ?? 620;
    if (this._pendingInner) {
      // Teleports or fast flight can make an in-flight build obsolete.
      const job = this._pendingInner;
      if (Math.hypot(playerPos.x - job.cx, playerPos.z - job.cz) > size * 0.3) {
        this._startInnerBuild(playerPos.x, playerPos.z);
      }
      this._advanceInnerBuild();
      return;
    }
    const dist = Math.hypot(playerPos.x - this._innerCenter.x, playerPos.z - this._innerCenter.z);
    if (dist > size * 0.3) {
      this._startInnerBuild(playerPos.x, playerPos.z);
      this._advanceInnerBuild();
    }
  }

  /** Blend biome colours for one vertex. */
  _vertexColor(x, z, h, slope, out) {
    const n = fbm2(x * 0.028, z * 0.028, 3, 12) * 0.5 + 0.5;
    const macro = fbm2(x * 0.0045, z * 0.0045, 3, 5) * 0.5 + 0.5;
    // Mid-scale patches: sun-dried meadow vs. damp mossy hollows.
    const patchN = fbm2(x * 0.012, z * 0.012, 4, 19) * 0.5 + 0.5;
    // Fine splatter so close-ups do not look single-coloured. Very cheap:
    // one extra FBM sample that only shifts brightness ±7 %.
    const grain = fbm2(x * 0.11, z * 0.11, 2, 99) * 0.5 + 0.5;

    const sandW = 1 - smoothstep(1.8, 3.2, h);
    const rockW = smoothstep(0.38, 0.68, slope);
    // Snow only on broad high ground — steep faces stay rock so the peaks
    // read as crags, not fog-white blobs.
    const snowW = smoothstep(78, 92, h) * (1 - smoothstep(0.25, 0.55, slope));
    const grassW = Math.max(0, 1 - sandW - snowW - rockW);

    const grass = this._grassColor.copy(C.grass).lerp(C.grassDark, n * 0.55 + macro * 0.22);
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
    const rock = this._rockColor.copy(C.rock).lerp(C.rockDark, n);
    const sand = this._sandColor.copy(C.sand).lerp(C.wetSand, smoothstep(0.6, 2.0, 1 - (h / 4)) * 0.6);

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

    // Dirt patches in the meadows break up the green into pasture and trail.
    const dirtPatch = grassW * smoothstep(0.6, 0.82, fbm2(x * 0.009 + 3.1, z * 0.009 - 2.4, 3, 23) * 0.5 + 0.5);
    out.lerp(C.dirt, dirtPatch * 0.28);

    // Subtle brightness variation to break up flat areas.
    const shade = 0.86 + n * 0.14 + patchN * 0.1;
    out.multiplyScalar(shade);
    out.multiplyScalar(0.9 + grain * 0.2);
  }

  /** Adjust detail for a quality change. */
  setQuality(settings) {
    if (!this.material) return;
    const detail = settings?.terrainDetail ?? 1;
    // Keep the surface readable without letting the normal map moiré at range.
    if (this.material.normalScale) this.material.normalScale.setScalar(0.07 + detail * 0.03);
    if (this.innerMaterial?.normalScale) this.innerMaterial.normalScale.setScalar(0.07 + detail * 0.03);
  }
}
