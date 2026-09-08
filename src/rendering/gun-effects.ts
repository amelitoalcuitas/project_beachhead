import * as pc from "playcanvas";
import { getActiveApp, WEAPON_OVERLAY_LAYER_ID } from "../pc-shim/index.ts";
import { terrainHeight } from "./battlefield.ts";
import type { EnemyType, Weapon } from "../types.ts";

type Position = { x: number; y: number; z: number };
type Direction = Position;
export interface MuzzlePose { position: Position; direction: Direction; }
export type MgImpactSurface = "terrain" | "armor" | "infantry";

const MAX_FLASHES = 18;
const MAX_SMOKE_BURSTS = 28;
const MAX_CANNON_MARKS = 36;
export const CANNON_MARK_LIFETIME = 15;

export function cannonMarkOpacity(life: number, maxOpacity = 0.56) {
  return Math.max(0, life / CANNON_MARK_LIFETIME) * maxOpacity;
}

export function cannonImpactMarkApplies(weapon: Weapon, position: Position) {
  return (weapon === "CANNON" || weapon === "BOFORS") &&
    Math.abs(position.y - terrainHeight(position.x, position.z)) <= 2.5;
}

export function mgImpactSurface(enemyType?: EnemyType): MgImpactSurface {
  if (!enemyType) return "terrain";
  return enemyType === "infantry" || enemyType === "armoredInfantry" || enemyType === "grenadierInfantry"
    ? "infantry"
    : "armor";
}

interface FlashSlot { root: pc.Entity; core: pc.Entity; spike: pc.Entity; light: pc.Entity; layerId: number; life: number; maxLife: number; lightIntensity: number; }
interface SmokeSlot { entity: pc.Entity; life: number; }
interface MarkSlot { entity: pc.Entity; mesh: pc.Mesh; material: pc.StandardMaterial; life: number; maxOpacity: number; }

/**
 * Direct PlayCanvas rendering for the high-frequency weapon effects. It is
 * deliberately separate from the compatibility scene so native entities are
 * not mirrored or disposed by the shim's scene walker.
 */
export class GunEffectsSystem {
  private app?: pc.Application;
  private root?: pc.Entity;
  private readonly flashes: FlashSlot[] = [];
  private readonly smoke: SmokeSlot[] = [];
  private readonly marks: MarkSlot[] = [];
  private smokeTexture?: pc.Texture;
  private flashTexture?: pc.Texture;

  emitMuzzle(position: Position, direction: Direction, weapon: Weapon, actor: "player" | "tank" = "player", viewPose?: MuzzlePose) {
    if (!this.ensureReady()) return;
    const profile = muzzleProfile(weapon, actor);
    const origin = vec(position); const forward = normalized(direction);
    this.emitFlash(origin, forward, profile, pc.LAYERID_WORLD, actor === "player" ? 0.72 : 1);
    if (actor === "player" && viewPose) {
      const overlayScale = weapon === "MG" ? 1.4 : weapon === "CANNON" ? 1.25 : 1.2;
      this.emitFlash(vec(viewPose.position), normalized(viewPose.direction), profile, WEAPON_OVERLAY_LAYER_ID, overlayScale);
    }
    if (actor === "tank") this.emitSmoke(origin, forward, weapon, "tank");
  }

