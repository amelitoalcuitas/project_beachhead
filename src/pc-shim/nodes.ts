// Scene-graph nodes that mirror Group/Mesh/Line/Sprite/Light/Camera/Scene
// from three.js. The renderer mirrors them into PlayCanvas each frame.
import { Vec2, Vec3 } from "./math.ts";
import type { GeometryBase } from "./geometry.ts";
import type { Material, SpriteMaterial } from "./materials.ts";
import { makeColor } from "./materials.ts";

let nextId = 1;

export class Object3D {
  id: number;
  name = "";
  type = "Object3D";
  parent: Object3D | null = null;
  children: Object3D[] = [];
  position: Vec3 = new Vec3();
  rotation: Euler = {
    x: 0, y: 0, z: 0, order: "XYZ",
    set(x: number, y: number, z: number, order = "XYZ") { this.x = x; this.y = y; this.z = z; this.order = order; return this; },
  };
  quaternion: Quaternion = {
    set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this; },
    x: 0, y: 0, z: 0, w: 1,
    setFromUnitVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
      const ax = a.x, ay = a.y, az = a.z;
      const bx = b.x, by = b.y, bz = b.z;
      const dot = ax * bx + ay * by + az * bz;
      if (dot > 0.999999) { this.x = 0; this.y = 0; this.z = 0; this.w = 1; return this; }
      if (dot < -0.999999) {
        let axisX = 1, axisY = 0, axisZ = 0;
        if (Math.abs(ay) < 0.5) { axisX = 0; axisY = 1; axisZ = 0; }
        this.x = axisX * Math.SQRT1_2;
        this.y = axisY * Math.SQRT1_2;
        this.z = axisZ * Math.SQRT1_2;
        this.w = 0;
        return this;
      }
      this.x = ay * bz - az * by;
      this.y = az * bx - ax * bz;
      this.z = ax * by - ay * bx;
      this.w = 1 + dot;
      const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
      this.x /= l; this.y /= l; this.z /= l; this.w /= l;
      return this;
    },
  };
  scale: Vec3 = new Vec3(1, 1, 1);
  visible = true;
  castShadow = false;
  receiveShadow = false;
  userData: Record<string, any> = {};
  material: Material | SpriteMaterial | null = null;
  geometry: GeometryBase | null = null;
  boundingRadius = 0;
  matrixWorldAutoUpdate = true;
  // Three.js uses these for culling / transform updates; the shim keeps them as
  // no-op stubs.
  matrix: { elements: number[] } = { elements: new Array(16).fill(0) };
  matrixWorld: { elements: number[] } = { elements: new Array(16).fill(0) };
  frustumCulled = true;
  renderOrder = 0;
  layers: { mask: number } = { mask: 1 };
  constructor() { this.id = nextId++; }
  add(...children: Object3D[]) {
    for (const child of children) {
      if (child.parent) child.parent.remove(child);
      child.parent = this;
      this.children.push(child);
    }
    return this;
  }
  remove(child: Object3D) {
    const i = this.children.indexOf(child);
    if (i !== -1) { this.children.splice(i, 1); child.parent = null; }
    return this;
  }
  removeFromParent() {
    if (this.parent) this.parent.remove(this);
    return this;
  }
  traverse(fn: (node: Object3D) => void) {
    fn(this);
    for (const child of [...this.children]) child.traverse(fn);
  }
  getObjectByName(name: string): Object3D | undefined {
    if (this.name === name) return this;
    for (const child of this.children) {
      const r = child.getObjectByName(name);
      if (r) return r;
    }
    return undefined;
  }
  rotateY(angle: number) { this.rotation.y += angle; }
  rotateX(angle: number) { this.rotation.x += angle; }
  rotateZ(angle: number) { this.rotation.z += angle; }
  rotateOnAxis(_axis: { x: number; y: number; z: number }, _angle: number) { /* placeholder */ }
  translateX(d: number) { this.position.x += d; }
  translateY(d: number) { this.position.y += d; }
  translateZ(d: number) { this.position.z += d; }
  translateOnAxis(_axis: { x: number; y: number; z: number }, _distance: number) { /* placeholder */ }
  getWorldPosition(target: Vec3) {
    target.set(0, 0, 0);
    let node: Object3D | null = this;
    const chain: Object3D[] = [];
    while (node) { chain.unshift(node); node = node.parent; }
    for (const n of chain) {
      // The game scene is intentionally shallow, but apply parent scale and
      // Euler rotation so child muzzle/occluder positions stay correct.
      if (n.parent) {
        const parent = n.parent;
        const local = n.position.clone().multiplyScalar(1);
        local.x *= parent.scale.x; local.y *= parent.scale.y; local.z *= parent.scale.z;
        local.applyAxisAngle({ x: 1, y: 0, z: 0 }, parent.rotation.x);
        local.applyAxisAngle({ x: 0, y: 1, z: 0 }, parent.rotation.y);
        local.applyAxisAngle({ x: 0, y: 0, z: 1 }, parent.rotation.z);
        target.add(local);
      } else target.add(n.position);
    }
    return target;
  }
  getWorldQuaternion(target: Quaternion) { target.x = this.quaternion.x; target.y = this.quaternion.y; target.z = this.quaternion.z; target.w = this.quaternion.w; return target; }
  lookAt(target: { x: number; y: number; z: number }) {
    const world = this.getWorldPosition(new Vec3());
    const dx = target.x - world.x;
    const dy = target.y - world.y;
    const dz = target.z - world.z;
    this.rotation.y = Math.atan2(dx, -dz);
    this.rotation.x = Math.atan2(dy, Math.hypot(dx, dz));
    return this;
  }
  // Build a 4x4 column-major transform matrix from this.position / rotation /
  // scale. The shim's matrix matches three.js (column-major, last column is
  // translation). We rotate in YXZ order.
  updateMatrix() {
    const e = this.matrix.elements;
    const rx = this.rotation.x, ry = this.rotation.y, rz = this.rotation.z;
    const sx = this.scale.x, sy = this.scale.y, sz = this.scale.z;
    const tx = this.position.x, ty = this.position.y, tz = this.position.z;
    const cx = Math.cos(rx), sx_ = Math.sin(rx);
    const cy = Math.cos(ry), sy_ = Math.sin(ry);
    const cz = Math.cos(rz), sz_ = Math.sin(rz);
    // Compose (yaw * pitch) * roll in column-major form.
    const a00 = cy * cz + 0 * sz_ + sy_ * 0;
    const a01 = -cy * sz_ + 0 * cz + sy_ * 0;
    const a02 = sy_;
    const a10 = sx_ * sy_ * cz + cx * sz_;
    const a11 = -sx_ * sy_ * sz_ + cx * cz;
    const a12 = -sx_ * cy;
    const a20 = -cx * sy_ * cz + sx_ * sz_;
    const a21 = cx * sy_ * sz_ + sx_ * cz;
    const a22 = cx * cy;
    e[0] = a00 * sx; e[1] = a10 * sy; e[2] = a20 * sz; e[3] = 0;
    e[4] = a01 * sx; e[5] = a11 * sy; e[6] = a21 * sz; e[7] = 0;
    e[8] = a02 * sx; e[9] = a12 * sy; e[10] = a22 * sz; e[11] = 0;
    e[12] = tx; e[13] = ty; e[14] = tz; e[15] = 1;
  }
  updateMatrixWorld(_force = false) {
    this.updateMatrix();
    for (const child of this.children) child.updateMatrixWorld();
  }
}

