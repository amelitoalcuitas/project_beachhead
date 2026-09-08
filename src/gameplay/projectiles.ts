import * as THREE from "../pc-shim/index.ts";
import type { Enemy, Shot } from "./entities.ts";
import {
  grenadeDamageAtDistance, groundImpactVolume, projectileImpact,
  proximityHit, segmentHit,
} from "./combat.ts";
import { isInfantryType } from "../types.ts";
import { specs } from "../content.ts";
import type { AudioManager } from "../audio/audio.ts";
import type { EffectsSystem } from "../rendering/effects.ts";
import type { EnemySystem } from "./enemies.ts";
import { releaseMesh } from "../rendering/effects.ts";
import type { GunEffectsSystem } from "../rendering/gun-effects.ts";

export const PLAYER_PROJECTILE_GRAVITY = 9.81;
export const ENEMY_PROJECTILE_GRAVITY = 24.5 * 0.3;

export interface ProjectileDeps {
  playerPosition: THREE.Vector3;
  projectileLayer: THREE.Group;
  audio: AudioManager;
  effects: EffectsSystem;
  gunEffects?: GunEffectsSystem;
  enemies: EnemySystem | null;
  muzzlePan: (position: THREE.Vector3) => number;
  onHurtPlayer: (amount: number, sourceBearing?: number) => void;
}

export class ProjectileSystem {
  private readonly deps: ProjectileDeps;
  readonly shots: Shot[] = [];

  constructor(deps: ProjectileDeps) {
    this.deps = deps;
  }

  wireEnemies(enemies: EnemySystem) {
    this.deps.enemies = enemies;
  }

  addShot(shot: Shot) {
    this.shots.push(shot);
  }

