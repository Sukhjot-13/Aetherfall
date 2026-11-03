/**
 * Story characters: the Wisp (a floating aether companion that follows the
 * player) and Sable, the last Keeper, waiting at Emberfall Camp.
 */

import * as THREE from 'three';
import { damp, dampAngle } from '../util/math.js';
import { LOCATIONS } from '../world/locations.js';
import { createGlowTexture } from '../world/textures.js';

const GLOW = createGlowTexture(96, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');

function toon(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
}

const MAT = {
  skin: toon('#c98f63'),
  hair: toon('#cfd3d8'),
  cloak: toon('#3f4a5c'),
  cloakDark: toon('#2a3242'),
  trim: toon('#c9a95c'),
  wood: toon('#6b4a2f'),
  boot: toon('#3a2b22'),
  eye: new THREE.MeshBasicMaterial({ color: '#1a1410' }),
};

export class NPCs {
  /**
   * @param {{scene:THREE.Scene, world:any, player:any, structures:any, audio:any}} deps
   */
  constructor({ scene, world, player, structures, audio }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.structures = structures;
    this.audio = audio;

    this.group = new THREE.Group();
    this.group.name = 'NPCs';
    scene.add(this.group);

    /** @type {Array<any>} */
    this.npcs = [];
    this._buildWisp();
    this._buildSable();
  }

  _buildWisp() {
    const group = new THREE.Group();
    group.name = 'Wisp';
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.17, 1),
      new THREE.MeshBasicMaterial({ color: '#eafffb' }),
    );
    group.add(core);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: GLOW,
        color: '#8ef2e0',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.scale.setScalar(1.15);
    group.add(halo);

    const motes = [];
    for (let i = 0; i < 4; i++) {
      const mote = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW,
          color: '#b6f2e8',
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      mote.scale.setScalar(0.16);
      group.add(mote);
      motes.push(mote);
    }

    const light = new THREE.PointLight('#8ef2e0', 0.85, 9, 2);
    group.add(light);

    const start = new THREE.Vector3(LOCATIONS.spawn.x + 2.4, 0, LOCATIONS.spawn.z - 3.2);
    start.y = this.world.heightAt(start.x, start.z) + 1.9;
    group.position.copy(start);
    this.group.add(group);

    this.wisp = {
      id: 'wisp',
      name: 'Wisp',
      group,
      position: group.position,
      radius: 3.2,
      core,
      halo,
      motes,
      light,
      phase: 0,
      target: start.clone(),
      talking: false,
    };
    this.npcs.push(this.wisp);
  }

  _buildSable() {
    const spot = this.structures?.sableSpot;
    const x = spot?.x ?? LOCATIONS.camp.x + 4.5;
    const z = spot?.z ?? LOCATIONS.camp.z + 3.2;
    const y = this.world.heightAt(x, z);

    const group = new THREE.Group();
    group.name = 'Sable';
    group.position.set(x, y, z);

    const body = new THREE.Group();
    body.position.y = 0.9;
    group.add(body);
    this.sableBody = body;

    // Long keeper's cloak.
    const cloak = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.46, 1.05, 9, 1, true), MAT.cloak);
    cloak.position.y = 0.1;
    cloak.castShadow = true;
    body.add(cloak);
    const shoulders = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.3, 9), MAT.cloakDark);
    shoulders.position.y = 0.62;
    shoulders.castShadow = true;
    body.add(shoulders);

    // Trim and belt.
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 5, 14), MAT.trim);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.74;
    body.add(trim);

    // Head.
    const head = new THREE.Group();
    head.position.y = 0.92;
    body.add(head);
    this.sableHead = head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), MAT.skin);
    skull.castShadow = true;
    head.add(skull);
    // Hair pulled back.
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.178, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.7), MAT.hair);
    hair.position.y = 0.03;
    head.add(hair);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), MAT.hair);
    bun.position.set(0, 0.12, 0.15);
    head.add(bun);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), MAT.eye);
      eye.position.set(side * 0.06, 0.01, -0.155);
      head.add(eye);
    }

    // Arms.
    const makeArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.28, 0.6, 0);
      body.add(shoulder);
      const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.34, 4, 7), MAT.cloak);
      sleeve.position.y = -0.2;
      sleeve.castShadow = true;
      shoulder.add(sleeve);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), MAT.skin);
      hand.position.y = -0.42;
      shoulder.add(hand);
      return { shoulder, hand };
    };
    this.sableArmL = makeArm(-1);
    this.sableArmR = makeArm(1);
    this.sableArmL.shoulder.rotation.z = 0.12;
    this.sableArmR.shoulder.rotation.z = -0.12;
    this.sableArmR.shoulder.rotation.x = -0.32;

    // Staff.
    const staff = new THREE.Group();
    staff.position.set(0.02, -0.44, -0.02);
    this.sableArmR.hand.add(staff);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 1.7, 6), MAT.wood);
    shaft.position.y = 0.5;
    shaft.castShadow = true;
    staff.add(shaft);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.02, 5, 12),
      new THREE.MeshStandardMaterial({ color: '#c9a95c', metalness: 0.6, roughness: 0.4 }),
    );
    ring.position.y = 1.36;
    staff.add(ring);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.07, 0),
      new THREE.MeshStandardMaterial({ color: '#7a4a12', emissive: '#ffcf8a', emissiveIntensity: 1.6 }),
    );
    gem.position.y = 1.36;
    staff.add(gem);
    this.sableGem = gem;

    // Camp stool.
    const stool = new THREE.Group();
    stool.position.set(0.5, 0, 0.2);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 8), MAT.wood);
    seat.position.y = 0.44;
    stool.add(seat);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 5), MAT.wood);
      leg.position.set(Math.cos(a) * 0.16, 0.22, Math.sin(a) * 0.16);
      leg.rotation.z = Math.cos(a) * 0.16;
      leg.rotation.x = -Math.sin(a) * 0.16;
      stool.add(leg);
    }
    group.add(stool);

    this.group.add(group);

    this.sable = {
      id: 'sable',
      name: 'Sable',
      group,
      position: group.position,
      radius: 3.0,
      head,
      body,
      phase: Math.random() * Math.PI * 2,
      talking: false,
    };
    this.npcs.push(this.sable);
  }

  /** Get an NPC by id. */
  get(id) {
    return this.npcs.find((n) => n.id === id) ?? null;
  }

  /**
   * Closest NPC within interaction range.
   * @param {THREE.Vector3} position
   * @param {number} [maxDist]
   */
  nearest(position, maxDist = 5) {
    let best = null;
    let bestDist = maxDist;
    for (const npc of this.npcs) {
      const d = Math.hypot(npc.position.x - position.x, npc.position.z - position.z);
      if (d < npc.radius && d < bestDist) {
        best = npc;
        bestDist = d;
      }
    }
    return best;
  }

  /** Point the Wisp toward a position (used during cutscenes). */
  moveWispTo(position) {
    if (this.wisp) this.wisp.target.copy(position);
  }

  /**
   * @param {number} dt
   * @param {number} elapsed
   * @param {THREE.Vector3} playerPos
   */
  update(dt, elapsed, playerPos) {
    const flying = Boolean(this.player?.fly);
    const wisp = this.wisp;
    if (wisp) {
      wisp.phase += dt;
      // The Wisp is a companion, not an attachment. It keeps its own altitude
      // and only starts drifting toward you once you have left it behind, so it
      // reads as a creature living in the world rather than a bubble glued to
      // the camera. Standoff is generous enough that it never crowds the view.
      const dx = playerPos.x - wisp.position.x;
      const dz = playerPos.z - wisp.position.z;
      const dist = Math.hypot(dx, dz);
      const ground = this.world.heightAt(wisp.position.x, wisp.position.z);
      const targetY = ground + 2.15 + Math.sin(elapsed * 0.9 + wisp.phase * 0.3) * 0.35;

      if (dist > 6.2 && !flying) {
        const standoff = 3.9;
        const tx = playerPos.x - (dx / dist) * standoff;
        const tz = playerPos.z - (dz / dist) * standoff;
        wisp.position.x = damp(wisp.position.x, tx, 0.85, dt);
        wisp.position.z = damp(wisp.position.z, tz, 0.85, dt);
      } else if (dist < 4.2 && !flying) {
        // Too close: ease back out instead of hugging the player.
        wisp.position.x = damp(wisp.position.x, wisp.position.x - dx * 0.55, 0.55, dt);
        wisp.position.z = damp(wisp.position.z, wisp.position.z - dz * 0.55, 0.55, dt);
      } else {
        // Idle wander around wherever it happens to be.
        const a = elapsed * 0.23 + wisp.phase * 0.11;
        wisp.position.x += Math.cos(a) * dt * 0.42;
        wisp.position.z += Math.sin(a * 1.27) * dt * 0.42;
      }
      wisp.position.y = damp(wisp.position.y, targetY, 1.4, dt);

      wisp.core.rotation.y += dt * 1.4;
      wisp.core.rotation.x += dt * 0.6;
      const pulse = 0.9 + Math.sin(elapsed * 3.1) * 0.12;
      wisp.halo.scale.setScalar(0.95 * pulse);
      wisp.halo.material.opacity = 0.34 + Math.sin(elapsed * 2.4) * 0.07;
      wisp.light.intensity = 0.8 * pulse;
      wisp.motes.forEach((mote, i) => {
        const a = elapsed * (0.9 + i * 0.17) + i * 1.7;
        const r = 0.5 + Math.sin(elapsed * 1.6 + i) * 0.12;
        mote.position.set(Math.cos(a) * r, Math.sin(a * 1.4) * 0.3, Math.sin(a) * r);
        mote.material.opacity = 0.24 + Math.sin(elapsed * 2.2 + i) * 0.12;
      });
    }

    const sable = this.sable;
    if (sable) {
      sable.phase += dt;
      const dx = playerPos.x - sable.position.x;
      const dz = playerPos.z - sable.position.z;
      const dist = Math.hypot(dx, dz);
      const near = dist < 9;
      if (near) {
        const targetYaw = Math.atan2(-dx, -dz);
        sable.group.rotation.y = dampAngle(sable.group.rotation.y, targetYaw, 3.2, dt);
      }
      // Breathing + a slow look-around.
      sable.body.position.y = 0.9 + Math.sin(sable.phase * 1.5) * 0.008;
      sable.head.rotation.y = near ? Math.sin(sable.phase * 0.5) * 0.05 : Math.sin(sable.phase * 0.22) * 0.35;
      sable.head.rotation.x = near ? -0.03 : Math.sin(sable.phase * 0.17) * 0.06;
      if (this.sableGem) this.sableGem.rotation.y += dt * 0.8;
      this.sableArmR.shoulder.rotation.z = -0.12 + Math.sin(sable.phase * 1.1) * 0.02;
    }
  }
}
