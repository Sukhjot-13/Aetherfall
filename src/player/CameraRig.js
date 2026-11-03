/**
 * Camera rig: third-person orbit with terrain/collider collision, first-person
 * eye view, cinematic title/finale orbits, trauma-based shake and speed FOV.
 */

import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../util/math.js';
import {
  CAMERA_MODES,
  THIRD_PERSON,
  applyLook,
  clampDistance,
  createCameraState,
  firstPersonPosition,
  lookDirection,
  thirdPersonPosition,
  toggleCameraMode,
} from './cameraLogic.js';

export class CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {any} world
   * @param {object} settings
   */
  constructor(camera, world, settings) {
    this.camera = camera;
    this.world = world;
    this.settings = settings;
    this.state = createCameraState(settings?.cameraMode === 'first' ? CAMERA_MODES.FIRST : CAMERA_MODES.THIRD);
    this.baseFov = settings?.fov ?? 72;
    this.trauma = 0;
    this.dip = 0;
    this.cinematic = { active: false, focus: new THREE.Vector3(), angle: 0, radius: 34, height: 12, speed: 0.12 };
    this.position = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._initialised = false;
  }

  /** Current view mode. */
  get mode() {
    return this.state.mode;
  }

  /** True when the player body should be hidden. */
  get firstPerson() {
    return this.state.mode === CAMERA_MODES.FIRST;
  }

  /** Switch view mode and snap the rig. */
  setMode(mode) {
    this.state.mode = mode === CAMERA_MODES.FIRST ? CAMERA_MODES.FIRST : CAMERA_MODES.THIRD;
    this._initialised = false;
    return this.state.mode;
  }

  /** Toggle between first and third person. */
  toggle() {
    return this.setMode(toggleCameraMode(this.state.mode));
  }

  /** Force the rig to re-place itself next update (teleport / respawn). */
  snap() {
    this._initialised = false;
  }

  /** Apply mouse deltas from the input layer. */
  look(dx, dy, sensitivity = 1, invertY = false) {
    if (this.cinematic.active) return;
    applyLook(this.state, dx, dy, 0.0022 * sensitivity, invertY);
  }

  /** Zoom the third-person camera. */
  zoom(delta) {
    this.state.distance = clampDistance(this.state.distance + Math.sign(delta) * 0.6);
  }

  /** Add screen shake. `amount` 0..1. */
  addShake(amount) {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  /** Camera dip on a heavy touchdown. `force` is 0..1. */
  land(force = 0.4) {
    const f = clamp(force, 0, 1);
    this.dip = Math.max(this.dip, 0.12 + f * 0.42);
    this.addShake(0.06 + f * 0.18);
  }

  /** Start/stop the cinematic orbit used by the title and finale. */
  setCinematic(active, focus, opts = {}) {
    this.cinematic.active = active;
    if (focus) this.cinematic.focus.copy(focus);
    if (opts.radius) this.cinematic.radius = opts.radius;
    if (opts.height) this.cinematic.height = opts.height;
    if (opts.speed) this.cinematic.speed = opts.speed;
    if (active) {
      this.cinematic.angle = Math.atan2(
        this.position.x - this.cinematic.focus.x,
        this.position.z - this.cinematic.focus.z,
      );
      this.trauma = 0;
    }
  }

  /**
   * Per-frame camera update.
   * @param {number} dt
   * @param {{position:THREE.Vector3, speed:number}} player
   */
  update(dt, player) {
    const cam = this.camera;

    if (this.cinematic.active) {
      this.cinematic.angle += dt * this.cinematic.speed;
      const c = this.cinematic;
      const ground = this.world.heightAt(c.focus.x, c.focus.z);
      const targetY = Math.max(c.focus.y, ground) + c.height;
      this.position.set(
        c.focus.x + Math.sin(c.angle) * c.radius,
        targetY + Math.sin(c.angle * 0.7) * 2.2,
        c.focus.z + Math.cos(c.angle) * c.radius,
      );
      this._look.set(c.focus.x, Math.max(c.focus.y, ground) + 3.2, c.focus.z);
      cam.position.copy(this.position);
      cam.lookAt(this._look);
      cam.fov = damp(cam.fov, this.baseFov - 6, 3, dt);
      cam.updateProjectionMatrix();
      this._initialised = true;
      this.trauma = Math.max(0, this.trauma - dt * 1.5);
      return;
    }

    const speed = player?.speed ?? 0;
    const sprinting = speed > 8.2;
    const dodging = Boolean(player?.dodging);
    const targetFov = this.baseFov + smoothstep(4, 12, speed) * 5 + (sprinting ? 2 : 0) + (dodging ? 7 : 0);
    cam.fov = damp(cam.fov, targetFov, 4, dt);
    cam.updateProjectionMatrix();

    this.dip = damp(this.dip, 0, 8, dt);

    const p = player?.position ?? this.target;
    const velocity = player?.velocity;
    const leadScale = Math.min(1.15, Math.max(0, (speed - 2.2) * 0.085));
    const leadX = velocity && speed > 0.01 ? (velocity.x / speed) * leadScale : 0;
    const leadZ = velocity && speed > 0.01 ? (velocity.z / speed) * leadScale : 0;

    if (this.state.mode === CAMERA_MODES.FIRST) {
      const eye = firstPersonPosition(p, 1.66);
      this._desired.set(eye.x + leadX * 0.35, eye.y - this.dip * 0.55, eye.z + leadZ * 0.35);
      if (!this._initialised) this.position.copy(this._desired);
      else {
        this.position.x = damp(this.position.x, this._desired.x, 26, dt);
        this.position.z = damp(this.position.z, this._desired.z, 26, dt);
        this.position.y = damp(this.position.y, this._desired.y, 22, dt);
      }
      cam.position.copy(this.position);
      const dir = lookDirection(this.state.yaw, this.state.pitch);
      this._look.copy(this.position).add(this._dir.set(dir.x, dir.y, dir.z).multiplyScalar(10));
      cam.lookAt(this._look);
      this._applyShake(dt);
      this._initialised = true;
      return;
    }

    // Third person: orbit around a head-height pivot that leads the player's
    // momentum, with a small boom extension at speed.
    this.target.set(p.x + leadX * 0.55, p.y + THIRD_PERSON.height * 0.82 - this.dip * 0.55, p.z + leadZ * 0.55);
    const boom = this.state.distance
      + clamp((speed - 4) * 0.045, 0, 0.85)
      + (dodging ? 0.45 : 0);
    const desired = thirdPersonPosition(
      { x: p.x + leadX * 0.35, y: p.y + 0.25, z: p.z + leadZ * 0.35 },
      { yaw: this.state.yaw, pitch: this.state.pitch, distance: boom },
      { height: THIRD_PERSON.height, shoulder: THIRD_PERSON.shoulder },
    );
    this._desired.set(desired.x, desired.y - this.dip * 0.3, desired.z);

    const safe = this._collide(this.target, this._desired);
    if (!this._initialised) this.position.copy(safe);
    else {
      this.position.x = damp(this.position.x, safe.x, 18, dt);
      this.position.y = damp(this.position.y, safe.y, 14, dt);
      this.position.z = damp(this.position.z, safe.z, 18, dt);
    }
    cam.position.copy(this.position);
    this._look.copy(this.target);
    this._look.y += 0.35;
    cam.lookAt(this._look);
    this._applyShake(dt);
    this._initialised = true;
  }

  /**
   * Keep the camera out of terrain and solid props by shortening the boom.
   * @param {THREE.Vector3} pivot
   * @param {THREE.Vector3} desired
   */
  _collide(pivot, desired) {
    const dx = desired.x - pivot.x;
    const dy = desired.y - pivot.y;
    const dz = desired.z - pivot.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.001) return desired;

    let allowed = length;
    const steps = 14;
    for (let i = 2; i <= steps; i++) {
      const t = i / steps;
      const x = pivot.x + dx * t;
      const y = pivot.y + dy * t;
      const z = pivot.z + dz * t;
      const ground = this.world.heightAt(x, z) + 0.55;
      if (y < ground) {
        allowed = Math.max(1.1, length * (i - 1) / steps);
        break;
      }
    }

    // Prop colliders: push the camera to the near side of any blocking circle.
    const colliders = this.world.colliders ?? [];
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const cx = c.x - pivot.x;
      const cz = c.z - pivot.z;
      const along = (cx * dx + cz * dz) / (length * length);
      if (along < 0.12 || along > 1.1) continue;
      const px = pivot.x + dx * along;
      const pz = pivot.z + dz * along;
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < c.r + 0.45) {
        allowed = Math.min(allowed, Math.max(1.1, length * along - 0.6));
      }
    }

    const t = allowed / length;
    return this._tmp.set(pivot.x + dx * t, pivot.y + dy * t, pivot.z + dz * t).clone();
  }

  /** Trauma-driven positional/rotational shake. */
  _applyShake(dt) {
    if (this.trauma <= 0.001) {
      this.trauma = 0;
      return;
    }
    const shake = this.trauma * this.trauma;
    const t = performance.now() * 0.001;
    const cam = this.camera;
    cam.position.x += Math.sin(t * 41.3) * shake * 0.32;
    cam.position.y += Math.sin(t * 37.7 + 1.7) * shake * 0.26;
    cam.position.z += Math.sin(t * 44.1 + 3.1) * shake * 0.32;
    cam.rotateZ(Math.sin(t * 29.7) * shake * 0.022);
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
  }

  /** Serialisable view state for saves. */
  serialize() {
    return { mode: this.state.mode };
  }

  /** Restore view mode from a save. */
  restore(mode) {
    this.setMode(mode);
  }
}
