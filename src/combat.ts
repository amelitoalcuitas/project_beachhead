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
export function canEngage(
  origin: Position,
  target: Position,
  range: number,
  clearSight: boolean,
) {
  return clearSight && distanceBetween(origin, target) <= range;
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
