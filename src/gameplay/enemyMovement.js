import { clamp } from '../util/math.js';

export const MELEE_HALF_ANGLE = 0.9;

/** Match a directional enemy strike to its visible sector and vertical reach. */
export function inEnemyStrike(origin, yaw, target, reach, verticalReach, halfAngle = MELEE_HALF_ANGLE) {
  const dx = target.x - origin.x, dz = target.z - origin.z;
  const distance = Math.hypot(dx, dz);
  if (distance > reach || Math.abs(target.y - origin.y) > verticalReach) return false;
  if (distance < 1e-6 || halfAngle >= Math.PI) return true;
  const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
  return (dx * forwardX + dz * forwardZ) / distance >= Math.cos(halfAngle);
}

/** Entry fraction of a segment into a circle, or null if it does not enter. */
export function segmentCircleEntry(start, end, circle, padding = 0) {
  const dx = end.x - start.x, dz = end.z - start.z;
  const ox = start.x - circle.x, oz = start.z - circle.z;
  const radius = Math.max(0, circle.r + padding);
  const c = ox * ox + oz * oz - radius * radius;
  // A projectile spawned inside a prop can leave it; it must not hit the
  // same collider on the very first frame.
  if (c <= 0) return null;
  const a = dx * dx + dz * dz;
  if (a < 1e-10) return null;
  const b = 2 * (ox * dx + oz * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Entry fraction of a 3D segment into a sphere. */
export function segmentSphereEntry(start, end, center, radius) {
  const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const ox = start.x - center.x, oy = start.y - center.y, oz = start.z - center.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-10) return null;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Deflect a desired heading around the nearest obstacle in its path. */
export function steerAround(position, velocity, radius, colliders, preferredSide = 1) {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < 1e-5) return { x: 0, z: 0 };
  const nx = velocity.x / speed, nz = velocity.z / speed;
  let best = null;
  for (const c of colliders ?? []) {
    if (c.active === false) continue;
    const dx = c.x - position.x, dz = c.z - position.z;
    const along = dx * nx + dz * nz;
    const clearance = radius + c.r + 0.5;
    if (along < -clearance || along > clearance + 3) continue;
    const side = nx * dz - nz * dx;
    if (Math.abs(side) >= clearance) continue;
    if (!best || along < best.along) best = { along, side, clearance };
  }
  if (!best) return { x: velocity.x, z: velocity.z };
  const side = Math.abs(best.side) < 0.15 ? preferredSide : -Math.sign(best.side);
  const weight = clamp((best.clearance - Math.abs(best.side)) / best.clearance, 0, 1);
  const sx = nx - nz * side * (1.6 * weight);
  const sz = nz + nx * side * (1.6 * weight);
  const length = Math.hypot(sx, sz) || 1;
  return { x: sx / length * speed, z: sz / length * speed };
}
