// Geometry primitives - mirror the small subset of three.js geometry classes
// the game uses. Each instance just records the parameters it was built with.

export type PrimitiveKind =
  | "box" | "sphere" | "plane" | "cylinder" | "cone"
  | "torus" | "dodecahedron" | "extrude";

// Tiny event-target helper used by the geometry / material classes to support
// three.js's `addEventListener('dispose', ...)` API.
class EventTargetBase {
  private _listeners: Record<string, Array<() => void>> = {};
  addEventListener(type: string, fn: () => void) {
    const arr = this._listeners[type] ?? [];
    arr.push(fn);
    this._listeners[type] = arr;
  }
  removeEventListener(type: string, fn: () => void) {
    const arr = this._listeners[type];
    if (!arr) return;
    this._listeners[type] = arr.filter((f) => f !== fn);
  }
  dispatchEvent(_type: string) {
    const arr = this._listeners[_type];
    if (arr) for (const f of arr) f();
  }
}

export class GeometryBase extends EventTargetBase {
  kind: PrimitiveKind = "box";
  parameters: Record<string, unknown> = {};
  attributes: Record<string, BufferAttribute> = {};
  pcMesh: unknown = null;
  vertices: Float32Array | null = null;
  indices: Uint32Array | null = null;
  colors: Float32Array | null = null;
  computeVertexNormals() { return this; }
  setAttribute(name: string, attribute: BufferAttribute | { array: Float32Array | number[]; itemSize: number }) {
    if (attribute instanceof BufferAttribute) {
      this.attributes[name] = attribute;
    } else {
      const array = attribute.array instanceof Float32Array
        ? attribute.array
        : new Float32Array(attribute.array as number[]);
      this.attributes[name] = new BufferAttribute(array, attribute.itemSize);
    }
    const attr = this.attributes[name];
    if (name === "position") this.vertices = attr.array;
    else if (name === "color") this.colors = attr.array;
    return this;
  }
  getAttribute(name: string): BufferAttribute | undefined { return this.attributes[name]; }
  rotateX(angle: number) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const pos = this.attributes["position"];
    if (pos) {
      const a = pos.array;
      for (let i = 0; i < pos.count; i++) {
        const y = a[i * 3 + 1];
        const z = a[i * 3 + 2];
        a[i * 3 + 1] = y * cos - z * sin;
        a[i * 3 + 2] = y * sin + z * cos;
      }
    }
    return this;
  }
  rotateY(angle: number) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const pos = this.attributes["position"];
    if (pos) {
      const a = pos.array;
      for (let i = 0; i < pos.count; i++) {
        const x = a[i * 3];
        const z = a[i * 3 + 2];
        a[i * 3] = x * cos + z * sin;
        a[i * 3 + 2] = -x * sin + z * cos;
      }
    }
    return this;
  }
  rotateZ(angle: number) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const pos = this.attributes["position"];
    if (pos) {
      const a = pos.array;
      for (let i = 0; i < pos.count; i++) {
        const x = a[i * 3];
        const y = a[i * 3 + 1];
        a[i * 3] = x * cos - y * sin;
        a[i * 3 + 1] = x * sin + y * cos;
      }
    }
    return this;
  }
  translate(x: number, y: number, z: number) {
    const pos = this.attributes["position"];
    if (pos) {
      const a = pos.array;
      for (let i = 0; i < pos.count; i++) {
        a[i * 3] += x;
        a[i * 3 + 1] += y;
        a[i * 3 + 2] += z;
      }
    }
    return this;
  }
  computeBoundingSphere() { return this; }
  boundingSphere: { center: { x: number; y: number; z: number }; radius: number } | null = null;
  dispose() { this.pcMesh = null; this.dispatchEvent("dispose"); }
}

