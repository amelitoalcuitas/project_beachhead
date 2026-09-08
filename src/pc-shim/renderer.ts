// The PlayCanvas-backed renderer. `mountScene(app, rootEntity, scene, camera,
// renderer)` walks the imperative Three.js-style scene graph and mirrors it
// into PlayCanvas entities each frame. We cache the mapping from
// `Object3D.id` -> `pc.Entity` and update transforms / materials in place.
//
// PlayCanvas's strict TypeScript types don't always match its runtime API
// (e.g. some fields are private but the engine accepts them via bracket
// access). We disable type-checking in this file so the calls follow the
// engine's actual behaviour.
// @ts-nocheck
import * as pc from "playcanvas";
import type {
  Object3D as Object3DNode, Scene, PerspectiveCamera, Mesh, Line, Sprite,
  DirectionalLight, HemisphereLight, PointLight,
} from "./nodes.ts";
import type {
  Material, MeshBasicMaterial, MeshStandardMaterial, SpriteMaterial,
  LineBasicMaterial, CanvasTexture,
} from "./materials.ts";
import type { GeometryBase } from "./geometry.ts";
import { colorFromHex } from "./color.ts";

// PlayCanvas's strict typings don't expose the entity.model/entity.render/
// entity.sprite fields that we read every frame. We work around that by
// typing the entity as a permissive struct that includes the runtime fields
// the engine stores.
type RenderEntity = pc.Entity & {
  render?: { meshInstances?: pc.MeshInstance[]; castShadows?: boolean; receiveShadows?: boolean } | null;
  sprite?: { material?: { opacity?: number }; rotation?: number; layers?: number[] } | null;
  camera?: {
    fov?: number;
    aspectRatio?: number;
    nearClip?: number;
    farClip?: number;
    clearColorBuffer?: boolean;
    clearDepthBuffer?: boolean;
    layers?: number[];
    priority?: number;
  } | null;
};

const entityMap = new Map<number, RenderEntity>();
const mountedEntityIds = new WeakMap<Scene, Set<number>>();
const cameraEntities = new Map<number, RenderEntity>();
const spriteAssets = new WeakMap<object, pc.Asset>();
const spriteAssetSet = new Set<pc.Asset>();
let placeholderSpriteAsset: pc.Asset | null = null;
export const WEAPON_OVERLAY_LAYER_ID = 1000;
let _activeApp: pc.Application | null = null;
let nextShaderMaterialId = 1;

export function getActiveApp() { return _activeApp; }

