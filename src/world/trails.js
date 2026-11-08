import { clamp, smoothstep } from '../util/math.js';
import { LOCATIONS } from './locations.js';

// The old Lantern Way connects the opening, camp and Beacon. Intermediate
// bends keep the route legible through the hills and near the lanterns.
export const MAIN_TRAIL = Object.freeze([
  [LOCATIONS.spawn.x, LOCATIONS.spawn.z], [62, 392], [88, 310],
  [LOCATIONS.camp.x, LOCATIONS.camp.z], [58, 210], [10, 108],
  [-34, 8], [-12, -120], [8, -240], [LOCATIONS.temple.x, LOCATIONS.temple.z],
].map((point) => Object.freeze(point)));

/** 1 at the centre of the trail, smoothly fading to 0 at its edge. */
export function trailWeight(x, z) {
  if (x < -45 || x > 143 || z < -343 || z > 441) return 0;
  let minSq = Infinity;
  for (let i = 1; i < MAIN_TRAIL.length; i++) {
    const [ax, az] = MAIN_TRAIL[i - 1], [bx, bz] = MAIN_TRAIL[i];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const px = x - ax - t * dx, pz = z - az - t * dz;
    minSq = Math.min(minSq, px * px + pz * pz);
  }
  return 1 - smoothstep(1.5, 4, Math.sqrt(minSq));
}

/** Generate the same route for per-pixel terrain shading. */
export function trailShader() {
  const segment = (a, b) => `trailDistanceSquared(p, vec2(${a[0]}.0, ${a[1]}.0), vec2(${b[0]}.0, ${b[1]}.0))`;
  const terms = MAIN_TRAIL.slice(1).map((point, i) => `trailD = min(trailD, ${segment(MAIN_TRAIL[i], point)});`).join('\n');
  return `
float trailDistanceSquared(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  vec2 delta = p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return dot(delta, delta);
}
float trailMask(vec2 p) {
  if (p.x < -45.0 || p.x > 143.0 || p.y < -343.0 || p.y > 441.0) return 0.0;
  float trailD = 10000.0;
  ${terms}
  return 1.0 - smoothstep(1.5, 4.0, sqrt(trailD));
}`;
}
