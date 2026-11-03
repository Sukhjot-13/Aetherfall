/**
 * Circular minimap. Bakes the island into an offscreen canvas once, then draws
 * the player arrow, objectives, shrines and nearby Veil creatures on top.
 */

import { clamp } from '../util/math.js';
import { LOCATIONS, WORLD } from '../world/locations.js';
import { objectiveTarget } from '../gameplay/questState.js';

const SIZE = 190;

export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../world/World.js').World} world
   */
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.map = document.createElement('canvas');
    this.map.width = 512;
    this.map.height = 512;
    this.mapCtx = this.map.getContext('2d');
    this.ready = false;
    this.frame = 0;
    this._bake();
  }

  /** World XZ -> minimap pixel. */
  _project(x, z, scale = SIZE) {
    const span = WORLD.size;
    return {
      x: ((x + span / 2) / span) * scale,
      y: ((z + span / 2) / span) * scale,
    };
  }

  /** Render the island once into the offscreen canvas. */
  _bake() {
    const size = this.map.width;
    const ctx = this.mapCtx;
    const hf = this.world.heightfield;
    const image = ctx.createImageData(size, size);
    const span = WORLD.size;
    const step = span / size;

    for (let py = 0; py < size; py++) {
      const z = -span / 2 + py * step;
      for (let px = 0; px < size; px++) {
        const x = -span / 2 + px * step;
        const h = hf.height(x, z);
        const i = (py * size + px) * 4;
        let r;
        let g;
        let b;
        if (h < -0.4) {
          const depth = clamp(-h / 22, 0, 1);
          r = 14 + (1 - depth) * 22;
          g = 42 + (1 - depth) * 42;
          b = 58 + (1 - depth) * 46;
        } else if (h < 2.6) {
          r = 168;
          g = 152;
          b = 112;
        } else if (hf.slope(x, z) > 0.62) {
          r = 104;
          g = 102;
          b = 96;
        } else if (h > 78) {
          r = 214;
          g = 222;
          b = 230;
        } else {
          const shade = 0.72 + clamp(h / 120, 0, 0.4);
          r = 74 * shade + 22;
          g = 106 * shade + 30;
          b = 66 * shade + 20;
        }
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = h < -0.4 ? 170 : 235;
      }
    }
    ctx.putImageData(image, 0, 0);

    // Coastline glow.
    ctx.strokeStyle = 'rgba(180, 232, 240, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let a = 0; a <= 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      const r = WORLD.islandRadius * 0.98;
      const p = this._project(Math.cos(rad) * r, Math.sin(rad) * r, size);
      if (a === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();

    // Vignette to fade the map edge into the frame.
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.5);
    gradient.addColorStop(0, 'rgba(4, 8, 12, 0)');
    gradient.addColorStop(1, 'rgba(4, 8, 12, 0.95)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    this.ready = true;
  }

  /** Distance in metres represented by the visible map. */
  get metresPerPixel() {
    return WORLD.size / SIZE;
  }

  /**
   * Redraw the minimap.
   * @param {{x:number,z:number}} player
   * @param {number} yaw
   * @param {{quest:object, enemies?:Array<any>, boss?:any, shards?:string[]}} state
   */
  draw(player, yaw, state = {}) {
    if (!this.ready) return;
    this.frame++;
    const ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(SIZE * dpr)) {
      this.canvas.width = Math.round(SIZE * dpr);
      this.canvas.height = Math.round(SIZE * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();

    // The map is a zoomed window around the player, north-up.
    const zoom = 1.85;
    const span = WORLD.size / zoom;
    const originX = -WORLD.size / 2;
    const originZ = -WORLD.size / 2;
    const srcSize = (span / WORLD.size) * this.map.width;
    const srcX = ((player.x - span / 2 - originX) / WORLD.size) * this.map.width;
    const srcY = ((player.z - span / 2 - originZ) / WORLD.size) * this.map.height;

    ctx.fillStyle = '#08131a';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.map, srcX, srcY, srcSize, srcSize, 0, 0, SIZE, SIZE);

    const project = (x, z) => ({
      x: ((x - (player.x - span / 2)) / span) * SIZE,
      y: ((z - (player.z - span / 2)) / span) * SIZE,
    });

    // POI markers.
    const drawPoi = (x, z, color, size, glyph) => {
      const p = project(x, z);
      if (p.x < -10 || p.x > SIZE + 10 || p.y < -10 || p.y > SIZE + 10) return;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (glyph) {
        ctx.fillStyle = '#07100f';
        ctx.font = '700 8px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph, p.x, p.y + 0.5);
      }
    };

    drawPoi(LOCATIONS.camp.x, LOCATIONS.camp.z, '#ffcf8a', 3.4, 'C');
    drawPoi(LOCATIONS.temple.x, LOCATIONS.temple.z, '#ffe9a8', 3.8, 'B');
    drawPoi(LOCATIONS.spawn.x, LOCATIONS.spawn.z, '#9fd8c8', 2.6, '');

    const collected = state.quest?.shards ?? [];
    for (const shard of LOCATIONS.shards) {
      if (collected.includes(shard.id)) continue;
      drawPoi(shard.x, shard.z, shard.color, 3, '◆');
    }

    // Objective marker.
    const target = state.quest ? objectiveTarget(state.quest) : null;
    if (target) {
      const p = project(target.x, target.z);
      const pulse = 0.6 + Math.sin(performance.now() * 0.004) * 0.4;
      ctx.strokeStyle = '#ffe9a8';
      ctx.globalAlpha = pulse;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Nearby enemies (radar blips).
    if (state.enemies) {
      for (const enemy of state.enemies) {
        if (!enemy.alive) continue;
        const d = Math.hypot(enemy.position.x - player.x, enemy.position.z - player.z);
        if (d > 120) continue;
        const p = project(enemy.position.x, enemy.position.z);
        if (p.x < 0 || p.x > SIZE || p.y < 0 || p.y > SIZE) continue;
        ctx.fillStyle = enemy.isWarden ? '#ff9a8a' : 'rgba(255, 107, 94, 0.75)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, enemy.isWarden ? 3 : 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player arrow (rotates with view yaw).
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ffe9a8';
    ctx.shadowColor = 'rgba(255, 233, 168, 0.9)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.lineTo(5.4, 5.5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-5.4, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
}