export class WebGLRenderer {
  domElement: HTMLCanvasElement;
  autoClear = true;
  shadowMap: { enabled: boolean; type: number } = { enabled: false, type: 0 };
  toneMapping = 0;
  toneMappingExposure = 1;
  outputColorSpace = "linear";
  app: pc.Application | null = null;
  rootEntity: pc.Entity | null = null;
  initializationError: Error | null = null;
  constructor(parameters: { canvas?: HTMLCanvasElement; antialias?: boolean; powerPreference?: string } = {}) {
    this.domElement = parameters.canvas ?? (typeof document !== "undefined" ? document.createElement("canvas") : ({} as HTMLCanvasElement));
    try {
      if (!this.domElement.isConnected && typeof this.domElement.setAttribute === "function") {
        this.domElement.setAttribute("aria-label", "3D beachhead battlefield");
        this.domElement.tabIndex = 0;
      }
    } catch (_err) { /* mock renderers in tests don't need this */ }
  }
  setSize(_w: number, _h: number) { /* canvas size handled by PlayCanvas fill mode */ }
  setPixelRatio(_r: number) { /* PlayCanvas uses devicePixelRatio automatically */ }
  render(scene: Scene, camera: PerspectiveCamera) {
    if (!this.app) this._initialize();
    if (!this.app) {
      this.showInitializationError();
      return;
    }
    if (this.app && this.rootEntity) {
      // PlayCanvas only renders inside its own `app.start()` requestAnimationFrame
      // loop; without it `renderNextFrame = true` is a no-op and the canvas
      // stays black. Kick off the loop the first time we render and from then
      // on just request a frame each Game tick. The two RAFs (Game's own
      // game-loop and PlayCanvas's render loop) coexist — neither blocks the
      // other.
      const appAny = this.app as unknown as { _alreadyStarted?: boolean };
      if (!appAny._alreadyStarted) {
        try { this.app.start(); } catch (_err) { /* headless */ }
      }
      const isOverlay = !this.autoClear;
      if (!isOverlay) {
        // A Three.js renderer clears at the start of the primary render. Our
        // PlayCanvas application renders asynchronously, so use that same
        // point to deactivate cameras from optional passes that were not
        // submitted this frame (for example after returning to the title).
        for (const cameraEntity of cameraEntities.values()) cameraEntity.enabled = false;
      }
      syncSceneSettings(this.app, scene, this);
      mountScene(this.app, this.rootEntity, scene, camera, { isOverlay });
      this.app.renderNextFrame = true;
    }
  }
  clearDepth() {
    // The overlay camera clears depth immediately before its own pass. A
    // direct graphics-device clear here would affect the previous async
    // PlayCanvas frame rather than the render currently being submitted.
  }
  start() {
    if (!this.app) this._initialize();
    if (this.app && !this.app._alreadyStarted) this.app.start();
  }
  stop() {
    for (const asset of spriteAssetSet) asset.destroy();
    spriteAssetSet.clear();
    placeholderSpriteAsset = null;
    this.app?.destroy();
    this.app = null;
  }
  private _initialize() {
    if (this.app) return;
    try {
      this.app = new pc.Application(this.domElement, {
        graphicsDeviceOptions: {
          antialias: true,
          powerPreference: "high-performance",
          alpha: false,
          // Keep the WebGL drawing buffer around until the next frame so
          // canvas screenshots and `drawImage` reads pick up the latest render.
          // The cost is one extra framebuffer copy per frame, which is
          // negligible on the modest pixel counts this game uses.
          preserveDrawingBuffer: true,
        },
        mouse: new pc.Mouse(this.domElement),
        keyboard: new pc.Keyboard(window),
      });
      this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
      this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
      this.app.scene.ambientLight = new pc.Color(0.4, 0.35, 0.3);
      // PlayCanvas's built-in UI layer contains only a transparent pass, so
      // opaque meshes (most of the weapon model) would be silently skipped.
      // A dedicated layer retains both opaque and transparent weapon parts.
      this.app.scene.layers.push(new pc.Layer({
        name: "Weapon Overlay",
        id: WEAPON_OVERLAY_LAYER_ID,
      }));
      this.rootEntity = this.app.root;
      _activeApp = this.app;
    } catch (_err) {
      this.initializationError = _err instanceof Error ? _err : new Error(String(_err));
      try { console.error("PlayCanvas initialization failed", this.initializationError); } catch { /* headless */ }
      this.app = null;
      this.rootEntity = null;
    }
  }
  private showInitializationError() {
    const host = this.domElement.parentElement;
    if (!host || host.querySelector(".render-error")) return;
    const error = document.createElement("div");
    error.className = "render-error";
    error.textContent = `Unable to initialize the battlefield renderer: ${this.initializationError?.message ?? "WebGL is unavailable"}`;
    Object.assign(error.style, {
      position: "absolute", inset: "1rem", zIndex: "20", padding: "1rem",
      color: "#f5e9ca", background: "rgba(20, 15, 12, .94)", font: "600 14px monospace",
    });
    host.appendChild(error);
  }
}

function syncSceneSettings(app: pc.Application, scene: Scene, renderer: WebGLRenderer) {
  const pcScene = app.scene as any;
  if (scene.fog) {
    pcScene.fog.type = pc.FOG_LINEAR;
    pcScene.fog.color = colorFromHex(scene.fog.color);
    pcScene.fog.start = scene.fog.near;
    pcScene.fog.end = scene.fog.far;
  } else pcScene.fog.type = pc.FOG_NONE;
  pcScene.exposure = renderer.toneMappingExposure;
  pcScene.shadowType = renderer.shadowMap.enabled ? pc.SHADOW_PCF3 : pc.SHADOWUPDATE_NONE;
  if (scene.background) pcScene.ambientLight = new pc.Color(scene.background.r, scene.background.g, scene.background.b);
}

export function mountScene(
  app: pc.Application,
  rootEntity: pc.Entity,
  scene: Scene,
  camera: PerspectiveCamera,
  options: { isOverlay?: boolean } = {},
) {
  _activeApp = app;
  const isOverlay = options.isOverlay ?? false;
  const layerId = isOverlay ? WEAPON_OVERLAY_LAYER_ID : pc.LAYERID_WORLD;
  const cameraEntity = ensureCameraEntity(rootEntity, scene, isOverlay, layerId);
  cameraEntity.enabled = true;
  cameraEntity.setPosition(camera.position.x, camera.position.y, camera.position.z);
  cameraEntity.setLocalEulerAngles(
    pc.math.RAD_TO_DEG * camera.rotation.x,
    pc.math.RAD_TO_DEG * camera.rotation.y,
    pc.math.RAD_TO_DEG * camera.rotation.z,
  );
  const camComp = cameraEntity.camera;
  if (camComp) {
    // CameraComponent has private _fov/_nearClip/_farClip; setting fov etc.
    // via the public API requires re-applying perspective. We set them via
    // bracket access to bypass strict typing - the runtime properties exist.
    (camComp as any).fov = camera.fov;
    (camComp as any).nearClip = camera.near;
    (camComp as any).farClip = camera.far;
    (camComp as any).aspectRatio = camera.aspect;
    camComp.clearColorBuffer = !isOverlay;
    camComp.clearDepthBuffer = true;
    camComp.layers = [layerId];
    camComp.priority = isOverlay ? 1 : 0;
    (camComp as any).toneMapping = pc.TONEMAP_ACES;
    (camComp as any).gammaCorrection = pc.GAMMA_SRGB;
  }
  syncLights(app, scene, layerId);
  const present = new Set<number>();
  const queue: Object3DNode[] = [...scene.children];
  while (queue.length) {
    const node = queue.shift()!;
    if (isLightNode(node)) { present.add(node.id); continue; }
    present.add(node.id);
    let entity = entityMap.get(node.id);
    if (!entity) {
      entity = createEntityForNode(node, layerId);
      if (entity) {
        entityMap.set(node.id, entity);
        const parentEntity = node.parent && node.parent !== scene
          ? entityMap.get(node.parent.id) ?? rootEntity
          : rootEntity;
        parentEntity.addChild(entity);
      }
    }
    if (entity) updateEntity(entity, node);
    for (const child of node.children) queue.push(child);
  }
  const previouslyMounted = mountedEntityIds.get(scene) ?? new Set<number>();
  for (const id of previouslyMounted) {
    if (!present.has(id)) {
      const entity = entityMap.get(id);
      if (!entity) continue;
      entity.destroy();
      entityMap.delete(id);
    }
  }
  mountedEntityIds.set(scene, present);
}

