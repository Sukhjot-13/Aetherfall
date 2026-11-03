/**
 * Ocean surface. A custom shader handles gerstner-ish swells, fresnel sky
 * reflection, sun glitter, shoreline foam and distance fog.
 */

import * as THREE from 'three';
import { smoothstep } from '../util/math.js';

const VERTEX = /* glsl */ `
  uniform float uTime;
  attribute float aShore;
  varying vec3 vWorld;
  varying float vShore;
  varying vec3 vNormalW;
  varying float vViewDist;

  void main() {
    vec3 pos = position;
    float t = uTime;

    float w1 = sin(pos.x * 0.045 + t * 1.05) * 0.30;
    float w2 = sin(pos.z * 0.061 - t * 0.85) * 0.24;
    float w3 = sin((pos.x + pos.z) * 0.028 + t * 0.55) * 0.38;
    pos.y += w1 + w2 + w3;

    float dx = cos(pos.x * 0.045 + t * 1.05) * 0.045 * 0.30
             + cos((pos.x + pos.z) * 0.028 + t * 0.55) * 0.028 * 0.38;
    float dz = cos(pos.z * 0.061 - t * 0.85) * 0.061 * 0.24
             + cos((pos.x + pos.z) * 0.028 + t * 0.55) * 0.028 * 0.38;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    vShore = aShore;
    vNormalW = normalize(vec3(-dx, 1.0, -dz));
    vec4 mv = viewMatrix * world;
    vViewDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uDay;
  varying vec3 vWorld;
  varying float vShore;
  varying vec3 vNormalW;
  varying float vViewDist;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = p * 2.05 + 7.1;
      a *= 0.5;
    }
    return v;
  }

  // Slope of a scrolling noise field, used as a wave normal. Sampling the
  // field three times gives real per-pixel ripples at every distance instead of
  // the flat sheet the old two-sine version produced.
  vec3 waveNormal(vec2 p, float t) {
    float e = 0.6;
    vec2 drift = vec2(t * 0.05, t * 0.03);
    float h0 = fbm(p * 0.055 + drift);
    float hx = fbm((p + vec2(e, 0.0)) * 0.055 + drift);
    float hz = fbm((p + vec2(0.0, e)) * 0.055 + drift);
    vec2 slope = vec2(hx - h0, hz - h0) / e;

    vec2 drift2 = vec2(-t * 0.08, t * 0.06);
    float g0 = fbm(p * 0.21 + drift2);
    float gx = fbm((p + vec2(e, 0.0)) * 0.21 + drift2);
    float gz = fbm((p + vec2(0.0, e)) * 0.21 + drift2);
    slope += vec2(gx - g0, gz - g0) / e * 0.45;

    return normalize(vec3(-slope.x * 3.4, 1.0, -slope.y * 3.4));
  }

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorld);
    vec3 n = waveNormal(vWorld.xz, uTime);
    // Blend toward the smooth geometric normal far away so the horizon stays calm.
    n = normalize(mix(n, normalize(vNormalW), smoothstep(280.0, 1100.0, vViewDist)));

    float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.4);
    float depthMix = clamp(vShore, 0.0, 1.0);

    vec3 col = mix(uDeep, uShallow, depthMix * 0.92);
    col = mix(col, uHorizon, fres * 0.5);

    // Wave-crest brightening: the side of a swell facing the sun catches light.
    float crest = smoothstep(0.25, 0.85, n.y * 0.5 + 0.5) - 0.5;
    col += uSunColor * crest * 0.16 * uDay;

    vec3 halfDir = normalize(viewDir + uSunDir);
    float spec = pow(max(dot(n, halfDir), 0.0), 120.0);
    col += uSunColor * spec * (2.1 * uDay + 0.25);

    // Broad glitter path under the sun.
    float glitter = smoothstep(0.5, 0.95, fbm(vWorld.xz * 1.7 + uTime * 0.22));
    float sunPath = pow(max(dot(viewDir, uSunDir), 0.0), 6.0);
    col += uSunColor * glitter * sunPath * 0.22 * uDay;

    float foamNoise = fbm(vWorld.xz * 0.8 + vec2(uTime * 0.35, -uTime * 0.22));
    float foam = smoothstep(0.55, 0.95, depthMix) * smoothstep(0.32, 0.72, foamNoise);
    foam += smoothstep(0.86, 1.0, depthMix) * 0.55;
    col = mix(col, vec3(0.92, 0.98, 1.0), clamp(foam, 0.0, 0.85));

    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vViewDist * vViewDist);
    col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));

    float alpha = mix(0.9, 0.98, depthMix);
    alpha = mix(alpha, 1.0, clamp(foam, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class Water {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./heightfield.js').Heightfield} heightfield
   * @param {object} settings
   */
  constructor(scene, heightfield, settings) {
    this.scene = scene;
    this.heightfield = heightfield;
    this.settings = settings;
    this.uniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#082c3f') },
      uShallow: { value: new THREE.Color('#1d7b86') },
      uHorizon: { value: new THREE.Color('#c2e0f4') },
      uSunColor: { value: new THREE.Color('#fff4da') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFogColor: { value: new THREE.Color('#c2e0f4') },
      uFogDensity: { value: 0.0014 },
      uDay: { value: 1 },
    };
  }

  build() {
    const segments = this.settings?.waterSegments ?? 140;
    const size = 4200;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const shore = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const depth = -this.heightfield.height(x, z);
      shore[i] = 1 - smoothstep(0.35, 7.5, depth);
    }
    geometry.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.material = material;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = 0;
    this.mesh.name = 'Ocean';
    this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
    return this.mesh;
  }

  /**
   * @param {number} elapsed
   * @param {import('./Sky.js').Sky} sky
   */
  update(elapsed, sky) {
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uSunDir.value.copy(sky.sunDirection);
    this.uniforms.uSunColor.value.copy(sky.uniforms.uSunColor.value);
    this.uniforms.uHorizon.value.copy(sky.horizonColor);
    this.uniforms.uFogColor.value.copy(sky.fogColor);
    this.uniforms.uFogDensity.value = sky.fog.density;
    this.uniforms.uDay.value = sky.dayFactor;

    const night = 1 - sky.dayFactor;
    this.uniforms.uDeep.value.setRGB(0.02 + 0.01 * sky.dayFactor, 0.09 + 0.07 * sky.dayFactor, 0.14 + 0.1 * sky.dayFactor);
    this.uniforms.uShallow.value.setRGB(0.05 + 0.08 * sky.dayFactor, 0.24 + 0.24 * sky.dayFactor, 0.3 + 0.24 * sky.dayFactor);
    this.uniforms.uDeep.value.multiplyScalar(1 - night * 0.35);
  }
}
