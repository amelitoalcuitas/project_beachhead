// Raycaster class compatible with the three.js subset the game uses.
import { Vec3, raySphereIntersect } from "./math.ts";
import { Mesh, type Object3D } from "./nodes.ts";
import { Mat4, Quat, Vec3 as PcVec3 } from "playcanvas";

export interface RayHit { object: Object3D; distance: number; normal: Vec3; }

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
  intersectObjects(objects: Object3D[], recursive = true): RayHit[] {
    const hits: RayHit[] = [];
    const testObject = (obj: Object3D) => {
      // View-model geometry is rendered in front of the camera but is never a
      // gameplay target or occluder. Callers can mark a hierarchy explicitly
      // to keep these meshes out of CPU ray tests.
      if (obj.userData.skipRaycast) return;
      if (obj instanceof Mesh && obj.geometry.kind === "box") {
        const hit = intersectBox(obj, this.ray.origin, this.ray.direction, this.near, this.far);
        if (hit) hits.push(hit);
        if (recursive) for (const child of obj.children) testObject(child);
        return;
      }
      const radius = obj.boundingRadius;
      if (radius > 0) {
        const center = obj.getWorldPosition(new Vec3());
        const scale = Math.max(Math.abs(obj.scale.x), Math.abs(obj.scale.y), Math.abs(obj.scale.z));
        const t = raySphereIntersect(this.ray.origin, this.ray.direction, center, radius * (scale || 1));
        if (t !== null && t >= this.near && t <= this.far) {
          hits.push({ object: obj, distance: t, normal: this.ray.origin.clone().addScaledVector(this.ray.direction, t).sub(center).normalize() });
        }
      }
      if (recursive) for (const c of obj.children) testObject(c);
    };
    for (const o of objects) testObject(o);
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }
  intersectObject(object: Object3D, recursive = true): RayHit[] {
    return this.intersectObjects([object], recursive);
  }
}

// Transform the ray into box space without normalizing: its parameter stays in world units.
function intersectBox(object: Mesh, origin: Vec3, direction: Vec3, near: number, far: number): RayHit | null {
  const hierarchy: Object3D[] = [];
  for (let node: Object3D | null = object; node; node = node.parent) hierarchy.unshift(node);
  const world = new Mat4();
  for (const node of hierarchy) {
    const rotation = new Quat().setFromEulerAngles(node.rotation.x * 180 / Math.PI, node.rotation.y * 180 / Math.PI, node.rotation.z * 180 / Math.PI);
    world.mul(new Mat4().setTRS(new PcVec3(node.position.x, node.position.y, node.position.z), rotation, new PcVec3(node.scale.x, node.scale.y, node.scale.z)));
  }
  const inverse = world.clone().invert();
  const localOrigin = inverse.transformPoint(new PcVec3(origin.x, origin.y, origin.z));
  const localDirection = inverse.transformVector(new PcVec3(direction.x, direction.y, direction.z));
  const parameters = object.geometry.parameters;
  const halfSize = { x: Number(parameters.width) / 2, y: Number(parameters.height) / 2, z: Number(parameters.depth) / 2 };
  let entry = -Infinity, exit = Infinity;
  let entryNormal = new PcVec3(), exitNormal = new PcVec3();
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(localDirection[axis]) < 1e-9) {
      if (Math.abs(localOrigin[axis]) > halfSize[axis]) return null;
      continue;
    }
    const first = (-halfSize[axis] - localOrigin[axis]) / localDirection[axis];
    const second = (halfSize[axis] - localOrigin[axis]) / localDirection[axis];
    const low = Math.min(first, second), high = Math.max(first, second);
    if (low > entry) { entry = low; entryNormal.set(0, 0, 0); entryNormal[axis] = first < second ? -1 : 1; }
    if (high < exit) { exit = high; exitNormal.set(0, 0, 0); exitNormal[axis] = first < second ? 1 : -1; }
    if (entry > exit) return null;
  }
  const distance = entry >= near ? entry : exit;
  if (distance < near || distance > far) return null;
  const normal = inverse.transpose().transformVector(entry >= near ? entryNormal : exitNormal).normalize();
  return { object, distance, normal: new Vec3(normal.x, normal.y, normal.z) };
}