function isLightNode(node: Object3DNode): boolean {
  return node.type === "DirectionalLight" || node.type === "HemisphereLight" || node.type === "PointLight";
}

function ensureCameraEntity(
  rootEntity: pc.Entity,
  scene: Scene,
  isOverlay: boolean,
  layerId: number,
): RenderEntity {
  const existing = cameraEntities.get(scene.id);
  if (existing) return existing;
  const entity = new pc.Entity(isOverlay ? `pc-camera-overlay-${scene.id}` : "pc-camera") as RenderEntity;
  entity.addComponent("camera", {
    clearColor: new pc.Color(0.05, 0.05, 0.07, 1),
    clearColorBuffer: !isOverlay,
    clearDepthBuffer: true,
    fov: 75, nearClip: 0.1, farClip: 1000,
    layers: [layerId],
    priority: isOverlay ? 1 : 0,
  });
  rootEntity.addChild(entity);
  cameraEntities.set(scene.id, entity);
  return entity;
}

function syncLights(app: pc.Application, scene: Scene, layerId: number) {
  // Tear down and rebuild the lights every frame; the Three.js scene graph
  // is the source of truth and the count is tiny (1-3 lights), so it's not
  // worth caching. We use a dedicated "pc-lights" container so the entities
  // don't get picked up by the scene graph walk and re-mounted each frame.
  const containerName = `pc-lights-${scene.id}`;
  let container = app.root.findByName(containerName) as pc.Entity | null;
  if (!container) {
    container = new pc.Entity(containerName);
    app.root.addChild(container);
  }
  const present = new Set<string>();
  for (const child of scene.children) {
    if (child.type === "DirectionalLight") {
      const dl = child as DirectionalLight;
      const name = `dir-light-${dl.id}`;
      present.add(name);
      const entity = (container.findByName(name) as pc.Entity | null) ?? new pc.Entity(name);
      try {
        if (!entity.light) entity.addComponent("light", { type: "directional", layers: [layerId] });
        const light = entity.light as any;
        light.color = colorFromHex(dl.color);
        light.intensity = dl.visible ? dl.intensity : 0;
        light.castShadows = dl.castShadow;
        light.layers = [layerId];
      } catch (e) {
        console.warn("[shim] dir-light failed", e);
        continue;
      }
      entity.setLocalPosition(dl.position.x, dl.position.y, dl.position.z);
      entity.lookAt(new pc.Vec3(0, 0, 0));
      if (!entity.parent) container.addChild(entity);
    } else if (child.type === "HemisphereLight") {
      const hl = child as HemisphereLight;
      const name = `hemi-light-${hl.id}`;
      present.add(name);
      const entity = (container.findByName(name) as pc.Entity | null) ?? new pc.Entity(name);
      try {
        if (!entity.light) entity.addComponent("light", { type: "directional", layers: [layerId] });
        const light = entity.light as any;
        light.color = colorFromHex(hl.color);
        light.intensity = hl.visible ? hl.intensity : 0;
        light.layers = [layerId];
      } catch (e) {
        console.warn("[shim] hemi-light failed", e);
        continue;
      }
      entity.setLocalPosition(0, 50, 0);
      if (!entity.parent) container.addChild(entity);
    } else if (child.type === "PointLight") {
      const pl = child as PointLight;
      const name = `point-light-${pl.id}`;
      present.add(name);
      const entity = (container.findByName(name) as pc.Entity | null) ?? new pc.Entity(name);
      try {
        if (!entity.light) entity.addComponent("light", { type: "point", layers: [layerId] });
        const light = entity.light as any;
        light.color = colorFromHex(pl.color);
        light.intensity = pl.visible ? pl.intensity : 0;
        light.range = pl.distance || 50;
        light.layers = [layerId];
      } catch (e) {
        console.warn("[shim] point-light failed", e);
        continue;
      }
      entity.setLocalPosition(pl.position.x, pl.position.y, pl.position.z);
      if (!entity.parent) container.addChild(entity);
    }
  }
  for (const child of [...container.children]) {
    if (!present.has(child.name)) child.destroy();
  }
}

