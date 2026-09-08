import * as THREE from "../pc-shim/index.ts";
import { weapons, weaponRoles } from "../content.ts";
import type { Weapon } from "../types.ts";
import type { SessionState } from "../game/game-state.ts";
import type { WeaponView } from "../rendering/weapon-view.ts";
import type { ScreenMessages } from "../ui/screens.ts";
import type { AudioManager } from "../audio/audio.ts";
import type { EffectsSystem } from "../rendering/effects.ts";
import type { GunEffectsSystem } from "../rendering/gun-effects.ts";
import type { ProjectileSystem } from "./projectiles.ts";

export const spreadBiasMax = { MG: 0.018, CANNON: 0.004, BOFORS: 0.006 } as const;
export const MG_ADS_SPREAD_MULTIPLIER = 0.2;
export const MG_MIN_BLOOM = 0.22;
export const AIM_CONVERGENCE_DISTANCE = 200;

export function bloomFromHeat(heat: number) {
  const t = THREE.MathUtils.clamp(heat, 0, 1);
  return t * t * t;
}

export function bloomAmount(heat: number, currentWeapon: Weapon) {
  const bloom = bloomFromHeat(heat);
  if (currentWeapon !== "MG") return bloom;
  return MG_MIN_BLOOM + (1 - MG_MIN_BLOOM) * bloom;
}

export function applyBloomSpread(
  spreadHeat: number,
  weapon: Weapon,
  zoom: boolean,
): number {
  const baseSpread = bloomAmount(spreadHeat, weapon) * weapons[weapon].spread;
  return zoom && weapon === "MG"
    ? baseSpread * MG_ADS_SPREAD_MULTIPLIER
    : baseSpread;
}

export function muzzleOffsetForWeapon(selectedWeapon: Weapon) {
  return selectedWeapon === "MG" ? 2.8 : selectedWeapon === "CANNON" ? 3.5 : 3.8;
}

const computeSpreadAngle = applyBloomSpread;

export interface WeaponDeps {
  session: SessionState;
  camera: THREE.PerspectiveCamera;
  playerPosition: THREE.Vector3;
  lookDirection: THREE.Vector3;
  weaponView: WeaponView;
  screens: ScreenMessages;
  audio: AudioManager;
  effects: EffectsSystem | null;
  gunEffects?: GunEffectsSystem;
  projectiles: ProjectileSystem | null;
  sphereGeometry: THREE.SphereGeometry;
  projectileLayer: THREE.Group;
  isActive: () => boolean;
  setShake: (amount: number) => void;
  getShake: () => number;
  addShake: (amount: number) => void;
  aimDistance?: (direction: THREE.Vector3) => number;
}

export class WeaponSystem {
  private readonly deps: WeaponDeps;
  private readonly muzzleRight = new THREE.Vector3();
  reload = 0;
  cooldown = 0;
  switchTime = 0;
  trigger = false;
  zoom = false;
  muzzleSmoke = 0;
  smokeAccumulator = 0;
  shotSmokeAccumulator = 0;
  spreadHeat = 0;
  spreadAngle = 0;
  spreadX = 0;
  spreadY = 0;
  weapon: Weapon = "MG";

  constructor(deps: WeaponDeps) {
    this.deps = deps;
  }

  wire(effects: EffectsSystem, projectiles: ProjectileSystem) {
    this.deps.effects = effects;
    this.deps.projectiles = projectiles;
  }

  applyBloomSpread() {
    this.spreadAngle = computeSpreadAngle(this.spreadHeat, this.weapon, this.zoom);
  }

  muzzleOrigin(forwardOffset: number) {
    const screenMuzzle = this.deps.weaponView.muzzleScreenPosition();
    const direction = new THREE.Vector3(screenMuzzle.x, screenMuzzle.y, 0.5)
      .unproject(this.deps.camera)
      .sub(this.deps.camera.position)
      .normalize();
    this.deps.camera.getWorldDirection(this.deps.lookDirection);
    return this.deps.playerPosition.clone()
      .addScaledVector(direction, forwardOffset / direction.dot(this.deps.lookDirection));
  }

  muzzleOffsetForWeapon = muzzleOffsetForWeapon;

  muzzlePan(position: THREE.Vector3) {
    this.deps.camera.getWorldDirection(this.deps.lookDirection);
    this.muzzleRight.set(
      Math.cos(this.deps.camera.rotation.y),
      0,
      -Math.sin(this.deps.camera.rotation.y),
    );
    const toTarget = position.clone().sub(this.deps.playerPosition);
    if (toTarget.lengthSq() < 1e-6) return 0;
    toTarget.normalize();
    return THREE.MathUtils.clamp(toTarget.dot(this.muzzleRight) * 1.5, -1, 1);
  }

