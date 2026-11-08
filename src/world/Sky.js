/**
 * Dynamic sky dome, sun/moon, stars, procedural clouds and the whole
 * day-night lighting rig. Also owns the scene fog so the horizon always
 * matches the sky.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp, smoothstep, TAU } from '../util/math.js';
import { WORLD } from './locations.js';

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uCloudColor;
  uniform float uDay;
  uniform float uTime;
  uniform float uRestored;
  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p = p * 2.03 + 13.7;
      a *= 0.5;
    }
    return v;
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);

    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.55));
    if (d.y < 0.0) {
      sky = mix(uHorizon, uGround, clamp(-d.y * 2.6, 0.0, 1.0));
    }

    // Sun disk + halo.
    float sd = max(dot(d, uSunDir), 0.0);
    float warmBand = exp(-abs(d.y - 0.06) * 3.2) * (1.0 - uDay) * 0.10;
    sky += uSunColor * pow(sd, 1400.0) * 7.0;
    sky += uSunColor * pow(sd, 26.0) * (0.18 + uDay * 0.32);
    sky += uSunColor * warmBand * pow(sd, 6.0);

    // Moon.
    float md = max(dot(d, -uSunDir), 0.0);
    sky += vec3(0.72, 0.82, 1.0) * pow(md, 2200.0) * 3.0 * (1.0 - uDay);
    sky += vec3(0.35, 0.45, 0.7) * pow(md, 60.0) * 0.15 * (1.0 - uDay);

    // Stars — altitude gated so the horizon haze eats the dim ones first.
    vec3 sp = floor(d * 420.0);
    float star = step(0.9977, hash31(sp));
    float twinkle = 0.65 + 0.35 * sin(uTime * 1.6 + hash31(sp + 1.7) * 40.0);
    float altitude = smoothstep(0.06, 0.28, d.y);
    sky += vec3(0.78, 0.87, 1.0) * star * altitude * (1.0 - uDay) * twinkle * 1.5;

    // Clouds projected onto the dome. Two drifting layers at different speeds
    // give the sky parallax and stop it reading as one flat poster.
    vec2 cuv = d.xz / (abs(d.y) + 0.24) * 0.85;
    float c1 = fbm(cuv * 1.35 + vec2(uTime * 0.006, uTime * 0.0035));
    float c2 = fbm(cuv * 3.7 - vec2(uTime * 0.011, uTime * 0.005));
    float c = c1 * 0.74 + c2 * 0.26;
    float cloud = smoothstep(0.45, 0.70, c) * smoothstep(-0.02, 0.13, d.y);
    vec3 cloudCol = uCloudColor;
    // Shaded bellies under the thicker parts.
    cloudCol = mix(cloudCol * 0.78, cloudCol, smoothstep(0.52, 0.86, c));
    cloudCol += uSunColor * pow(sd, 8.0) * 0.22 * uDay;
    sky = mix(sky, cloudCol, cloud * 0.9);

    // Aether aurora after the beacon is restored.
    if (uRestored > 0.5 && d.y > 0.12) {
      float band = fbm(vec2(d.x * 3.0 + uTime * 0.02, d.y * 6.0 - uTime * 0.01));
      float aurora = smoothstep(0.55, 0.85, band) * smoothstep(0.1, 0.45, d.y) * (1.0 - uDay);
      sky += vec3(1.0, 0.82, 0.45) * aurora * 0.35;
    }

    // Horizon haze + a broad warm scatter around the sun.
    float haze = exp(-abs(d.y) * 11.0);
    sky = mix(sky, uHorizon * 1.08, haze * 0.32);
    sky += uSunColor * pow(sd, 4.0) * 0.09 * uDay;
    // Low-altitude mist band: bleaches the horizon so peaks sit in air.
    float mist = exp(-abs(d.y - 0.015) * 26.0);
    sky = mix(sky, uHorizon * 1.05, mist * 0.22 * (0.35 + 0.65 * uDay));

    gl_FragColor = vec4(sky, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const PALETTE = {
  nightZenith: new THREE.Color('#04060d'),
  nightHorizon: new THREE.Color('#0b1422'),
  nightGround: new THREE.Color('#05090e'),
  twilightZenith: new THREE.Color('#20305a'),
  twilightHorizon: new THREE.Color('#ff9a62'),
  twilightGround: new THREE.Color('#2a1b20'),
  dayZenith: new THREE.Color('#2a61bd'),
  dayHorizon: new THREE.Color('#cfe9f9'),
  dayGround: new THREE.Color('#5d6b57'),
  cloudNight: new THREE.Color('#18202d'),
  cloudDay: new THREE.Color('#fbfdff'),
  cloudSunset: new THREE.Color('#ffc09a'),
  sunLow: new THREE.Color('#ff9a52'),
  sunHigh: new THREE.Color('#fff4da'),
  moon: new THREE.Color('#9fbcff'),
  gold: new THREE.Color('#ffd98a'),
};

export class Sky {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} settings
   */
  constructor(scene, renderer, settings) {
    this.scene = scene;
    this.renderer = renderer;
    this.settings = settings;
    this.timeOfDay = WORLD.startHour;
    this.dayFactor = 1;
    this.nightFactor = 0;
    this.restored = false;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.horizonColor = new THREE.Color('#c2e0f4');
    this.fogColor = new THREE.Color('#c2e0f4');

    this.uniforms = {
      uZenith: { value: new THREE.Color('#2f6fc4') },
      uHorizon: { value: new THREE.Color('#c2e0f4') },
      uGround: { value: new THREE.Color('#5c6a58') },
      uSunColor: { value: new THREE.Color('#fff4da') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uCloudColor: { value: new THREE.Color('#f7fbff') },
      uDay: { value: 1 },
      uTime: { value: 0 },
      uRestored: { value: 0 },
    };

    const geometry = new THREE.SphereGeometry(3200, 48, 28);
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    scene.background = new THREE.Color('#05080c');
    this.fog = new THREE.FogExp2(0x9fbfd4, 0.0014);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x3b4a2a, 0.5);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff3d6, 2.6);
    // 80m box follows the player so shadows stay crisp everywhere on
    // the 10600m island; wide enough that tree shadows survive past the
    // immediate clearing instead of vanishing at the frustum edge.
    // Frustum follows player in _refresh; bias/normalBias tuned to kill
    // acne without peter-panning the contact shadow.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(settings?.shadowMapSize ?? 2048, settings?.shadowMapSize ?? 2048);
    this.sun.shadow.camera.left = -80;
    this.sun.shadow.camera.right = 80;
    this.sun.shadow.camera.top = 80;
    this.sun.shadow.camera.bottom = -80;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 520;
    this.sun.shadow.bias = -0.00042;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2.2;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(PALETTE.moon, 0.35);
    this.moon.target = this.sun.target;
    scene.add(this.moon);

    // Image-based lighting so metals (gold, crystal) and standard
    // materials reflect something instead of going flat dark. Low
    // intensity keeps the outdoor sun-keyed look.
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTex;
      scene.environmentIntensity = 0.35;
      pmrem.dispose();
    } catch { /* environment is a bonus, never a boot failure */ }

    this._tmpColor = new THREE.Color();
    this._zenith = new THREE.Color();
    this._horizon = new THREE.Color();
    this._ground = new THREE.Color();
    this._cloud = new THREE.Color();
    this._sunColor = new THREE.Color();

    this.setTimeOfDay(this.timeOfDay);
  }

  /** Jump to a specific hour without advancing. */
  setTimeOfDay(hours) {
    this.timeOfDay = ((hours % 24) + 24) % 24;
    this._refresh(0, new THREE.Vector3(), new THREE.Vector3(), false);
  }

  /** Mark the beacon as restored (adds aurora + warmth). */
  setRestored(value) {
    this.restored = Boolean(value);
    this.uniforms.uRestored.value = this.restored ? 1 : 0;
  }

  /** Current sun direction (unit vector). */
  getSunDirection() {
    return this.sunDirection;
  }

  /**
   * Advance the clock and refresh every lighting value.
   * @param {number} dt
   * @param {THREE.Vector3} cameraPos
   * @param {THREE.Vector3} playerPos
   * @param {boolean} [advance=true]
   */
  update(dt, cameraPos, playerPos, advance = true) {
    this.uniforms.uTime.value += dt;
    if (advance) {
      this.timeOfDay = (this.timeOfDay + (dt / WORLD.dayLength) * 24) % 24;
    }
    this._refresh(dt, cameraPos, playerPos, advance);
  }

  _refresh(dt, cameraPos, playerPos, advance) {
    const angle = (this.timeOfDay / 24 - 0.25) * TAU;
    this.sunDirection.set(Math.cos(angle) * 0.92, Math.sin(angle), 0.3).normalize();

    const elev = this.sunDirection.y;
    const day = smoothstep(-0.05, 0.22, elev);
    const twilight = clamp(smoothstep(-0.28, 0.04, elev) * (1 - day) * 1.1, 0, 1);
    this.dayFactor = day;
    this.nightFactor = 1 - day;

    const zenith = this._zenith.copy(PALETTE.nightZenith).lerp(PALETTE.dayZenith, day);
    zenith.lerp(PALETTE.twilightZenith, twilight * 0.7);
    const horizon = this._horizon.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, day);
    horizon.lerp(PALETTE.twilightHorizon, twilight * 0.85);
    const ground = this._ground.copy(PALETTE.nightGround).lerp(PALETTE.dayGround, day);
    const cloud = this._cloud.copy(PALETTE.cloudNight).lerp(PALETTE.cloudDay, day);
    cloud.lerp(PALETTE.cloudSunset, twilight * 0.9);
    const sunColor = this._sunColor.copy(PALETTE.sunLow).lerp(PALETTE.sunHigh, smoothstep(0.02, 0.45, elev));

    if (this.restored) {
      horizon.lerp(PALETTE.gold, 0.08 * day);
      cloud.lerp(PALETTE.gold, 0.06);
    }

    this.horizonColor.copy(horizon);
    this.uniforms.uZenith.value.copy(zenith);
    this.uniforms.uHorizon.value.copy(horizon);
    this.uniforms.uGround.value.copy(ground);
    this.uniforms.uCloudColor.value.copy(cloud);
    this.uniforms.uSunColor.value.copy(sunColor);
    this.uniforms.uSunDir.value.copy(this.sunDirection);
    this.uniforms.uDay.value = day;

    this.fog.color.copy(horizon).lerp(ground, 0.28);
    this.fogColor.copy(this.fog.color);
    // Day haze ~0.00062: distant peaks stay grey-blue rock instead of
    // dissolving into the horizon colour.
    this.fog.density = 0.00078 - 0.00016 * day + 0.00015 * twilight;

    this.hemi.color.copy(zenith);
    this.hemi.groundColor.copy(ground);
    this.hemi.intensity = 0.2 + 0.62 * day + 0.16 * twilight;

    this.sun.color.copy(sunColor);
    this.sun.intensity = 2.9 * day + 0.3 * twilight;
    this.moon.intensity = 0.46 * (1 - day);

    const snap = 4;
    const px = Math.round(playerPos.x / snap) * snap;
    const pz = Math.round(playerPos.z / snap) * snap;
    const py = playerPos.y;
    this.sun.position.set(px + this.sunDirection.x * 280, py + this.sunDirection.y * 280, pz + this.sunDirection.z * 280);
    this.sun.target.position.set(px, py, pz);
    this.sun.target.updateMatrixWorld();
    this.moon.position.set(px - this.sunDirection.x * 220, py + 180, pz - this.sunDirection.z * 220);
    this.moon.target.updateMatrixWorld();

    this.mesh.position.copy(cameraPos);
  }

  /** Apply a new quality preset. */
  setQuality(settings) {
    const size = settings?.shadowMapSize ?? 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.sun.castShadow = Boolean(settings?.shadows);
  }
}