function createEntityForNode(node: Object3DNode, layerId: number): pc.Entity | null {
  const entity = new pc.Entity(`obj-${node.id}`);
  if (node.type === "Mesh" || node.type === "Line") {
    attachMesh(entity, node as Mesh | Line, layerId);
  } else if (node.type === "Sprite") {
    attachSprite(entity, node as Sprite, layerId);
  } else if (node.type === "InstancedMesh") {
    attachInstancedMesh(entity, node as InstancedMeshNode, layerId);
  }
  return entity;
}

function updateEntity(entity: pc.Entity, node: Object3DNode) {
  entity.setLocalPosition(node.position.x, node.position.y, node.position.z);
  entity.setLocalEulerAngles(
    pc.math.RAD_TO_DEG * node.rotation.x,
    pc.math.RAD_TO_DEG * node.rotation.y,
    pc.math.RAD_TO_DEG * node.rotation.z,
  );
  entity.setLocalScale(node.scale.x, node.scale.y, node.scale.z);
  entity.enabled = node.visible;
  if ((node.type === "Mesh" || node.type === "Line") && (entity as RenderEntity).render) {
    syncMesh(entity as RenderEntity, node as Mesh | Line);
  } else if (node.type === "InstancedMesh") {
    syncInstancedMesh(entity, node as InstancedMeshNode);
  } else if (node.type === "Sprite" && entity.sprite) {
    syncSprite(entity, node as Sprite);
  }
}

function attachMesh(entity: pc.Entity, node: Mesh | Line, layerId: number) {
  const mesh = node.type === "Line"
    ? buildLineFor(node.geometry)
    : buildMeshFor(node.geometry, node.material);
  if (!mesh) return;
  const pcMat = ensurePcMaterial(node.material);
  if (!pcMat) return;
  const meshInstance = new pc.MeshInstance(mesh, pcMat, entity);
  // PlayCanvas's RenderComponent has no `castShadows`/`receiveShadows`
  // setters; the per-instance flag is what actually drives the shadow caster
  // list. Set it eagerly so the first frame already has the right value.
  meshInstance.castShadow = node.castShadow;
  try {
    (entity as unknown as { addComponent: (name: string, opts: unknown) => void })
      .addComponent("render", { meshInstances: [meshInstance], layers: [layerId] });
  } catch (_err) { /* headless / no graphics device */ }
}

function syncMesh(entity: RenderEntity, node: Mesh | Line) {
  const render = entity.render;
  if (!render) return;
  // Keep the per-instance shadow flags in sync each frame.
  for (const mi of render.meshInstances ?? []) {
    mi.castShadow = node.castShadow;
    mi.receiveShadow = node.receiveShadow;
    if (node.material) {
      const pcMat = ensurePcMaterial(node.material);
      if (pcMat && mi.material !== pcMat) mi.material = pcMat;
      syncPcMaterial(node.material);
    }
  }
  if (node.type === "Mesh") syncDynamicGeometry(node.geometry, render.meshInstances?.[0]?.mesh);
}

interface InstancedMeshNode extends Object3DNode {
  type: "InstancedMesh";
  geometry: GeometryBase | null;
  material: Material | null;
  count: number;
  matrices: Float32Array[];
  castShadow: boolean;
  receiveShadow: boolean;
}

function attachInstancedMesh(entity: pc.Entity, node: InstancedMeshNode, layerId: number) {
  const mesh = buildMeshFor(node.geometry, node.material);
  if (!mesh) return;
  const pcMat = ensurePcMaterial(node.material);
  if (!pcMat) return;
  // Split into N child entities, each carrying its own MeshInstance. PlayCanvas
  // does support a true GPU-instanced path via ModelComponent + per-instance
  // attribute buffers, but for ~500 instances the per-entity cost is
  // negligible and the per-instance transforms stay trivially correct.
  for (let i = 0; i < node.count; i++) {
    const child = new pc.Entity(`inst-${node.id}-${i}`);
    applyInstanceMatrix(child, node.matrices[i]);
    const mi = new pc.MeshInstance(mesh, pcMat, child);
    mi.castShadow = node.castShadow;
    try {
      (child as unknown as { addComponent: (name: string, opts: unknown) => void })
        .addComponent("render", { meshInstances: [mi], layers: [layerId] });
      entity.addChild(child);
    } catch (_err) { /* headless / no graphics device */ }
  }
}