export class Group extends Object3D {
  constructor() { super(); this.type = "Group"; }
}

export class Mesh<G extends GeometryBase = GeometryBase, M extends Material = Material> extends Object3D {
  isMesh = true;
  override geometry: G | null = null;
  override material: M | null = null;
  constructor(geometry?: G, material?: M) {
    super();
    this.type = "Mesh";
    this.geometry = geometry ?? null;
    this.material = material ?? null;
    this.boundingRadius = geometryBoundingRadius(geometry);
  }
}

function geometryBoundingRadius(geometry: GeometryBase | null | undefined) {
  if (!geometry) return 0;
  const p = geometry.parameters as Record<string, number>;
  switch (geometry.kind) {
    case "sphere": return Math.abs(p.radius ?? 1);
    case "box": return Math.hypot(p.width ?? 1, p.height ?? 1, p.depth ?? 1) / 2;
    case "cylinder": return Math.hypot(Math.max(p.radiusTop ?? 1, p.radiusBottom ?? 1), (p.height ?? 1) / 2);
    case "cone": return Math.hypot(p.radius ?? 1, (p.height ?? 1) / 2);
    case "plane": return Math.hypot(p.width ?? 1, p.height ?? 1) / 2;
    case "torus": return Math.abs((p.radius ?? 1) + (p.tube ?? 0.4));
    case "dodecahedron": return Math.abs(p.radius ?? 1);
    default: return 0;
  }
}

export class Line extends Object3D {
  isLine = true;
  constructor(geometry?: GeometryBase, material?: Material) {
    super();
    this.type = "Line";
    this.geometry = geometry ?? null;
    this.material = material ?? null;
  }
}

export class Sprite extends Object3D {
  isSprite = true;
  constructor(material?: SpriteMaterial) {
    super();
    this.type = "Sprite";
    this.material = material ?? null;
  }
}

export class Light extends Object3D {
  // Three.js Light.color is a `Color` instance with setHex / multiplyScalar
  // methods. The renderer reads `color` as a hex int. We use `any` here so
  // the source code can call methods on it without TS narrowing complaints.
  color: any;
  intensity: number;
  constructor(color: number = 0xffffff, intensity = 1) {
    super();
    this.type = "Light";
    // Three.js callers expect `light.color.setHex(...)` / `light.color.getHex()`
    // / `light.color.multiplyScalar(...)` to work. Wrap any numeric colour so
    // the result is always a Color-shaped object. The renderer reads
    // `light.color` through `colorFromHex()` which accepts both shapes.
    this.color = makeColor(color);
    this.intensity = intensity;
  }
  setHex(hex: number) { this.color = makeColor(hex); }
  set(color: number | { r: number; g: number; b: number }) {
    this.color = typeof color === "number" ? makeColor(color) : color;
  }
  getHex() {
    const c = this.color;
    if (typeof c === "number") return c;
    return ((Math.round(c.r * 255) & 255) << 16) | ((Math.round(c.g * 255) & 255) << 8) | (Math.round(c.b * 255) & 255);
  }
}

