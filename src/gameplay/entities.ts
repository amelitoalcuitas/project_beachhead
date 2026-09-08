import * as THREE from "../pc-shim/index.ts";
import type { EnemyType, Weapon } from "../types.ts";

export interface Enemy {
  /** Stable gameplay identity; never couple HUD/collision state to render IDs. */
  id: number;
  type: EnemyType;
  group: THREE.Group;
  hp: number;
  speed: number;
  fire: number;
  burstRemaining: number;
  dead: boolean;
  target: THREE.Vector3;
  passes: number;
  unloaded: boolean;
  parachuting: boolean;
  warning: number;
  sightTimer: number;
  canAttack: boolean;
}

export interface Shot {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  explosionDamage: number;
  splash: number;
  life: number;
  owner: "player" | "enemy";
  weapon: Weapon;
  projectile?: "grenade";
  gravity?: number;
  previous: THREE.Vector3;
  distanceTravelled?: number;
  proximityRadius?: number;
  armingDistance?: number;
  sourceBearing?: number;
}

export interface Effect {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  duration: number;
  growth: number;
}

export interface SpriteEffect {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  duration: number;
  growth: number;
  opacity: number;
  spin: number;
  lift: number;
  isFlash: boolean;
}

export interface Tracer {
  line: THREE.Line;
  life: number;
}

export interface MuzzleSmoke {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
  curlAxis: THREE.Vector3;
  spin: number;
  driftPhase: number;
  driftSpeed: number;
  driftAmount: number;
  growth: number;
  opacity: number;
}

export interface MuzzleSmokeTrail {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  points: THREE.Vector3[];
  weapon: Weapon;
  life: number;
  maxLife: number;
  attachmentDuration: number;
  driftAxis: THREE.Vector3;
  driftPhase: number;
}

export interface MuzzleFlashLight {
  light: THREE.PointLight;
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  baseIntensity: number;
  baseScale: number;
}

export interface WreckageParticle {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
  growth: number;
  opacity: number;
  isFlame: boolean;
}

export interface Wreckage {
  group: THREE.Group;
  life: number;
  smokeTimer: number;
  flameTimer: number;
  particles: WreckageParticle[];
}

export interface Corpse {
  group: THREE.Group;
  life: number;
}

export interface ScorchMark {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}