export class BoxGeometry extends GeometryBase {
  constructor(width = 1, height = 1, depth = 1) {
    super();
    this.kind = "box";
    this.parameters = { width, height, depth };
  }
}
export class SphereGeometry extends GeometryBase {
  constructor(
    radius = 1,
    _widthSegments = 8,
    _heightSegments = 6,
    _phiStart = 0,
    _phiLength = Math.PI * 2,
    _thetaStart = 0,
    _thetaLength = Math.PI,
  ) {
    super();
    this.kind = "sphere";
    this.parameters = { radius };
  }
}
export class CylinderGeometry extends GeometryBase {
  constructor(rt = 1, rb = 1, h = 1, _s = 12) {
    super();
    this.kind = "cylinder";
    this.parameters = { radiusTop: rt, radiusBottom: rb, height: h };
  }
}
export class ConeGeometry extends GeometryBase {
  constructor(radius = 1, height = 1, segments = 12) {
    super();
    this.kind = "cone";
    this.parameters = { radius, height, segments };
    // Generate approximate vertex data: a cone with `segments` radial sides
    // and a tip at +Y. Position attribute is enough for the source code's
    // `.attributes.position.count` lookups.
    const segs = Math.max(3, Math.floor(segments));
    const positions = new Float32Array((segs + 2) * 3);
    positions[0] = 0; positions[1] = height / 2; positions[2] = 0; // tip
    positions[3] = 0; positions[4] = -height / 2; positions[5] = 0; // base centre
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      positions[(i + 2) * 3] = Math.cos(a) * radius;
      positions[(i + 2) * 3 + 1] = -height / 2;
      positions[(i + 2) * 3 + 2] = Math.sin(a) * radius;
    }
    this.setAttribute("position", new BufferAttribute(positions, 3));
  }
}
export class PlaneGeometry extends GeometryBase {
  constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
    super();
    this.kind = "plane";
    this.parameters = { width, height, widthSegments, heightSegments };
    // Generate vertex positions like three.js's PlaneGeometry so the source
    // code can call `getAttribute('position')` and read vertex data.
    const ws = Math.max(1, Math.floor(widthSegments));
    const hs = Math.max(1, Math.floor(heightSegments));
    const vertexCount = (ws + 1) * (hs + 1);
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const halfW = width / 2;
    const halfH = height / 2;
    for (let iy = 0; iy <= hs; iy++) {
      for (let ix = 0; ix <= ws; ix++) {
        const i = iy * (ws + 1) + ix;
        const x = (ix / ws) * width - halfW;
        const y = (iy / hs) * height - halfH;
        positions[i * 3] = x;
        positions[i * 3 + 1] = -y;
        positions[i * 3 + 2] = 0;
        uvs[i * 2] = ix / ws;
        uvs[i * 2 + 1] = 1 - iy / hs;
      }
    }
    const indices = new Uint32Array(ws * hs * 6);
    let ptr = 0;
    for (let iy = 0; iy < hs; iy++) {
      for (let ix = 0; ix < ws; ix++) {
        const a = iy * (ws + 1) + ix;
        const b = a + ws + 1;
        indices[ptr++] = a;
        indices[ptr++] = b;
        indices[ptr++] = a + 1;
        indices[ptr++] = a + 1;
        indices[ptr++] = b;
        indices[ptr++] = b + 1;
      }
    }
    this.setAttribute("position", new BufferAttribute(positions, 3));
    this.setAttribute("uv", new BufferAttribute(uvs, 2));
    this.indices = indices;
  }
}
export class TorusGeometry extends GeometryBase {
  constructor(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48) {
    super();
    this.kind = "torus";
    this.parameters = { radius, tube, radialSegments, tubularSegments };
  }
}
export class DodecahedronGeometry extends GeometryBase {
  constructor(radius = 1, detail = 0) {
    super();
    this.kind = "dodecahedron";
    this.parameters = { radius, detail };
  }
}

export class BufferGeometry extends GeometryBase {
  constructor() { super(); this.kind = "box"; }
  setIndex(array: number[] | Uint16Array | Uint32Array) {
    this.indices = array instanceof Uint32Array
      ? array
      : new Uint32Array(array as number[] | Uint16Array);
    return this;
  }
  setFromPoints(points: { x: number; y: number; z: number }[]) {
    const data = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      data[i * 3] = points[i].x;
      data[i * 3 + 1] = points[i].y;
      data[i * 3 + 2] = points[i].z;
    }
    this.setAttribute("position", { array: data, itemSize: 3 });
    return this;
  }
}

export class Shape {
  holes: Shape[] = [];
  points: Array<{ x: number; y: number }> = [];
  moveTo(x: number, y: number) { this.points.push({ x, y }); return this; }
  lineTo(x: number, y: number) { this.points.push({ x, y }); return this; }
  bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, x: number, y: number) { this.points.push({ x, y }); return this; }
  closePath() { return this; }
}
export class Path extends Shape {
  absarc(x: number, y: number, radius: number, startAngle: number, endAngle: number, clockwise = false) {
    const span = clockwise ? startAngle - endAngle : endAngle - startAngle;
    const steps = Math.max(8, Math.ceil(Math.abs(span) * 8));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = startAngle + (clockwise ? -1 : 1) * span * t;
      this.points.push({ x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius });
    }
    return this;
  }
  absellipse(x: number, y: number, xRadius: number, yRadius: number, startAngle: number, endAngle: number, clockwise = false, rotation = 0) {
    const span = clockwise ? startAngle - endAngle : endAngle - startAngle;
    const steps = Math.max(8, Math.ceil(Math.abs(span) * 8));
    const c = Math.cos(rotation), s = Math.sin(rotation);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = startAngle + (clockwise ? -1 : 1) * span * t;
      const px = Math.cos(angle) * xRadius, py = Math.sin(angle) * yRadius;
      this.points.push({ x: x + px * c - py * s, y: y + px * s + py * c });
    }
    return this;
  }
}
export class ExtrudeGeometry extends GeometryBase {
  boundingSphere: { center: { x: number; y: number; z: number }; radius: number } | null = null;
  constructor(shape?: Shape, options: Record<string, unknown> = {}) {
    super();
    this.kind = "extrude";
    const depth = Number(options.depth ?? 1);
    const points = shape?.points?.length ? shape.points : [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
    const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
    this.parameters = { width: maxX - minX, height: maxY - minY, depth };
    const vertices = new Float32Array(points.length * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i < points.length; i++) {
      vertices[i * 3] = points[i].x; vertices[i * 3 + 1] = points[i].y; vertices[i * 3 + 2] = -depth / 2;
      const j = points.length + i;
      vertices[j * 3] = points[i].x; vertices[j * 3 + 1] = points[i].y; vertices[j * 3 + 2] = depth / 2;
    }
    for (let i = 1; i < points.length - 1; i++) {
      indices.push(0, i + 1, i, points.length, points.length + i, points.length + i + 1);
    }
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      indices.push(i, next, points.length + i, next, points.length + next, points.length + i);
    }
    this.vertices = vertices;
    this.indices = new Uint32Array(indices);
    this.setAttribute("position", new BufferAttribute(vertices, 3));
  }
  computeBoundingSphere() { return this; }
}