  private emitFlash(origin: pc.Vec3, forward: pc.Vec3, profile: ReturnType<typeof muzzleProfile>, layerId: number, scale: number) {
    const slot = this.acquireFlash(layerId);
    slot.root.enabled = true;
    slot.root.setPosition(origin);
    slot.root.lookAt(origin.clone().add(forward));
    slot.core.setLocalScale(profile.coreWidth * scale, 1, profile.coreLength * scale);
    slot.core.setLocalEulerAngles(90, 0, Math.random() * 360);
    slot.core.setLocalPosition(0, 0, -profile.coreLength * 0.08);
    slot.spike.setLocalScale(profile.spikeWidth * scale, profile.spikeLength * scale, profile.spikeWidth * scale);
    slot.spike.setLocalEulerAngles(-90, 0, 0);
    slot.spike.setLocalPosition(0, 0, -profile.spikeLength * 0.42);
    setMaterialColor(slot.core, profile.color, 1);
    setMaterialColor(slot.spike, profile.tipColor, 0.92);
    slot.light.light!.color = hexColor(profile.color);
    slot.light.light!.intensity = layerId === pc.LAYERID_WORLD ? profile.lightIntensity : profile.lightIntensity * 0.35;
    slot.light.light!.range = profile.lightRange;
    slot.life = slot.maxLife = profile.life;
    slot.lightIntensity = slot.light.light!.intensity;
  }

  emitShotSmoke(position: Position, direction: Direction, weapon: Weapon) {
    if (!this.ensureReady()) return;
    this.emitSmoke(vec(position), normalized(direction), weapon, "shot");
  }

  emitResidualMgSmoke(position: Position, direction: Direction) {
    if (!this.ensureReady()) return;
    this.emitSmoke(vec(position), normalized(direction), "MG", "residual");
  }

  emitMgImpact(position: Position, enemyType?: EnemyType) {
    if (!this.ensureReady()) return;
    const surface = mgImpactSurface(enemyType);
    if (surface === "infantry") {
      this.emitSmoke(vec(position), new pc.Vec3(0, 1, 0), "MG", "impact-light");
      return;
    }
    const direction = surface === "armor" ? new pc.Vec3(0, 0.7, 0) : new pc.Vec3(0, 1, 0);
    this.emitSmoke(vec(position), direction, "MG", surface === "armor" ? "impact-armor" : "impact-dirt");
    this.emitImpactFlash(vec(position), surface === "armor" ? 0xffdd8a : 0xd6a35a, surface === "armor" ? 0.18 : 0.11);
  }

  addCannonImpactMark(position: Position, weapon: Weapon) {
    if (!this.ensureReady() || !cannonImpactMarkApplies(weapon, position)) return;
    const slot = this.acquireMark();
    const size = weapon === "CANNON" ? 5.8 : 3.7;
    const groundY = terrainHeight(position.x, position.z);
    const normal = terrainNormal(position.x, position.z);
    slot.entity.enabled = true;
    slot.entity.setPosition(position.x, groundY + 0.035, position.z);
    slot.entity.setRotation(new pc.Quat().setFromDirections(new pc.Vec3(0, 1, 0), normal));
    slot.entity.rotateLocal(0, Math.random() * 360, 0);
    slot.entity.setLocalScale(size, 1, size);
    slot.maxOpacity = weapon === "CANNON" ? 0.56 : 0.42;
    slot.material.opacity = slot.maxOpacity;
    slot.material.update();
    slot.life = CANNON_MARK_LIFETIME;
  }

  update(dt: number) {
    if (!this.root) return;
    for (const flash of this.flashes) {
      if (flash.life <= 0) continue;
      flash.life -= dt;
      const t = Math.max(0, flash.life / flash.maxLife);
      const ignition = Math.min(1, t * 5);
      const afterglow = Math.pow(t, 2.4);
      setEntityOpacity(flash.core, ignition * (0.18 + afterglow * 0.82));
      setEntityOpacity(flash.spike, ignition * afterglow * 0.82);
      flash.light.light!.intensity = flash.lightIntensity * afterglow;
      if (flash.life <= 0) flash.root.enabled = false;
    }
    for (const burst of this.smoke) {
      if (burst.life <= 0) continue;
      burst.life -= dt;
      if (burst.life <= 0) burst.entity.enabled = false;
    }
    for (const mark of this.marks) {
      if (mark.life <= 0) continue;
      mark.life -= dt;
      mark.material.opacity = cannonMarkOpacity(mark.life, mark.maxOpacity);
      mark.material.update();
      if (mark.life <= 0) mark.entity.enabled = false;
    }
  }

