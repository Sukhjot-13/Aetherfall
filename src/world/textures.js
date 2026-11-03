/**
 * Runtime-generated textures. Keeping every map procedural means the game has
 * no binary asset dependencies and always matches the colour grading.
 */

import * as THREE from 'three';
import { fbm2, valueNoise2 } from '../util/noise.js';

function canvas2d(width, height = width) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

/**
 * Tiling grayscale noise used as a terrain detail map.
 * @param {{size?:number, scale?:number, octaves?:number, seed?:number, contrast?:number, base?:number}} [opts]
 */
export function createNoiseTexture(opts = {}) {
  const { size = 512, scale = 7, octaves = 5, seed = 1, contrast = 0.5, base = 0.82 } = opts;
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm2((x / size) * scale, (y / size) * scale, octaves, seed) * 0.5 + 0.5;
      const v = Math.max(0, Math.min(255, (base + (n - 0.5) * contrast) * 255));
      const i = (y * size + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Tiling normal map derived from the same noise field.
 * @param {{size?:number, scale?:number, seed?:number, strength?:number}} [opts]
 */
export function createNormalTexture(opts = {}) {
  const { size = 256, scale = 8, seed = 3, strength = 2.4 } = opts;
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  const sample = (x, y) => fbm2((x / size) * scale, (y / size) * scale, 4, seed);
  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = sample((x + 1) % size, y) - sample((x - 1 + size) % size, y);
      const dy = sample(x, (y + 1) % size) - sample(x, (y - 1 + size) % size);
      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * size + x) * 4;
      image.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      image.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Grass-blade alpha card (three blades per card). */
/**
 * One grass tuft. The silhouette matters more than the blade count: a tuft has
 * to read as a solid clump of foliage, not as a handful of isolated spikes, so
 * the bottom third is filled with overlapping thatch and the blades are wide
 * enough to survive mipmapping at a distance.
 */
export function createGrassTexture() {
  const W = 256;
  const H = 256;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.clearRect(0, 0, W, H);

  /**
   * A single curved leaf. Straight triangles read as a bristle brush; a leaf
   * needs a bent centreline, a tapered body and a slightly blunt tip.
   */
  const leaf = (baseX, lean, width, topY, tone, curve = 0.55) => {
    const gradient = ctx.createLinearGradient(0, H, 0, topY);
    gradient.addColorStop(0, `rgba(${30 + tone * 0.6}, ${54 + tone * 0.7}, ${26 + tone * 0.4}, 1)`);
    gradient.addColorStop(0.45, `rgba(${66 + tone * 0.8}, ${104 + tone * 0.8}, ${46 + tone * 0.5}, 1)`);
    gradient.addColorStop(0.82, `rgba(${104 + tone * 0.9}, ${148 + tone * 0.9}, ${68 + tone * 0.6}, 1)`);
    gradient.addColorStop(1, `rgba(${156 + tone}, ${196 + tone}, ${108 + tone * 0.6}, 1)`);
    ctx.fillStyle = gradient;

    const steps = 16;
    const left = [];
    const right = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = H + (topY - H) * t;
      const x = baseX + lean * Math.pow(t, 1.5) * curve + lean * t * (1 - curve);
      // Taper to a soft point rather than a needle.
      const w = Math.max(2.2, width * Math.pow(1 - t, 0.62));
      left.push([x - w, y]);
      right.push([x + w, y]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], H);
    for (const [x, y] of left) ctx.lineTo(x, y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fill();
  };

  // Low thatch: fills the base of the tuft so the ground never shows through.
  const thatch = ctx.createLinearGradient(0, H, 0, H * 0.55);
  thatch.addColorStop(0, 'rgba(30, 52, 24, 1)');
  thatch.addColorStop(0.55, 'rgba(56, 88, 38, 1)');
  thatch.addColorStop(1, 'rgba(86, 126, 52, 0.3)');
  ctx.fillStyle = thatch;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 14) {
    ctx.lineTo(x, H * (0.54 + ((x * 7919) % 41) / 100));
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Back layer: shorter, darker leaves.
  const back = [
    [8, -34, 13, 78, 2], [30, -26, 14, 62, 6], [52, -20, 13, 74, 3],
    [74, -12, 14, 58, 9], [96, -6, 13, 70, 5], [118, 0, 14, 60, 11],
    [140, 6, 13, 72, 4], [162, 12, 14, 56, 8], [184, 20, 13, 68, 3],
    [206, 26, 14, 74, 7], [228, 32, 13, 60, 5], [248, 36, 12, 80, 2],
  ];
  for (const [x, lean, width, top, tone] of back) leaf(x, lean, width, top, tone, 0.35);

  // Front layer: taller, lighter leaves overlapping the back layer.
  const front = [
    [2, -42, 15, 34, 14], [26, -30, 16, 14, 22], [50, -22, 15, 44, 10],
    [72, -14, 16, 2, 30], [96, -6, 17, 26, 18], [120, 0, 16, 8, 34],
    [144, 6, 17, 30, 16], [168, 12, 16, 4, 28], [192, 18, 17, 38, 12],
    [216, 26, 16, 16, 24], [240, 34, 15, 48, 8], [110, -2, 12, 52, 20],
    [156, 8, 12, 56, 18], [62, -18, 11, 64, 12], [206, 22, 11, 60, 14],
  ];
  for (const [x, lean, width, top, tone] of front) leaf(x, lean, width, top, tone, 0.7);

  // Canvas transparent pixels are (0,0,0,0); averaged with blade texels during
  // mipmapping they create black fringes. Give the empty RGB a grass tone while
  // keeping alpha at zero so filtered edges stay green.
  const image = ctx.getImageData(0, 0, W, H);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 12) {
      data[i] = 80;
      data[i + 1] = 124;
      data[i + 2] = 62;
    }
  }
  ctx.putImageData(image, 0, 0);

  // One-pixel soften: crisp vector edges read as shark teeth once the tuft is
  // stretched across a quad, a slight blur reads as foliage.
  const soft = canvas2d(W, H);
  soft.ctx.filter = 'blur(1.1px)';
  soft.ctx.drawImage(canvas, 0, 0);
  soft.ctx.filter = 'none';

  const texture = new THREE.CanvasTexture(soft.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Vertical light-shaft gradient: solid at the base, dissolving to nothing at
 * the top so a beacon beam fades into the sky instead of ending on a hard edge.
 */
export function createBeamTexture() {
  const { canvas, ctx } = canvas2d(8, 256);
  const gradient = ctx.createLinearGradient(0, 256, 0, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, 0.62)');
  gradient.addColorStop(0.55, 'rgba(255, 255, 255, 0.22)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Soft radial glow sprite. */
export function createGlowTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const { canvas, ctx } = canvas2d(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Soft flame silhouette for fire spell billboards. Transparent background,
 * bright core and ragged tongues, normal-blended so it reads in daylight.
 */
export function createFlameTexture(size = 128) {
  const { canvas, ctx } = canvas2d(size, size);
  ctx.clearRect(0, 0, size, size);
  const grad = ctx.createRadialGradient(size / 2, size * 0.74, size * 0.04, size / 2, size * 0.7, size * 0.52);
  grad.addColorStop(0, 'rgba(255, 248, 210, 1)');
  grad.addColorStop(0.28, 'rgba(255, 196, 92, 0.95)');
  grad.addColorStop(0.62, 'rgba(255, 96, 26, 0.62)');
  grad.addColorStop(1, 'rgba(110, 18, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.02);
  ctx.bezierCurveTo(size * 0.78, size * 0.3, size * 0.9, size * 0.64, size * 0.5, size * 0.99);
  ctx.bezierCurveTo(size * 0.1, size * 0.64, size * 0.22, size * 0.3, size * 0.5, size * 0.02);
  ctx.fill();
  // A few brighter tongues give the silhouette a ragged edge.
  for (let i = 0; i < 4; i++) {
    const x = size * (0.32 + i * 0.12);
    const h = size * (0.42 + (i % 2) * 0.18);
    const g = ctx.createLinearGradient(x, size, x, size - h);
    g.addColorStop(0, 'rgba(255, 236, 170, 0.9)');
    g.addColorStop(1, 'rgba(255, 120, 30, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - size * 0.055, size);
    ctx.quadraticCurveTo(x + size * 0.04, size - h * 0.55, x, size - h);
    ctx.quadraticCurveTo(x - size * 0.03, size - h * 0.5, x + size * 0.055, size);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * NPC / landmark name plate.
 * @param {string} title
 * @param {string} [subtitle]
 */
export function createNameTag(title, subtitle = '') {
  const { canvas, ctx } = canvas2d(512, 128);
  ctx.clearRect(0, 0, 512, 128);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffe9a8';
  ctx.font = '600 40px "Iowan Old Style", Palatino, Georgia, serif';
  ctx.fillText(title, 256, 54);
  if (subtitle) {
    ctx.fillStyle = 'rgba(220, 235, 240, 0.78)';
    ctx.font = '500 22px -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(subtitle, 256, 92);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Small floating health bar with a live 2D context for cheap updates.
 * @param {{width?:number, height?:number, color?:string}} [opts]
 */
export function createHealthBar(opts = {}) {
  const { width = 128, height = 14, color = '#ff6b5e' } = opts;
  const { canvas, ctx } = canvas2d(width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  let ratio = 1;
  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(4, 8, 10, 0.72)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.fillStyle = color;
    ctx.fillRect(2, 2, Math.max(0, (width - 4) * ratio), height - 4);
    texture.needsUpdate = true;
  };
  draw();
  return {
    texture,
    set(nextRatio) {
      ratio = Math.max(0, Math.min(1, nextRatio));
      draw();
    },
  };
}

/** Soft cloud puff sprite for low-altitude mist. */
export function createCloudTexture(size = 256) {
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const r = Math.hypot(nx, ny) * 2;
      const n = valueNoise2(x * 0.035, y * 0.035, 9) * 0.5 + 0.5;
      const a = Math.max(0, 1 - r) ** 2 * (0.45 + n * 0.55);
      const i = (y * size + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
