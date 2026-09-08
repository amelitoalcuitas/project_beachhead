// Raycaster class compatible with the three.js subset the game uses.
import { Vec3, raySphereIntersect } from "./math.ts";
import type { Object3D } from "./nodes.ts";

export class Raycaster {
  ray: { origin: Vec3; direction: Vec3 };
  far: number;
  near: number;
  constructor(origin = new Vec3(), direction = new Vec3(0, 0, -1)) {
    this.ray = { origin, direction };
    this.far = Infinity;
    this.near = 0;
  }
  set(
    origin: Vec3 | { x: number; y: number; z: number },
    direction: Vec3 | { x: number; y: number; z: number },
  ) {
    this.ray.origin.copy(origin as Vec3);
    this.ray.direction.copy(direction as Vec3);
    return this;
  }
  intersectObjects(objects: Object3D[], recursive = true): { object: Object3D; distance: number }[] {
    const hits: { object: Object3D; distance: number }[] = [];
    const testObject = (obj: Object3D) => {
      // View-model geometry is rendered in front of the camera but is never a
      // gameplay target or occluder. Callers can mark a hierarchy explicitly
      // to keep these meshes out of CPU ray tests.
      if (obj.userData.skipRaycast) return;
      const radius = obj.boundingRadius;
      if (radius > 0) {
        const center = obj.getWorldPosition(new Vec3());
        const scale = Math.max(Math.abs(obj.scale.x), Math.abs(obj.scale.y), Math.abs(obj.scale.z));
        const t = raySphereIntersect(this.ray.origin, this.ray.direction, center, radius * (scale || 1));
        if (t !== null && t >= this.near && t <= this.far) {
          hits.push({ object: obj, distance: t });
        }
      }
      if (recursive) for (const c of obj.children) testObject(c);
    };
    for (const o of objects) testObject(o);
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }
  intersectObject(object: Object3D, recursive = true): { object: Object3D; distance: number }[] {
    return this.intersectObjects([object], recursive);
  }
}