export class BufferAttribute {
  array: Float32Array;
  itemSize: number;
  count: number;
  needsUpdate = false;
  usage = 35048;
  constructor(array: number[] | Float32Array, itemSize: number) {
    this.array = array instanceof Float32Array ? array : new Float32Array(array);
    this.itemSize = itemSize;
    this.count = this.array.length / itemSize;
  }
  getX(i: number) { return this.array[i * this.itemSize]; }
  getY(i: number) { return this.array[i * this.itemSize + 1]; }
  getZ(i: number) { return this.array[i * this.itemSize + 2]; }
  getW(i: number) { return this.array[i * this.itemSize + 3]; }
  setX(i: number, v: number) { this.array[i * this.itemSize] = v; }
  setY(i: number, v: number) { this.array[i * this.itemSize + 1] = v; }
  setZ(i: number, v: number) { this.array[i * this.itemSize + 2] = v; }
  setW(i: number, v: number) { this.array[i * this.itemSize + 3] = v; }
  setXYZ(i: number, x: number, y: number, z: number) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
    this.array[i * this.itemSize + 2] = z;
  }
  setXY(i: number, x: number, y: number) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
  }
  setUsage(_usage: number) { /* no-op */ }
}

export const Float = 1;
export const DynamicDrawUsage = 35048;

// Three.js exposes `Float32BufferAttribute` as an alias of `BufferAttribute`;
// some code uses that longer name.
export { BufferAttribute as Float32BufferAttribute } from "./geometry.ts";

import { Mesh as _Mesh } from "./nodes.ts";
import type { Material as _Material } from "./materials.ts";

export class InstancedMesh extends _Mesh {
  count: number;
  boundingSphere: { center: { x: number; y: number; z: number }; radius: number } | null = null;
  instanceMatrix: { needsUpdate: boolean } = { needsUpdate: false };
  /**
   * Per-instance 4x4 matrices stored as 16-element row-major arrays (matches
   * PlayCanvas `Mat4`). Populated by `setMatrixAt` from the Three.js-style
   * column-major matrix Three.js passes in.
   */
  matrices: Float32Array[] = [];
  constructor(geometry?: unknown, material?: unknown, count = 0) {
    super();
    this.type = "InstancedMesh";
    (this as unknown as { geometry: unknown }).geometry = geometry;
    (this as unknown as { material: unknown }).material = material;
    this.count = count;
  }
  /**
   * Accepts either a Three.js `Matrix4` (column-major; `elements[0..15]` where
   * the translation lives in indices 12/13/14) or a PlayCanvas `Mat4`
   * (row-major). Stored row-major so the renderer can hand it straight to
   * `MeshInstance.setMatrix()`.
   */
  setMatrixAt(index: number, matrix: number[] | { elements: number[] }) {
    const src = Array.isArray(matrix) ? matrix : matrix.elements;
    const out = new Float32Array(16);
    // Three.js column-major -> PlayCanvas row-major: transpose upper-left 3x3,
    // copy translation column -> row.
    out[0] = src[0]; out[1] = src[4]; out[2] = src[8];   out[3] = src[12];
    out[4] = src[1]; out[5] = src[5]; out[6] = src[9];   out[7] = src[13];
    out[8] = src[2]; out[9] = src[6]; out[10] = src[10]; out[11] = src[14];
    out[12] = src[3]; out[13] = src[7]; out[14] = src[11]; out[15] = src[15];
    this.matrices[index] = out;
    this.instanceMatrix.needsUpdate = true;
  }
}
