import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge explicitly marked, immutable siblings while retaining their parent and material. */
export function batchStaticMeshes(root, excluded = new Set()) {
  let saved = 0;
  const parents = [];
  root.traverse((object) => parents.push(object));
  for (const parent of parents) {
    const groups = new Map();
    for (const mesh of parent.children) {
      if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh || !mesh.userData.staticStructure ||
          excluded.has(mesh) || !mesh.visible || mesh.children.length || Array.isArray(mesh.material) ||
          mesh.material.transparent || Object.keys(mesh.geometry.morphAttributes).length) continue;
      mesh.updateMatrix();
      if (mesh.matrix.determinant() <= 0) continue;
      const attributes = Object.entries(mesh.geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
        .map(([name, attr]) => `${name}:${attr.itemSize}:${attr.normalized}:${attr.array.constructor.name}`).join('|');
      const key = `${mesh.material.id}/${mesh.castShadow}/${mesh.receiveShadow}/${mesh.renderOrder}/${mesh.layers.mask}/${attributes}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh);
    }
    for (const meshes of groups.values()) {
      if (meshes.length < 3) continue;
      const parts = meshes.map((mesh) => {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrix);
        return geometry;
      });
      const geometry = mergeGeometries(parts, false);
      parts.forEach((part) => part.dispose());
      if (!geometry) continue;
      const first = meshes[0];
      const merged = new THREE.Mesh(geometry, first.material);
      merged.name = 'Static landmark details';
      merged.castShadow = first.castShadow;
      merged.receiveShadow = first.receiveShadow;
      merged.renderOrder = first.renderOrder;
      merged.layers.mask = first.layers.mask;
      // Replacing siblings keeps each landmark's culling and visibility scope.
      meshes.forEach((mesh) => parent.remove(mesh));
      parent.add(merged);
      saved += meshes.length - 1;
    }
  }
  return saved;
}
