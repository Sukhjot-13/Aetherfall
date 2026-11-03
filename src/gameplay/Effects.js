/**
 * Pooled visual effects: spark particles, expanding rings, beams, floating
 * damage numbers and short-lived lights. Everything is preallocated so combat
 * never triggers a garbage-collection spike.
 */

import * as THREE from 'three';
import { clamp } from '../util/math.js';
import { createGlowTexture } from '../world/textures.js';

const FLASH_TEX = createGlowTexture(128, 'rgba(255, 255, 255, 1)', 'rgba(255, 255, 255, 0)');

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (340.0 / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.06, d);
    float a = core * core * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const RING_GEO = new THREE.RingGeometry(0.72, 1, 72, 1);
const BEAM_GEO = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {{particles?:number, rings?:number, beams?:number, numbers?:number, lights?:number}} [opts]
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    /** Optional camera used to keep close-range flashes from whiting out the view. */
    this.camera = opts.camera ?? null;
    this.capacity = opts.particles ?? 1400;

    // --- particles -------------------------------------------------------
    const positions = new Float32Array(this.capacity * 3);
    const colors = new Float32Array(this.capacity * 3);
    const sizes = new Float32Array(this.capacity);
    const alphas = new Float32Array(this.capacity);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setDrawRange(0, this.capacity);

    const material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.name = 'FX.Particles';
    scene.add(this.points);

    this.positions = positions;
    this.colors = colors;
    this.sizes = sizes;
    this.alphas = alphas;
    this.vel = new Float32Array(this.capacity * 3);
    this.life = new Float32Array(this.capacity);
    this.maxLife = new Float32Array(this.capacity);
    this.gravity = new Float32Array(this.capacity);
    this.drag = new Float32Array(this.capacity);
    this.cursor = 0;
    this.activeParticles = 0;

    // --- rings -----------------------------------------------------------
    this.rings = [];
    const ringCount = opts.rings ?? 28;
    for (let i = 0; i < ringCount; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(RING_GEO, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, radius: 1, from: 0.2, tilt: 0 });
    }
    this.ringCursor = 0;

    // --- beams -----------------------------------------------------------
    this.beams = [];
    const beamCount = opts.beams ?? 14;
    for (let i = 0; i < beamCount; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(BEAM_GEO, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      this.beams.push({ mesh, life: 0, maxLife: 0.3, width: 0.2 });
    }
    this.beamCursor = 0;

    // --- damage numbers --------------------------------------------------
    this.numbers = [];
    const numberCount = opts.numbers ?? 16;
    for (let i = 0; i < numberCount; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 20;
      sprite.scale.set(2.2, 1.1, 1);
      scene.add(sprite);
      this.numbers.push({ sprite, ctx, texture, life: 0, maxLife: 1, vy: 2.4, vx: 0 });
    }
    this.numberCursor = 0;

    // --- billboard flashes ------------------------------------------------
    this.flashes = [];
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: FLASH_TEX,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sprite.visible = false;
      sprite.renderOrder = 7;
      scene.add(sprite);
      this.flashes.push({ sprite, life: 0, maxLife: 0.3, size: 2, growth: 1.8 });
    }
    this.flashCursor = 0;

    // --- transient lights ------------------------------------------------
    this.lights = [];
    const lightCount = opts.lights ?? 6;
    for (let i = 0; i < lightCount; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 2);
      light.visible = false;
      scene.add(light);
      this.lights.push({ light, life: 0, maxLife: 1, peak: 0 });
    }
    this.lightCursor = 0;

    this._color = new THREE.Color();
    this._vec = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /**
   * Emit a spray of sparks.
   * @param {THREE.Vector3} position
   * @param {{count?:number, color?:string|number, speed?:number, size?:number, life?:number, gravity?:number, spread?:number, direction?:THREE.Vector3, drag?:number, jitter?:number}} [opts]
   */
  burst(position, opts = {}) {
    const count = Math.max(1, Math.round(opts.count ?? 14));
    const color = this._color.set(opts.color ?? '#ffb066');
    const speed = opts.speed ?? 4;
    const size = opts.size ?? 0.4;
    const life = opts.life ?? 0.7;
    const gravity = opts.gravity ?? 3;
    const drag = opts.drag ?? 1.6;
    const jitter = opts.jitter ?? 0.18;
    const dir = opts.direction;
    const spread = opts.spread ?? 1;

    for (let i = 0; i < count; i++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const i3 = index * 3;

      this.positions[i3] = position.x + (Math.random() - 0.5) * jitter;
      this.positions[i3 + 1] = position.y + (Math.random() - 0.5) * jitter;
      this.positions[i3 + 2] = position.z + (Math.random() - 0.5) * jitter;

      let vx;
      let vy;
      let vz;
      if (dir) {
        const s = speed * (0.45 + Math.random() * 0.75);
        vx = dir.x * s + (Math.random() - 0.5) * speed * spread;
        vy = dir.y * s + (Math.random() - 0.5) * speed * spread + speed * 0.12;
        vz = dir.z * s + (Math.random() - 0.5) * speed * spread;
      } else {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(1 - Math.random() * 1.35);
        const s = speed * (0.35 + Math.random() * 0.9);
        vx = Math.sin(phi) * Math.cos(theta) * s;
        vy = Math.cos(phi) * s + speed * 0.28;
        vz = Math.sin(phi) * Math.sin(theta) * s;
      }
      this.vel[i3] = vx;
      this.vel[i3 + 1] = vy;
      this.vel[i3 + 2] = vz;

      const tint = 0.78 + Math.random() * 0.45;
      this.colors[i3] = color.r * tint;
      this.colors[i3 + 1] = color.g * tint;
      this.colors[i3 + 2] = color.b * tint;

      this.sizes[index] = size * (0.65 + Math.random() * 0.8);
      this.alphas[index] = 1;
      this.life[index] = life * (0.7 + Math.random() * 0.6);
      this.maxLife[index] = this.life[index];
      this.gravity[index] = gravity;
      this.drag[index] = drag;
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aColor.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }

  /**
   * Expanding ground (or tilted) ring.
   * @param {THREE.Vector3} position
   * @param {{color?:string|number, radius?:number, from?:number, life?:number, tilt?:number, opacity?:number}} [opts]
   */
  ring(position, opts = {}) {
    const entry = this.rings[this.ringCursor];
    this.ringCursor = (this.ringCursor + 1) % this.rings.length;
    const mesh = entry.mesh;
    mesh.position.copy(position);
    mesh.position.y += 0.06;
    mesh.rotation.set(opts.tilt ?? -Math.PI / 2, 0, Math.random() * Math.PI);
    mesh.material.color.set(opts.color ?? '#ffe9a8');
    mesh.material.opacity = opts.opacity ?? 0.85;
    mesh.visible = true;
    entry.radius = opts.radius ?? 6;
    entry.from = opts.from ?? 0.18;
    entry.life = opts.life ?? 0.55;
    entry.maxLife = entry.life;
    entry.opacity = opts.opacity ?? 0.85;
    const s = entry.radius * entry.from;
    mesh.scale.set(s, s, s);
  }

  /**
   * A short-lived beam from A to B.
   * @param {THREE.Vector3} from
   * @param {THREE.Vector3} to
   * @param {{color?:string|number, width?:number, life?:number}} [opts]
   */
  beam(from, to, opts = {}) {
    const entry = this.beams[this.beamCursor];
    this.beamCursor = (this.beamCursor + 1) % this.beams.length;
    const mesh = entry.mesh;
    const dir = this._vec.subVectors(to, from);
    const length = dir.length();
    if (length < 0.001) return;
    dir.normalize();
    mesh.position.copy(from).addScaledVector(dir, length * 0.5);
    mesh.quaternion.setFromUnitVectors(this._up, dir);
    const width = opts.width ?? 0.22;
    mesh.scale.set(width, length, width);
    mesh.material.color.set(opts.color ?? '#b48cff');
    mesh.material.opacity = 1;
    mesh.visible = true;
    entry.life = opts.life ?? 0.28;
    entry.maxLife = entry.life;
    entry.width = width;
  }

  /**
   * Floating combat number.
   * @param {THREE.Vector3} position
   * @param {string|number} value
   * @param {{color?:string, size?:number, crit?:boolean, label?:string}} [opts]
   */
  damageNumber(position, value, opts = {}) {
    const entry = this.numbers[this.numberCursor];
    this.numberCursor = (this.numberCursor + 1) % this.numbers.length;
    const { ctx, texture, sprite } = entry;
    const color = opts.color ?? '#ffe9a8';
    const text = String(value);
    ctx.clearRect(0, 0, 160, 80);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(4,7,10,0.85)';
    ctx.font = `700 ${opts.crit ? 46 : 38}px -apple-system, "Segoe UI", sans-serif`;
    ctx.strokeText(text, 80, 42);
    ctx.fillStyle = color;
    ctx.fillText(text, 80, 42);
    texture.needsUpdate = true;

    sprite.position.copy(position);
    sprite.position.x += (Math.random() - 0.5) * 0.6;
    sprite.position.y += 1.4;
    const w = opts.crit ? 2.9 : 2.1;
    sprite.scale.set(w, opts.crit ? 1.45 : 1.05, 1);
    sprite.material.opacity = 1;
    sprite.visible = true;
    entry.life = opts.crit ? 1.15 : 0.9;
    entry.maxLife = entry.life;
    entry.vx = (Math.random() - 0.5) * 1.2;
    entry.vy = opts.crit ? 3.1 : 2.4;
    entry.baseScaleX = w;
    entry.baseScaleY = sprite.scale.y;
  }

  /**
   * Flash a point light.
   * @param {THREE.Vector3} position
   * @param {{color?:string|number, intensity?:number, distance?:number, life?:number}} [opts]
   */
  light(position, opts = {}) {
    const entry = this.lights[this.lightCursor];
    this.lightCursor = (this.lightCursor + 1) % this.lights.length;
    entry.light.position.copy(position);
    entry.light.color.set(opts.color ?? '#ffd98a');
    entry.light.distance = opts.distance ?? 20;
    entry.peak = opts.intensity ?? 6;
    entry.light.intensity = entry.peak;
    entry.light.visible = true;
    entry.life = opts.life ?? 0.4;
    entry.maxLife = entry.life;
  }

  /**
   * A soft camera-facing flash (muzzle blast / detonation core).
   * @param {THREE.Vector3} position
   * @param {{color?:string|number, size?:number, life?:number, growth?:number, opacity?:number}} [opts]
   */
  flash(position, opts = {}) {
    const entry = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    const sprite = entry.sprite;
    sprite.position.copy(position);
    sprite.material.color.set(opts.color ?? '#ffe9a8');
    sprite.material.opacity = opts.opacity ?? 1;
    sprite.scale.setScalar((opts.size ?? 3) * 0.35);
    sprite.visible = true;
    entry.life = opts.life ?? 0.28;
    entry.maxLife = entry.life;
    entry.size = opts.size ?? 3;
    entry.growth = opts.growth ?? 2.1;
    entry.peak = opts.opacity ?? 1;
  }

  /** Advance every effect. */
  update(dt) {
    // Particles.
    let anyAlive = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      const i3 = i * 3;
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - this.gravity[i] * dt;
      this.vel[i3 + 2] *= drag;
      this.positions[i3] += this.vel[i3] * dt;
      this.positions[i3 + 1] += this.vel[i3 + 1] * dt;
      this.positions[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alphas[i] = clamp(t * 1.6, 0, 1);
    }
    if (anyAlive) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.aAlpha.needsUpdate = true;
    }

    // Rings.
    for (const entry of this.rings) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = 1 - Math.max(0, entry.life) / entry.maxLife;
      const eased = 1 - Math.pow(1 - t, 3);
      const s = entry.radius * (entry.from + (1 - entry.from) * eased);
      entry.mesh.scale.set(s, s, s);
      entry.mesh.material.opacity = (entry.opacity ?? 0.85) * (1 - t) ** 1.5;
      if (entry.life <= 0) entry.mesh.visible = false;
    }

    // Beams.
    for (const entry of this.beams) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = 1 - Math.max(0, entry.life) / entry.maxLife;
      entry.mesh.material.opacity = (1 - t) ** 1.3;
      const w = entry.width * (1 - t * 0.55);
      entry.mesh.scale.x = w;
      entry.mesh.scale.z = w;
      if (entry.life <= 0) entry.mesh.visible = false;
    }

    // Flashes.
    const cam = this.camera;
    for (const entry of this.flashes) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = 1 - Math.max(0, entry.life) / entry.maxLife;
      const scale = entry.size * (0.35 + entry.growth * (1 - Math.pow(1 - t, 2)));
      entry.sprite.scale.setScalar(scale);
      let opacity = (entry.peak ?? 1) * (1 - t) ** 1.6;
      // A big additive sprite sitting a couple of metres from the lens fills the
      // whole frame and bloom turns it into a white-out. Fade aggressively by
      // proximity: first-person muzzle flashes stay readable instead of turning
      // the screen into a white ball.
      if (cam) {
        const dist = entry.sprite.position.distanceTo(cam.position);
        const near = clamp((dist - 1.2) / (scale * 2.4 + 0.001), 0, 1);
        opacity *= 0.06 + 0.94 * near * near;
      }
      entry.sprite.material.opacity = opacity;
      if (entry.life <= 0) entry.sprite.visible = false;
    }

    // Damage numbers.
    for (const entry of this.numbers) {      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = 1 - Math.max(0, entry.life) / entry.maxLife;
      entry.sprite.position.y += entry.vy * dt;
      entry.sprite.position.x += entry.vx * dt;
      entry.vy -= 3.4 * dt;
      entry.sprite.material.opacity = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
      const pop = 1 + Math.max(0, 0.14 - t) * 2.2;
      entry.sprite.scale.set(entry.baseScaleX * pop, entry.baseScaleY * pop, 1);
      if (entry.life <= 0) entry.sprite.visible = false;
    }

    // Lights.
    for (const entry of this.lights) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      const t = Math.max(0, entry.life) / entry.maxLife;
      entry.light.intensity = entry.peak * t * t;
      if (entry.life <= 0) entry.light.visible = false;
    }
  }

  /** Reset everything (new game / title). */
  clear() {
    for (let i = 0; i < this.capacity; i++) {
      this.life[i] = 0;
      this.alphas[i] = 0;
    }
    for (const entry of this.rings) {
      entry.life = 0;
      entry.mesh.visible = false;
    }
    for (const entry of this.beams) {
      entry.life = 0;
      entry.mesh.visible = false;
    }
    for (const entry of this.numbers) {
      entry.life = 0;
      entry.sprite.visible = false;
    }
    for (const entry of this.flashes) {
      entry.life = 0;
      entry.sprite.visible = false;
    }
    for (const entry of this.lights) {
      entry.life = 0;
      entry.light.visible = false;
    }
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
