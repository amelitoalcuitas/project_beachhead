// Material classes that mirror the small subset of three.js materials the
// game uses. The renderer turns these into PlayCanvas `pc.StandardMaterial`
// (or `pc.BasicMaterial`) on first use.
import { Vec2 } from "./math.ts";

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;
export const NormalBlending = 0;
export const AdditiveBlending = 1;
export const ClampToEdgeWrapping = 0;
export const RepeatWrapping = 1;

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

// Create a Color-shaped object that has both numeric RGB channels and
// three.js-style methods. We model it as a stand-in for THREE.Color.
export function makeColor(hex: number): {
  r: number; g: number; b: number;
  setHex(n: number): void;
  multiplyScalar(s: number): void;
  copy(c: { r: number; g: number; b: number }): void;
  getHex(): number;
} {
  const c = {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
    setHex(n: number) {
      c.r = ((n >> 16) & 255) / 255;
      c.g = ((n >> 8) & 255) / 255;
      c.b = (n & 255) / 255;
    },
    multiplyScalar(s: number) { c.r *= s; c.g *= s; c.b *= s; },
    copy(other: { r: number; g: number; b: number }) { c.r = other.r; c.g = other.g; c.b = other.b; },
    getHex() { return ((Math.round(c.r * 255) & 255) << 16) | ((Math.round(c.g * 255) & 255) << 8) | (Math.round(c.b * 255) & 255); },
  };
  return c;
}

export class Material extends EventTargetBase {
  transparent = false;
  depthWrite = true;
  side = FrontSide;
  blending = NormalBlending;
  needsUpdate = false;
  uniforms: Record<string, { value: unknown }> = {};
  vertexShader = "";
  fragmentShader = "";
  color: any = 0xffffff;
  emissive: any = 0x000000;
  map: unknown = null;
  metalness = 0;
  roughness = 1;
  opacity = 1;
  rotation = 0;
  depthTest = true;
  polygonOffset = false;
  polygonOffsetFactor = 0;
  polygonOffsetUnits = 0;
  vertexColors = false;
  pcMaterial: unknown = null;
  kind = "Material";
  constructor(parameters: Record<string, unknown> = {}) {
    super();
    Object.assign(this, parameters);
    if (typeof this.color === "number") this.color = makeColor(this.color);
    if (typeof this.emissive === "number") this.emissive = makeColor(this.emissive);
  }
  setHex(hex: number) {
    if (this.color && typeof this.color.setHex === "function") this.color.setHex(hex);
    else this.color = makeColor(hex);
  }
  multiplyScalar(s: number) {
    if (this.color && typeof this.color.multiplyScalar === "function") this.color.multiplyScalar(s);
    if (this.emissive && typeof this.emissive.multiplyScalar === "function") this.emissive.multiplyScalar(s);
    return this;
  }
  clone(): Material {
    const clone = new (this.constructor as new (p?: Record<string, unknown>) => Material)();
    for (const key of Object.keys(this)) {
      if (key === "pcMaterial" || key === "_listeners") continue;
      const value = (this as any)[key];
      if (value && typeof value === "object") {
        if (typeof value.clone === "function") (clone as any)[key] = value.clone();
        else if ("r" in value && "g" in value && "b" in value && typeof value.multiplyScalar === "function") {
          const copiedColor = makeColor(0);
          copiedColor.copy(value);
          (clone as any)[key] = copiedColor;
        }
        else if (Array.isArray(value)) (clone as any)[key] = value.slice();
        else (clone as any)[key] = { ...value };
      } else (clone as any)[key] = value;
    }
    clone.pcMaterial = null;
    return clone;
  }
  dispose() {
    const nativeMaterial = this.pcMaterial as { destroy?: () => void } | null;
    nativeMaterial?.destroy?.();
    this.pcMaterial = null;
    this.dispatchEvent("dispose");
  }
}

export class MeshBasicMaterial extends Material {
  override kind = "MeshBasicMaterial";
  constructor(parameters: Record<string, unknown> = {}) {
    super(parameters);
    if (typeof this.color === "number") this.color = makeColor(this.color);
  }
}
export class MeshStandardMaterial extends Material {
  override kind = "MeshStandardMaterial";
  emissiveIntensity = 1;
  constructor(parameters: Record<string, unknown> = {}) {
    super(parameters);
    if (typeof parameters.emissiveIntensity === "number") this.emissiveIntensity = parameters.emissiveIntensity;
  }
}
export class SpriteMaterial extends Material {
  override kind = "SpriteMaterial";
  constructor(parameters: Record<string, unknown> = {}) { super(parameters); }
}
export class LineBasicMaterial extends Material {
  override kind = "LineBasicMaterial";
  constructor(parameters: Record<string, unknown> = {}) { super(parameters); }
}
export class ShaderMaterial extends Material {
  override kind = "ShaderMaterial";
  constructor(parameters: Record<string, unknown> = {}) { super(parameters); }
}
export class CanvasTexture {
  source: HTMLCanvasElement;
  needsUpdate = false;
  wrapS = ClampToEdgeWrapping;
  wrapT = ClampToEdgeWrapping;
  repeat = new Vec2(1, 1);
  pcTexture: unknown = null;
  constructor(canvas: HTMLCanvasElement) { this.source = canvas; }
  dispose() { this.pcTexture = null; }
}