  updateShots(dt: number) {
  for (let i = this.shots.length - 1; i >= 0; i--) {
    const shot = this.shots[i];
    shot.previous.copy(shot.mesh.position);
    // Apply bullet drop to projectiles (CANNON, BOFORS, and MG)
    shot.velocity.y -=
      (shot.gravity ??
        (shot.owner === "player"
          ? PLAYER_PROJECTILE_GRAVITY
          : ENEMY_PROJECTILE_GRAVITY)) * dt;
    shot.mesh.position.addScaledVector(shot.velocity, dt);
    shot.life -= dt;
    const distanceTravelled = shot.distanceTravelled ?? 0;
    shot.distanceTravelled = distanceTravelled + shot.previous.distanceTo(shot.mesh.position);
    let hit = false,
      enemyHit: Enemy | undefined,
      bestT = Infinity;
    const step = shot.mesh.position.clone().sub(shot.previous),
      length = step.length(),
      direction = step.clone().normalize();
    const enemies = this.deps.enemies!;
    const obstruction = enemies.obstructionDistance(shot.previous, direction, length);
    if (obstruction <= length) {
      bestT = obstruction / length;
      hit = true;
    }
    if (shot.owner === "enemy") {
      let playerHit = false;
      const t = segmentHit(
        shot.previous,
        shot.mesh.position,
        this.deps.playerPosition,
        2.1,
      );
      if (t !== null && t < bestT) {
        shot.mesh.position.lerpVectors(shot.previous, shot.mesh.position, t);
        playerHit = true;
        hit = true;
      }
      if (hit && shot.projectile === "grenade") {
        const distance = shot.mesh.position.distanceTo(this.deps.playerPosition);
        if (distance <= shot.splash)
          this.deps.onHurtPlayer(
            playerHit ? shot.damage : grenadeDamageAtDistance(distance),
            shot.sourceBearing,
          );
        this.deps.effects.explode(shot.mesh.position, 3.2, groundImpactVolume(distance));
      } else if (playerHit) this.deps.onHurtPlayer(shot.damage, shot.sourceBearing);
    } else {
      let headshotHit = false;
      let proximityT = Infinity;
      for (const enemy of enemies.enemies) {
        if (enemy.dead) continue;
        const fuseT = shot.weapon === "BOFORS"
          ? proximityHit(
              shot.previous, shot.mesh.position, enemy.group.position,
              distanceTravelled, shot.armingDistance ?? 0,
              shot.proximityRadius ?? 0, !!specs[enemy.type].air,
            )
          : null;
        if (fuseT !== null) proximityT = Math.min(proximityT, fuseT);
        if (isInfantryType(enemy.type)) {
          // Small headshot hitbox around the helmet - checked separately from
          // the body so a shot to the head can register bonus damage.
          enemies.targetCenter.copy(enemy.group.position);
          enemies.targetCenter.y += 3.15;
          const headT = segmentHit(
            shot.previous,
            shot.mesh.position,
            enemies.targetCenter,
            0.55,
          );
          enemies.targetCenter.copy(enemy.group.position);
          enemies.targetCenter.y += 1.7;
          const bodyT = segmentHit(
            shot.previous,
            shot.mesh.position,
            enemies.targetCenter,
            1.5,
          );
          const isHead = headT !== null && (bodyT === null || headT <= bodyT);
          const t = isHead ? headT : bodyT;
          if (t !== null && t < bestT) {
            bestT = t;
            enemyHit = enemy;
            hit = true;
            headshotHit = isHead;
          }
        } else {
          enemies.targetCenter.copy(enemy.group.position);
          enemies.targetCenter.y += specs[enemy.type].air ? 0 : 1.7;
          const t = segmentHit(
            shot.previous,
            shot.mesh.position,
            enemies.targetCenter,
            specs[enemy.type].air ? 3.6 : 3.2,
          );
          if (t !== null && t < bestT) {
            bestT = t;
            enemyHit = enemy;
            hit = true;
            headshotHit = false;
          }
        }
      }
      const impact = projectileImpact(bestT, proximityT);
      if (impact) {
        hit = true;
        bestT = impact.t;
        if (impact.kind === "proximity") {
          enemyHit = undefined;
          headshotHit = false;
        }
      }
      if (hit) {
        shot.mesh.position.lerpVectors(
          shot.previous,
          shot.mesh.position,
          bestT,
        );
        if (enemyHit)
          enemies.hitEnemy(
            enemyHit,
            shot.damage,
            shot.weapon,
            shot.mesh.position,
            headshotHit,
          );
        enemies.applyExplosionToEnemies(
          shot.mesh.position,
          shot.explosionDamage,
          shot.splash,
          shot.weapon,
          enemyHit,
          direction,
        );
        if (shot.weapon === "MG") {
          this.deps.gunEffects?.emitMgImpact(shot.mesh.position, enemyHit?.type);
          // Only play the ground/obstruction ricochet sound when the bullet
          // didn't hit an enemy - enemy hits already get the hit-marker sound.
          if (!enemyHit) {
            const impactDistance =
              shot.mesh.position.distanceTo(this.deps.playerPosition);
            this.deps.audio.ricochetSound(
              this.deps.muzzlePan(shot.mesh.position),
              groundImpactVolume(impactDistance),
            );
          }
        } else {
          const impactVolume = enemyHit
            ? 1
            : groundImpactVolume(
                shot.mesh.position.distanceTo(this.deps.playerPosition),
              );
          this.deps.effects.explode(
            shot.mesh.position,
            shot.weapon === "BOFORS" ? 2 : 3.2,
            impactVolume,
            shot.weapon === "BOFORS" ? "flak" : "he",
          );
          this.deps.gunEffects?.addCannonImpactMark(shot.mesh.position, shot.weapon);
        }
      }
    }
    // Only add tracer for cannon/Bofors projectiles, not MG bullets
    if (shot.weapon !== "MG" || shot.projectile === "grenade") {
      this.deps.effects.addTracer(
        shot.previous,
        shot.mesh.position,
        shot.owner === "enemy" ? 0xff8060 : 0xffce77,
        0.06,
      );
    }
    if (!hit && shot.life <= 0 && shot.projectile === "grenade") {
      const distance = shot.mesh.position.distanceTo(this.deps.playerPosition);
      if (distance <= shot.splash)
        this.deps.onHurtPlayer(grenadeDamageAtDistance(distance), shot.sourceBearing);
      this.deps.effects.explode(shot.mesh.position, 3.2, groundImpactVolume(distance));
      hit = true;
    }
    if (hit || shot.life <= 0) {
      releaseMesh(shot.mesh);
      this.shots.splice(i, 1);
    }
  }
  }

  clear() {
    for (const shot of this.shots) releaseMesh(shot.mesh);
    this.shots.length = 0;
  }
}
