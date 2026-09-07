import { weaponEffectiveness } from "./content.ts";
import { isInfantryType, type EnemyType, type Weapon } from "./types.ts";

export interface Position {
  x: number;
  y: number;
  z: number;
}

// North is world -Z. Keep compass math independent of pitch and roll.
export function bearing(dx: number, dz: number) {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}
export function bearingDelta(target: number, heading: number) {
  return ((target - heading + 540) % 360) - 180;
}

export const RADAR_RANGE_METERS = 200;
export const RADAR_RING_INTERVAL_METERS = 50;
export const RADAR_RADIUS_PERCENT = 42;

export function radarContactPosition(relativeBearing: number, distance: number) {
  const angle = (relativeBearing * Math.PI) / 180;
  const radius = Math.min(1, distance / RADAR_RANGE_METERS) * RADAR_RADIUS_PERCENT;
  return {
    left: 50 + Math.sin(angle) * radius,
    top: 50 - Math.cos(angle) * radius,
    isDistant: distance > RADAR_RANGE_METERS,
  };
}

export function distanceBetween(a: Position, b: Position) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export const GROUND_IMPACT_FULL_VOLUME_DISTANCE = 20;
export const GROUND_IMPACT_AUDIBLE_DISTANCE = 350;
export const GRENADE_DAMAGE = 75;
export const GRENADE_BLAST_RADIUS = 8;

export function grenadeDamageAtDistance(distance: number) {
  if (distance < 0 || distance > GRENADE_BLAST_RADIUS) return 0;
  return GRENADE_DAMAGE * (1 - distance / GRENADE_BLAST_RADIUS);
}

export function groundImpactVolume(distance: number) {
  if (distance <= GROUND_IMPACT_FULL_VOLUME_DISTANCE) return 1;
  if (distance >= GROUND_IMPACT_AUDIBLE_DISTANCE) return 0;

  const falloff =
    1 -
    (distance - GROUND_IMPACT_FULL_VOLUME_DISTANCE) /
      (GROUND_IMPACT_AUDIBLE_DISTANCE - GROUND_IMPACT_FULL_VOLUME_DISTANCE);
  return falloff * falloff;
}

export function canEngage(
  origin: Position,
  target: Position,
  range: number,
  clearSight: boolean,
) {
  return clearSight && distanceBetween(origin, target) <= range;
}

export function ballisticVelocity(
  origin: Position,
  target: Position,
  speed: number,
  gravity: number,
): Position {
  const dx = target.x - origin.x,
    dy = target.y - origin.y,
    dz = target.z - origin.z;
  const directDistance = Math.hypot(dx, dy, dz);
  if (speed <= 0 || directDistance === 0) return { x: 0, y: 0, z: 0 };

  const horizontalDistance = Math.hypot(dx, dz);
  const directVelocity = () => ({
    x: (dx / directDistance) * speed,
    y: (dy / directDistance) * speed,
    z: (dz / directDistance) * speed,
  });
  if (gravity <= 0 || horizontalDistance === 0) return directVelocity();

  const speedSquared = speed * speed;
  const discriminant =
    speedSquared * speedSquared -
    gravity *
      (gravity * horizontalDistance * horizontalDistance +
        2 * dy * speedSquared);
  if (discriminant < 0) return directVelocity();

  const launchSlope =
    (speedSquared - Math.sqrt(discriminant)) /
    (gravity * horizontalDistance);
  const horizontalSpeed = speed / Math.sqrt(1 + launchSlope * launchSlope);
  return {
    x: (dx / horizontalDistance) * horizontalSpeed,
    y: launchSlope * horizontalSpeed,
    z: (dz / horizontalDistance) * horizontalSpeed,
  };
}

export function terrainIntersection(
  origin: Position,
  direction: Position,
  distance: number,
  heightAt: (x: number, z: number) => number,
) {
  const samples = Math.max(1, Math.ceil(distance / 2));
  const below = (t: number) =>
    origin.y + direction.y * t <=
    heightAt(origin.x + direction.x * t, origin.z + direction.z * t);
  if (below(0)) return 0;
  for (let i = 1; i <= samples; i++) {
    const t = (distance * i) / samples;
    if (!below(t)) continue;
    let low = (distance * (i - 1)) / samples,
      high = t;
    for (let j = 0; j < 8; j++) {
      const middle = (low + high) / 2;
      if (below(middle)) high = middle;
      else low = middle;
    }
    return high;
  }
  return Infinity;
}
// Segment tests prevent fast rounds from jumping through the bunker or targets.
export function segmentHit(
  start: Position,
  end: Position,
  center: Position,
  radius: number,
): number | null {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    dz = end.z - start.z;
  const ox = start.x - center.x,
    oy = start.y - center.y,
    oz = start.z - center.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c <= 0) return 0;
  if (lengthSquared === 0) return null;
  const b = ox * dx + oy * dy + oz * dz;
  const discriminant = b * b - lengthSquared * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / lengthSquared;
  return t >= 0 && t <= 1 ? t : null;
}

const HEADSHOT_MULTIPLIER = 2.5;
const MG_HEADSHOT_DAMAGE = 100;
const SPLASH_DAMAGE_SCALE = 0.65;

export function resolveWeaponDamage(
  amount: number,
  weapon: Weapon,
  target: EnemyType,
  headshot = false,
) {
  const critical = headshot && isInfantryType(target);
  const damage = critical ? (weapon === "MG" ? MG_HEADSHOT_DAMAGE : amount * HEADSHOT_MULTIPLIER) : amount;
  return damage * weaponEffectiveness[weapon][target];
}

export function splashDamage(
  amount: number,
  radius: number,
  distance: number,
  clearSight: boolean,
  directlyHit = false,
) {
  if (directlyHit || !clearSight || radius <= 0 || distance < 0 || distance >= radius) return 0;
  return amount * SPLASH_DAMAGE_SCALE * (1 - distance / radius);
}

// Clip the swept segment at the arming distance; a fast round can arm mid-step.
export function proximityHit(
  start: Position,
  end: Position,
  center: Position,
  distanceTravelled: number,
  armingDistance: number,
  radius: number,
  isAir: boolean,
  isDead = false,
): number | null {
  if (!isAir || isDead || radius <= 0) return null;
  const length = distanceBetween(start, end);
  if (length === 0 || distanceTravelled + length < armingDistance) return null;
  const armedT = Math.max(0, (armingDistance - distanceTravelled) / length);
  const armedStart = {
    x: start.x + (end.x - start.x) * armedT,
    y: start.y + (end.y - start.y) * armedT,
    z: start.z + (end.z - start.z) * armedT,
  };
  const hit = segmentHit(armedStart, end, center, radius);
  return hit === null ? null : armedT + hit * (1 - armedT);
}

export function projectileImpact(physicalT: number, proximityT: number) {
  if (physicalT <= proximityT && Number.isFinite(physicalT))
    return { t: physicalT, kind: "physical" as const };
  if (Number.isFinite(proximityT))
    return { t: proximityT, kind: "proximity" as const };
  return null;
}
