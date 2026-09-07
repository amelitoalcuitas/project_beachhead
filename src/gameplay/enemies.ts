import * as THREE from "three";
import { terrainHeight } from "../rendering/battlefield.ts";
import { enemyModel, animateEnemy } from "../rendering/enemy-models.ts";
import { specs, weaponEffectiveness } from "../content.ts";
import {
  advanceEnemyFire, ballisticVelocity, bearing, canEngage,
  enemyProjectileDamage, resolveSplashDamage, resolveWeaponDamage,
  splashDamage, terrainIntersection,
} from "./combat.ts";
import { isInfantryType, type EnemyType, type Weapon } from "../types.ts";
import type { Enemy } from "./entities.ts";
import type { SessionState } from "../game/game-state.ts";
import type { Battlefield } from "../rendering/battlefield.ts";
import type { CombatHud } from "../ui/hud.ts";
import type { AudioManager } from "../audio/audio.ts";
import type { ScreenMessages } from "../ui/screens.ts";
import type { EffectsSystem } from "../rendering/effects.ts";
import type { ProjectileSystem } from "./projectiles.ts";
export function addParachute(group: THREE.Group) {
  const parachute = new THREE.Group();
  parachute.name = "parachute";
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd6d0ae, roughness: 0.9, side: THREE.DoubleSide }),
  );
  canopy.position.y = 5.2;
  canopy.scale.y = 0.65;
  parachute.add(canopy);
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x403f34 });
  for (const x of [-1.7, 1.7]) {
    parachute.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 4.9, 0), new THREE.Vector3(x * 0.4, 2.25, 0),
      ]),
      lineMaterial,
    ));
  }
  group.add(parachute);
}

export function removeParachute(group: THREE.Group) {
  const parachute = group.getObjectByName("parachute");
  if (!parachute) return;
  parachute.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      node.geometry.dispose();
      if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
      else node.material.dispose();
    }
  });
  parachute.removeFromParent();
}

export interface EnemyDeps {
  session: SessionState;
  playerPosition: THREE.Vector3;
  enemyLayer: THREE.Group;
  getSimulationTime: () => number;
  battlefield: Battlefield;
  raycaster: THREE.Raycaster;
  hud: CombatHud;
  audio: AudioManager;
  screens: ScreenMessages;
  effects: EffectsSystem;
  projectiles: ProjectileSystem;
  sphereGeometry: THREE.SphereGeometry;
  projectileLayer: THREE.Group;
  getWeapon: () => Weapon;
  muzzlePan: (position: THREE.Vector3) => number;
}

export class EnemySystem {
  private readonly deps: EnemyDeps;
  readonly enemies: Enemy[] = [];
  readonly targetCenter = new THREE.Vector3();

  constructor(deps: EnemyDeps) {
    this.deps = deps;
  }

