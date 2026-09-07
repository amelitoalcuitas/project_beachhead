import * as THREE from "three";
import { terrainHeight } from "./battlefield.ts";
import type { Weapon } from "../types.ts";
import type { AudioManager } from "../audio/audio.ts";
import type {
  Corpse, Effect, Enemy, MuzzleFlashLight, MuzzleSmoke, MuzzleSmokeTrail,
  ScorchMark, Tracer, Wreckage,
} from "../gameplay/entities.ts";
import { isInfantryType } from "../types.ts";
import { specs } from "../content.ts";
export const WRECKAGE_LIFETIME = 45;
export const WRECKAGE_FADE_DURATION = 6;
export const CORPSE_LIFETIME = 30;
export const CORPSE_FADE_DURATION = 5;

export function releaseMesh(mesh: THREE.Mesh, disposeGeometry = false) {
  mesh.removeFromParent();
  if (disposeGeometry) mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => material.dispose());
}

export interface EffectsDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  effectLayer: THREE.Group;
  smokeLayer: THREE.Group;
  playerPosition: THREE.Vector3;
  audio: AudioManager;
  muzzlePan: (position: THREE.Vector3) => number;
  muzzleOrigin: (forwardOffset: number) => THREE.Vector3;
  muzzleOffsetForWeapon: (weapon: Weapon) => number;
  addShake: (amount: number) => void;
}

export class EffectsSystem {
  private readonly deps: EffectsDeps;
  readonly effects: Effect[] = [];
  readonly tracers: Tracer[] = [];
  readonly muzzleSmokes: MuzzleSmoke[] = [];
  readonly wreckages: Wreckage[] = [];
  readonly corpses: Corpse[] = [];
  readonly scorchMarks: ScorchMark[] = [];
  private smokeTexture!: THREE.CanvasTexture;
  private scorchTexture!: THREE.CanvasTexture;
  private muzzleSmokeTrail?: MuzzleSmokeTrail;
  private muzzleLightPool!: THREE.PointLight[];
  private muzzleLightCursor = 0;
  private readonly activeMuzzleFlashes: MuzzleFlashLight[] = [];
  private readonly sphereGeometry: THREE.SphereGeometry;
  private readonly wreckageBoxGeometry: THREE.BoxGeometry;

  constructor(deps: EffectsDeps, sphereGeometry: THREE.SphereGeometry, wreckageBoxGeometry: THREE.BoxGeometry) {
    this.deps = deps;
    this.sphereGeometry = sphereGeometry;
    this.wreckageBoxGeometry = wreckageBoxGeometry;
    this.smokeTexture = this.buildSmokeTexture();
    this.scorchTexture = this.buildScorchTexture();
    this.muzzleLightPool = Array.from({ length: 12 }, () => {
      const light = new THREE.PointLight(0xffffff, 0, 14, 2);
      light.visible = false;
      deps.scene.add(light);
      return light;
    });
  }

  private buildSmokeTexture() {
    const size = 128; const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!; const cx = size/2, cy = size/2;
    for (let i = 0; i < 7; i++) {
      const angle = (i/7)*Math.PI*2+Math.random()*0.8; const dist = Math.random()*size*0.22;
      const bx = cx+Math.cos(angle)*dist, by = cy+Math.sin(angle)*dist*0.85;
      const radius = size*(0.22+Math.random()*0.24);
      const g = ctx.createRadialGradient(bx,by,0,bx,by,radius);
      const a = 0.35+Math.random()*0.25;
      g.addColorStop(0,`rgba(255,255,255,${a})`); g.addColorStop(0.55,`rgba(230,228,222,${a*0.45})`); g.addColorStop(1,"rgba(210,208,200,0)");
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(bx,by,radius,0,Math.PI*2); ctx.fill();
    }
    const t = new THREE.CanvasTexture(canvas); t.needsUpdate=true; return t;
  }
  private buildScorchTexture() {
    const size = 128; const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!; const cx = size/2, cy = size/2;
    for (let i = 0; i < 6; i++) {
      const angle = (i/6)*Math.PI*2+Math.random()*0.6; const dist = Math.random()*size*0.18;
      const bx = cx+Math.cos(angle)*dist, by = cy+Math.sin(angle)*dist*0.9;
      const radius = size*(0.18+Math.random()*0.22);
      const g = ctx.createRadialGradient(bx,by,0,bx,by,radius);
      const a = 0.45+Math.random()*0.25;
      g.addColorStop(0,`rgba(28,22,16,${a})`); g.addColorStop(0.5,`rgba(42,34,24,${a*0.55})`); g.addColorStop(1,"rgba(52,44,34,0)");
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(bx,by,radius,0,Math.PI*2); ctx.fill();
    }
    const t = new THREE.CanvasTexture(canvas); t.needsUpdate=true; return t;
  }