function syncInstancedMesh(_entity: pc.Entity, _node: InstancedMeshNode) {
  // Per-instance transforms are baked at attach time from the matrices the
  // shim captured via `setMatrixAt`. The Three.js code path never updates
  // them after construction, so nothing to sync here.
}

function applyInstanceMatrix(child: pc.Entity, m: Float32Array | undefined) {
  if (!m) return;
  // m is row-major (set by InstancedMesh.setMatrixAt from Three.js's
  // column-major matrix). Extract translation, scale, and a basis rotation
  // the entity can consume via setLocalPosition / setLocalScale / setLocalEulerAngles.
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  child.setLocalPosition(m[3], m[7], m[11]);
  child.setLocalScale(sx, sy, sz);
  if (sx > 0 && sy > 0 && sz > 0) {
    // Build a 3x3 rotation matrix from the normalized basis and extract
    // Euler angles. We use the YXZ order Three.js applies so the result
    // matches what `updateMatrix` would have produced.
    const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
    const r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
    const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
    const pitch = Math.asin(-Math.max(-1, Math.min(1, r20)));
    const yaw = Math.atan2(r02, r22);
    const roll = Math.atan2(r10, r11);
    child.setLocalEulerAngles(
      pc.math.RAD_TO_DEG * yaw,
      pc.math.RAD_TO_DEG * pitch,
      pc.math.RAD_TO_DEG * roll,
    );
  }
}

function buildMeshFor(geometry: GeometryBase | null, material: Material | null): pc.Mesh | null {
  if (!geometry) return null;
  const cached = geometry.pcMesh as pc.Mesh | null;
  // RenderComponent destroys an unreferenced PlayCanvas mesh when its last
  // short-lived entity disappears. Shared shim geometry can outlive that
  // entity (projectile spheres are reused), so only reuse a live GPU mesh.
  if (cached?.vertexBuffer) return cached;
  if (cached) geometry.pcMesh = null;
  // Without a live graphics device (Node test runs) we cannot build a
  // PlayCanvas mesh. Return early so we don't poison the cache with a
  // sentinel `null` that would force a rebuild on every call.
  if (!_activeApp?.graphicsDevice) return null;
  // ExtrudeGeometry is intentionally metadata-only in the compatibility
  // layer. Rendering its old unit-cube placeholder put a camera-filling dark
  // block where the MG barrel jacket or gun shield should be. Until the shim
  // carries the authored outline, omit that unsupported part instead.
  if (geometry.kind === "extrude" && geometry.vertices?.length === 0) return null;
  if (geometry.vertices && geometry.indices) {
    const m = buildMeshFromArrays(
      geometry.vertices,
      geometry.indices,
      geometry.colors,
      geometry.getAttribute("uv")?.array,
    );
    geometry.pcMesh = m;
    return m;
  }
  const builder = PRIMITIVE_BUILDERS[geometry.kind];
  if (!builder) return null;
  const m = builder(geometry.parameters, material);
  if (m) geometry.pcMesh = m;
  return m;
}

function buildLineFor(geometry: GeometryBase | null): pc.Mesh | null {
  if (!geometry?.vertices || geometry.vertices.length < 6 || !_activeApp?.graphicsDevice) return null;
  const cached = geometry.pcMesh as pc.Mesh | null;
  if (cached?.vertexBuffer) return cached;
  const mesh = new pc.Mesh(_activeApp.graphicsDevice);
  mesh.setPositions(geometry.vertices);
  mesh.update(pc.PRIMITIVE_LINES);
  geometry.pcMesh = mesh;
  return mesh;
}

function syncDynamicGeometry(geometry: GeometryBase | null, mesh: pc.Mesh | undefined) {
  const position = geometry?.getAttribute("position");
  if (!position?.needsUpdate || !mesh) return;
  mesh.setPositions(position.array);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  position.needsUpdate = false;
}

type Builder = (p: Record<string, unknown>, mat: Material | null) => pc.Mesh | null;

