/**
 * The first-draft finale: Vaelor, the Veil Sovereign.
 *
 * A dedicated, fully procedural three-phase boss encounter at the Beacon.
 * The boss registers an enemy proxy with `Enemies` so every spell, chain,
 * damage number and hit marker already works; its movement, telegraphed
 * attacks, adds, arena barrier and phase cinematics live here.
 */

import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../util/math.js';
import { LOCATIONS } from '../world/locations.js';
import { createGlowTexture } from '../world/textures.js';
import { springDamp } from '../player/gait.js';
import {
  BOSS,
  attackCooldown,
  attackPattern,
  bossArmor,
  bossPhase,
  cleaveDamage,
  clampToArena,
  nextPhase,
  phaseColor,
  phaseStartRatio,
  riftCount,
  shouldPhaseTransition,
  slamDamage,
  summonCount,
  telegraphDuration,
  volleyCount,
  volleyDamage,
} from './bossPhases.js';
import { actionPose, idlePose } from './bossPose.js';

const GLOW = createGlowTexture(128, 'rgba(255,255,255,1)', 'rgba(120,70,255,0)');
const MAX_ORBS = 30;
const MAX_TELEGRAPHS = 10;
const MAX_SHOCKWAVES = 4;

function part(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function glowSprite(color, size, opacity = 0.7) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: GLOW,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

function clothPanel(width, height, material) {
  const geometry = new THREE.PlaneGeometry(width, height, 3, 6);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const t = (y + height / 2) / height;
    position.setZ(i, Math.sin(t * Math.PI) * 0.12 + (1 - t) * 0.08);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

export class FinalBoss {
  /**
   * @param {{scene:THREE.Scene, world:any, player:any, powers:any, enemies:any, effects:any, audio:any, camera?:any, onDefeated?:Function, onPhase?:Function}} deps
   */
  constructor({ scene, world, player, powers, enemies, effects, audio, camera, onDefeated, onPhase }) {
    this.scene = scene;
    this.world = world;
    this.player = player;
    this.powers = powers;
    this.enemies = enemies;
    this.effects = effects;
    this.audio = audio;
    this.camera = camera;
    this.onDefeated = onDefeated ?? (() => {});
    this.onPhase = onPhase ?? (() => {});

    const temple = LOCATIONS.temple;
    const ground = this.world.heightAt(temple.x, temple.z);
    this.center = new THREE.Vector3(temple.x, ground, temple.z);
    // Vaelor manifests on the south side of the altar so the Beacon sits behind
    // him, not between the camera and the fight.
    this.spawn = new THREE.Vector3(temple.x, ground, temple.z + 6);

    this.fightActive = false;
    this.defeated = false;
    this.state = 'idle';
    this.phase = 1;
    this.introTimer = 0;
    this.transitionTimer = 0;
    this.deathTimer = 0;
    this.attackTimer = 0;
    this.action = null;
    this.patternIndex = 0;
    this.strafeTimer = 0;
    this.strafeDir = 1;
    this.adds = [];
    this.slashTimer = 0;
    this.enrage = 0;
    this.flashTimer = 0;
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();

    this._buildArena();
    this._buildModel();
    this._buildOrbs();
    this._buildTelegraphs();
    this._buildShockwaves();
    this._buildEnemy();
    this.reset();
  }

  /* --------------------------------------------------------------- model */

  _buildArena() {
    this.arena = new THREE.Group();
    this.arena.name = 'SovereignArena';
    this.arena.position.copy(this.center);
    this.arena.visible = false;
    this.scene.add(this.arena);

    const domeMat = new THREE.MeshBasicMaterial({
      color: '#6a3fb0',
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(BOSS.arenaRadius + 2.4, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.52),
      domeMat,
    );
    this.dome.position.y = -0.4;
    this.dome.renderOrder = 2;
    this.arena.add(this.dome);

    const latticeMat = new THREE.MeshBasicMaterial({
      color: '#a878ff',
      wireframe: true,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.domeLattice = new THREE.Mesh(
      new THREE.SphereGeometry(BOSS.arenaRadius + 2.1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      latticeMat,
    );
    this.domeLattice.position.y = -0.4;
    this.arena.add(this.domeLattice);

    this.arenaRing = new THREE.Mesh(
      new THREE.TorusGeometry(BOSS.arenaRadius - 1.4, 0.11, 6, 120),
      new THREE.MeshBasicMaterial({
        color: '#b48cff',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.arenaRing.rotation.x = -Math.PI / 2;
    this.arenaRing.position.y = 0.1;
    this.arena.add(this.arenaRing);

    // Soft radial corruption pool: a normal-blended dark glow texture so the
    // temple floor darkens gradually instead of ending in a hard disc edge.
    this.corruption = new THREE.Mesh(
      new THREE.CircleGeometry(BOSS.arenaRadius - 1.6, 64),
      new THREE.MeshBasicMaterial({
        map: GLOW,
        color: '#140820',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.corruption.rotation.x = -Math.PI / 2;
    this.corruption.position.y = 0.045;
    this.arena.add(this.corruption);

    // Soft blob shadow under the hovering Sovereign.
    this.groundShadow = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 32),
      new THREE.MeshBasicMaterial({
        map: GLOW,
        color: '#08040f',
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      }),
    );
    this.groundShadow.rotation.x = -Math.PI / 2;
    this.groundShadow.visible = false;
    this.scene.add(this.groundShadow);

    this.arenaRunes = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rune = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.3, 0),
        new THREE.MeshBasicMaterial({
          color: '#c6a8ff',
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      rune.position.set(Math.cos(a) * (BOSS.arenaRadius - 2.2), 0.6, Math.sin(a) * (BOSS.arenaRadius - 2.2));
      rune.scale.set(1, 2.4, 1);
      this.arena.add(rune);
      this.arenaRunes.push({ mesh: rune, phase: i * 0.7 });
    }
  }

  _buildModel() {
    const root = new THREE.Group();
    root.name = 'Vaelor';
    this.root = root;
    this.scene.add(root);

    const body = new THREE.Group();
    root.add(body);
    this.body = body;

    this.robeMat = new THREE.MeshStandardMaterial({
      color: '#35224f',
      emissive: '#5a2fa0',
      emissiveIntensity: 0.7,
      roughness: 0.86,
      metalness: 0.05,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.robeInnerMat = new THREE.MeshStandardMaterial({
      color: '#3f2a63',
      emissive: '#6338b8',
      emissiveIntensity: 0.55,
      roughness: 0.78,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.plateMat = new THREE.MeshStandardMaterial({
      color: '#6b4f9e',
      emissive: '#3a1f66',
      emissiveIntensity: 0.55,
      roughness: 0.38,
      metalness: 0.62,
      flatShading: true,
    });
    this.boneMat = new THREE.MeshStandardMaterial({
      color: '#e6d9f2',
      emissive: '#4a2a6e',
      emissiveIntensity: 0.3,
      roughness: 0.45,
      metalness: 0.22,
      flatShading: true,
    });
    this.capeMat = new THREE.MeshStandardMaterial({
      color: '#241533',
      emissive: '#4a2380',
      emissiveIntensity: 0.6,
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    this.coreMat = new THREE.MeshBasicMaterial({ color: '#d6b8ff' });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: '#fff1ff' });
    this.bladeMat = new THREE.MeshStandardMaterial({
      color: '#2c1a44',
      emissive: '#7f4dff',
      emissiveIntensity: 1.4,
      roughness: 0.3,
      metalness: 0.8,
      flatShading: true,
    });
    this.trimMat = new THREE.MeshStandardMaterial({
      color: '#c9a7ff',
      emissive: '#7f4dff',
      emissiveIntensity: 1.15,
      roughness: 0.3,
      metalness: 0.7,
      flatShading: true,
    });
    this.visorMat = new THREE.MeshBasicMaterial({ color: '#fff1ff' });
    this.materials = [
      this.robeMat,
      this.robeInnerMat,
      this.plateMat,
      this.boneMat,
      this.capeMat,
      this.bladeMat,
      this.trimMat,
    ];

    // Layered robe.
    part(body, new THREE.ConeGeometry(2.35, 5.5, 12, 1, true), this.robeMat, [0, 2.75, 0]);
    part(body, new THREE.ConeGeometry(1.85, 4.7, 10, 1, true), this.robeInnerMat, [0, 2.45, 0]);
    part(body, new THREE.ConeGeometry(1.35, 3.9, 8, 1, true), this.plateMat, [0, 2.35, 0]);

    // Ragged hem.
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const strip = part(
        body,
        new THREE.BoxGeometry(0.14, 1.7 + (i % 3) * 0.35, 0.05),
        i % 2 ? this.robeMat : this.capeMat,
        [Math.cos(a) * 2.05, 0.55, Math.sin(a) * 2.05],
        [1, 1, 1],
        [0.16, a, 0],
      );
      strip.rotation.z = Math.sin(a) * 0.1;
    }

    // Robe runes.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.25;
      part(
        body,
        new THREE.BoxGeometry(0.08, 1.6, 0.035),
        new THREE.MeshBasicMaterial({ color: '#b48cff', transparent: true, opacity: 0.7 }),
        [Math.cos(a) * 2.03, 2.1, Math.sin(a) * 2.03],
        [1, 1, 1],
        [0, -a, 0],
      );
    }

    // Torso armour.
    part(body, new THREE.IcosahedronGeometry(1.18, 1), this.plateMat, [0, 4.85, 0], [1.08, 1.18, 0.82]);
    part(body, new THREE.BoxGeometry(1.1, 0.62, 0.28), this.boneMat, [0, 5.0, -0.82]);
    // Glowing armour trim: collar, chest bars and waist band. These read as
    // edge highlights at distance without turning the model into a wireframe.
    const collar = part(body, new THREE.TorusGeometry(0.62, 0.035, 4, 24), this.trimMat, [0, 5.62, 0]);
    collar.rotation.x = Math.PI / 2;
    part(body, new THREE.BoxGeometry(1.18, 0.06, 0.06), this.trimMat, [0, 5.3, -0.86]);
    part(body, new THREE.BoxGeometry(1.18, 0.06, 0.06), this.trimMat, [0, 4.68, -0.86]);
    const belt = part(body, new THREE.TorusGeometry(1.06, 0.045, 4, 28), this.trimMat, [0, 3.0, 0]);
    belt.rotation.x = Math.PI / 2;
    const core = part(body, new THREE.OctahedronGeometry(0.46, 0), this.coreMat, [0, 4.9, -1.0], [1, 1.35, 0.7]);
    core.castShadow = false;
    this.core = core;
    const coreGlow = glowSprite('#d6b8ff', 3.2, 0.4);
    coreGlow.position.set(0, 4.9, -1.05);
    body.add(coreGlow);
    this.coreGlow = coreGlow;

    // Pauldrons and spikes.
    for (const side of [-1, 1]) {
      part(body, new THREE.SphereGeometry(0.58, 10, 8), this.plateMat, [side * 1.35, 5.35, 0], [1, 0.72, 1]);
      const rim = part(body, new THREE.TorusGeometry(0.6, 0.035, 4, 20), this.trimMat, [side * 1.35, 5.35, 0]);
      rim.rotation.x = Math.PI / 2;
      for (let i = 0; i < 3; i++) {
        const spike = part(
          body,
          new THREE.ConeGeometry(0.1, 0.7 - i * 0.12, 5),
          this.boneMat,
          [side * (1.55 + i * 0.12), 5.72 + i * 0.08, -0.16 + i * 0.16],
        );
        spike.rotation.z = side * -0.5;
        spike.rotation.x = -0.18;
      }
    }

    // Arms.
    const buildArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 1.42, 5.15, 0);
      body.add(shoulder);
      part(shoulder, new THREE.CylinderGeometry(0.2, 0.16, 1.35, 7), this.robeMat, [0, -0.68, 0]);
      const elbow = new THREE.Group();
      elbow.position.y = -1.35;
      shoulder.add(elbow);
      part(elbow, new THREE.SphereGeometry(0.22, 8, 6), this.boneMat, [0, 0, 0]);
      part(elbow, new THREE.CylinderGeometry(0.16, 0.13, 1.2, 7), this.plateMat, [0, -0.62, 0]);
      part(elbow, new THREE.SphereGeometry(0.24, 8, 6), this.boneMat, [0, -1.25, 0]);
      for (let i = 0; i < 3; i++) {
        const claw = part(
          elbow,
          new THREE.ConeGeometry(0.06, 0.55, 5),
          this.boneMat,
          [(i - 1) * 0.13, -1.55, -0.1],
        );
        claw.rotation.x = -0.28;
        claw.rotation.z = (i - 1) * 0.22;
      }
      return { shoulder, elbow };
    };
    this.armL = buildArm(-1);
    this.armR = buildArm(1);

    // Veilblade, gripped in the right hand.
    this.blade = new THREE.Group();
    this.blade.position.set(0, -1.28, 0);
    this.armR.elbow.add(this.blade);
    part(this.blade, new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6), this.boneMat, [0, -0.7, 0]);
    part(this.blade, new THREE.BoxGeometry(0.28, 3.7, 0.09), this.bladeMat, [0, -3.1, 0]);
    part(this.blade, new THREE.ConeGeometry(0.16, 0.8, 4), this.bladeMat, [0, -5.3, 0], [1, 1, 0.5]);
    part(this.blade, new THREE.BoxGeometry(0.05, 3.2, 0.03), this.coreMat, [0.16, -3.0, 0]);
    part(this.blade, new THREE.BoxGeometry(0.04, 3.2, 0.03), this.trimMat, [-0.16, -3.0, 0]);
    this.blade.rotation.z = 0.12;

    // Neck and masked head.
    part(body, new THREE.CylinderGeometry(0.32, 0.42, 0.55, 8), this.robeMat, [0, 5.85, 0]);
    const head = new THREE.Group();
    head.position.set(0, 6.45, 0);
    body.add(head);
    this.head = head;
    part(head, new THREE.IcosahedronGeometry(0.62, 1), this.plateMat, [0, 0, 0], [0.9, 1.05, 0.9]);
    part(head, new THREE.BoxGeometry(0.72, 0.46, 0.2), this.boneMat, [0, 0.02, -0.5]);
    part(head, new THREE.BoxGeometry(0.54, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: '#1a0d28' }), [0, 0.08, -0.62]);
    for (const side of [-1, 1]) {
      const eye = part(head, new THREE.SphereGeometry(0.065, 8, 6), this.eyeMat, [side * 0.17, 0.1, -0.58], [1, 0.7, 1]);
      eye.castShadow = false;
    }
    // Bright visor slit and forehead gem make the mask readable at distance.
    const visor = part(head, new THREE.BoxGeometry(0.56, 0.07, 0.05), this.visorMat, [0, 0.2, -0.64]);
    visor.castShadow = false;
    this.visor = visor;
    const brow = part(head, new THREE.BoxGeometry(0.66, 0.05, 0.05), this.boneMat, [0, 0.3, -0.62]);
    brow.rotation.x = -0.18;
    const gem = part(head, new THREE.OctahedronGeometry(0.075, 0), this.visorMat, [0, 0.38, -0.6], [0.8, 1.5, 0.5]);
    gem.castShadow = false;
    this.faceGem = gem;
    const faceGlow = glowSprite('#f0e6ff', 1.35, 0.18);
    faceGlow.position.set(0, 0.12, -0.62);
    head.add(faceGlow);
    this.faceGlow = faceGlow;

    // Crown of floating shards.
    this.crown = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const shard = part(
        head,
        new THREE.OctahedronGeometry(0.15, 0),
        this.boneMat,
        [Math.cos(a) * 0.58, 0.62 + (i % 2) * 0.18, Math.sin(a) * 0.58],
        [1, 2.6, 1],
      );
      shard.rotation.y = a;
      shard.rotation.z = Math.sin(a) * 0.25;
      this.crown.push(shard);
    }
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.045, 5, 48),
      new THREE.MeshBasicMaterial({
        color: '#b48cff',
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.set(0, 0.05, 0.55);
    head.add(halo);
    this.halo = halo;

    // Cape panels.
    this.capeTails = [];
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      pivot.position.set((i - 1.5) * 0.42, 5.3, 0.62);
      pivot.rotation.y = (i - 1.5) * 0.16;
      body.add(pivot);
      const panel = clothPanel(0.7, 4.2 + (i % 2) * 0.5, this.capeMat);
      panel.position.y = -(2.1 + (i % 2) * 0.25);
      pivot.add(panel);
      this.capeTails.push(pivot);
    }

    // Crescent slash used by the cleave telegraph and strike.
    const slashGeometry = new THREE.RingGeometry(2.4, 8.8, 56, 1, -Math.PI * 0.36, Math.PI * 0.72);
    slashGeometry.rotateX(-Math.PI / 2);
    this.slash = new THREE.Mesh(
      slashGeometry,
      new THREE.MeshBasicMaterial({
        color: '#7a3cff',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.slash.visible = false;
    this.slash.renderOrder = 3;
    this.scene.add(this.slash);

    // Bright outer edge so the cleave wedge reads against the pale temple
    // floor even at a glance.
    const slashEdgeGeometry = new THREE.RingGeometry(8.5, 8.8, 56, 1, -Math.PI * 0.36, Math.PI * 0.72);
    slashEdgeGeometry.rotateX(-Math.PI / 2);
    this.slashEdge = new THREE.Mesh(
      slashEdgeGeometry,
      new THREE.MeshBasicMaterial({
        color: '#ffe9a8',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.slashEdge.visible = false;
    this.slashEdge.renderOrder = 4;
    this.scene.add(this.slashEdge);

    // Floating rings.
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#b48cff',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ringA = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.055, 5, 72), ringMat.clone());
    this.ringA.rotation.x = Math.PI / 2;
    this.ringA.position.y = 3.1;
    body.add(this.ringA);
    this.ringB = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.04, 5, 64), ringMat.clone());
    this.ringB.rotation.x = Math.PI / 2;
    this.ringB.position.y = 4.6;
    body.add(this.ringB);

    // Orbiting shards.
    this.orbiters = [];
    for (let i = 0; i < 6; i++) {
      const shard = part(
        body,
        new THREE.OctahedronGeometry(0.16, 0),
        this.bladeMat,
        [0, 4.4, 0],
        [1, 2.2, 1],
      );
      shard.castShadow = false;
      this.orbiters.push({ mesh: shard, angle: (i / 6) * Math.PI * 2, radius: 2.3, y: 4.2 + (i % 3) * 0.55 });
    }

    const aura = glowSprite('#8d5bff', 8, 0.16);
    aura.position.y = 3.6;
    body.add(aura);
    this.aura = aura;

    this.light = new THREE.PointLight('#b48cff', 20, 30, 1.8);
    this.light.position.set(0, 4.8, -2.4);
    body.add(this.light);

    this.baseLightIntensity = 20;
    this.baseRimIntensity = 7;
    // The rim light lives on the root so it can be placed behind Vaelor
    // relative to the camera every frame.
    this.rimLight = new THREE.PointLight('#8d5bff', 7, 22, 2);
    this.rimLight.position.set(0, 6.2, 2.4);
    root.add(this.rimLight);

    root.visible = false;
    root.position.copy(this.spawn);
  }

  _buildOrbs() {
    this.orbs = [];
    const coreGeo = new THREE.IcosahedronGeometry(0.28, 1);
    const glowGeo = new THREE.SphereGeometry(0.62, 10, 8);
    for (let i = 0; i < MAX_ORBS; i++) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: '#e8d6ff' }));
      const glow = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({
          color: '#9a6bff',
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW,
          color: '#b48cff',
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      halo.scale.setScalar(2.2);
      group.add(core, glow, halo);
      group.visible = false;
      this.scene.add(group);
      this.orbs.push({
        group,
        core,
        glow,
        halo,
        active: false,
        velocity: new THREE.Vector3(),
        life: 0,
        damage: 0,
        homing: 0,
        trail: 0,
      });
    }
    this.orbCursor = 0;
  }

  _buildTelegraphs() {
    this.telegraphs = [];
    for (let i = 0; i < MAX_TELEGRAPHS; i++) {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.93, 1, 48),
        new THREE.MeshBasicMaterial({
          color: '#c76bff',
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.97, 40),
        new THREE.MeshBasicMaterial({
          color: '#5b2b8f',
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      group.add(ring, disc);
      group.visible = false;
      this.scene.add(group);
      this.telegraphs.push({
        group,
        ring,
        disc,
        active: false,
        x: 0,
        z: 0,
        radius: 1,
        duration: 1,
        time: 0,
        damage: 0,
        kind: 'rift',
      });
    }
    this.telegraphCursor = 0;
  }

  _buildShockwaves() {
    this.shockwaves = [];
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 72),
        new THREE.MeshBasicMaterial({
          color: '#d6b8ff',
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({
        mesh,
        active: false,
        x: 0,
        z: 0,
        radius: 0,
        maxRadius: 14,
        speed: 22,
        damage: 0,
        hit: false,
      });
    }
    this.shockCursor = 0;
  }

  _buildEnemy() {
    const ground = this.spawn.y;
    this.enemy = {
      id: 'boss-vaelor',
      type: 'boss',
      name: `${BOSS.name} — ${BOSS.title}`,
      spec: { armor: BOSS.armor, health: BOSS.maxHealth, radius: 2.6, attackRange: 9, damage: 20 },
      group: this.root,
      body: this.body,
      materials: this.materials,
      position: this.root.position,
      spawnPoint: this.spawn.clone(),
      velocity: new THREE.Vector3(),
      yaw: 0,
      health: BOSS.maxHealth,
      maxHealth: BOSS.maxHealth,
      alive: false,
      aggro: false,
      dormant: true,
      engaged: false,
      attackCooldown: 2,
      windup: 0,
      windupKind: null,
      hitFlash: 0,
      deadTimer: 0,
      baseY: ground,
      phase: 0,
      slows: [],
      radius: 2.6,
      hitHeight: 3.8,
      shardId: null,
      isWarden: false,
      isBoss: true,
      attackCount: 0,
      lunge: 0,
      invulnerable: false,
      onDefeat: () => this._beginDeath(),
    };
  }

  /** Register the enemy proxy after `Enemies.reset()` has cleared the list. */
  attach() {
    if (!this.enemy) return;
    if (!this.enemies.list.includes(this.enemy)) this.enemies.list.push(this.enemy);
  }

  /* --------------------------------------------------------------- fight */

  /** Raise the arena and start the intro (boss is invulnerable until activate). */
  begin(startPhase = 1) {
    const phase = clamp(Math.round(startPhase), 1, BOSS.phaseCount);
    this.reset();
    this.attach();
    this.fightActive = true;
    this.defeated = false;
    this.state = 'intro';
    this.introTimer = 0;
    this.phase = phase;
    this.enrage = (phase - 1) / 2;
    this.patternIndex = 0;
    this.enemy.alive = true;
    this.enemy.dormant = false;
    this.enemy.invulnerable = true;
    this.enemy.health = Math.round(BOSS.maxHealth * phaseStartRatio(phase));
    this.enemy.spec.armor = bossArmor(phase);
    this.root.visible = true;
    this.root.position.copy(this.spawn);
    this.root.scale.setScalar(0.08);
    this.root.rotation.set(0, 0, 0);
    this.arena.visible = true;
    this.arena.scale.setScalar(0.85);
    this.groundShadow.visible = true;
    this._restoreMaterials();
    this._applyPhaseVisuals();
    this.audio?.bossIntro();
    this.effects?.burst(this.spawn.clone().setY(this.spawn.y + 2.5), {
      count: 90,
      color: '#b48cff',
      speed: 8,
      size: 0.5,
      life: 1.6,
      gravity: -1.2,
      drag: 1.4,
      jitter: 1.2,
    });
    this.effects?.ring(this.center.clone().setY(this.center.y + 0.1), {
      color: '#b48cff',
      radius: BOSS.arenaRadius,
      life: 1.6,
      opacity: 0.8,
    });
  }

  /** Leave the intro and start attacking. */
  activate() {
    if (!this.fightActive) return;
    this.state = 'active';
    this.enemy.invulnerable = false;
    this.attackTimer = 1.25;
    this.action = null;
    this.root.scale.setScalar(1);
    this.camera?.addShake?.(0.35);
  }

  reset() {
    this.fightActive = false;
    this.defeated = false;
    this.state = 'idle';
    this.phase = 1;
    this.enrage = 0;
    this.attackTimer = 0;
    this.action = null;
    this.introTimer = 0;
    this.transitionTimer = 0;
    this.deathTimer = 0;
    this.slashTimer = 0;
    this.flashTimer = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.z = 0;
    this.head.rotation.set(0, 0, 0);
    this.armL.shoulder.rotation.set(0, 0, 0);
    this.armL.elbow.rotation.set(0, 0, 0);
    this.armR.shoulder.rotation.set(0, 0, 0);
    this.armR.elbow.rotation.set(0, 0, 0);
    this.blade.rotation.set(0, 0, 0.12);
    this.light.intensity = this.baseLightIntensity ?? 20;
    this.rimLight.intensity = this.baseRimIntensity ?? 7;
    this.enemy?.velocity?.set(0, 0, 0);
    this.rimLight.position.set(0, 6.2, 2.4);
    this.root.visible = false;
    this.root.scale.setScalar(1);
    this.root.position.copy(this.spawn);
    this.root.rotation.set(0, 0, 0);
    this.arena.visible = false;
    this.groundShadow.visible = false;
    this.groundShadow.position.set(this.spawn.x, this.center.y + 0.06, this.spawn.z);
    this.groundShadow.scale.setScalar(1);
    this.groundShadow.material.opacity = 0.3;
    this.slash.visible = false;
    this.slash.material.opacity = 0;
    this.slashEdge.visible = false;
    this.slashEdge.material.opacity = 0;
    this.slashTimer = 0;
    this.dome.material.opacity = 0.045;
    this.domeLattice.material.opacity = 0.05;
    this.corruption.material.opacity = 0.18;
    this.arenaRing.material.opacity = 0.75;
    this._restoreMaterials();
    if (this.enemy) {
      this.enemy.health = BOSS.maxHealth;
      this.enemy.maxHealth = BOSS.maxHealth;
      this.enemy.alive = false;
      this.enemy.dormant = true;
      this.enemy.aggro = false;
      this.enemy.engaged = false;
      this.enemy.invulnerable = false;
      this.enemy.hitFlash = 0;
      this.enemy.spec.armor = bossArmor(1);
    }
    for (const orb of this.orbs ?? []) {
      orb.active = false;
      orb.group.visible = false;
    }
    for (const t of this.telegraphs ?? []) {
      t.active = false;
      t.group.visible = false;
    }
    for (const s of this.shockwaves ?? []) {
      s.active = false;
      s.mesh.visible = false;
    }
    this._clearAdds();
  }

  /** Hide the boss after victory / new game. */
  dismiss() {
    this.reset();
  }

  get active() {
    return this.fightActive;
  }

  /** HUD payload. */
  hudState() {
    if (!this.fightActive) return null;
    return {
      name: this.enemy.name,
      health: this.enemy.health,
      maxHealth: this.enemy.maxHealth,
      phase: this.phase,
      phaseCount: BOSS.phaseCount,
      phaseName: BOSS.phaseNames[this.phase - 1],
      enraged: this.phase === 3,
    };
  }

  _restoreMaterials() {
    this.robeMat.transparent = false;
    this.robeInnerMat.transparent = false;
    this.plateMat.transparent = false;
    this.boneMat.transparent = false;
    this.capeMat.transparent = false;
    this.bladeMat.transparent = false;
    for (const mat of this.materials) {
      mat.opacity = 1;
      mat.needsUpdate = true;
    }
  }

  _applyPhaseVisuals() {
    const color = phaseColor(this.phase);
    this.enrage = (this.phase - 1) / 2;
    this.coreMat.color.set(color);
    this.eyeMat.color.set(this.phase === 3 ? '#fff0e8' : '#fff1ff');
    this.visorMat.color.set(this.phase === 3 ? '#fff0e8' : '#fff1ff');
    this.faceGlow.material.color.set(this.phase === 3 ? '#ffd0c4' : '#f0e6ff');
    this.light.color.set(color);
    this.baseLightIntensity = 10 + this.enrage * 6;
    this.light.intensity = this.baseLightIntensity;
    this.rimLight.color.set(this.phase === 3 ? '#ff5a4a' : '#8d5bff');
    this.baseRimIntensity = 6 + this.enrage * 4;
    this.rimLight.intensity = this.baseRimIntensity;
    this.trimMat.color.set(this.phase === 3 ? '#ffb7a6' : this.phase === 2 ? '#ffc6e8' : '#c9a7ff');
    this.trimMat.emissive.set(color);
    this.trimMat.emissiveIntensity = 1.1 + this.enrage * 0.5;
    this.coreGlow.material.color.set(color);
    this.aura.material.color.set(color);
    this.halo.material.color.set(color);
    this.ringA.material.color.set(color);
    this.ringB.material.color.set(color);
    this.arenaRing.material.color.set(color);
    this.slash.material.color.set(this.phase === 3 ? '#ff2a1a' : this.phase === 2 ? '#ff2a86' : '#7a3cff');
    this.corruption.material.color.set(this.phase === 3 ? '#2a0a12' : '#1b0b2e');
    for (const rune of this.arenaRunes) rune.mesh.material.color.set(color);
    this.robeMat.emissive.set(this.phase === 3 ? '#6b1c2a' : '#3d1f6e');
    this.robeInnerMat.emissive.set(this.phase === 3 ? '#4a1622' : '#4a2480');
    this.plateMat.emissive.set(this.phase === 3 ? '#3a1020' : '#24123f');
    this.bladeMat.emissive.set(this.phase === 3 ? '#ff4a3a' : '#7f4dff');
    this.capeMat.emissive.set(this.phase === 3 ? '#4a1222' : '#33165c');
    this.enemy.spec.armor = bossArmor(this.phase);
  }

  _enterPhase(phase) {
    this.phase = phase;
    this.state = 'transition';
    this.transitionTimer = 2.1;
    this.action = null;
    this.enemy.invulnerable = true;
    this._applyPhaseVisuals();
    this._clearOrbs();
    this._clearTelegraphs();
    this._clearAdds();

    const at = this.root.position.clone().setY(this.root.position.y + 3.5);
    this.effects?.burst(at, {
      count: 120,
      color: phaseColor(phase),
      speed: 12,
      size: 0.5,
      life: 1.4,
      gravity: -1,
      drag: 1.3,
      jitter: 1.2,
    });
    this.effects?.ring(this.center.clone().setY(this.center.y + 0.1), {
      color: phaseColor(phase),
      radius: BOSS.arenaRadius - 2,
      life: 1.1,
      opacity: 0.9,
    });
    this.effects?.light(at, { color: phaseColor(phase), intensity: 30, distance: 80, life: 1.4 });
    this.camera?.addShake?.(0.8);
    this.audio?.bossPhase();
    this.onPhase(phase);
  }

  /* --------------------------------------------------------------- update */

  update(dt) {
    if (this.state === 'defeated') return;
    if (!this.root.visible && this.state === 'idle') return;

    this._animate(dt);

    if (this.state === 'intro') {
      this.introTimer += dt;
      const t = clamp(this.introTimer / 2.4, 0, 1);
      this.root.scale.setScalar(0.08 + t * 0.92);
      this.root.position.y = this.spawn.y + Math.sin(this.introTimer * 1.4) * 0.2;
      this.dome.material.opacity = damp(this.dome.material.opacity, 0.055, 2, dt);
      this.domeLattice.material.opacity = damp(this.domeLattice.material.opacity, 0.07, 2, dt);
      this.arena.scale.setScalar(damp(this.arena.scale.x, 1, 3, dt));
      this._clampPlayer();
      return;
    }

    if (this.state === 'transition') {
      this.transitionTimer = Math.max(0, this.transitionTimer - dt);
      this.root.position.y = damp(this.root.position.y, this.spawn.y + 1.5 + Math.sin(this.transitionTimer * 3) * 0.25, 6, dt);
      this.root.rotation.y += dt * 1.6;
      if (this.transitionTimer <= 0) {
        this.state = 'active';
        this.enemy.invulnerable = false;
        this.attackTimer = 0.9;
        this.root.rotation.y = this.enemy.yaw;
      }
      this._clampPlayer();
      this._updateProjectiles(dt);
      return;
    }

    if (this.state === 'dying') {
      this._updateDeath(dt);
      return;
    }

    if (this.state !== 'active') return;

    // Phase transitions are checked before attack logic so a killing blow
    // cannot skip a phase beat.
    const wantedPhase = bossPhase(this.enemy.health, this.enemy.maxHealth);
    if (shouldPhaseTransition(this.phase, wantedPhase)) {
      this._enterPhase(wantedPhase);
      return;
    }
    if (this.enemy.health <= 0) {
      this._beginDeath();
      return;
    }

    this.enemy.hitFlash = Math.max(0, this.enemy.hitFlash - dt);
    this._move(dt);
    this._updateAction(dt);
    this._updateProjectiles(dt);
    this._updateTelegraphs(dt);
    this._updateShockwaves(dt);
    this._clampPlayer();
    this._updateBarrierFx(dt);
  }

  _animate(dt) {
    const t = this.root.userData.time = (this.root.userData.time ?? 0) + dt;
    this.body.position.y = Math.sin(t * 1.1) * 0.16;
    this.ringA.rotation.z += dt * 0.45;
    this.ringB.rotation.z -= dt * 0.7;
    this.halo.rotation.z += dt * 0.3;
    this.core.rotation.y += dt * 1.2;
    this.coreGlow.material.opacity = 0.3 + Math.sin(t * 2.4) * 0.08;
    this.aura.material.opacity = 0.12 + Math.sin(t * 1.8) * 0.035 + this.enrage * 0.06;
    this.aura.scale.setScalar(8 + Math.sin(t * 1.4) * 0.8);

    for (const shard of this.crown) {
      shard.position.y += Math.sin(t * 2 + shard.rotation.y) * 0.0008;
      shard.rotation.y += dt * 0.35;
    }
    for (const orbiter of this.orbiters) {
      orbiter.angle += dt * (0.55 + this.enrage * 0.7);
      orbiter.mesh.position.set(
        Math.cos(orbiter.angle) * orbiter.radius,
        orbiter.y + Math.sin(t * 1.4 + orbiter.angle) * 0.18,
        Math.sin(orbiter.angle) * orbiter.radius,
      );
      orbiter.mesh.rotation.y += dt * 2;
    }
    this.capeTails.forEach((tail, i) => {
      const flutter = Math.sin(t * (1.4 + i * 0.15) + i) * 0.06;
      tail.rotation.x = damp(tail.rotation.x, 0.08 + flutter + Math.sin(t * 0.8) * 0.04, 3, dt);
      tail.rotation.z = damp(tail.rotation.z, Math.sin(t * 1.1 + i) * 0.05, 3, dt);
    });

    // Hit flash on top of the phase palette.
    const flash = this.enemy.hitFlash > 0 ? this.enemy.hitFlash / 0.22 : 0;
    for (const mat of this.materials) {
      if (mat === this.trimMat) continue;
      mat.emissiveIntensity = damp(mat.emissiveIntensity, (this.phase === 3 ? 0.8 : 0.45) + flash * 4, 12, dt);
    }
    this.enemy.hitFlash = Math.max(0, this.enemy.hitFlash - dt);

    // Slash fade.
    if (this.slashTimer > 0) {
      this.slashTimer = Math.max(0, this.slashTimer - dt);
      const t2 = 1 - this.slashTimer / 0.36;
      this.slash.material.opacity = 0.85 * (1 - t2);
      this.slashEdge.material.opacity = 0.95 * (1 - t2);
      this.slash.scale.setScalar(1 + t2 * 0.22);
      this.slashEdge.scale.setScalar(1 + t2 * 0.22);
      if (this.slashTimer <= 0) {
        this.slash.visible = false;
        this.slashEdge.visible = false;
      }
    }

    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this._animatePose(dt, t);
    this._updateRimLight(t);

    const ground = this.world.heightAt(this.root.position.x, this.root.position.z);
    const height = Math.max(0, this.root.position.y - ground);
    this.groundShadow.position.set(this.root.position.x, ground + 0.06, this.root.position.z);
    this.groundShadow.scale.setScalar(clamp(1.25 - height * 0.11, 0.5, 1.25));
    this.groundShadow.material.opacity = clamp(0.36 - height * 0.03, 0.1, 0.36);
  }

  /** Damped body language: idle sway, wind-up coil, strike and recovery. */
  _animatePose(dt, t) {
    const a = this.action;
    const recovering = Boolean(a && a.phase === 'recover');
    const progress = a ? clamp(a.time / a.duration, 0, 1) : 0;
    const target = a
      ? actionPose(a.kind, this.phase, progress, recovering)
      : idlePose(t);
    // Soft-body rates: coil is slow/heavy, strike snaps, recover settles.
    const bodyLambda = recovering ? 9 : a ? 5.5 : 3.2;
    const armLambda = recovering ? 10 : a ? 6.5 : 3.8;

    this.body.rotation.x = springDamp(this.body.rotation.x, target.bodyX, bodyLambda, dt);
    this.body.rotation.y = springDamp(this.body.rotation.y, target.bodyY, bodyLambda, dt);
    this.body.rotation.z = springDamp(this.body.rotation.z, target.bodyZ, bodyLambda, dt);
    this.body.position.z = springDamp(this.body.position.z, target.bodyZOffset, bodyLambda, dt);
    this.head.rotation.x = springDamp(this.head.rotation.x, target.headX, bodyLambda * 0.85, dt);
    this.head.rotation.y = springDamp(this.head.rotation.y, target.headY, bodyLambda * 0.85, dt);
    this.head.rotation.z = springDamp(this.head.rotation.z, target.headZ, bodyLambda * 0.85, dt);

    this.armL.shoulder.rotation.x = springDamp(this.armL.shoulder.rotation.x, target.armLX, armLambda, dt);
    this.armL.shoulder.rotation.z = springDamp(this.armL.shoulder.rotation.z, target.armLZ, armLambda, dt);
    this.armL.elbow.rotation.x = springDamp(this.armL.elbow.rotation.x, target.elbowL, armLambda, dt);
    this.armR.shoulder.rotation.x = springDamp(this.armR.shoulder.rotation.x, target.armRX, armLambda, dt);
    this.armR.shoulder.rotation.z = springDamp(this.armR.shoulder.rotation.z, target.armRZ, armLambda, dt);
    this.armR.elbow.rotation.x = springDamp(this.armR.elbow.rotation.x, target.elbowR, armLambda, dt);
    this.blade.rotation.x = springDamp(this.blade.rotation.x, target.bladeX, armLambda, dt);
    this.blade.rotation.z = springDamp(this.blade.rotation.z, target.bladeZ, armLambda, dt);

    const charge = target.charge ?? 0;
    const flash = this.flashTimer > 0 ? this.flashTimer / 0.2 : 0;
    this.light.intensity = this.baseLightIntensity + charge * 10 + flash * 12;
    this.rimLight.intensity = this.baseRimIntensity + charge * 5 + flash * 8;
    this.coreGlow.material.opacity = 0.3 + Math.sin(t * 2.4) * 0.08 + charge * 0.45 + flash * 0.2;
    this.coreGlow.scale.setScalar(1 + charge * 0.35 + flash * 0.25);
    this.aura.material.opacity = 0.12 + Math.sin(t * 1.8) * 0.035 + this.enrage * 0.06 + charge * 0.08;
    this.faceGlow.material.opacity = 0.18 + charge * 0.55 + flash * 0.2;
    this.visor.scale.x = 1 + charge * 0.35;
    this.faceGem.rotation.y += dt * 0.8;
    this.trimMat.emissiveIntensity = 1.1 + this.enrage * 0.5 + charge * 0.9 + flash * 1.5;
  }

  /** Keep the rim light behind Vaelor relative to the camera. */
  _updateRimLight(t) {
    if (!this.camera || !this.rimLight) return;
    const dx = this.camera.position.x - this.root.position.x;
    const dz = this.camera.position.z - this.root.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return;
    const yaw = this.root.rotation.y;
    const localX = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const localZ = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const dist = 3.6;
    this.rimLight.position.set(
      (-localX / len) * dist,
      6.2 + Math.sin(t * 1.3) * 0.25,
      (-localZ / len) * dist,
    );
  }

  /** Position the cleave wedge and its bright edge on the arena floor. */
  _placeSlash() {
    const y = this.world.heightAt(this.root.position.x, this.root.position.z) + 0.08;
    this.slash.position.set(this.root.position.x, y, this.root.position.z);
    this.slash.rotation.y = this.enemy.yaw + Math.PI / 2;
    this.slashEdge.position.copy(this.slash.position);
    this.slashEdge.rotation.y = this.slash.rotation.y;
  }

  _move(dt) {
    const p = this.player.position;
    const beforeX = this.root.position.x;
    const beforeZ = this.root.position.z;
    const dx = p.x - this.root.position.x;
    const dz = p.z - this.root.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;

    this.enemy.yaw = dampAngle(this.enemy.yaw, Math.atan2(-dx, -dz), 4, dt);
    this.root.rotation.y = this.enemy.yaw;

    if (this.state === 'active' && !this.action) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 2.4 + Math.random() * 1.8;
        this.strafeDir *= Math.random() < 0.28 ? -1 : 1;
      }
      const desired = this.phase === 3 ? 8.5 : 11;
      let move = 0;
      if (dist > desired + 3.5) move = 1;
      else if (dist < desired - 3) move = -1;
      const speed = (2.1 + this.phase * 0.35) * move;
      const strafe = 1.55 * this.strafeDir;
      // Gliding velocity: the Sovereign drifts with weight instead of
      // teleporting between strafe directions.
      this._velX = damp(this._velX ?? 0, nx * speed - nz * strafe, 3.0, dt);
      this._velZ = damp(this._velZ ?? 0, nz * speed + nx * strafe, 3.0, dt);
      this.root.position.x += this._velX * dt;
      this.root.position.z += this._velZ * dt;
    } else {
      this._velX = damp(this._velX ?? 0, 0, 3.0, dt);
      this._velZ = damp(this._velZ ?? 0, 0, 3.0, dt);
      this.root.position.x += this._velX * dt;
      this.root.position.z += this._velZ * dt;
    }

    // Keep the Sovereign inside the ring and off the altar pedestal.
    const inside = clampToArena(
      this.root.position.x,
      this.root.position.z,
      this.center.x,
      this.center.z,
      BOSS.arenaRadius - 5,
    );
    this.root.position.x = inside.x;
    this.root.position.z = inside.z;
    const cx = this.root.position.x - this.center.x;
    const cz = this.root.position.z - this.center.z;
    const centerDist = Math.hypot(cx, cz);
    if (centerDist > 0.001 && centerDist < 5.5) {
      const push = 5.5 / centerDist;
      this.root.position.x = this.center.x + cx * push;
      this.root.position.z = this.center.z + cz * push;
    }

    const ground = this.world.heightAt(this.root.position.x, this.root.position.z);
    if (this.action?.kind !== 'slam') {
      const hover = 0.9 + Math.sin((this.root.userData.time ?? 0) * 1.2) * 0.16;
      this.root.position.y = damp(this.root.position.y, ground + hover, 6, dt);
    }
    this.enemy.baseY = ground;
    if (dt > 0 && this.enemy.velocity) {
      this.enemy.velocity.set(
        (this.root.position.x - beforeX) / dt,
        0,
        (this.root.position.z - beforeZ) / dt,
      );
    }
  }

  _updateAction(dt) {
    if (this.action) {
      const a = this.action;
      a.time += dt;
      const p = clamp(a.time / a.duration, 0, 1);

      if (a.kind === 'cleave' && a.phase === 'windup') {
        this.slash.visible = true;
        this.slashEdge.visible = true;
        this._placeSlash();
        this.slash.material.opacity = 0.15 + p * 0.3;
        this.slashEdge.material.opacity = 0.35 + p * 0.4;
      } else if (a.kind === 'slam') {
        const targetY = a.phase === 'windup'
          ? this.center.y + 4.4 + Math.sin(a.time * 9) * 0.3
          : this.center.y + 0.9;
        this.root.position.y = damp(this.root.position.y, targetY, a.phase === 'windup' ? 9 : 12, dt);
      }

      if (!a.fired && a.time >= a.duration) {
        a.fired = true;
        this._fireAction(a.kind);
        a.time = 0;
        a.duration = 0.52;
        a.phase = 'recover';
      } else if (a.fired && a.phase === 'recover' && a.time >= a.duration) {
        this.action = null;
        this.attackTimer = attackCooldown(this.phase);
        this._clearTelegraphs();
      }
      return;
    }

    this.attackTimer = Math.max(0, this.attackTimer - dt);
    if (this.attackTimer <= 0) this._chooseAttack();
  }

  _chooseAttack() {
    const pattern = attackPattern(this.phase);
    let kind = pattern[this.patternIndex % pattern.length];
    this.patternIndex += 1;

    // Skip summons when the arena is already crowded.
    if (kind === 'summon' && this.adds.filter((a) => a.alive).length >= summonCount(this.phase)) {
      kind = 'volley';
    }
    this._startAction(kind);
  }

  _startAction(kind) {
    const duration = telegraphDuration(kind, this.phase);
    this.action = { kind, time: 0, duration, fired: false, phase: 'windup' };
    this.enemy.attackCount += 1;
    this.audio?.bossVolley?.();

    if (kind === 'cleave') {
      this.slash.visible = true;
      this.slashEdge.visible = true;
      this._placeSlash();
      this.slash.material.opacity = 0.15;
      this.slashEdge.material.opacity = 0.35;
      this.slashEdge.scale.setScalar(1);
      this.effects?.ring(this.root.position.clone(), {
        color: '#c6a8ff',
        radius: 9,
        life: duration,
        opacity: 0.35,
      });
    } else if (kind === 'slam') {
      this._spawnTelegraph(
        this.root.position.x,
        this.root.position.z,
        13.5,
        duration,
        slamDamage(this.phase),
        'slam',
      );
    } else if (kind === 'rifts') {
      const count = riftCount(this.phase);
      const p = this.player.position;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.random() * 0.7;
        const r = i === 0 ? 0 : 3 + Math.random() * 5;
        this._spawnTelegraph(
          p.x + Math.cos(a) * r,
          p.z + Math.sin(a) * r,
          3.4,
          duration,
          24,
          'rift',
        );
      }
    } else if (kind === 'storm') {
      this._spawnTelegraph(this.player.position.x, this.player.position.z, 4.5, duration, 20, 'storm');
    } else if (kind === 'summon') {
      this.effects?.ring(this.root.position.clone(), {
        color: '#c76bff',
        radius: 7,
        life: duration,
        opacity: 0.55,
      });
    }
  }

  _fireAction(kind) {
    this.flashTimer = 0.2;
    const p = this.player.position;
    const chest = new THREE.Vector3(this.root.position.x, this.root.position.y + 4.2, this.root.position.z);
    const target = new THREE.Vector3(p.x, p.y + 1.1, p.z);

    if (kind === 'cleave') {
      const dx = p.x - this.root.position.x;
      const dz = p.z - this.root.position.z;
      const dist = Math.hypot(dx, dz);
      const forward = { x: -Math.sin(this.enemy.yaw), z: -Math.cos(this.enemy.yaw) };
      const dot = dist > 0.001 ? (dx / dist) * forward.x + (dz / dist) * forward.z : 0;
      if (dist < 9.6 && dot > 0.18) {
        this.enemies.damagePlayer(cleaveDamage(this.phase), {
          origin: this.root.position,
          kind: 'cleave',
          shake: 0.55,
          color: '#d9b8ff',
        });
      }
      this.slash.visible = true;
      this.slashEdge.visible = true;
      this._placeSlash();
      this.slash.material.opacity = 0.85;
      this.slashEdge.material.opacity = 0.95;
      this.slashTimer = 0.36;
      this.slash.scale.setScalar(1);
      this.slashEdge.scale.setScalar(1);
      this.camera?.addShake?.(0.3);
      this.audio?.bossSlam?.();
    } else if (kind === 'volley') {
      const count = volleyCount(this.phase);
      const base = Math.atan2(-(p.x - chest.x), -(p.z - chest.z));
      for (let i = 0; i < count; i++) {
        const spread = (i - (count - 1) / 2) * 0.12;
        const dir = new THREE.Vector3(-Math.sin(base + spread), 0.03, -Math.cos(base + spread));
        this._spawnOrb(chest, dir, {
          speed: 17 + this.phase,
          damage: volleyDamage(this.phase),
          color: phaseColor(this.phase),
          homing: this.phase === 3 ? 0.35 : 0,
        });
      }
      this.effects?.flash(chest, { color: '#e4d4ff', size: 3.2, life: 0.22, growth: 1.8 });
      this.effects?.burst(chest, {
        count: 20,
        color: phaseColor(this.phase),
        speed: 5,
        size: 0.3,
        life: 0.45,
        gravity: 0,
        direction: new THREE.Vector3(target.x - chest.x, target.y - chest.y, target.z - chest.z).normalize(),
        spread: 0.7,
      });
      this.camera?.addShake?.(0.2);
    } else if (kind === 'slam') {
      this.root.position.y = this.center.y + 0.9;
      this._spawnShockwave(this.root.position.x, this.root.position.z, slamDamage(this.phase));
      this.effects?.ring(this.root.position.clone(), {
        color: '#d6b8ff',
        radius: 15,
        life: 0.7,
        opacity: 0.9,
      });
      this.effects?.burst(this.root.position.clone(), {
        count: 60,
        color: '#b48cff',
        speed: 9,
        size: 0.4,
        life: 0.8,
        gravity: 2,
        drag: 1.6,
      });
      this.camera?.addShake?.(0.85);
      this.audio?.bossSlam?.();
      if (this.phase >= 2) {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          this._spawnTelegraph(
            p.x + Math.cos(a) * 4.2,
            p.z + Math.sin(a) * 4.2,
            3.2,
            0.75,
            20,
            'rift',
          );
        }
      }
    } else if (kind === 'rifts') {
      // Rift telegraphs fire themselves; the cast itself just flashes.
      this.effects?.flash(chest, { color: '#ff7ac8', size: 4, life: 0.3, growth: 2 });
      this.camera?.addShake?.(0.25);
    } else if (kind === 'storm') {
      const count = 12 + this.phase * 2;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0.02, Math.sin(a));
        this._spawnOrb(chest, dir, {
          speed: 11 + this.phase,
          damage: volleyDamage(this.phase),
          color: '#ff7ac8',
          homing: 0,
        });
      }
      for (let i = 0; i < 3; i++) {
        const dir = new THREE.Vector3(
          target.x - chest.x + (i - 1) * 2,
          target.y - chest.y,
          target.z - chest.z,
        ).normalize();
        this._spawnOrb(chest, dir, {
          speed: 19,
          damage: volleyDamage(this.phase) + 2,
          color: '#ff5a4a',
          homing: 0.55,
        });
      }
      this.effects?.flash(chest, { color: '#ffb0e0', size: 5, life: 0.3, growth: 2.4 });
      this.effects?.ring(this.root.position.clone(), {
        color: '#ff7ac8',
        radius: 12,
        life: 0.8,
        opacity: 0.8,
      });
      this.camera?.addShake?.(0.5);
    } else if (kind === 'summon') {
      const count = summonCount(this.phase);
      for (let i = 0; i < count; i++) {
        const a = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.8;
        const x = this.center.x + Math.cos(a) * (BOSS.arenaRadius - 5);
        const z = this.center.z + Math.sin(a) * (BOSS.arenaRadius - 5);
        const add = this.enemies.spawn('drifter', x, z, { name: 'Veil Echo' });
        if (add) {
          add.aggro = true;
          add.engaged = true;
          add.summoned = true;
          this._stylizeEcho(add);
          this.adds.push(add);
        }
      }
      this.effects?.ring(this.root.position.clone(), {
        color: '#c76bff',
        radius: 9,
        life: 0.8,
        opacity: 0.8,
      });
      this.camera?.addShake?.(0.35);
    }
  }

  /** Give a summoned drifter the masked, ringed Veil Echo look. */
  _stylizeEcho(enemy) {
    if (!enemy || enemy.echo) return enemy;
    enemy.echo = true;
    enemy.name = 'Veil Echo';
    enemy.health = 52;
    enemy.maxHealth = 52;
    enemy.group.scale.setScalar(0.88);

    const [skin, dark, bone] = enemy.materials ?? [];
    if (skin) {
      skin.color.set('#4a2a78');
      skin.emissive.set('#7f4dff');
      skin.emissiveIntensity = 1.15;
    }
    if (dark) {
      dark.color.set('#120a1c');
      dark.emissive.set('#2a1048');
      dark.emissiveIntensity = 0.6;
    }
    if (bone) {
      bone.color.set('#d6c4f2');
      bone.emissive.set('#4a2a6e');
      bone.emissiveIntensity = 0.4;
    }

    const mask = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.17, 0),
      new THREE.MeshBasicMaterial({ color: '#e8d6ff' }),
    );
    mask.position.set(0, 1.8, -0.3);
    mask.scale.set(1, 1.35, 0.65);
    mask.castShadow = false;
    enemy.body.add(mask);
    enemy.echoMask = mask;

    const aura = glowSprite('#b48cff', 2.6, 0.3);
    aura.position.set(0, 1.15, 0);
    enemy.body.add(aura);
    enemy.echoAura = aura;

    const tether = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.018, 4, 24),
      new THREE.MeshBasicMaterial({
        color: '#c76bff',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    tether.position.set(0, 1.55, 0);
    tether.rotation.x = Math.PI / 2;
    enemy.body.add(tether);
    enemy.echoRing = tether;
    return enemy;
  }

  _beginDeath() {
    if (this.state === 'dying' || this.defeated) return;
    this.state = 'dying';
    this.deathTimer = 3.4;
    this.fightActive = true;
    this.enemy.alive = false;
    this.enemy.invulnerable = true;
    this.enemy.aggro = false;
    this.action = null;
    this._clearOrbs();
    this._clearTelegraphs();
    this._clearShockwaves();
    this._clearAdds();
    this.slash.visible = false;
    this.slashEdge.visible = false;
    this.slashTimer = 0;
    this.audio?.bossDeath();
    this.camera?.addShake?.(1);
    const at = this.root.position.clone().setY(this.root.position.y + 3.8);
    this.effects?.burst(at, {
      count: 220,
      color: '#d6b8ff',
      speed: 15,
      size: 0.55,
      life: 2.2,
      gravity: -1.2,
      drag: 1.2,
      jitter: 1.4,
    });
    this.effects?.burst(at, {
      count: 90,
      color: '#ffe9a8',
      speed: 8,
      size: 0.4,
      life: 2.6,
      gravity: -0.6,
      drag: 1,
    });
    this.effects?.light(at, { color: '#ffe9a8', intensity: 44, distance: 140, life: 2.4 });
    this.effects?.ring(this.center.clone().setY(this.center.y + 0.1), {
      color: '#ffe9a8',
      radius: BOSS.arenaRadius,
      life: 1.8,
      opacity: 1,
    });
    this.dome.material.opacity = 0.02;
    this.domeLattice.material.opacity = 0.02;
  }

  _updateDeath(dt) {
    this.deathTimer = Math.max(0, this.deathTimer - dt);
    const t = clamp(1 - this.deathTimer / 3.4, 0, 1);
    this.root.position.y = damp(this.root.position.y, this.center.y - 1.8, 2.5, dt);
    this.root.rotation.y += dt * (0.6 + t * 1.4);
    this.body.rotation.z = Math.sin(t * 8) * 0.08;
    for (const mat of this.materials) {
      mat.transparent = true;
      mat.opacity = damp(mat.opacity, 1 - t, 2, dt);
    }
    this.coreMat.color.lerp(new THREE.Color('#ffe9a8'), dt * 1.2);
    this.light.intensity = damp(this.light.intensity, 0, 2, dt);
    this.rimLight.intensity = damp(this.rimLight.intensity, 0, 2, dt);
    this.aura.material.opacity = Math.max(0, this.aura.material.opacity - dt * 0.2);
    this.arenaRing.material.opacity = damp(this.arenaRing.material.opacity, 0, 1.5, dt);
    this.corruption.material.opacity = damp(this.corruption.material.opacity, 0, 1.5, dt);
    this.dome.material.opacity = damp(this.dome.material.opacity, 0, 1.5, dt);
    this.domeLattice.material.opacity = damp(this.domeLattice.material.opacity, 0, 1.5, dt);
    this.groundShadow.material.opacity = damp(this.groundShadow.material.opacity, 0, 2, dt);

    if (Math.random() < dt * 12) {
      const at = this.root.position.clone().add(
        new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 5, (Math.random() - 0.5) * 4),
      );
      this.effects?.burst(at, {
        count: 18,
        color: Math.random() < 0.5 ? '#d6b8ff' : '#ffe9a8',
        speed: 4 + Math.random() * 4,
        size: 0.35,
        life: 0.8,
        gravity: 0.8,
        drag: 1.6,
      });
      this.camera?.addShake?.(0.12);
    }

    if (this.deathTimer <= 0) {
      this.state = 'defeated';
      this.defeated = true;
      this.fightActive = false;
      this.root.visible = false;
      this.arena.visible = false;
      this.groundShadow.visible = false;
      this.onDefeated();
    }
  }

  /* ------------------------------------------------------------- attacks */

  _spawnOrb(origin, direction, opts = {}) {
    const slot = this.orbs[this.orbCursor];
    this.orbCursor = (this.orbCursor + 1) % this.orbs.length;
    slot.group.position.copy(origin);
    slot.group.visible = true;
    slot.active = true;
    slot.velocity.copy(direction).normalize().multiplyScalar(opts.speed ?? 17);
    slot.life = opts.life ?? 3.2;
    slot.damage = opts.damage ?? 13;
    slot.homing = opts.homing ?? 0;
    slot.trail = 0;
    slot.core.material.color.set(opts.color ?? '#e8d6ff');
    slot.glow.material.color.set(opts.color ?? '#9a6bff');
    slot.halo.material.color.set(opts.color ?? '#b48cff');
  }

  _updateProjectiles(dt) {
    for (const slot of this.orbs) {
      if (!slot.active) continue;
      slot.life -= dt;
      if (slot.homing > 0) {
        const target = this._tmp.set(
          this.player.position.x,
          this.player.position.y + 1.0,
          this.player.position.z,
        );
        const desired = target.sub(slot.group.position).normalize().multiplyScalar(slot.velocity.length());
        slot.velocity.lerp(desired, clamp(slot.homing * dt, 0, 0.4));
      }
      slot.group.position.addScaledVector(slot.velocity, dt);
      slot.group.rotation.y += dt * 7;
      slot.trail -= dt;
      if (slot.trail <= 0) {
        slot.trail = 0.055;
        this.effects.burst(slot.group.position, {
          count: 2,
          color: '#c6a8ff',
          speed: 0.5,
          size: 0.22,
          life: 0.32,
          gravity: -0.4,
          jitter: 0.12,
        });
      }

      const p = this.player.position;
      const dist = Math.hypot(
        slot.group.position.x - p.x,
        slot.group.position.y - (p.y + 1.0),
        slot.group.position.z - p.z,
      );
      if (dist < 1.25) {
        this.enemies.damagePlayer(slot.damage, {
          origin: slot.group.position,
          kind: 'orb',
          shake: 0.2,
          color: '#d6b8ff',
        });
        this.effects.burst(slot.group.position, {
          count: 16,
          color: '#c6a8ff',
          speed: 4,
          size: 0.3,
          life: 0.45,
          gravity: 1.4,
        });
        this._deactivateOrb(slot);
        continue;
      }

      const ground = this.world.heightAt(slot.group.position.x, slot.group.position.z);
      const outside = Math.hypot(
        slot.group.position.x - this.center.x,
        slot.group.position.z - this.center.z,
      ) > BOSS.arenaRadius + 8;
      if (slot.life <= 0 || slot.group.position.y < ground + 0.15 || outside) {
        this._deactivateOrb(slot);
      }
    }
  }

  _deactivateOrb(slot) {
    slot.active = false;
    slot.group.visible = false;
  }

  _clearOrbs() {
    for (const slot of this.orbs) this._deactivateOrb(slot);
  }

  _spawnTelegraph(x, z, radius, duration, damage, kind = 'rift') {
    const slot = this.telegraphs[this.telegraphCursor];
    this.telegraphCursor = (this.telegraphCursor + 1) % this.telegraphs.length;
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.radius = radius;
    slot.duration = Math.max(0.2, duration);
    slot.time = 0;
    slot.damage = damage;
    slot.kind = kind;
    const y = this.world.heightAt(x, z) + 0.08;
    slot.group.position.set(x, y, z);
    slot.group.scale.setScalar(0.2);
    slot.group.visible = true;
    const color = kind === 'slam' ? '#ffb066' : kind === 'storm' ? '#ff7ac8' : '#c76bff';
    slot.ring.material.color.set(color);
    slot.disc.material.color.set(kind === 'slam' ? '#8f4a1f' : '#5b2b8f');
  }

  _updateTelegraphs(dt) {
    for (const slot of this.telegraphs) {
      if (!slot.active) continue;
      slot.time += dt;
      const p = clamp(slot.time / slot.duration, 0, 1);
      const pulse = 0.55 + Math.sin(slot.time * 20) * 0.25;
      slot.group.scale.setScalar(0.2 + p * slot.radius);
      slot.ring.material.opacity = 0.35 + pulse * 0.55;
      slot.disc.material.opacity = 0.08 + p * 0.2;
      if (slot.time >= slot.duration) {
        this._triggerTelegraph(slot);
        slot.active = false;
        slot.group.visible = false;
      }
    }
  }

  _triggerTelegraph(slot) {
    const p = this.player.position;
    const dist = Math.hypot(p.x - slot.x, p.z - slot.z);
    const ground = this.world.heightAt(slot.x, slot.z);
    this.effects.ring(new THREE.Vector3(slot.x, ground + 0.1, slot.z), {
      color: slot.ring.material.color.getStyle(),
      radius: slot.radius * 1.25,
      life: 0.45,
      opacity: 0.9,
    });
    this.effects.burst(new THREE.Vector3(slot.x, ground + 0.4, slot.z), {
      count: slot.kind === 'slam' ? 60 : 34,
      color: slot.kind === 'slam' ? '#ffb066' : '#c76bff',
      speed: slot.kind === 'slam' ? 8 : 6,
      size: 0.35,
      life: 0.7,
      gravity: 1.8,
      drag: 1.6,
    });
    if (slot.kind === 'rift' || slot.kind === 'storm') {
      this.effects.beam(
        new THREE.Vector3(slot.x, ground, slot.z),
        new THREE.Vector3(slot.x, ground + 9, slot.z),
        { color: '#ff7ac8', width: 0.9, life: 0.22 },
      );
    }
    this.effects.light(new THREE.Vector3(slot.x, ground + 1, slot.z), {
      color: '#c76bff',
      intensity: 10,
      distance: 28,
      life: 0.4,
    });
    this.camera?.addShake?.(slot.kind === 'slam' ? 0.55 : 0.2);
    if (dist < slot.radius) {
      this.enemies.damagePlayer(slot.damage, {
        origin: new THREE.Vector3(slot.x, ground, slot.z),
        kind: slot.kind,
        shake: 0.3,
        color: '#d9b8ff',
      });
    }
  }

  _clearTelegraphs() {
    for (const slot of this.telegraphs) {
      slot.active = false;
      slot.group.visible = false;
    }
  }

  _spawnShockwave(x, z, damage) {
    const slot = this.shockwaves[this.shockCursor];
    this.shockCursor = (this.shockCursor + 1) % this.shockwaves.length;
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.radius = 1;
    slot.maxRadius = 16;
    slot.speed = 24;
    slot.damage = damage;
    slot.hit = false;
    slot.mesh.position.set(x, this.world.heightAt(x, z) + 0.12, z);
    slot.mesh.scale.setScalar(1);
    slot.mesh.visible = true;
    slot.mesh.material.opacity = 0.9;
  }

  _updateShockwaves(dt) {
    for (const slot of this.shockwaves) {
      if (!slot.active) continue;
      slot.radius += slot.speed * dt;
      slot.mesh.scale.setScalar(slot.radius);
      slot.mesh.material.opacity = 0.9 * (1 - slot.radius / slot.maxRadius);
      const p = this.player.position;
      const dist = Math.hypot(p.x - slot.x, p.z - slot.z);
      if (!slot.hit && Math.abs(dist - slot.radius) < 1.7) {
        slot.hit = true;
        this.enemies.damagePlayer(slot.damage, {
          origin: new THREE.Vector3(slot.x, this.world.heightAt(slot.x, slot.z), slot.z),
          kind: 'shockwave',
          shake: 0.5,
          color: '#ffb066',
        });
      }
      if (slot.radius >= slot.maxRadius) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }
  }

  _clearShockwaves() {
    for (const slot of this.shockwaves) {
      slot.active = false;
      slot.mesh.visible = false;
    }
  }

  _clearAdds() {
    for (const add of this.adds) {
      if (!add) continue;
      this.enemies.despawn(add);
    }
    this.adds = [];
  }

  _clampPlayer() {
    if (!this.fightActive || this.player.fly) return;
    const p = this.player.position;
    const c = clampToArena(p.x, p.z, this.center.x, this.center.z, BOSS.arenaRadius - 1.4);
    if (!c.outside) return;
    p.x = c.x;
    p.z = c.z;
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const len = Math.hypot(dx, dz) || 1;
    const outward = this.player.velocity.x * (dx / len) + this.player.velocity.z * (dz / len);
    if (outward > 0) {
      this.player.velocity.x -= (dx / len) * outward;
      this.player.velocity.z -= (dz / len) * outward;
    }
    if (Math.random() < 0.35) {
      this.effects.ring(new THREE.Vector3(p.x, p.y + 0.1, p.z), {
        color: '#c6a8ff',
        radius: 1.6,
        life: 0.3,
        opacity: 0.4,
      });
    }
  }

  _updateBarrierFx(dt) {
    const t = this.root.userData.time ?? 0;
    this.dome.material.opacity = damp(this.dome.material.opacity, 0.05 + Math.sin(t * 1.6) * 0.008, 2, dt);
    this.domeLattice.material.opacity = damp(this.domeLattice.material.opacity, 0.06 + Math.sin(t * 2.1) * 0.012, 2, dt);
    this.arenaRing.material.opacity = 0.42 + Math.sin(t * 2.3) * 0.12;
    this.arenaRing.rotation.z += dt * 0.08;
    this.corruption.material.opacity = 0.3 + Math.sin(t * 1.2) * 0.04 + this.enrage * 0.08;
    for (const rune of this.arenaRunes) {
      rune.mesh.position.y = 0.55 + Math.sin(t * 1.8 + rune.phase) * 0.22;
      rune.mesh.rotation.y += dt * 0.5;
    }
    this.domeLattice.rotation.y += dt * 0.02;
  }
}