  addMuzzleFlash(
    position: THREE.Vector3,
    color: number,
    intensity: number,
    distance: number,
    duration: number,
  ) {
    const light = this.muzzleLightPool[this.muzzleLightCursor];
    this.muzzleLightCursor = (this.muzzleLightCursor + 1) % this.muzzleLightPool.length;
    const existing = this.activeMuzzleFlashes.findIndex((flash) => flash.light === light);
    if (existing >= 0) this.activeMuzzleFlashes.splice(existing, 1);
    light.color.setHex(color);
    light.position.copy(position);
    light.distance = distance;
    light.intensity = intensity;
    light.visible = true;
    this.activeMuzzleFlashes.push({ light, life: duration, maxLife: duration, baseIntensity: intensity });
  }

  addEffect(
  position: THREE.Vector3,
  color: number,
  size: number,
  duration: number,
  velocity: THREE.Vector3,
  growth: number,
  ) {
  if (this.effects.length >= 240) return;
  const mesh = new THREE.Mesh(
    this.sphereGeometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  mesh.position.copy(position);
  mesh.scale.setScalar(size);
  this.deps.effectLayer.add(mesh);
  this.effects.push({ mesh, velocity, life: duration, duration, growth });
  }
  addWreckageParticle(
  wreckage: Wreckage,
  color: number,
  life: number,
  size: number,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  growth: number,
  opacity: number,
  isFlame = false,
  ) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: this.smokeTexture,
      color,
      transparent: true,
      depthWrite: false,
      depthTest: !isFlame,
      blending: isFlame ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity,
    }),
  );
  sprite.position.copy(position);
  sprite.scale.setScalar(size);
  sprite.renderOrder = isFlame ? 2 : 1;
  this.deps.smokeLayer.add(sprite);
  wreckage.particles.push({
    sprite,
    life,
    maxLife: life,
    velocity,
    growth,
    opacity,
    isFlame,
  });
  }

  createWreckage(enemy: Enemy) {
  if (isInfantryType(enemy.type) || specs[enemy.type].air) return;

  const position = enemy.group.position.clone();
  const group = new THREE.Group();
  const footprint =
    enemy.type === "tank"
      ? 1.35
      : enemy.type === "apc" || enemy.type === "truck"
        ? 1.15
        : 1;
  const debrisSpecs = [
    {
      size: [2.4, 0.55, 1.8],
      pos: [0, 0.28, 0],
      rot: [0.18, 0, 0.12],
      color: 0x2a2520,
    },
    {
      size: [1.1, 0.35, 0.9],
      pos: [-0.95, 0.42, 0.55],
      rot: [0.42, 0.55, -0.28],
      color: 0x1f1b18,
    },
    {
      size: [0.85, 0.28, 1.4],
      pos: [0.75, 0.35, -0.65],
      rot: [-0.22, -0.35, 0.48],
      color: 0x312b24,
    },
    {
      size: [0.55, 0.22, 0.55],
      pos: [0.2, 0.62, 0.35],
      rot: [0.65, 0.15, -0.55],
      color: 0x24201c,
    },
    {
      size: [1.6, 0.18, 0.45],
      pos: [-0.35, 0.22, -0.35],
      rot: [0.08, 0.82, 0.18],
      color: 0x35302a,
    },
  ];
  for (const spec of debrisSpecs) {
    const mesh = new THREE.Mesh(
      this.wreckageBoxGeometry,
      new THREE.MeshStandardMaterial({
        color: spec.color,
        emissive: 0x120b06,
        emissiveIntensity: 0.35,
        roughness: 0.92,
        metalness: 0.55,
        transparent: true,
        opacity: 1,
      }),
    );
    mesh.scale.set(
      spec.size[0] * footprint,
      spec.size[1] * footprint,
      spec.size[2] * footprint,
    );
    mesh.position.set(
      spec.pos[0] * footprint,
      spec.pos[1] * footprint,
      spec.pos[2] * footprint,
    );
    mesh.rotation.set(
      spec.rot[0],
      spec.rot[1] + enemy.group.rotation.y * 0.15,
      spec.rot[2],
    );
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.position.copy(position);
  group.rotation.y =
    enemy.group.rotation.y + (Math.random() - 0.5) * 0.35;
  this.deps.effectLayer.add(group);
  const wreckage: Wreckage = {
    group,
    life: WRECKAGE_LIFETIME,
    smokeTimer: 0,
    flameTimer: 0,
    particles: [],
  };
  this.wreckages.push(wreckage);

  const fireOrigin = position.clone().add(new THREE.Vector3(0, 1.1, 0));
  for (let i = 0; i < 4; i++)
    this.addWreckageParticle(
      wreckage,
      i % 2 === 0 ? 0xff7628 : 0xffd05a,
      0.45 + Math.random() * 0.3,
      0.8 + Math.random() * 0.45,
      fireOrigin.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 1.4,
          0,
          (Math.random() - 0.5) * 1.4,
        ),
      ),
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.55,
        0.5 + Math.random() * 0.45,
        (Math.random() - 0.5) * 0.55,
      ),
      0.3,
      0.9,
      true,
    );
  for (let i = 0; i < 3; i++)
    this.addWreckageParticle(
      wreckage,
      0x5a554d,
      2.6 + Math.random(),
      1.7 + Math.random() * 0.7,
      fireOrigin.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 1.2,
          0.45,
          (Math.random() - 0.5) * 1.2,
        ),
      ),
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.75,
        1.35 + Math.random() * 0.65,
        (Math.random() - 0.5) * 0.75,
      ),
      0.7,
      0.48,
    );
  }

  createCorpse(enemy: Enemy) {
  if (!isInfantryType(enemy.type)) return;

  const group = enemy.group;
  group.removeFromParent();
  const position = group.position.clone();
  position.y = terrainHeight(position.x, position.z);
  group.position.copy(position);
  group.rotation.x = Math.PI * 0.48 + (Math.random() - 0.5) * 0.15;
  group.rotation.z = (Math.random() - 0.5) * 0.25;
  group.position.y += 0.15;
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    const deadMaterials = materials.map((source) => {
      const dead = source.clone() as THREE.MeshStandardMaterial;
      dead.color.multiplyScalar(0.65);
      dead.emissive.setHex(0x0a0806);
      dead.emissiveIntensity = 0.1;
      dead.transparent = true;
      dead.opacity = 1;
      return dead;
    });
    node.material = Array.isArray(node.material)
      ? deadMaterials
      : deadMaterials[0];
  });
  this.deps.effectLayer.add(group);
  this.corpses.push({ group, life: CORPSE_LIFETIME });
  }

  removeCorpse(corpse: Corpse) {
  corpse.group.removeFromParent();
  corpse.group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach((material) => material.dispose());
  });
  }

  updateCorpses(dt: number) {
  for (let i = this.corpses.length - 1; i >= 0; i--) {
    const corpse = this.corpses[i];
    corpse.life -= dt;
    const fadeProgress =
      corpse.life <= 0
        ? THREE.MathUtils.clamp(-corpse.life / CORPSE_FADE_DURATION, 0, 1)
        : 0;
    const opacity = 1 - fadeProgress;
    corpse.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) material.opacity = opacity;
    });
    if (corpse.life <= -CORPSE_FADE_DURATION) {
      this.removeCorpse(corpse);
      this.corpses.splice(i, 1);
    }
  }
  }

  removeWreckage(wreckage: Wreckage) {
  wreckage.group.removeFromParent();
  wreckage.group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach((material) => material.dispose());
  });
  for (const particle of wreckage.particles) {
    particle.sprite.removeFromParent();
    particle.sprite.material.dispose();
  }
  wreckage.particles.length = 0;
  }

  updateWreckages(dt: number) {
  for (let i = this.wreckages.length - 1; i >= 0; i--) {
    const wreckage = this.wreckages[i];
    wreckage.life -= dt;
    const fading = wreckage.life <= 0;
    const fadeProgress = fading
      ? THREE.MathUtils.clamp(-wreckage.life / WRECKAGE_FADE_DURATION, 0, 1)
      : 0;
    const hullOpacity = 1 - fadeProgress;
    wreckage.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) {
        material.opacity = hullOpacity;
      }
    });
    if (!fading) {
      wreckage.smokeTimer -= dt;
      wreckage.flameTimer -= dt;
      if (wreckage.smokeTimer <= 0) {
        const origin = wreckage.group.position
          .clone()
          .add(new THREE.Vector3(0, 1.7, 0));
        this.addWreckageParticle(
          wreckage,
          0x6c665c,
          2.4 + Math.random() * 1.2,
          1.4 + Math.random() * 0.8,
          origin,
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.7,
            1.2 + Math.random() * 0.8,
            (Math.random() - 0.5) * 0.7,
          ),
          0.65,
          0.34,
        );
        wreckage.smokeTimer = 0.4 + Math.random() * 0.35;
      }
      if (wreckage.flameTimer <= 0) {
        const origin = wreckage.group.position
          .clone()
          .add(new THREE.Vector3(0, 0.9, 0));
        this.addWreckageParticle(
          wreckage,
          Math.random() > 0.35 ? 0xff7628 : 0xffc14d,
          0.35 + Math.random() * 0.25,
          0.65 + Math.random() * 0.4,
          origin,
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            0.35 + Math.random() * 0.35,
            (Math.random() - 0.5) * 0.5,
          ),
          0.35,
          0.78,
          true,
        );
        wreckage.flameTimer = 0.16 + Math.random() * 0.18;
      }
    }
    for (
      let particleIndex = wreckage.particles.length - 1;
      particleIndex >= 0;
      particleIndex--
    ) {
      const particle = wreckage.particles[particleIndex];
      particle.life -= dt;
      particle.velocity.multiplyScalar(Math.exp(-dt * 0.4));
      particle.sprite.position.addScaledVector(particle.velocity, dt);
      particle.sprite.scale.addScalar(particle.growth * dt);
      const age = particle.maxLife - particle.life;
      const fadeIn = particle.isFlame ? 1 : Math.min(1, age / 0.08);
      const fadeOut = Math.pow(Math.max(0, particle.life / particle.maxLife), 1.3);
      (particle.sprite.material as THREE.SpriteMaterial).opacity =
        particle.opacity * fadeIn * fadeOut * hullOpacity;
      if (particle.life <= 0) {
        particle.sprite.removeFromParent();
        particle.sprite.material.dispose();
        wreckage.particles.splice(particleIndex, 1);
      }
    }
    if (wreckage.life <= -WRECKAGE_FADE_DURATION) {
      this.removeWreckage(wreckage);
      this.wreckages.splice(i, 1);
    }
  }
  }
  addScorchMark(position: THREE.Vector3, size: number) {
  const groundY = terrainHeight(position.x, position.z);
  if (position.y - groundY > 2.5) return;
  const sample = 0.75;
  const yWest = terrainHeight(position.x - sample, position.z);
  const yEast = terrainHeight(position.x + sample, position.z);
  const yNorth = terrainHeight(position.x, position.z - sample);
  const ySouth = terrainHeight(position.x, position.z + sample);
  const normal = new THREE.Vector3(yWest - yEast, 2 * sample, 0)
    .cross(new THREE.Vector3(0, yNorth - ySouth, 2 * sample))
    .normalize();
  if (normal.y < 0.1) return;
  const material = new THREE.MeshBasicMaterial({
    map: this.scorchTexture,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const radius = size * 1.15;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    material,
  );
  mesh.position.set(position.x, groundY + 0.05, position.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  mesh.rotateY(Math.random() * Math.PI * 2);
  this.deps.effectLayer.add(mesh);
  this.scorchMarks.push({ mesh, life: 5, maxLife: 5 });
  }
  updateScorchMarks(dt: number) {
  for (let i = this.scorchMarks.length - 1; i >= 0; i--) {
    const mark = this.scorchMarks[i];
    mark.life -= dt;
    const material = mark.mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.82 * Math.max(0, mark.life / mark.maxLife);
    if (mark.life <= 0) {
      mark.mesh.removeFromParent();
      material.dispose();
      mark.mesh.geometry.dispose();
      this.scorchMarks.splice(i, 1);
    }
  }
  }
  explode(
  position: THREE.Vector3,
  size: number,
  soundVolume = 1,
  style: "he" | "flak" | "default" | "vehicle" = "default",
  ) {
  const flashColor =
    style === "flak"
      ? 0xffe9ad
      : style === "he"
        ? 0xd4b870
        : style === "vehicle"
          ? 0xffc866
          : 0xffbd55;
  const debrisColor =
    style === "flak"
      ? 0x353b40
      : style === "he"
        ? 0x5a5248
        : style === "vehicle"
          ? 0x4a4035
          : 0x514a3e;
  const flashScale = style === "vehicle" ? 0.62 : 0.45;
  const flashDuration = style === "vehicle" ? 0.38 : 0.28;
  this.addEffect(
    position,
    flashColor,
    size * flashScale,
    flashDuration,
    new THREE.Vector3(),
    style === "vehicle" ? 10 : 8,
  );
  if (style === "vehicle") {
    this.addEffect(
      position,
      0xfff4d6,
      size * 0.72,
      0.14,
      new THREE.Vector3(),
      14,
    );
    this.addEffect(
      position.clone().add(new THREE.Vector3(0, size * 0.15, 0)),
      0xff9a3c,
      size * 0.34,
      0.22,
      new THREE.Vector3(0, size * 0.8, 0),
      6,
    );
  }
  const debrisCount = style === "vehicle" ? 14 : style === "flak" ? 7 : 10;
  for (let i = 0; i < debrisCount; i++)
    this.addEffect(
      position,
      i < 4 ? flashColor : debrisColor,
      size * (i < 4 ? 0.13 : 0.23),
      i < 4 ? 0.7 : 2.2,
      new THREE.Vector3(
        (Math.random() - 0.5) * size * 6,
        Math.random() * size * 5,
        (Math.random() - 0.5) * size * 6,
      ),
      i < 4 ? 0.3 : 1.2,
    );
  this.deps.audio.explosionSound(this.deps.muzzlePan(position), size, soundVolume);
  const distance = position.distanceTo(this.deps.playerPosition);
  const shakeScale = style === "vehicle" ? 0.065 : 0.05;
  const shakeAmount = THREE.MathUtils.clamp(
    size * shakeScale * (1 - distance / (size * 12)),
    0,
    size * shakeScale,
  );
  this.deps.addShake(shakeAmount);
  this.addScorchMark(position, size);
  }
  sparks(position: THREE.Vector3) {
  for (let i = 0; i < 3; i++)
    this.addEffect(
      position,
      0xffd87a,
      0.06,
      0.22,
      new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 7,
        (Math.random() - 0.5) * 8,
      ),
      0,
    );
  }
  bloodSplat(position: THREE.Vector3) {
  for (let i = 0; i < 7; i++)
    this.addEffect(
      position,
      i < 3 ? 0x8a1414 : 0x5c0d0d,
      0.05 + Math.random() * 0.05,
      0.32 + Math.random() * 0.18,
      new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 5,
        (Math.random() - 0.5) * 5,
      ),
      0,
    );
  }
  infantryDeath(position: THREE.Vector3, headshot = false) {
  if (!headshot) this.bloodSplat(position);
  for (let i = 0; i < 4; i++)
    this.addEffect(
      position,
      0x8a7358,
      0.035 + Math.random() * 0.025,
      0.3 + Math.random() * 0.12,
      new THREE.Vector3(
        (Math.random() - 0.5) * 2.2,
        Math.random() * 1.2,
        (Math.random() - 0.5) * 2.2,
      ),
      0.08,
    );
  }
  ricochetSparks(position: THREE.Vector3) {
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    const upBias = 0.3 + Math.random() * 0.5;
    this.addEffect(
      position,
      i < 2 ? 0xffe8a0 : 0xc8a040,
      i < 2 ? 0.04 : 0.03,
      0.15,
      new THREE.Vector3(
        Math.cos(angle) * speed * (1 - upBias),
        speed * upBias,
        Math.sin(angle) * speed * (1 - upBias),
      ),
      0,
    );
  }
  }
  addMuzzleSmoke(
  position: THREE.Vector3,
  weapon: Weapon,
  residual = false,
  ) {
  const baseSize =
    weapon === "MG" ? 0.5 : weapon === "CANNON" ? 0.95 : 0.8;
  const puffs = residual ? 1 : weapon === "MG" ? 1 : 3;
  const forward = new THREE.Vector3();
  this.deps.camera.getWorldDirection(forward);
  for (let p = 0; p < puffs; p++) {
    if (this.muzzleSmokes.length >= 100) return;
    const material = new THREE.SpriteMaterial({
      map: this.smokeTexture,
      color:
        weapon === "MG"
          ? 0x8a8780
          : weapon === "CANNON"
            ? 0x6a6660
            : 0x7a7068,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      rotation: Math.random() * Math.PI * 2,
    });
    const sprite = new THREE.Sprite(material);
    const jitter = residual ? 0.12 : 0.26;
    sprite.position.copy(position).add(
      new THREE.Vector3(
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter * 0.6,
        (Math.random() - 0.5) * jitter,
      ),
    );
    const size = baseSize * (0.65 + Math.random() * 0.7);
    sprite.scale.set(size, size, 1);
    this.deps.smokeLayer.add(sprite);
    const life = residual
      ? 1.7 + Math.random() * 0.7
      : 1.2 + Math.random() * 0.8;
    const ejectionSpeed = residual
      ? 0.08
      : weapon === "MG"
        ? 0.65
        : 1.1;
    const curlAxis = new THREE.Vector3()
      .setFromMatrixColumn(this.deps.camera.matrixWorld, 0)
      .normalize()
      .applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (Math.random() - 0.5) * 0.55,
      );
    this.muzzleSmokes.push({
      sprite,
      life,
      maxLife: life,
      velocity: forward
        .clone()
        .multiplyScalar(ejectionSpeed)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.16,
            0.9 + Math.random() * 0.75,
            (Math.random() - 0.5) * 0.16,
          ),
        ),
      curlAxis,
      spin: (Math.random() - 0.5) * 0.75,
      driftPhase: Math.random() * Math.PI * 2,
      driftSpeed: 1 + Math.random() * 1.1,
      driftAmount: 0.18 + Math.random() * 0.24,
      growth: 0.48 + Math.random() * 0.35,
      opacity: residual
        ? 0.16 + Math.random() * 0.04
        : 0.22 + Math.random() * 0.07,
    });
  }
  }
  startMuzzleSmokeTrail(position: THREE.Vector3, weapon: Weapon) {
  if (this.muzzleSmokeTrail) return;
  const pointCount = 9;
  const points = Array.from({ length: pointCount }, (_, index) =>
    position.clone().add(new THREE.Vector3(0, index * 0.008, 0)),
  );
  const positions = new Float32Array(pointCount * 2 * 3);
  const uvs = new Float32Array(pointCount * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    const progress = i / (pointCount - 1);
    uvs.set([0, progress, 1, progress], i * 4);
    if (i < pointCount - 1) {
      const vertex = i * 2;
      indices.push(
        vertex,
        vertex + 1,
        vertex + 2,
        vertex + 1,
        vertex + 3,
        vertex + 2,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    map: this.smokeTexture,
    color:
      weapon === "MG"
        ? 0x8a8780
        : weapon === "CANNON"
          ? 0x6a6660
          : 0x7a7068,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  this.deps.smokeLayer.add(mesh);
  this.muzzleSmokeTrail = {
    mesh,
    points,
    weapon,
    life: 2.1,
    maxLife: 2.1,
    attachmentDuration: 0.32,
    driftAxis: new THREE.Vector3()
      .setFromMatrixColumn(this.deps.camera.matrixWorld, 0)
      .normalize(),
    driftPhase: Math.random() * Math.PI * 2,
  };
  }
  addTracer(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: number,
  life = 0.07,
  ) {
  if (this.tracers.length >= 80) return;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start, end]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
  );
  this.deps.effectLayer.add(line);
  this.tracers.push({ line, life });
  }
  updateMuzzleSmokeTrail(dt: number) {
  if (!this.muzzleSmokeTrail) return;
  const trail = this.muzzleSmokeTrail;
  trail.life -= dt;
  trail.driftPhase += dt * 1.15;
  const age = trail.maxLife - trail.life;
  const cameraRight = new THREE.Vector3()
    .setFromMatrixColumn(this.deps.camera.matrixWorld, 0)
    .normalize();
  const positions = trail.mesh.geometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;

  for (let i = 0; i < trail.points.length; i++) {
    const progress = i / (trail.points.length - 1);
    const point = trail.points[i];
    if (i === 0 && age < trail.attachmentDuration) {
      point.copy(this.deps.muzzleOrigin(this.deps.muzzleOffsetForWeapon(trail.weapon)));
    } else {
      point.y += (0.45 + progress * 1.1) * dt;
      point.addScaledVector(
        trail.driftAxis,
        Math.sin(trail.driftPhase + progress * 2.4) *
          (0.035 + progress * 0.12) *
          dt,
      );
    }

    const halfWidth = 0.035 + progress * 0.085 + age * 0.012;
    const left = point.clone().addScaledVector(cameraRight, -halfWidth);
    const right = point.clone().addScaledVector(cameraRight, halfWidth);
    positions.setXYZ(i * 2, left.x, left.y, left.z);
    positions.setXYZ(i * 2 + 1, right.x, right.y, right.z);
  }
  positions.needsUpdate = true;

  const fadeIn = Math.min(1, age / 0.1);
  const fadeOut = THREE.MathUtils.clamp(trail.life / 0.75, 0, 1);
  trail.mesh.material.opacity = 0.25 * fadeIn * fadeOut;
  if (trail.life <= 0) {
    trail.mesh.removeFromParent();
    trail.mesh.geometry.dispose();
    trail.mesh.material.dispose();
    this.muzzleSmokeTrail = undefined;
  }
  }
  updateEffects(dt: number) {
  this.updateWreckages(dt);
  this.updateCorpses(dt);
  this.updateScorchMarks(dt);
  for (let i = this.effects.length - 1; i >= 0; i--) {
    const effect = this.effects[i];
    effect.life -= dt;
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.velocity.multiplyScalar(Math.exp(-dt * 2));
    effect.mesh.scale.addScalar(effect.growth * dt);
    (effect.mesh.material as THREE.MeshBasicMaterial).opacity =
      Math.max(0, effect.life / effect.duration) * 0.8;
    if (effect.life <= 0) {
      releaseMesh(effect.mesh);
      this.effects.splice(i, 1);
    }
  }
  for (let i = this.tracers.length - 1; i >= 0; i--) {
    this.tracers[i].life -= dt;
    if (this.tracers[i].life <= 0) {
      const { line } = this.tracers[i];
      line.removeFromParent();
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.tracers.splice(i, 1);
    }
  }
  // Circular puffs expand evenly while buoyancy and light lateral drift keep
  // the cloud from looking static or mechanically uniform.
  for (let i = this.muzzleSmokes.length - 1; i >= 0; i--) {
    const smoke = this.muzzleSmokes[i];
    smoke.life -= dt;
    smoke.driftPhase += smoke.driftSpeed * dt;
    smoke.velocity.multiplyScalar(Math.exp(-dt * 0.48));
    smoke.velocity.y += 0.28 * dt;
    smoke.sprite.position.addScaledVector(smoke.velocity, dt);
    smoke.sprite.position.addScaledVector(
      smoke.curlAxis,
      Math.sin(smoke.driftPhase) * smoke.driftAmount * dt,
    );
    smoke.sprite.scale.x += smoke.growth * dt;
    smoke.sprite.scale.y += smoke.growth * dt;
    const material = smoke.sprite.material as THREE.SpriteMaterial;
    material.rotation += smoke.spin * dt;
    const lifeRatio = Math.max(0, smoke.life / smoke.maxLife);
    const age = smoke.maxLife - smoke.life;
    const fadeIn = Math.min(1, age / 0.12);
    const fadeOut = Math.pow(lifeRatio, 1.4);
    const turbulence = 0.88 + Math.sin(smoke.driftPhase * 1.7) * 0.12;
    material.opacity = smoke.opacity * fadeIn * fadeOut * turbulence;
    if (smoke.life <= 0) {
      smoke.sprite.removeFromParent();
      material.dispose();
      this.muzzleSmokes.splice(i, 1);
    }
  }
  this.updateMuzzleSmokeTrail(dt);
  // Gunfire flashes pop bright then collapse fast, like a real muzzle flash.
  for (let i = this.activeMuzzleFlashes.length - 1; i >= 0; i--) {
    const flash = this.activeMuzzleFlashes[i];
    flash.life -= dt;
    if (flash.life <= 0) {
      flash.light.intensity = 0;
      flash.light.visible = false;
      this.activeMuzzleFlashes.splice(i, 1);
      continue;
    }
    const t = flash.life / flash.maxLife;
    flash.light.intensity = flash.baseIntensity * t * t;
  }
  }

  clear() {
    for (const effect of this.effects) releaseMesh(effect.mesh);
    for (const tracer of this.tracers) {
      tracer.line.removeFromParent();
      tracer.line.geometry.dispose();
      (tracer.line.material as THREE.Material).dispose();
    }
    for (const smoke of this.muzzleSmokes) {
      smoke.sprite.removeFromParent();
      (smoke.sprite.material as THREE.SpriteMaterial).dispose();
    }
    for (const wreckage of this.wreckages) this.removeWreckage(wreckage);
    for (const corpse of this.corpses) this.removeCorpse(corpse);
    if (this.muzzleSmokeTrail) {
      this.muzzleSmokeTrail.mesh.removeFromParent();
      this.muzzleSmokeTrail.mesh.geometry.dispose();
      this.muzzleSmokeTrail.mesh.material.dispose();
      this.muzzleSmokeTrail = undefined;
    }
    for (const flash of this.activeMuzzleFlashes) {
      flash.light.intensity = 0;
      flash.light.visible = false;
    }
    this.effects.length = 0;
    this.tracers.length = 0;
    this.muzzleSmokes.length = 0;
    this.wreckages.length = 0;
    this.corpses.length = 0;
    this.scorchMarks.length = 0;
    this.activeMuzzleFlashes.length = 0;
  }
}