  clear() {
    for (const flash of this.flashes) {
      destroyRenderResources(flash.core);
      destroyRenderResources(flash.spike);
      flash.root.destroy();
    }
    for (const burst of this.smoke) { burst.entity.destroy(); }
    for (const mark of this.marks) { mark.entity.destroy(); mark.mesh.destroy(); mark.material.destroy(); }
    this.flashes.length = this.smoke.length = this.marks.length = 0;
    this.smokeTexture?.destroy();
    this.flashTexture?.destroy();
    this.smokeTexture = undefined;
    this.flashTexture = undefined;
    this.root?.destroy();
    this.root = undefined;
    this.app = undefined;
  }

  private ensureReady() {
    const activeApp = getActiveApp();
    if (!activeApp) return false;
    if (this.app === activeApp && this.root) return true;
    this.clear();
    this.app = activeApp;
    this.root = new pc.Entity("native-gun-effects");
    activeApp.root.addChild(this.root);
    this.smokeTexture = createSoftTexture(activeApp);
    this.flashTexture = createFlashTexture(activeApp);
    return true;
  }

  private acquireFlash(layerId: number = pc.LAYERID_WORLD) {
    const available = this.flashes.find((slot) => slot.life <= 0 && slot.layerId === layerId) ??
      (this.flashes.length >= MAX_FLASHES ? this.flashes.find((slot) => slot.layerId === layerId) : undefined);
    if (available) { if (!this.flashes.includes(available)) this.flashes.push(available); return available; }
    const root = new pc.Entity("gun-flash");
    const core = makeFlashCore(this.flashTexture!, layerId);
    const spike = makeFlashCone(layerId);
    const light = new pc.Entity("gun-flash-light");
    light.addComponent("light", { type: "omni", intensity: 0, range: 10, layers: [layerId] });
    root.addChild(core); root.addChild(spike); root.addChild(light); this.root!.addChild(root);
    const slot = { root, core, spike, light, layerId, life: 0, maxLife: 0, lightIntensity: 0 };
    this.flashes.push(slot);
    return slot;
  }

  private emitImpactFlash(position: pc.Vec3, color: number, size: number) {
    const slot = this.acquireFlash();
    slot.root.enabled = true;
    slot.root.setPosition(position);
    slot.root.setEulerAngles(0, Math.random() * 360, 0);
    slot.core.setLocalScale(size, 1, size);
    slot.core.setLocalEulerAngles(0, 0, Math.random() * 360);
    slot.spike.setLocalScale(size * 0.32, size * 1.4, size * 0.32);
    setMaterialColor(slot.core, color, 1); setMaterialColor(slot.spike, color, 0.7);
    slot.light.light!.intensity = 0; slot.lightIntensity = 0; slot.life = slot.maxLife = 0.09;
  }

  private emitSmoke(position: pc.Vec3, direction: pc.Vec3, weapon: Weapon, kind: SmokeKind) {
    const slot = this.acquireSmoke(kind);
    const profile = smokeProfile(weapon, kind);
    slot.entity.enabled = true;
    slot.entity.setPosition(position);
    const system = slot.entity.particlesystem!;
    system.initialVelocity = profile.speed;
    system.emitterExtents = new pc.Vec3(profile.spread, profile.spread * 0.45, profile.spread);
    system.lifetime = profile.life;
    system.reset(); system.play();
    slot.life = profile.life + 0.18;
    // Particle-system velocity is local; orient its +Z emission toward the discharge/impact direction.
    slot.entity.lookAt(position.clone().add(direction));
  }

