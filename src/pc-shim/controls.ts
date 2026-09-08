// PointerLockControls replacement. The only thing the rest of the codebase
// touches on the original three.js class is `isLocked`, `lock`/`unlock`, the
// `unlock` event, and `pointerSpeed` + min/max polar angle. We listen to
// pointerlockchange + mousemove on document and apply the rotation to the
// camera ourselves.
import type { PerspectiveCamera } from "./nodes.ts";
import { MathUtils } from "./math.ts";

export class PointerLockControls {
  camera: PerspectiveCamera;
  domElement: HTMLElement;
  isLocked = false;
  pointerSpeed = 1;
  minPolarAngle = 0;
  maxPolarAngle = Math.PI;
  private _listeners: Map<string, ((e: { type: string }) => void)[]> = new Map();
  private _onMouseMove = (e: MouseEvent) => {
    if (!this.isLocked) return;
    const dx = e.movementX ?? 0;
    const dy = e.movementY ?? 0;
    const speed = this.pointerSpeed ?? 1;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y -= dx * 0.002 * speed;
    const pitch = this.camera.rotation.x - dy * 0.002 * speed;
    // Three.js expresses these limits as polar angles from +Y; the camera's
    // Euler X is measured around the eye line, so convert before clamping.
    const minPitch = Math.PI / 2 - this.maxPolarAngle;
    const maxPitch = Math.PI / 2 - this.minPolarAngle;
    this.camera.rotation.x = MathUtils.clamp(pitch, minPitch, maxPitch);
  };
  private _onPointerLockChange = () => {
    this.isLocked = document.pointerLockElement === this.domElement;
    if (!this.isLocked) this.dispatchEvent({ type: "unlock" });
  };
  constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    if (typeof document.addEventListener === "function") {
      document.addEventListener("mousemove", this._onMouseMove);
      document.addEventListener("pointerlockchange", this._onPointerLockChange);
    }
  }
  lock() {
    const el = this.domElement as HTMLElement & { requestPointerLock?: () => Promise<void> | void };
    const p = el.requestPointerLock?.();
    if (p && typeof (p as Promise<void>).then === "function") {
      (p as Promise<void>).catch(() => { /* surfaced via mousemove / pointerlockchange */ });
    }
  }
  unlock() { document.exitPointerLock?.(); }
  addEventListener(type: string, fn: (e: { type: string }) => void) {
    const arr = this._listeners.get(type) ?? [];
    arr.push(fn);
    this._listeners.set(type, arr);
  }
  removeEventListener(type: string, fn: (e: { type: string }) => void) {
    const arr = this._listeners.get(type);
    if (arr) this._listeners.set(type, arr.filter((f) => f !== fn));
  }
  private dispatchEvent(e: { type: string }) {
    const arr = this._listeners.get(e.type);
    if (arr) for (const f of arr) f(e);
  }
}
