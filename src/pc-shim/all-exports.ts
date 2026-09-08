// Single source for the namespace-style `import * as THREE from ...` usage.
// We re-export everything as a flat namespace so the call site can do
// `THREE.Vector3`, `THREE.Group`, etc. and TS will accept them as types.
export {
  MathUtils, Vec2, Color, Vector, Vector2, Vector3,
  Float, DynamicDrawUsage,
  BufferAttribute, BufferGeometry, Float32BufferAttribute, InstancedMesh,
  BoxGeometry, SphereGeometry,
  CylinderGeometry, ConeGeometry, PlaneGeometry, TorusGeometry,
  DodecahedronGeometry, Shape, Path, ExtrudeGeometry,
  FrontSide, BackSide, DoubleSide, NormalBlending, AdditiveBlending,
  ClampToEdgeWrapping, RepeatWrapping, Material, MeshBasicMaterial,
  MeshStandardMaterial, SpriteMaterial, LineBasicMaterial, ShaderMaterial,
  CanvasTexture,
  Object3D, Group, Mesh, Line, Sprite, Light, HemisphereLight,
  DirectionalLight, PointLight, PerspectiveCamera, Scene, Fog,
  Raycaster, PointerLockControls, WebGLRenderer, mountScene, getActiveApp,
  SRGBColorSpace, LinearSRGBColorSpace, ACESFilmicToneMapping, PCFSoftShadowMap,
  Object,
} from "./index.ts";