  private acquireSmoke(kind: SmokeKind) {
    const available = this.smoke.find((slot) => slot.life <= 0) ?? (this.smoke.length >= MAX_SMOKE_BURSTS ? this.smoke.shift() : undefined);
    if (available) { if (!this.smoke.includes(available)) this.smoke.push(available); return available; }
    const entity = new pc.Entity(`gun-smoke-${kind}`);
    const profile = smokeProfile("MG", kind);
    entity.addComponent("particlesystem", particleOptions(this.smokeTexture!, profile));
    this.root!.addChild(entity);
    const slot = { entity, life: 0 }; this.smoke.push(slot); return slot;
  }

  private acquireMark() {
    const available = this.marks.find((slot) => slot.life <= 0) ?? (this.marks.length >= MAX_CANNON_MARKS ? this.marks.shift() : undefined);
    if (available) { if (!this.marks.includes(available)) this.marks.push(available); return available; }
    const entity = new pc.Entity("cannon-impact-mark");
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0.095, 0.062, 0.032); material.opacity = 0.56;
    material.blendType = pc.BLEND_NORMAL; material.depthWrite = false; material.cull = pc.CULLFACE_NONE; material.update();
    const mesh = createIrregularScorchMesh(this.app!);
    const meshInstance = new pc.MeshInstance(mesh, material, entity);
    meshInstance.castShadow = false; meshInstance.receiveShadow = false;
    entity.addComponent("render", { meshInstances: [meshInstance], layers: [pc.LAYERID_WORLD] });
    this.root!.addChild(entity);
    const slot = { entity, mesh, material, life: 0, maxOpacity: 0.56 }; this.marks.push(slot); return slot;
  }
}