  spawn(type: EnemyType, near?: THREE.Vector3, parachuting = false) {
  if (this.enemies.filter((enemy) => !enemy.dead).length >= 32) return;
  const definition = specs[type],
    group = enemyModel(type, definition.color);
  // The opening this.deps.session.wave establishes the shoreline; later waves include the flanks and rear.
  const angle =
    this.deps.session.wave === 1 ? (Math.random() - 0.5) * 2.4 : Math.random() * Math.PI * 2;
  const distance = definition.air
    ? 380 + Math.random() * 180
    : 190 + Math.random() * 230;
  group.position.set(
    Math.sin(angle) * distance,
    0,
    18 - Math.cos(angle) * distance,
  );
  if (!definition.air) group.position.z = Math.max(-250, group.position.z);
  group.position.y = definition.air
    ? type === "heli"
      ? 40
      : 70
    : terrainHeight(group.position.x, group.position.z);
  if (near) {
    group.position.copy(near);
    group.position.x += (Math.random() - 0.5) * 12;
    group.position.z += (Math.random() - 0.5) * 12;
    if (!parachuting)
      group.position.y = terrainHeight(group.position.x, group.position.z);
  }
  if (parachuting) addParachute(group);
  const enemy: Enemy = {
    type,
    group,
    hp: definition.hp,
    speed: definition.speed * Math.min(1.65, 1 + this.deps.session.wave * 0.025),
    fire: 1 / definition.attackRate + Math.random() * 2.5,
    burstRemaining: 0,
    dead: false,
    target: this.deps.playerPosition.clone(),
    passes: 0,
    unloaded: false,
    parachuting,
    warning: 0,
    sightTimer: 0,
    canAttack: false,
  };
  if (type === "aircraft")
    enemy.target.set(
      -group.position.x * 0.65,
      70,
      18 + (18 - group.position.z) * 0.65,
    );
  group.traverse((node) => (node.userData.enemy = enemy));
  this.deps.enemyLayer.add(group);
  this.enemies.push(enemy);
  }
  applyExplosionToEnemies(
  origin: THREE.Vector3,
  amount: number,
  radius: number,
  source: Weapon | "vehicle",
  exclude?: Enemy,
  directionHint?: THREE.Vector3,
  ) {
  if (radius <= 0 || amount <= 0) return;
  for (const enemy of this.enemies) {
    if (enemy.dead) continue;
    if (source === "vehicle" && !isInfantryType(enemy.type)) continue;
    this.targetCenter.copy(enemy.group.position);
    if (!specs[enemy.type].air) this.targetCenter.y += 1.7;
    const distance = this.targetCenter.distanceTo(origin);
    if (distance >= radius) continue;
    const blastOrigin = origin.clone();
    if (directionHint) blastOrigin.addScaledVector(directionHint, -0.03);
    const sightDirection = this.targetCenter.clone().sub(blastOrigin);
    const sightDistance = sightDirection.length();
    sightDirection.normalize();
    const clearSight =
      this.obstructionDistance(blastOrigin, sightDirection, sightDistance) >=
      sightDistance;
    const raw = splashDamage(
      amount,
      radius,
      distance,
      clearSight,
      enemy === exclude,
    );
    if (raw <= 0) continue;
    this.hitEnemy(
      enemy,
      raw,
      source,
      origin,
      false,
      source === "vehicle" ? "blast" : "splash",
    );
  }
  }
  obstructionDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
  ) {
  const ground = terrainIntersection(
    origin,
    direction,
    distance,
    terrainHeight,
  );
  this.deps.raycaster.set(origin, direction);
  this.deps.raycaster.far = distance;
  const hit = this.deps.raycaster.intersectObjects(
    this.deps.battlefield.occluders.slice(1),
    true,
  )[0];
  return Math.min(ground, hit?.distance ?? Infinity);
  }
  enemyOrigin(enemy: Enemy) {
  return enemy.group.position
    .clone()
    .add(
      new THREE.Vector3(
        0,
        specs[enemy.type].air ? 0 : isInfantryType(enemy.type) ? 2 : 3,
        0,
      ),
    );
  }
  clearLineOfSight(origin: THREE.Vector3) {
  const direction = this.deps.playerPosition.clone().sub(origin),
    distance = direction.length();
  direction.normalize();
  return this.obstructionDistance(origin, direction, distance) > distance - 1;
  }
  hitEnemy(
  enemy: Enemy,
  amount: number,
  source: Weapon | "vehicle",
  position: THREE.Vector3,
  headshot = false,
  mode: "direct" | "splash" | "blast" = "direct",
  ) {
  if (enemy.dead) return;
  const weapon = source === "vehicle" ? "MG" : source;
  const resisted =
    mode === "direct" &&
    source !== "vehicle" &&
    weaponEffectiveness[this.deps.getWeapon()][enemy.type] < 0.5;
  const damage =
    mode === "blast"
      ? amount
      : mode === "splash"
        ? resolveSplashDamage(amount, this.deps.getWeapon(), enemy.type)
        : resolveWeaponDamage(amount, this.deps.getWeapon(), enemy.type, headshot);
  if (damage <= 0) return;
  enemy.hp -= damage;
  this.deps.effects.sparks(position);
  if (headshot) this.deps.effects.bloodSplat(position);
  this.deps.hud.hit(enemy.hp <= 0);
  const hitPan = this.deps.muzzlePan(position);
  if (headshot) this.deps.audio.splatSound(hitPan);
  else if (isInfantryType(enemy.type))
    this.deps.audio.hitMarkerSound(enemy.hp <= 0, hitPan);
  else this.deps.audio.vehicleHitSound(enemy.hp <= 0, hitPan);
  if (enemy.hp > 0) {
    if (resisted) {
      const recommended = specs[enemy.type].air ? "BOFORS" : "AT GUN";
      this.deps.screens.message("LOW EFFECTIVENESS · SWITCH TO " + recommended);
    }
    else if (headshot) this.deps.screens.message("HEADSHOT · CRITICAL DAMAGE");
    return;
  }
  enemy.dead = true;
  enemy.canAttack = false;
  if (isInfantryType(enemy.type)) {
    this.deps.effects.createCorpse(enemy);
    this.deps.effects.infantryDeath(position, headshot);
  } else {
    const definition = specs[enemy.type];
    const blastOrigin = enemy.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    this.deps.effects.createWreckage(enemy);
    enemy.group.removeFromParent();
    const groundVehicle = !definition.air;
    this.deps.effects.explode(
      blastOrigin,
      definition.air ? 3.5 : 3.8,
      groundVehicle ? 1.15 : 1,
      groundVehicle ? "vehicle" : "default",
    );
    this.applyExplosionToEnemies(
      blastOrigin,
      definition.explosionDamage,
      definition.explosionRadius,
      "vehicle",
    );
  }
  this.deps.session.score += specs[enemy.type].score;
  this.deps.screens.message(
    specs[enemy.type].score +
      " POINTS / " +
      specs[enemy.type].name +
      " DESTROYED",
  );
  }
  enemyAttack(enemy: Enemy) {
  const origin = this.enemyOrigin(enemy);
  const definition = specs[enemy.type];
  // Recheck at the moment of discharge, including after an attack wind-up.
  if (
    enemy.dead ||
    !canEngage(
      origin,
      this.deps.playerPosition,
      specs[enemy.type].range,
      this.clearLineOfSight(origin),
    )
  )
    return false;
  const grenade = specs[enemy.type].grenade === true;
  const projectileSpeed = specs[enemy.type].projectileSpeed;
  const launchDirection = this.deps.playerPosition.clone().sub(origin).normalize();
  const mesh = new THREE.Mesh(
    this.deps.sphereGeometry,
    new THREE.MeshBasicMaterial({ color: grenade ? 0x4f6b3a : 0xff7150 }),
  );
  mesh.scale.setScalar(grenade ? 0.24 : enemy.type === "tank" ? 0.36 : 0.16);
  mesh.position.copy(origin).addScaledVector(launchDirection, 2);
  const velocity = ballisticVelocity(
    mesh.position,
    this.deps.playerPosition,
    projectileSpeed,
    definition.bulletDrop,
  );
  this.deps.projectileLayer.add(mesh);
  this.deps.effects.sparks(origin);
  this.deps.effects.addMuzzleFlash(
    origin,
    grenade ? 0x9fbf6a : 0xff7150,
    enemy.type === "tank" ? 30 : 18,
    enemy.type === "tank" ? 20 : 13,
    0.07,
  );
  this.deps.projectiles.addShot({
    mesh,
    velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
    damage: enemyProjectileDamage(definition),
    explosionDamage: definition.explosionDamage,
    splash: grenade ? definition.explosionRadius : 0,
    life: grenade ? 8 : 6,
    owner: "enemy",
    weapon: "MG",
    projectile: grenade ? "grenade" : undefined,
    gravity: definition.bulletDrop,
    previous: mesh.position.clone(),
    sourceBearing: bearing(
      origin.x - this.deps.playerPosition.x,
      origin.z - this.deps.playerPosition.z,
    ),
  });
  return true;
  }
  updateEnemies(dt: number) {
  for (const enemy of this.enemies) {
    if (enemy.dead) continue;
    const position = enemy.group.position,
      definition = specs[enemy.type];
    let moving = false;
    if (enemy.parachuting) {
      const landingHeight = terrainHeight(position.x, position.z);
      position.y = Math.max(landingHeight, position.y - 7 * dt);
      if (position.y <= landingHeight) {
        position.y = landingHeight;
        enemy.parachuting = false;
        removeParachute(enemy.group);
      } else {
        animateEnemy(
          enemy.group,
          enemy.type,
          this.deps.getSimulationTime() + enemy.group.id,
          false,
        );
        continue;
      }
    }
    if (enemy.type === "aircraft") {
      const to = enemy.target.clone().sub(position);
      if (to.length() < 8) {
        enemy.passes++;
        if (enemy.passes >= 3) {
          enemy.dead = true;
          enemy.group.removeFromParent();
          continue;
        }
        enemy.target.set(-position.x, 70, 36 - position.z);
      }
      position.addScaledVector(to.normalize(), enemy.speed * dt);
      enemy.group.lookAt(enemy.target);
      enemy.group.rotateY(Math.PI);
    } else {
      const to = this.deps.playerPosition.clone().sub(position);
      to.y = 0;
      const stop =
        enemy.type === "heli"
          ? enemy.unloaded
            ? 105
            : 220
          : enemy.type === "tank"
            ? 115
            : enemy.type === "apc"
              ? 75
              : isInfantryType(enemy.type)
                ? 25
                : 45;
      if (to.length() > stop) {
        position.addScaledVector(to.normalize(), enemy.speed * dt);
        moving = true;
      }
      if (enemy.type === "heli") {
        position.y = 42 + Math.sin(this.deps.getSimulationTime() * 1.2 + enemy.group.id) * 5;
        position.x += Math.sin(this.deps.getSimulationTime() * 0.5 + enemy.group.id) * dt * 4;
      } else position.y = terrainHeight(position.x, position.z);
      enemy.group.rotation.y = Math.atan2(
        position.x - this.deps.playerPosition.x,
        position.z - this.deps.playerPosition.z,
      );
    }
    animateEnemy(
      enemy.group,
      enemy.type,
      this.deps.getSimulationTime() + enemy.group.id,
      moving,
    );
    if (
      (enemy.type === "truck" || enemy.type === "heli") &&
      !enemy.unloaded &&
      (enemy.type === "heli"
        ? position.distanceTo(this.deps.playerPosition) < 220
        : position.distanceTo(this.deps.playerPosition) < 80) &&
      this.enemies.filter((e) => !e.dead).length <= (enemy.type === "heli" ? 27 : 28)
    ) {
      enemy.unloaded = true;
      const infantryCount = enemy.type === "heli" ? 1 : 2;
      for (let i = 0; i < infantryCount; i++)
        this.spawn("infantry", position, enemy.type === "heli");
    }
    enemy.sightTimer -= dt;
    if (enemy.sightTimer <= 0) {
      const origin = this.enemyOrigin(enemy);
      enemy.canAttack = canEngage(
        origin,
        this.deps.playerPosition,
        definition.range,
        origin.distanceTo(this.deps.playerPosition) <= definition.range &&
          this.clearLineOfSight(origin),
      );
      enemy.sightTimer = 0.3;
    }
    if (!enemy.canAttack) {
      if (this.deps.session.airWarningEnemyId === enemy.group.id) this.deps.session.airWarningEnemyId = null;
      enemy.warning = 0;
      enemy.burstRemaining = 0;
      enemy.fire = Math.max(enemy.fire, 0.5);
      continue;
    }
    if (enemy.warning > 0) {
      enemy.warning -= dt;
      if (enemy.warning <= 0) {
        if (this.deps.session.airWarningEnemyId === enemy.group.id) this.deps.session.airWarningEnemyId = null;
        this.enemyAttack(enemy);
        enemy.fire = 1 / specs[enemy.type].attackRate + Math.random() * 2;
      }
      continue;
    }
    if (definition.burst) {
      const next = advanceEnemyFire(enemy, dt, definition.burst, 1 / definition.attackRate + Math.random() * 2);
      enemy.fire = next.fire;
      enemy.burstRemaining = next.burstRemaining;
      if (next.shouldFire && !this.enemyAttack(enemy)) {
        enemy.burstRemaining = 0;
        enemy.fire = 1 / definition.attackRate + Math.random() * 2;
      }
      continue;
    }
    enemy.fire -= dt;
    if (enemy.fire > 0) continue;
    if (
      enemy.type === "tank" ||
      enemy.type === "heli" ||
      enemy.type === "aircraft"
    ) {
      if (this.deps.getSimulationTime() < this.deps.session.heavyAttackReady) continue;
      this.deps.session.heavyAttackReady = this.deps.getSimulationTime() + 1.6;
      enemy.warning = 0.85;
      this.deps.screens.message(specs[enemy.type].name + " PREPARING TO FIRE");
      this.deps.effects.sparks(this.enemyOrigin(enemy));
      if (enemy.type === "heli" || enemy.type === "aircraft") {
        this.deps.audio.sound("air-warning");
        this.deps.session.airWarningEnemyId = enemy.group.id;
      }
    } else {
      this.enemyAttack(enemy);
      enemy.fire = 1 / specs[enemy.type].attackRate + Math.random() * 2;
    }
  }
  }

  clear() {
    for (const enemy of this.enemies) {
      enemy.group.removeFromParent();
      enemy.group.traverse((node) => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
    }
    this.enemies.length = 0;
  }
}
