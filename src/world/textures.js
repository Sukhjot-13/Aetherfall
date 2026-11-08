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

/**
 * Procedural bark: vertical furrows with moss speckle. Tiles vertically for
 * trunk wraps. Warm brown-grey, not flat tan.
 */
export function createBarkTexture(size = 256) {
  const { canvas, ctx } = canvas2d(size, size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 8;
      const v = (y / size) * 2;
      const furrow = fbm2(u, v, 4, 17) * 0.5 + 0.5;
      const ridge = Math.pow(Math.abs(Math.sin(u * Math.PI + fbm2(u * 0.7, v, 2, 23))), 1.6);
      const n = valueNoise2(x * 0.08, y * 0.08, 31) * 0.5 + 0.5;
      let r = 78 + furrow * 44 - ridge * 30 + n * 18;
      let g = 60 + furrow * 30 - ridge * 20 + n * 14;
      let b = 42 + furrow * 20 - ridge * 12 + n * 10;
      const moss = (fbm2(u * 0.6 + 9, v * 0.6, 3, 41) > 0.62) ? 22 : 0;
      g += moss;
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      const i = (y * size + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Pine needle mass: a drooping branch with dense needles, transparent
 * background for alpha-tested cards. Two layered tiers of needles give
 * depth; centre twig anchors the silhouette.
 */
export function createNeedleTexture() {
  const W = 256;
  const H = 192;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.clearRect(0, 0, W, H);
  // Twig
  ctx.strokeStyle = 'rgba(58, 40, 26, 1)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(W * 0.06, H * 0.52);
  ctx.quadraticCurveTo(W * 0.5, H * 0.42, W * 0.95, H * 0.30);
  ctx.stroke();
  // Needles: short strokes fanning downward from the twig.
  const needle = (x, y, len, ang, tone) => {
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    const g = ctx.createLinearGradient(x, y, x + dx, y + dy);
    g.addColorStop(0, `rgba(${52 + tone * 0.7}, ${92 + tone * 0.9}, ${54 + tone * 0.5}, 1)`);
    g.addColorStop(1, `rgba(${76 + tone}, ${134 + tone}, ${74 + tone * 0.6}, 1)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + dx * 0.5, y + dy * 0.5 + 3, x + dx, y + dy);
    ctx.stroke();
  };
  const rng = (i) => {
    let s = i * 16807 % 2147483647;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  };
  const rand = rng(777);
  for (let layer = 0; layer < 2; layer++) {
    const n = layer === 0 ? 120 : 80;
    for (let i = 0; i < n; i++) {
      const t = 0.05 + rand() * 0.9;
      const x = W * 0.06 + t * (W * 0.89);
      const y = H * 0.52 - t * H * 0.2 + (rand() - 0.5) * 36 + layer * 10;
      const len = 26 + rand() * 42 - layer * 4;
      const ang = 1.15 + (rand() - 0.5) * 0.9; // downward fan
      needle(x, y, len, ang, 10 + rand() * 34);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Broadleaf cluster: twig with oval leaves (mid-green, sunlit tips).
 * Alpha-tested card for canopy shells.
 */
export function createLeafTexture() {
  const W = 256;
  const H = 256;
  const { canvas, ctx } = canvas2d(W, H);
  ctx.clearRect(0, 0, W, H);
  const leafShape = (x, y, len, wid, ang, tone, alpha = 1) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, `rgba(${40 + tone * 0.6}, ${74 + tone * 0.8}, ${34 + tone * 0.4}, ${alpha})`);
    g.addColorStop(1, `rgba(${78 + tone}, ${128 + tone}, ${58 + tone * 0.6}, ${alpha})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(wid, len * 0.35, 0, len);
    ctx.quadraticCurveTo(-wid, len * 0.35, 0, 0);
    ctx.fill();
    // Centre vein
    ctx.strokeStyle = `rgba(${30 + tone * 0.5}, ${56 + tone * 0.6}, ${26 + tone * 0.3}, ${alpha * 0.7})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(0, len - 2);
    ctx.stroke();
    ctx.restore();
  };
  const rng = (i) => {
    let s = i * 48271 % 2147483647;
    return () => (s = (s * 48271) % 2147483647) / 2147483647;
  };
  const rand = rng(4242);
  // Twigs
  ctx.strokeStyle = 'rgba(66, 46, 30, 1)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 5; i++) {
    const x = W * (0.2 + rand() * 0.6);
    const y = H * (0.35 + rand() * 0.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 90, y - 40, x + (rand() - 0.5) * 120, y - 70 - rand() * 40);
    ctx.stroke();
  }
  for (let i = 0; i < 46; i++) {
    const x = W * (0.12 + rand() * 0.76);
    const y = H * (0.10 + rand() * 0.68);
    const len = 26 + rand() * 30;
    const wid = 10 + rand() * 9;
    const ang = rand() * Math.PI * 2;
    leafShape(x, y, len, wid, ang, rand() * 60);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Stone-block albedo: coursed blocks with mortar lines and per-block tone
 * variation. Tiled for structure walls.
 */
export function createStoneTexture(size = 256) {
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  const rows = 6;
  const cols = 4;
  const blockWidth = size / cols;
  const blockHeight = size / rows;
  const tones = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) =>
      (fbm2(col * 3.1 + row * 7.7, row * 2.3, 2, 555) * 0.5 + 0.5) * 36 - 18));
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / blockHeight);
    const localY = y - row * blockHeight;
    // Alternate half-block offsets make a running bond that tiles seamlessly.
    const offset = row % 2 ? blockWidth / 2 : 0;
    for (let x = 0; x < size; x++) {
      const shifted = (x + offset) % size;
      const col = Math.floor(shifted / blockWidth);
      const localX = shifted - col * blockWidth;
      const tone = tones[row][col];
      const edge = (localX < 2 || localX > blockWidth - 2 || localY < 2 || localY > blockHeight - 2) ? -27 : 0;
      const n = valueNoise2(x * 0.07, y * 0.07, 561) * 22 - 11;
      const i = (y * size + x) * 4;
      image.data[i] = 138 + tone + edge + n;
      image.data[i + 1] = 135 + tone + edge + n;
      image.data[i + 2] = 122 + tone + edge + n;
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

/** Wood-plank albedo: horizontal grain streaks and plank seams. */
export function createWoodTexture(size = 256) {
  const { canvas, ctx } = canvas2d(size);
  const image = ctx.createImageData(size, size);
  const planks = 5;
  for (let y = 0; y < size; y++) {
    const plank = Math.floor((y / size) * planks);
    const tone = (fbm2(plank * 5.3, 1.1, 2, 777) * 0.5 + 0.5) * 34 - 17;
    for (let x = 0; x < size; x++) {
      const grain = Math.sin((x * 0.11 + fbm2(x * 0.02, y * 0.05, 2, 779) * 30) * 1.7) * 14;
      const seam = (y % Math.floor(size / planks) < 2) ? -38 : 0;
      const n = valueNoise2(x * 0.09, y * 0.09, 781) * 16 - 8;
      const i = (y * size + x) * 4;
      image.data[i] = 104 + tone + grain + seam + n;
      image.data[i + 1] = 76 + tone + grain + seam + n;
      image.data[i + 2] = 54 + tone * 0.7 + grain + seam + n;
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
