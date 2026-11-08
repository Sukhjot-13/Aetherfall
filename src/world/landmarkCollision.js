/** Circular wall colliders for Embercastle, leaving the south gate open. */
export function castleWallColliders(castle) {
  const colliders = [];
  for (let p = -8; p <= 8; p += 4) {
    for (const side of [-1, 1]) {
      colliders.push({ x: castle.x + side * 12, z: castle.z + p, r: 1.65 });
      if (Math.abs(p) >= 4) colliders.push({ x: castle.x + p, z: castle.z + side * 12, r: 1.65 });
    }
  }
  colliders.push({ x: castle.x, z: castle.z - 12, r: 1.65 });
  return colliders;
}
