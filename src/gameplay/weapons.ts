import * as THREE from "three";
import { weapons, weaponRoles } from "../content.ts";
import type { Weapon } from "../types.ts";
import type { SessionState } from "../game/game-state.ts";
import type { WeaponView } from "../rendering/weapon-view.ts";
import type { ScreenMessages } from "../ui/screens.ts";
import type { AudioManager } from "../audio/audio.ts";
import type { EffectsSystem } from "../rendering/effects.ts";
import type { ProjectileSystem } from "./projectiles.ts";

export const spreadBiasMax = { MG: 0.018, CANNON: 0.004, BOFORS: 0.006 } as const;
export const MG_ADS_SPREAD_MULTIPLIER = 0.2;
export const MG_MIN_BLOOM = 0.22;

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
  projectiles: ProjectileSystem | null;
  sphereGeometry: THREE.SphereGeometry;
  projectileLayer: THREE.Group;
  isActive: () => boolean;
  setShake: (amount: number) => void;
  getShake: () => number;
  addShake: (amount: number) => void;
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
    this.muzzleRight.setFromMatrixColumn(this.deps.camera.matrixWorld, 0).normalize();
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
    this.weapon === "MG" ? 0.08 : this.weapon === "CANNON" ? 0.15 : 0.12;
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
  
  this.deps.camera.getWorldDirection(this.deps.lookDirection);
  // Apply spread offset to aim direction (aim stays from the eye/this.deps.camera so
  // the crosshair remains accurate; only the visible origin below is offset)
  const aimDirection = this.deps.lookDirection.clone();
  aimDirection.x += this.spreadX;
  aimDirection.y += this.spreadY;
  // Add random spread within the current spread angle
  const randomSpread = (Math.random() - 0.5) * this.spreadAngle;
  const randomYaw = (Math.random() - 0.5) * this.spreadAngle;
  aimDirection.applyAxisAngle(new THREE.Vector3(1, 0, 0), randomSpread);
  aimDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), randomYaw);
  aimDirection.normalize();
  
  // Calculate muzzle position based on this.weapon type (offset to match the
  // on-screen gun position rather than spawning from dead-center)
  const muzzleOffset = this.muzzleOffsetForWeapon(this.weapon);
  const origin = this.muzzleOrigin(muzzleOffset);
  
  // Every successful shot contributes to the live plume. Residual barrel
  // smoke continues separately as the accumulated heat dissipates.
  this.deps.effects.addMuzzleSmoke(origin, this.weapon);
  this.deps.effects.startMuzzleSmokeTrail(origin, this.weapon);
  // Briefly light up the surroundings with each shot - heavier weapons throw
  // a bigger, longer-lived flash than the rapid-fire MG.
  this.deps.effects.addMuzzleFlash(
    origin,
    this.weapon === "MG" ? 0xffe8a0 : this.weapon === "CANNON" ? 0xd4c8a0 : 0xff9955,
    this.weapon === "MG" ? 14 : 36,
    this.weapon === "MG" ? 12 : 22,
    this.weapon === "MG" ? 0.05 : 0.11,
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
      this.smokeAccumulator += dt * (1.2 + this.muzzleSmoke * 3.8);
      while (this.smokeAccumulator >= 1) {
        this.deps.effects.addMuzzleSmoke(this.muzzleOrigin(muzzleOffsetForWeapon("MG")), "MG", true);
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

  resetState() {
    this.reload = this.cooldown = this.switchTime = 0;
    this.trigger = this.zoom = false;
    this.muzzleSmoke = this.smokeAccumulator = 0;
    this.spreadHeat = this.spreadAngle = this.spreadX = this.spreadY = 0;
    this.weapon = "MG";
  }
}
