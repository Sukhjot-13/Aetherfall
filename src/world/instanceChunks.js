import * as THREE from 'three';

/** Partition a world-space instanced mesh into independently culled tiles. */
export function partitionInstances(mesh, cellSize = 512) {
  const groups = new Map();
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    point.setFromMatrixPosition(matrix);
    const key = `${Math.floor(point.x / cellSize)},${Math.floor(point.z / cellSize)}`;
    const group = groups.get(key) ?? [];
    group.push({ index: i, rank: mesh.userData.treeRanks?.[i] });
    groups.set(key, group);
  }
  const color = new THREE.Color();
  const chunks = [];
  for (const entries of groups.values()) {
    if (mesh.userData.treeRanks) entries.sort((a, b) => a.rank - b.rank);
    const chunk = new THREE.InstancedMesh(mesh.geometry, mesh.material, entries.length);
    chunk.name = mesh.name;
    chunk.castShadow = mesh.castShadow;
    chunk.receiveShadow = mesh.receiveShadow;
    chunk.customDepthMaterial = mesh.customDepthMaterial;
    const ranks = [];
    entries.forEach((entry, i) => {
      mesh.getMatrixAt(entry.index, matrix);
      chunk.setMatrixAt(i, matrix);
      if (mesh.instanceColor) {
        mesh.getColorAt(entry.index, color);
        chunk.setColorAt(i, color);
      }
      if (mesh.userData.treeRanks) ranks.push(entry.rank);
    });
    chunk.instanceMatrix.needsUpdate = true;
    if (chunk.instanceColor) chunk.instanceColor.needsUpdate = true;
    chunk.computeBoundingSphere();
    chunks.push({ mesh: chunk, ranks: mesh.userData.treeRanks ? ranks : null, max: entries.length });
  }
  return chunks;
}

/** Count a sorted tile's instances that belong to the selected quality tier. */
export function countRanksBelow(ranks, limit) {
  let lo = 0, hi = ranks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ranks[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