// PlayCanvas 2.x removed the `pc.createBox/createPlane/createTorus` family in
// favour of `pc.Mesh.fromGeometry(device, new pc.XxxGeometry({...}))`. The old
// helpers are now no-ops that print `DEPRECATED` console warnings — which is
// why the page rendered as a black void. The builders below all use the
// non-deprecated static constructor.
const PRIMITIVE_BUILDERS: Record<string, Builder> = {
  box: (p, mat) => {
    const w = (p.width as number) ?? 1;
    const h = (p.height as number) ?? 1;
    const d = (p.depth as number) ?? 1;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    const mesh = pc.Mesh.fromGeometry(device, new pc.BoxGeometry({
      halfExtents: new pc.Vec3(w / 2, h / 2, d / 2),
    }));
    applyMaterial(mesh, mat);
    return mesh;
  },
  sphere: (p, mat) => {
    const r = (p.radius as number) ?? 1;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    const mesh = pc.Mesh.fromGeometry(device, new pc.SphereGeometry({
      radius: r, latitudeBands: 16, longitudeBands: 12,
    }));
    applyMaterial(mesh, mat);
    return mesh;
  },
  cylinder: (p, mat) => {
    const rt = (p.radiusTop as number) ?? 1;
    const rb = (p.radiusBottom as number) ?? 1;
    const h = (p.height as number) ?? 1;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    // PlayCanvas's CylinderGeometry has a single `radius` (no top/bottom);
    // we use the larger of the two and accept the visual simplification.
    const mesh = pc.Mesh.fromGeometry(device, new pc.CylinderGeometry({
      radius: Math.max(rt, rb),
      height: h,
      capSegments: 12,
    }));
    applyMaterial(mesh, mat);
    return mesh;
  },
  cone: (p, mat) => {
    const r = (p.radius as number) ?? 1;
    const h = (p.height as number) ?? 1;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    const mesh = pc.Mesh.fromGeometry(device, new pc.ConeGeometry({
      baseRadius: r, peakRadius: 0, height: h,
      heightSegments: 1, capSegments: 8,
    }));
    applyMaterial(mesh, mat);
    return mesh;
  },
  plane: (p, mat) => {
    const w = (p.width as number) ?? 1;
    const h = (p.height as number) ?? 1;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    const mesh = pc.Mesh.fromGeometry(device, new pc.PlaneGeometry({
      halfExtents: new pc.Vec2(w / 2, h / 2),
      widthSegments: 1, lengthSegments: 1,
    }));
    applyMaterial(mesh, mat);
    return mesh;
  },
  torus: (p, mat) => {
    const tube = (p.tube as number) ?? 0.4;
    const ring = (p.radius as number) ?? 1;
    const radialSegments = (p.radialSegments as number) ?? 8;
    const tubularSegments = (p.tubularSegments as number) ?? 24;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    const geometry = new pc.TorusGeometry({
      tubeRadius: tube, ringRadius: ring,
      sides: radialSegments, segments: tubularSegments,
    });
    // PlayCanvas authors toruses in the XZ plane (axis +Y); Three.js authors
    // them in XY (axis +Z). Rotate the primitive data once so existing weapon
    // sights, wheels, and handwheels retain their authored orientation.
    for (const vectors of [geometry.positions, geometry.normals]) {
      for (let i = 0; i < vectors.length; i += 3) {
        const y = vectors[i + 1];
        vectors[i + 1] = -vectors[i + 2];
        vectors[i + 2] = y;
      }
    }
    const mesh = pc.Mesh.fromGeometry(device, geometry);
    applyMaterial(mesh, mat);
    return mesh;
  },
  dodecahedron: (p, mat) => {
    const r = (p.radius as number) ?? 1;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    // PlayCanvas has no DodecahedronGeometry. A low-poly sphere reads as a
    // chunky rock in this scene.
    const mesh = pc.Mesh.fromGeometry(device, new pc.SphereGeometry({
      radius: r, latitudeBands: 4, longitudeBands: 6,
    }));
    applyMaterial(mesh, mat);
    return mesh;
  },
  extrude: (p, mat) => {
    const w = (p.width as number) ?? 1;
    const h = (p.height as number) ?? 1;
    const d = (p.depth as number) ?? 1;
    const device = _activeApp?.graphicsDevice;
    if (!device) return null;
    const mesh = pc.Mesh.fromGeometry(device, new pc.BoxGeometry({
      halfExtents: new pc.Vec3(w / 2, h / 2, d / 2),
    }));
    applyMaterial(mesh, mat);
    return mesh;
  },
};

