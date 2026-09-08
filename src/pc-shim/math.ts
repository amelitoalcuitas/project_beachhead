// Math helpers + light-weight vector / color types that mirror the small
// subset of THREE.MathUtils / THREE.Vector / THREE.Color the project uses.
export const MathUtils = {
  clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); },
  lerp(x: number, y: number, t: number) { return x + (y - x) * t; },
  smoothstep(x: number, min: number, max: number) {
    if (max <= min) return x < min ? 0 : 1;
    const t = Math.max(0, Math.min(1, (x - min) / (max - min)));
    return t * t * (3 - 2 * t);
  },
  degToRad(deg: number) { return (deg * Math.PI) / 180; },
  radToDeg(rad: number) { return (rad * 180) / Math.PI; },
  damp(current: number, target: number, lambda: number, dt: number) {
    return MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
  },
  randFloat(low: number, high: number) { return low + Math.random() * (high - low); },
};

export class Vec3 {
  x: number; y: number; z: number;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: { x: number; y: number; z: number }) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vec3(this.x, this.y, this.z); }
  add(v: { x: number; y: number; z: number }) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v: { x: number; y: number; z: number }) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s: number) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v: { x: number; y: number; z: number }, s: number) {
    this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this;
  }
  distanceTo(v: { x: number; y: number; z: number }) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  lerp(v: { x: number; y: number; z: number }, t: number) {
    this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this;
  }
  setFromMatrixColumn(matrix: any, index: number) {
    const e = Array.isArray(matrix) ? matrix : matrix?.elements;
    if (!e) return this;
    const offset = index * 4;
    this.x = e[offset] ?? 0;
    this.y = e[offset + 1] ?? 0;
    this.z = e[offset + 2] ?? 0;
    return this;
  }
  toArray() { return [this.x, this.y, this.z]; }
  setScalar(s: number) { this.x = s; this.y = s; this.z = s; return this; }
  addScalar(s: number) { this.x += s; this.y += s; this.z += s; return this; }
  lerpVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
    this.x = a.x + (b.x - a.x) * t;
    this.y = a.y + (b.y - a.y) * t;
    this.z = a.z + (b.z - a.z) * t;
    return this;
  }
  dot(v: { x: number; y: number; z: number }) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  cross(v: { x: number; y: number; z: number }) {
    const ax = this.x, ay = this.y, az = this.z;
    this.x = ay * v.z - az * v.y;
    this.y = az * v.x - ax * v.z;
    this.z = ax * v.y - ay * v.x;
    return this;
  }
  crossVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    this.x = a.y * b.z - a.z * b.y;
    this.y = a.z * b.x - a.x * b.z;
    this.z = a.x * b.y - a.y * b.x;
    return this;
  }
  applyAxisAngle(axis: { x: number; y: number; z: number }, angle: number) {
    // Rodrigues' rotation formula
    const c = Math.cos(angle), s = Math.sin(angle);
    const t = 1 - c;
    const x = axis.x, y = axis.y, z = axis.z;
    const tx = t * x, ty = t * y;
    this.set(
      (c + tx * x) * this.x + (tx * y - s * z) * this.y + (tx * z + s * y) * this.z,
      (tx * y + s * z) * this.x + (c + ty * y) * this.y + (ty * z - s * x) * this.z,
      (tx * z - s * y) * this.x + (ty * z + s * x) * this.y + (c + t * z * z) * this.z,
    );
    return this;
  }
  applyQuaternion(q: { x: number; y: number; z: number; w: number }) {
    const x = this.x, y = this.y, z = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
  unproject(camera?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; order?: string }; fov?: number; aspect?: number }) {
    if (!camera?.position || !camera.rotation) return this;
    const fov = ((camera.fov ?? 75) * Math.PI) / 180;
    const tan = Math.tan(fov / 2);
    const local = new Vec3(this.x * tan * (camera.aspect ?? 1), this.y * tan, -1).normalize();
    local.applyAxisAngle({ x: 1, y: 0, z: 0 }, camera.rotation.x);
    local.applyAxisAngle({ x: 0, y: 1, z: 0 }, camera.rotation.y);
    local.applyAxisAngle({ x: 0, y: 0, z: 1 }, camera.rotation.z);
    this.copy(local).add(camera.position);
    return this;
  }
  // The weapon-view test expects this to project a world-space point into
  // screen space and the result should have x near 0 (the muzzle is on the
  // gun's centreline). Three.js's implementation does a real matrix multiply;
  // for the shim we just zero out x and y when the camera is looking down -Z,
  // which is the configuration WeaponView uses.
  project(camera?: { position?: { x: number; y: number; z: number }; rotation?: { x: number; y: number; z: number; order?: string }; fov?: number; aspect?: number }) {
    if (!camera?.position || !camera.rotation) return this;
    const local = this.clone().sub(camera.position);
    local.applyAxisAngle({ x: 0, y: 0, z: 1 }, -camera.rotation.z);
    local.applyAxisAngle({ x: 0, y: 1, z: 0 }, -camera.rotation.y);
    local.applyAxisAngle({ x: 1, y: 0, z: 0 }, -camera.rotation.x);
    const tan = Math.tan(((camera.fov ?? 75) * Math.PI) / 180 / 2);
    const z = -local.z || -1;
    this.x = local.x / (z * tan * (camera.aspect ?? 1));
    this.y = local.y / (z * tan);
    this.z = (z - 0.1) / 1000;
    return this;
  }
  fromBufferAttribute(attribute: { array: Float32Array | number[]; itemSize: number }, index: number) {
    const arr = attribute.array;
    this.x = arr[index * attribute.itemSize];
    this.y = arr[index * attribute.itemSize + 1];
    if (attribute.itemSize >= 3) this.z = arr[index * attribute.itemSize + 2];
    else this.z = 0;
    return this;
  }
  applyMatrix4(m: { elements: number[] } | number[]) {
    const e = Array.isArray(m) ? m : m.elements;
    const x = this.x, y = this.y, z = this.z;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  equals(v: { x: number; y: number; z: number }) { return this.x === v.x && this.y === v.y && this.z === v.z; }
  setFromUnitVectors(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    const ax = a.x, ay = a.y, az = a.z;
    const bx = b.x, by = b.y, bz = b.z;
    const dot = ax * bx + ay * by + az * bz;
    if (dot > 0.999999) { this.set(0, 0, 0); return this; }
    if (dot < -0.999999) {
      // Pick any perpendicular axis.
      let axisX = 1, axisY = 0, axisZ = 0;
      if (Math.abs(ay) < 0.5) { axisX = 0; axisY = 1; axisZ = 0; }
      this.set(axisX, axisY, axisZ);
    } else {
      this.set(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
    }
    this.normalize();
    return this;
  }
  angleTo(v: { x: number; y: number; z: number }) {
    const denom = Math.hypot(this.x, this.y, this.z) * Math.hypot(v.x, v.y, v.z);
    if (denom === 0) return 0;
    return Math.acos(MathUtils.clamp(this.dot(v) / denom, -1, 1));
  }
}

export class Vec2 {
  x: number; y: number;
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x: number, y: number) { this.x = x; this.y = y; return this; }
  copy(v: { x: number; y: number }) { this.x = v.x; this.y = v.y; return this; }
}

export class Color {
  r: number; g: number; b: number;
  constructor(r = 0, g = 0, b = 0) { this.r = r; this.g = g; this.b = b; }
  set(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; return this; }
  setHex(hex: number) {
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }
  setHSL(h: number, s: number, l: number) {
    h = ((h % 1) + 1) % 1;
    if (s === 0) { this.r = this.g = this.b = l; return this; }
    const hue = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    this.r = hue(p, q, h + 1 / 3);
    this.g = hue(p, q, h);
    this.b = hue(p, q, h - 1 / 3);
    return this;
  }
  multiplyScalar(s: number) { this.r *= s; this.g *= s; this.b *= s; return this; }
  getHex() {
    return (
      ((Math.round(this.r * 255) & 255) << 16) |
      ((Math.round(this.g * 255) & 255) << 8) |
      (Math.round(this.b * 255) & 255)
    );
  }
}

export function raySphereIntersect(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
  radius: number,
): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : 0;
}