type SmokeKind = "shot" | "tank" | "residual" | "impact-dirt" | "impact-armor" | "impact-light";
export function muzzleProfile(weapon: Weapon, actor: "player" | "tank" = "player") {
  // These are deliberately visible at the player's weapon scale. The weapon
  // view's muzzle mesh is only an anchor; the native overlay renders the flash.
  if (actor === "tank") return { coreWidth: 0.42, coreLength: 0.52, spikeWidth: 0.12, spikeLength: 0.95, color: 0xff9f45, tipColor: 0xffdf9a, lightIntensity: 3.2, lightRange: 20, life: 0.24 };
  if (weapon === "CANNON") return { coreWidth: 0.42, coreLength: 0.56, spikeWidth: 0.11, spikeLength: 0.95, color: 0xffaa4f, tipColor: 0xffe5a6, lightIntensity: 3.4, lightRange: 20, life: 0.22 };
  if (weapon === "BOFORS") return { coreWidth: 0.32, coreLength: 0.4, spikeWidth: 0.085, spikeLength: 0.7, color: 0xff8f42, tipColor: 0xffdda0, lightIntensity: 2.5, lightRange: 17, life: 0.16 };
  return { coreWidth: 0.2, coreLength: 0.28, spikeWidth: 0.055, spikeLength: 0.42, color: 0xffc264, tipColor: 0xffedb0, lightIntensity: 1.4, lightRange: 10, life: 0.11 };
}
function smokeProfile(weapon: Weapon, kind: SmokeKind) {
  if (kind === "impact-dirt") return { count: 7, life: 0.48, speed: 0.7, spread: 0.16, color: new pc.Color(0.42, 0.31, 0.2) };
  if (kind === "impact-armor") return { count: 5, life: 0.36, speed: 1.1, spread: 0.1, color: new pc.Color(0.3, 0.31, 0.31) };
  if (kind === "impact-light") return { count: 2, life: 0.25, speed: 0.25, spread: 0.05, color: new pc.Color(0.5, 0.42, 0.34) };
  if (kind === "residual") return { count: 3, life: 0.8, speed: 0.15, spread: 0.05, color: new pc.Color(0.45, 0.45, 0.42) };
  const heavy = weapon !== "MG" || kind === "tank";
  return { count: heavy ? 7 : 3, life: heavy ? 0.9 : 0.48, speed: heavy ? 0.85 : 0.45, spread: heavy ? 0.12 : 0.045, color: heavy ? new pc.Color(0.42, 0.4, 0.36) : new pc.Color(0.52, 0.5, 0.45) };
}
function particleOptions(texture: pc.Texture, profile: ReturnType<typeof smokeProfile>) {
  return {
    numParticles: profile.count, lifetime: profile.life, rate: 0.01, rate2: 0.018, loop: false, autoPlay: false,
    emitterShape: pc.EMITTERSHAPE_SPHERE, emitterRadius: 0.03, initialVelocity: profile.speed,
    velocityGraph: new pc.CurveSet([0, 0, 1, 0], [0, 0.45, 1, 0.9], [0, 1, 1, 0]),
    scaleGraph: new pc.Curve([0, 0.035, 0.35, 0.13, 1, 0.34]), alphaGraph: new pc.Curve([0, 0, 0.12, 0.18, 0.68, 0.08, 1, 0]),
    colorGraph: new pc.CurveSet([0, profile.color.r, 1, profile.color.r], [0, profile.color.g, 1, profile.color.g], [0, profile.color.b, 1, profile.color.b]),
    colorMap: texture, blendType: pc.BLEND_NORMAL, depthWrite: false, sort: pc.PARTICLESORT_NONE,
    orientation: pc.PARTICLEORIENTATION_SCREEN, layers: [pc.LAYERID_WORLD], lighting: false,
  } as any;
}
function makeFlashCore(texture: pc.Texture, layerId: number) {
  const entity = new pc.Entity("gun-flash-core"); const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0, 0, 0); material.emissive = new pc.Color(0.72, 0.72, 0.72); material.emissiveMap = texture;
  material.opacityMap = texture; material.opacityMapChannel = "a"; material.opacity = 1;
  material.blendType = pc.BLEND_ADDITIVE; material.depthWrite = false; material.cull = pc.CULLFACE_NONE; material.update();
  const mesh = pc.Mesh.fromGeometry(getActiveApp()!.graphicsDevice, new pc.PlaneGeometry({ widthSegments: 1, lengthSegments: 1 }));
  const meshInstance = new pc.MeshInstance(mesh, material, entity);
  meshInstance.castShadow = false; meshInstance.receiveShadow = false;
  entity.addComponent("render", { meshInstances: [meshInstance], layers: [layerId] }); return entity;
}
function makeFlashCone(layerId: number) {
  const entity = new pc.Entity("gun-flash-flame"); const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(0, 0, 0); material.emissive = new pc.Color(0.65, 0.65, 0.65); material.opacity = 0.58;
  material.blendType = pc.BLEND_ADDITIVE; material.depthWrite = false; material.cull = pc.CULLFACE_NONE; material.update();
  const mesh = pc.Mesh.fromGeometry(getActiveApp()!.graphicsDevice, new pc.ConeGeometry({ baseRadius: 0.5, peakRadius: 0, height: 1, heightSegments: 1, capSegments: 12 }));
  const meshInstance = new pc.MeshInstance(mesh, material, entity);
  meshInstance.castShadow = false; meshInstance.receiveShadow = false;
  entity.addComponent("render", { meshInstances: [meshInstance], layers: [layerId] }); return entity;
}
function destroyRenderResources(entity: pc.Entity) {
  for (const meshInstance of entity.render?.meshInstances ?? []) {
    meshInstance.mesh?.destroy();
    meshInstance.material?.destroy();
  }
}
function setMaterialColor(entity: pc.Entity, color: number, opacity: number) { const material = entity.render!.meshInstances[0].material as pc.StandardMaterial; material.emissive = hexColor(color).mulScalar(0.72); material.opacity = opacity; material.update(); }
function setEntityOpacity(entity: pc.Entity, opacity: number) { const material = entity.render!.meshInstances[0].material as pc.StandardMaterial; material.opacity = opacity; material.update(); }
function hexColor(hex: number) { return new pc.Color(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255); }
function vec(value: Position) { return new pc.Vec3(value.x, value.y, value.z); }
function normalized(value: Direction) { const out = vec(value); return out.lengthSq() > 0 ? out.normalize() : new pc.Vec3(0, 0, -1); }
function terrainNormal(x: number, z: number) { const s = 0.75; return new pc.Vec3(terrainHeight(x - s, z) - terrainHeight(x + s, z), s * 2, terrainHeight(x, z - s) - terrainHeight(x, z + s)).normalize(); }
function createSoftTexture(app: pc.Application) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const ctx = canvas.getContext("2d")!;
  for (let lobe = 0; lobe < 7; lobe++) {
    const angle = lobe / 7 * Math.PI * 2 + Math.random() * 0.45;
    const distance = lobe === 0 ? 0 : 5 + Math.random() * 8;
    const x = 32 + Math.cos(angle) * distance; const y = 32 + Math.sin(angle) * distance * 0.8;
    const radius = lobe === 0 ? 22 : 13 + Math.random() * 8;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${lobe === 0 ? 0.55 : 0.25})`);
    gradient.addColorStop(0.5, "rgba(235,232,225,.18)"); gradient.addColorStop(1, "rgba(210,205,195,0)");
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new pc.Texture(app.graphicsDevice, { width: 64, height: 64, format: pc.PIXELFORMAT_SRGBA8 }); texture.setSource(canvas); return texture;
}
function createFlashTexture(app: pc.Application) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128; const ctx = canvas.getContext("2d")!;
  const center = 64;
  ctx.save(); ctx.translate(center, center);
  for (let ray = 0; ray < 9; ray++) {
    ctx.save(); ctx.rotate((ray / 9) * Math.PI * 2 + Math.random() * 0.18);
    const length = 35 + Math.random() * 25; const width = 3 + Math.random() * 6;
    const gradient = ctx.createLinearGradient(0, 0, length, 0);
    gradient.addColorStop(0, "rgba(255,255,235,.95)"); gradient.addColorStop(0.3, "rgba(255,200,90,.7)"); gradient.addColorStop(1, "rgba(255,100,20,0)");
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(length, -width); ctx.lineTo(length * 0.7, 0); ctx.lineTo(length, width); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(center, center, 0, center, center, 36);
  glow.addColorStop(0, "rgba(255,255,248,1)"); glow.addColorStop(0.18, "rgba(255,235,160,.96)"); glow.addColorStop(0.55, "rgba(255,145,40,.48)"); glow.addColorStop(1, "rgba(255,80,10,0)");
  ctx.fillStyle = glow; ctx.fillRect(25, 25, 78, 78);
  return canvasTexture(app, canvas);
}
function createIrregularScorchMesh(app: pc.Application) {
  const segments = 28; const positions = [0, 0, 0]; const normals = [0, 1, 0]; const uvs = [0.5, 0.5]; const indices: number[] = [];
  for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2;
    const radius = 0.38 + Math.random() * 0.12 + Math.sin(angle * 5 + Math.random()) * 0.035;
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    normals.push(0, 1, 0); uvs.push(0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius);
    indices.push(0, index + 1, (index + 1) % segments + 1);
  }
  const geometry = new pc.Geometry();
  geometry.positions = positions; geometry.normals = normals; geometry.uvs = uvs; geometry.indices = indices;
  return pc.Mesh.fromGeometry(app.graphicsDevice, geometry);
}
function canvasTexture(app: pc.Application, canvas: HTMLCanvasElement) {
  const texture = new pc.Texture(app.graphicsDevice, { width: canvas.width, height: canvas.height, format: pc.PIXELFORMAT_SRGBA8 });
  texture.minFilter = pc.FILTER_LINEAR; texture.magFilter = pc.FILTER_LINEAR; texture.addressU = pc.ADDRESS_CLAMP_TO_EDGE; texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE; texture.setSource(canvas); return texture;
}