// Builds (or returns cached) PlayCanvas material for the given Three.js-style
// material. In PlayCanvas 2.x the material lives on the MeshInstance, not on
// the Mesh — so we cache the pc.Material on the shim's `Material.pcMaterial`
// field and let the callers wrap it in a MeshInstance.
function ensurePcMaterial(material: Material | null): pc.Material | null {
  if (!material) return null;
  if (material.pcMaterial) return material.pcMaterial as pc.Material;
  let pcMat: pc.Material;
  switch (material.kind) {
    case "MeshBasicMaterial":
      pcMat = new pc.StandardMaterial();
      pcMat.useLighting = false;
      setColor(pcMat, (material as MeshBasicMaterial).color);
      break;
    case "SpriteMaterial":
      pcMat = new pc.StandardMaterial();
      pcMat.useLighting = false;
      setColor(pcMat, (material as SpriteMaterial).color);
      if (material.opacity < 1) {
        pcMat.opacity = material.opacity;
        pcMat.blendType = pc.BLEND_NORMAL;
        pcMat.depthWrite = material.depthWrite;
        pcMat.update();
      }
      break;
    case "LineBasicMaterial":
      pcMat = new pc.StandardMaterial();
      pcMat.useLighting = false;
      setColor(pcMat, (material as LineBasicMaterial).color);
      break;
    case "ShaderMaterial":
      const fragmentShader = (material as any).fragmentShader || `void main(void){ gl_FragColor = vec4(1.0); }`;
      const varyingName = fragmentShader.includes("vDirection") ? "vDirection" : "vPos";
      pcMat = new pc.ShaderMaterial({
        uniqueName: `beachhead-shader-${nextShaderMaterialId++}`,
        attributes: { aPosition: pc.SEMANTIC_POSITION },
        vertexGLSL: `attribute vec3 aPosition; uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; varying vec3 ${varyingName}; void main(void){ ${varyingName} = aPosition; gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0); }`,
        fragmentGLSL: fragmentShader,
      });
      break;
    default:
      pcMat = new pc.StandardMaterial();
      setColor(pcMat, (material as MeshStandardMaterial).color);
      if ((material as MeshStandardMaterial).emissive) {
        pcMat.emissive = colorFromHex((material as MeshStandardMaterial).emissive);
        pcMat.emissiveIntensity = (material as MeshStandardMaterial).emissiveIntensity ?? 1;
      }
      if ((material as MeshStandardMaterial).metalness !== undefined) {
        pcMat.metalness = (material as MeshStandardMaterial).metalness;
      }
      if ((material as MeshStandardMaterial).roughness !== undefined) {
        pcMat.roughness = (material as MeshStandardMaterial).roughness;
      }
      break;
  }
  if (material.side === 2) pcMat.cull = pc.CULLFACE_NONE;
  else if (material.side === 1) pcMat.cull = pc.CULLFACE_FRONT;
  else pcMat.cull = pc.CULLFACE_BACK;
  if (material.transparent) {
    pcMat.opacity = material.opacity;
    pcMat.blendType = pc.BLEND_NORMAL;
    pcMat.depthWrite = material.depthWrite;
  }
  if (material.map instanceof Object && (material.map as any).source) {
    const texture = ensurePcTexture(material.map as CanvasTexture);
    if (texture) {
      (pcMat as any).diffuseMap = texture;
      const emissive = (material as any).emissive;
      const emissiveVisible = typeof emissive === "number"
        ? emissive !== 0
        : !!emissive && (emissive.r > 0 || emissive.g > 0 || emissive.b > 0);
      if (emissiveVisible) (pcMat as any).emissiveMap = texture;
      if (material.transparent) (pcMat as any).opacityMap = texture;
      (pcMat as any).diffuseMapTiling = new pc.Vec2(
        (material.map as CanvasTexture).repeat.x,
        (material.map as CanvasTexture).repeat.y,
      );
    }
  }
  if ((material as any).vertexColors) (pcMat as any).diffuseVertexColor = true;
  if ((material as any).depthTest === false) (pcMat as any).depthTest = false;
  if ((material as any).polygonOffset) {
    (pcMat as any).polygonOffset = true;
    (pcMat as any).polygonOffsetFactor = (material as any).polygonOffsetFactor;
    (pcMat as any).polygonOffsetUnits = (material as any).polygonOffsetUnits;
  }
  for (const [name, uniform] of Object.entries(material.uniforms ?? {})) {
    (pcMat as any).setParameter?.(name, uniform.value);
  }
  pcMat.update();
  material.pcMaterial = pcMat;
  return pcMat;
}

function syncPcMaterial(material: Material) {
  const pcMat = material.pcMaterial as any;
  if (!pcMat) return;
  setColor(pcMat, material.color);
  if (material.emissive) pcMat.emissive = colorFromHex(material.emissive);
  if ((material as any).emissiveIntensity !== undefined) pcMat.emissiveIntensity = (material as any).emissiveIntensity;
  pcMat.opacity = material.opacity;
  pcMat.blendType = material.blending === 1 ? pc.BLEND_ADDITIVE : (material.transparent ? pc.BLEND_NORMAL : pc.BLEND_NONE);
  pcMat.depthWrite = material.depthWrite;
  for (const [name, uniform] of Object.entries(material.uniforms ?? {})) {
    pcMat.setParameter?.(name, uniform.value);
  }
  pcMat.update();
}

function ensurePcTexture(texture: CanvasTexture): pc.Texture | null {
  if (texture.pcTexture) return texture.pcTexture as pc.Texture;
  const device = _activeApp?.graphicsDevice;
  if (!device || !texture.source) return null;
  const pcTexture = new pc.Texture(device, {
    width: texture.source.width,
    height: texture.source.height,
    format: pc.PIXELFORMAT_RGBA8,
    addressU: texture.wrapS === 1 ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: texture.wrapT === 1 ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
  });
  pcTexture.setSource(texture.source);
  texture.pcTexture = pcTexture;
  return pcTexture;
}

// Backwards-compatible no-op wrapper kept so PRIMITIVE_BUILDERS that still call
// `applyMaterial(mesh, mat)` don't break. New code should use `ensurePcMaterial`.
function applyMaterial(_mesh: pc.Mesh, _material: Material | null) { /* use ensurePcMaterial */ }