export class HemisphereLight extends Light {
  groundColor: number;
  constructor(sky = 0xffffff, ground = 0xffffff, intensity = 1) {
    super(sky, intensity);
    this.type = "HemisphereLight";
    this.groundColor = ground;
  }
}

export class DirectionalLight extends Light {
  target: Object3D = new Object3D();
  shadow: {
    camera: { left: number; right: number; top: number; bottom: number; near: number; far: number };
    mapSize: Vec2; bias: number; normalBias: number;
  };
  constructor(color = 0xffffff, intensity = 1) {
    super(color, intensity);
    this.type = "DirectionalLight";
    this.shadow = {
      camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 },
      mapSize: new Vec2(1024, 1024),
      bias: 0,
      normalBias: 0,
    };
  }
}

export class PointLight extends Light {
  distance: number; decay: number;
  constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 2) {
    super(color, intensity);
    this.type = "PointLight";
    this.distance = distance;
    this.decay = decay;
  }
}

export class PerspectiveCamera {
  isPerspectiveCamera = true;
  fov: number; near: number; far: number; aspect: number;
  position: Vec3 = new Vec3();
  rotation: Euler = { x: 0, y: 0, z: 0, order: "XYZ", set(x: number, y: number, z: number, order = "XYZ") { this.x = x; this.y = y; this.z = z; this.order = order; return this; } };
  quaternion: Quaternion = {
    set(x: number, y: number, z: number, w: number) { this.x = x; this.y = y; this.z = z; this.w = w; return this; },
    x: 0, y: 0, z: 0, w: 1,
    setFromUnitVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
      const ax = a.x, ay = a.y, az = a.z;
      const bx = b.x, by = b.y, bz = b.z;
      const dot = ax * bx + ay * by + az * bz;
      if (dot > 0.999999) { this.x = 0; this.y = 0; this.z = 0; this.w = 1; return this; }
      if (dot < -0.999999) {
        let axisX = 1, axisY = 0, axisZ = 0;
        if (Math.abs(ay) < 0.5) { axisX = 0; axisY = 1; axisZ = 0; }
        this.x = axisX * Math.SQRT1_2;
        this.y = axisY * Math.SQRT1_2;
        this.z = axisZ * Math.SQRT1_2;
        this.w = 0;
        return this;
      }
      this.x = ay * bz - az * by;
      this.y = az * bx - ax * bz;
      this.z = ax * by - ay * bx;
      this.w = 1 + dot;
      const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
      this.x /= l; this.y /= l; this.z /= l; this.w /= l;
      return this;
    },
  };
  scale: Vec3 = new Vec3(1, 1, 1);
  up: Vec3 = new Vec3(0, 1, 0);
  matrixWorld: { elements: number[] } = { elements: new Array(16).fill(0) };
  constructor(fov = 75, aspect = 1, near = 0.1, far = 1000) {
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
  }
  updateProjectionMatrix() { /* renderer derives per frame */ }
  lookAt(_t: { x: number; y: number; z: number }) { /* unused */ }
  getWorldDirection(target: Vec3) {
    const cp = Math.cos(this.rotation.x);
    target.set(
      -Math.sin(this.rotation.y) * cp,
      // Rotating camera forward (-Z) around +X points upward. Match the
      // rendered PlayCanvas camera and unprojection used by the muzzle.
      Math.sin(this.rotation.x),
      -Math.cos(this.rotation.y) * cp,
    );
    return target;
  }
}

export interface Euler {
  x: number;
  y: number;
  z: number;
  order: string;
  set(x: number, y: number, z: number, order?: string): Euler;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
  setFromUnitVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): Quaternion;
  set(x: number, y: number, z: number, w: number): Quaternion;
}

export function makeEuler(x = 0, y = 0, z = 0, order = "XYZ"): Euler {
  return {
    x, y, z, order,
    set(x: number, y: number, z: number, order = "XYZ") { this.x = x; this.y = y; this.z = z; this.order = order; return this; },
  };
}

export class Scene extends Object3D {
  fog: { color: number; near: number; far: number } | null = null;
  background: { r: number; g: number; b: number } | null = null;
  constructor() {
    super();
    this.type = "Scene";
  }
}

export class Fog {
  color: number;
  near: number;
  far: number;
  constructor(color: number, near = 1, far = 1000) {
    this.color = color;
    this.near = near;
    this.far = far;
  }
}

// Re-export the makeColor helper so Light and other node classes can produce
// three.js-style Color objects from a hex int.
