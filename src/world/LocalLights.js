import * as THREE from 'three';

/** Render a bounded number of nearby animated landmark lights. */
export class LocalLights {
  constructor(scene, root, limit = 4) {
    this.sources = [];
    root.traverse((object) => {
      if (!object.isPointLight) return;
      // Retain transforms, intensity and visibility for quest animations,
      // while keeping every source out of the main camera's light list.
      object.layers.set(31);
      this.sources.push(object);
    });
    this.pool = Array.from({ length: limit }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      scene.add(light);
      return light;
    });
    this.position = new THREE.Vector3();
  }

  update(playerPos) {
    if (!playerPos) return;
    const candidates = [];
    for (const source of this.sources) {
      if (!source.visible || source.intensity <= 0) continue;
      source.getWorldPosition(this.position);
      const distance = this.position.distanceTo(playerPos);
      if (source.distance > 0 && distance > source.distance + 25) continue;
      candidates.push({ source, distance, position: this.position.clone() });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.pool.forEach((light, i) => {
      const candidate = candidates[i];
      if (!candidate) { light.intensity = 0; return; }
      const source = candidate.source;
      light.position.copy(candidate.position);
      light.color.copy(source.color);
      light.intensity = source.intensity;
      light.distance = source.distance;
      light.decay = source.decay;
    });
  }
}
