/** Static spatial index for the world's circular prop colliders. */
export class CollisionGrid {
  constructor(colliders, cellSize = 24) {
    this.cellSize = cellSize;
    this.cells = new Map();
    for (const collider of colliders) {
      const radius = Math.max(0, collider.r ?? 0);
      const minX = Math.floor((collider.x - radius) / cellSize);
      const maxX = Math.floor((collider.x + radius) / cellSize);
      const minZ = Math.floor((collider.z - radius) / cellSize);
      const maxZ = Math.floor((collider.z + radius) / cellSize);
      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        const key = `${x},${z}`;
        const cell = this.cells.get(key) ?? [];
        cell.push(collider);
        this.cells.set(key, cell);
      }
    }
  }

  /** Conservative candidate list for a circular query; exact tests are left to callers. */
  query(x, z, radius = 0) {
    const size = this.cellSize;
    const found = new Set();
    const minX = Math.floor((x - radius) / size), maxX = Math.floor((x + radius) / size);
    const minZ = Math.floor((z - radius) / size), maxZ = Math.floor((z + radius) / size);
    for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
      for (const collider of this.cells.get(`${gx},${gz}`) ?? []) {
        if (collider.active !== false) found.add(collider);
      }
    }
    return [...found];
  }
}