function setColor(m: pc.StandardMaterial, color: number | { r: number; g: number; b: number }) {
  if (typeof color === "number") m.diffuse = colorFromHex(color);
  else m.diffuse = new pc.Color(color.r, color.g, color.b, 1);
}

function buildMeshFromArrays(
  positions: Float32Array,
  indices: Uint32Array,
  colors: Float32Array | null,
  uvs?: Float32Array,
): pc.Mesh {
  const device = _activeApp?.graphicsDevice;
  const mesh = new pc.Mesh(device);
  if (!device) return mesh;
  const vertexCount = positions.length / 3;
  // Compute per-vertex normals from the triangle list so the resulting
  // mesh works with lit materials (StandardMaterial expects NORMAL at
  // attribute location 1). Three.js's `computeVertexNormals` is a no-op
  // in the shim, so we do the work here where the actual positions and
  // indices are present.
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const fx = cx - ax, fy = cy - ay, fz = cz - az;
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    normals[a * 3] += nx; normals[a * 3 + 1] += ny; normals[a * 3 + 2] += nz;
    normals[b * 3] += nx; normals[b * 3 + 1] += ny; normals[b * 3 + 2] += nz;
    normals[c * 3] += nx; normals[c * 3 + 1] += ny; normals[c * 3 + 2] += nz;
  }
  for (let i = 0; i < vertexCount; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  }
  // Let Mesh build its own vertex format and GPU buffers. Assigning the
  // low-level buffers directly leaves PlayCanvas's internal geometry state
  // incomplete; dynamically added meshes then fail at draw time because the
  // shader cannot find vertex_position.
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  if (colors) {
    const colorComponents = colors.length / vertexCount;
    mesh.setColors(colors, colorComponents === 4 ? 4 : 3);
  }
  if (uvs && uvs.length === vertexCount * 2) mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

function attachSprite(entity: pc.Entity, node: Sprite, layerId: number) {
  if (!_activeApp) return;
  const mat = node.material as SpriteMaterial | null;
  const texture = mat?.map as CanvasTexture | null;
  const cacheKey = (texture && typeof texture === "object") ? texture : null;
  const cachedAsset = cacheKey ? spriteAssets.get(cacheKey) : placeholderSpriteAsset;
  if (cachedAsset) {
    try { entity.addComponent("sprite", { spriteAsset: cachedAsset, layers: [layerId] }); } catch (_err) { /* ignore */ }
    return;
  }
  let tex: pc.Texture | null = null;
  if (texture && texture.source) {
    tex = new pc.Texture(_activeApp.graphicsDevice, {
      width: texture.source.width,
      height: texture.source.height,
      format: pc.PIXELFORMAT_RGBA8,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    tex.setSource(texture.source);
  } else {
    // Fall back to a 1x1 white texture so the sprite still renders.
    const placeholder = document.createElement("canvas");
    placeholder.width = 1;
    placeholder.height = 1;
    const ctx = placeholder.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1, 1);
    tex = new pc.Texture(_activeApp.graphicsDevice, { width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8 });
    tex.setSource(placeholder);
  }
  const atlas = new pc.TextureAtlas();
  atlas.texture = tex;
  atlas.frames = {};
  atlas.setFrame("0", {
    rect: new pc.Vec4(0, 0, tex.width, tex.height),
    pivot: new pc.Vec2(0.5, 0.5),
    border: new pc.Vec4(0, 0, 0, 0),
  });
  const spriteResource = new pc.Sprite(_activeApp.graphicsDevice, {
    atlas,
    frameKeys: ["0"],
    // THREE.Sprite scale is expressed in world units. Normalizing the source
    // texture prevents a 128px smoke puff from becoming 128 world units wide.
    pixelsPerUnit: Math.max(1, tex.width, tex.height),
  });
  const asset = new pc.Asset(`sprite-${node.id}`, "sprite", { url: "" });
  asset.resource = spriteResource;
  asset.loaded = true;
  _activeApp.assets.add(asset);
  if (cacheKey) spriteAssets.set(cacheKey, asset);
  else placeholderSpriteAsset = asset;
  spriteAssetSet.add(asset);
  try {
    entity.addComponent("sprite", { spriteAsset: asset, layers: [layerId] });
  } catch (_err) { /* ignore */ }
}

function syncSprite(entity: RenderEntity, node: Sprite) {
  if (entity.sprite && node.material) {
    const m = node.material as SpriteMaterial;
    const sp = entity.sprite as { color?: pc.Color; rotation?: number };
    const color = m.color;
    sp.color = typeof color === "number"
      ? new pc.Color(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, m.opacity)
      : new pc.Color(color.r, color.g, color.b, m.opacity);
    if (m.rotation) sp.rotation = pc.math.RAD_TO_DEG * m.rotation;
  }
}
