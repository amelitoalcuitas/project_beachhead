// Public entry point for the PlayCanvas-backed Three.js compatibility shim.
// The rest of the project imports this as if it were the `three` module.
export { MathUtils, Vec2, Color, Vec3 as Vector, Vec3 as Vector3 } from "./math.ts";
export {
  Float, DynamicDrawUsage,
  BufferAttribute, BufferGeometry, Float32BufferAttribute, InstancedMesh,
  BoxGeometry, SphereGeometry,
  CylinderGeometry, ConeGeometry, PlaneGeometry, TorusGeometry,
  DodecahedronGeometry, Shape, Path, ExtrudeGeometry,
} from "./geometry.ts";
export {
  FrontSide, BackSide, DoubleSide, NormalBlending, AdditiveBlending,
  ClampToEdgeWrapping, RepeatWrapping, Material, MeshBasicMaterial,
  MeshStandardMaterial, SpriteMaterial, LineBasicMaterial, ShaderMaterial,
  CanvasTexture,
} from "./materials.ts";
export {
  Object3D, Group, Mesh, Line, Sprite, Light, HemisphereLight,
  DirectionalLight, PointLight, PerspectiveCamera, Scene, Fog,
} from "./nodes.ts";
export { Raycaster } from "./raycast.ts";
export { PointerLockControls } from "./controls.ts";
export { WebGLRenderer, mountScene, getActiveApp, WEAPON_OVERLAY_LAYER_ID } from "./renderer.ts";

// Re-export Vec2 also as Vector2 (the Three.js name).
export { Vec2 as Vector2 } from "./math.ts";

export const SRGBColorSpace = "srgb";
export const LinearSRGBColorSpace = "linear";
export const ACESFilmicToneMapping = 1;
export const PCFSoftShadowMap = 2;

export { Object3D as Object } from "./nodes.ts";

// Default export - the all-exports namespace object. Lets call sites do
// `import * as THREE from "../pc-shim/index.ts"` and access types as well.
import * as _all from "./all-exports.ts";
export default _all;