  selectWeapon(next: Weapon) {
    if (!this.deps.isActive() || next === this.weapon) return;
    this.weapon = next;
    this.reload = 0;
    this.switchTime = 0.4;
    this.cooldown = 0.4;
    this.trigger = false;
    this.deps.weaponView.select(next);
    this.deps.screens.message(weaponRoles[next]);
  }

  reloadWeapon() {
    if (!this.deps.isActive() || this.reload > 0 || this.switchTime > 0) return;
    const definition = weapons[this.weapon];
    if (definition.mag === definition.maxMag || definition.reserve === 0) return;
    this.reload = definition.reload;
    this.deps.audio.sound(this.deps.audio.reloadSoundForWeapon(this.weapon));
  }

  completeReload() {
    const definition = weapons[this.weapon],
      rounds = Math.min(definition.maxMag - definition.mag, definition.reserve);
    definition.mag += rounds;
    definition.reserve -= rounds;
    this.reload = 0;
    this.deps.audio.sound(this.deps.audio.reloadSoundForWeapon(this.weapon));
  }

  fire() {
    if (this.deps.session.state !== "combat" || this.reload > 0 || this.cooldown > 0 || this.switchTime > 0)
      return;
    const definition = weapons[this.weapon];
    if (definition.mag <= 0) {
      if (definition.reserve > 0) this.reloadWeapon();
      else this.deps.screens.message("AMMUNITION DEPLETED · SWITCH WEAPON");
      return;
    }
    if (!this.deps.session.infiniteAmmo) definition.mag--;
    this.cooldown = 1 / definition.fireRate;
    this.deps.weaponView.fire(this.weapon);
    this.deps.setShake(this.weapon === "MG" ? 0.025 : 0.1);
    this.deps.audio.sound(this.weapon === "MG" ? "gun" : this.weapon === "CANNON" ? "cannon" : "bofors");
  const smokeBuildup =
    this.weapon === "MG" ? 0.055 : this.weapon === "CANNON" ? 0.12 : 0.09;
  this.muzzleSmoke = Math.min(1, this.muzzleSmoke + smokeBuildup);
  
  // Heat rises steadily; MG cone starts at MG_MIN_BLOOM and eases up from there
  let heatPerShot = this.weapon === "MG" ? 0.05 : this.weapon === "CANNON" ? 0.06 : 0.08;
  if (this.weapon === "MG") {
    const curveFactor = 0.96;
    heatPerShot *= (1 + this.spreadHeat * curveFactor);
  }
  // Reduce heat per shot when zoomed for MG to minimize crosshair oscillation
  if (this.zoom && this.weapon === "MG") {
    heatPerShot *= 0.7;
  }
  this.spreadHeat = Math.min(1, this.spreadHeat + heatPerShot);
  this.applyBloomSpread();
  const bloom = bloomAmount(this.spreadHeat, this.weapon);
  const kick = (this.weapon === "MG" ? 0.0014 : this.weapon === "CANNON" ? 0.0003 : 0.0004) * (0.2 + bloom);
  const bias = spreadBiasMax[this.weapon];
  this.spreadX = THREE.MathUtils.clamp(this.spreadX + (Math.random() - 0.5) * kick * 2, -bias, bias);
  this.spreadY = THREE.MathUtils.clamp(this.spreadY + (Math.random() - 0.5) * kick * 2, -bias, bias);
  
  // Calculate muzzle position based on this.weapon type (offset to match the
  // on-screen gun position rather than spawning from dead-center)
  const muzzleOffset = this.muzzleOffsetForWeapon(this.weapon);
  const origin = this.muzzleOrigin(muzzleOffset);

  // Build spread in camera space. Adding directly to world X/Y made the cone
  // rotate incorrectly as the player turned, while firing the camera's forward
  // vector from an offset muzzle left every round permanently beside the reticle.
  this.deps.camera.getWorldDirection(this.deps.lookDirection);
  const cameraRight = this.muzzleRight.set(
    Math.cos(this.deps.camera.rotation.y),
    0,
    -Math.sin(this.deps.camera.rotation.y),
  ).clone();
  const cameraUp = cameraRight.clone().cross(this.deps.lookDirection).normalize();
  const aimRay = this.deps.lookDirection.clone()
    .addScaledVector(cameraRight, this.spreadX + (Math.random() - 0.5) * this.spreadAngle)
    .addScaledVector(cameraUp, this.spreadY + (Math.random() - 0.5) * this.spreadAngle)
    .normalize();
  const aimDistance = Math.max(
    muzzleOffset,
    this.deps.aimDistance?.(aimRay) ?? AIM_CONVERGENCE_DISTANCE,
  );
  const aimPoint = this.deps.playerPosition.clone()
    .addScaledVector(aimRay, aimDistance);
  const aimDirection = aimPoint.sub(origin).normalize();

  // Heavy guns vent on every shot. The automatic MG emits a smaller puff every
  // few rounds so rapid fire cannot stack an opaque cloud over the sightline.
  this.shotSmokeAccumulator += this.weapon === "MG" ? 0.28 : 1;
  if (this.shotSmokeAccumulator >= 1) {
    this.deps.gunEffects?.emitShotSmoke(origin, aimDirection, this.weapon);
    this.shotSmokeAccumulator -= 1;
  }
  this.deps.gunEffects?.emitMuzzle(
    origin,
    aimDirection,
    this.weapon,
    "player",
    this.deps.weaponView.muzzleViewPose(),
  );

  if (this.weapon === "MG") {
    const mesh = new THREE.Mesh(
      this.deps.sphereGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffe8a0 }),
    );
    mesh.scale.setScalar(0.12);
    mesh.position.copy(origin).addScaledVector(aimDirection, 1.5);
    this.deps.projectileLayer.add(mesh);
    const velocity = aimDirection.clone().multiplyScalar(definition.projectileSpeed);
    this.deps.projectiles.addShot({
      mesh,
      velocity,
      damage: definition.damage,
      explosionDamage: 0,
      splash: 0,
      life: 1.2,
      owner: "player",
      weapon: this.weapon,
      gravity: definition.bulletDrop,
      previous: mesh.position.clone(),
    });
  } else {
    const mesh = new THREE.Mesh(
      this.deps.sphereGeometry,
      new THREE.MeshBasicMaterial({
        color: this.weapon === "BOFORS" ? 0xffe9a0 : 0xc8b888,
      }),
    );
    mesh.scale.setScalar(0.22);
    mesh.position.copy(origin);
    this.deps.projectileLayer.add(mesh);
    const velocity = aimDirection.clone().multiplyScalar(definition.projectileSpeed);
    this.deps.projectiles.addShot({
      mesh,
      velocity,
      damage: definition.damage,
      explosionDamage: definition.explosionDamage,
      splash: definition.explosionRadius,
      proximityRadius: definition.proximityRadius,
      armingDistance: definition.armingDistance,
      distanceTravelled: 0,
      life: 7,
      owner: "player",
      weapon: this.weapon,
      gravity: definition.bulletDrop,
      previous: mesh.position.clone(),
    });
  }
  }

  tickSpread(dt: number) {
    const spreadRecovery = this.trigger
      ? 0
      : this.weapon === "MG" ? 2.2 : this.weapon === "CANNON" ? 1.8 : 2.4;
    this.spreadHeat = THREE.MathUtils.lerp(this.spreadHeat, 0, Math.min(1, spreadRecovery * dt));
    this.spreadX = THREE.MathUtils.lerp(this.spreadX, 0, Math.min(1, spreadRecovery * dt));
    this.spreadY = THREE.MathUtils.lerp(this.spreadY, 0, Math.min(1, spreadRecovery * dt));
    this.applyBloomSpread();
    if (!this.trigger && this.weapon === "MG" && this.muzzleSmoke > 0.05) {
      this.smokeAccumulator += dt * (0.55 + this.muzzleSmoke * 1.8);
      while (this.smokeAccumulator >= 1) {
        this.deps.camera.getWorldDirection(this.deps.lookDirection);
        this.deps.gunEffects?.emitResidualMgSmoke(
          this.muzzleOrigin(muzzleOffsetForWeapon("MG")),
          this.deps.lookDirection,
        );
        this.smokeAccumulator--;
      }
    } else if (this.trigger || this.muzzleSmoke <= 0.05) {
      this.smokeAccumulator = 0;
    }
    if (!this.trigger) {
      this.muzzleSmoke = Math.max(0, this.muzzleSmoke - dt * 0.34);
    }
  }

  tickReload(dt: number) {
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) this.completeReload();
    }
  }

  resetState(keepWeapon = false) {
    this.reload = this.cooldown = this.switchTime = 0;
    this.trigger = this.zoom = false;
    this.muzzleSmoke = this.smokeAccumulator = this.shotSmokeAccumulator = 0;
    this.spreadHeat = this.spreadAngle = this.spreadX = this.spreadY = 0;
    if (!keepWeapon) this.weapon = "MG";
  }
}
