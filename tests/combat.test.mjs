import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveWeaponDamage,
  splashDamage,
  proximityHit,
  projectileImpact,
  ballisticVelocity,
  bearing,
  bearingDelta,
  canEngage,
  GROUND_IMPACT_AUDIBLE_DISTANCE,
  GROUND_IMPACT_FULL_VOLUME_DISTANCE,
  groundImpactVolume,
  GRENADE_BLAST_RADIUS,
  GRENADE_DAMAGE,
  grenadeDamageAtDistance,
  segmentHit,
  terrainIntersection,
} from "../src/combat.ts";
import { specs, weapons, weaponEffectiveness } from "../src/content.ts";
import { wavePlans } from "../src/content.ts";

test("short projectile steps still collide with terrain", () => {
  const distance = terrainIntersection(
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    0.9,
    () => 0.5,
  );
  assert.ok(Math.abs(distance - 0.5) < 0.004);
  assert.equal(
    terrainIntersection(
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      10,
      () => 0,
    ),
    Infinity,
  );
});

test("compass maps the four world directions to their correct bearings", () => {
  assert.equal(bearing(0, -1), 0);
  assert.equal(bearing(1, 0), 90);
  assert.equal(bearing(0, 1), 180);
  assert.equal(bearing(-1, 0), 270);
});
test("pins cross north continuously and distinguish the rear hemisphere", () => {
  assert.equal(bearingDelta(1, 359), 2);
  assert.equal(bearingDelta(359, 1), -2);
  assert.equal(bearingDelta(90, 0), 90);
  assert.equal(bearingDelta(270, 0), -90);
  assert.equal(Math.abs(bearingDelta(180, 0)), 180);
});
test("enemy range limits use real distance, with no hidden range bonus", () => {
  for (const [type, { range }] of Object.entries(specs)) {
    assert.equal(
      canEngage(
        { x: 0, y: 7, z: range + 0.01 },
        { x: 0, y: 7, z: 0 },
        range,
        true,
      ),
      false,
      type + " outside",
    );
    assert.equal(
      canEngage({ x: 0, y: 7, z: range }, { x: 0, y: 7, z: 0 }, range, true),
      true,
      type + " at boundary",
    );
    assert.equal(
      canEngage(
        { x: 0, y: 7, z: range - 1 },
        { x: 0, y: 7, z: 0 },
        range,
        true,
      ),
      true,
      type + " inside",
    );
  }
});
test("altitude contributes to aircraft firing distance", () => {
  assert.equal(
    canEngage({ x: 0, y: 100, z: 100 }, { x: 0, y: 0, z: 0 }, 140, true),
    false,
  );
  assert.equal(
    canEngage({ x: 0, y: 100, z: 100 }, { x: 0, y: 0, z: 0 }, 142, true),
    true,
  );
});
test("occluded enemies cannot fire even at close range", () => {
  assert.equal(
    canEngage({ x: 0, y: 2, z: 10 }, { x: 0, y: 7, z: 0 }, 65, false),
    false,
  );
});
test("fast rounds hit along their segment rather than only at the endpoint", () => {
  const hit = segmentHit(
    { x: -20, y: 7, z: 0 },
    { x: 20, y: 7, z: 0 },
    { x: 0, y: 7, z: 0 },
    2,
  );
  assert.equal(hit, 0.45);
});
test("rounds that pass above or beyond the target do not hit it", () => {
  assert.equal(
    segmentHit(
      { x: -10, y: 10, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 7, z: 0 },
      2,
    ),
    null,
  );
  assert.equal(
    segmentHit(
      { x: -10, y: 7, z: 0 },
      { x: -5, y: 7, z: 0 },
      { x: 0, y: 7, z: 0 },
      2,
    ),
    null,
  );
});
test("collision handles stationary rounds and starts inside targets", () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(segmentHit(origin, origin, origin, 2), 0);
  assert.equal(segmentHit(origin, origin, { x: 10, y: 0, z: 0 }, 2), null);
});

test("ground impact volume falls off with distance", () => {
  assert.equal(groundImpactVolume(0), 1);
  assert.equal(groundImpactVolume(GROUND_IMPACT_FULL_VOLUME_DISTANCE), 1);
  assert.equal(groundImpactVolume(GROUND_IMPACT_AUDIBLE_DISTANCE), 0);
  assert.equal(groundImpactVolume(Infinity), 0);

  const nearVolume = groundImpactVolume(75);
  const farVolume = groundImpactVolume(250);
  assert.ok(nearVolume > farVolume);
  assert.ok(farVolume > 0);
});

test("vehicle projectiles compensate for gravity at their stopping distances", () => {
  const gravity = 24.5 * 0.3;
  const speed = 55;
  for (const distance of [45, 75, 115]) {
    const origin = { x: 0, y: 3, z: -distance };
    const target = { x: 0, y: 7, z: 0 };
    const velocity = ballisticVelocity(origin, target, speed, gravity);
    const flightTime = distance / velocity.z;
    const impactY =
      origin.y +
      velocity.y * flightTime -
      0.5 * gravity * flightTime * flightTime;

    assert.ok(Math.abs(impactY - target.y) < 1e-9);
    assert.ok(
      Math.abs(Math.hypot(velocity.x, velocity.y, velocity.z) - speed) < 1e-9,
    );
  }
});

test("infantry variants and ground speed balance are defined", () => {
  assert.equal(specs.infantry.hp, 100);
  assert.equal(specs.infantry.speed, 7.7);
  assert.equal(specs.infantry.range, 90);
  assert.equal(specs.armoredInfantry.hp, 150);
  assert.equal(specs.grenadierInfantry.hp, 100);
  assert.equal(specs.grenadierInfantry.range, 85);
  assert.equal(specs.grenadierInfantry.grenade, true);
  assert.equal(specs.grenadierInfantry.color, 0x315fa8);
  assert.equal(specs.armoredInfantry.color, 0xa63b32);
  assert.equal(specs.armoredInfantry.score, 200);
  assert.equal(specs.grenadierInfantry.score, 250);
  for (const [type, baseline] of Object.entries({ jeep: 12, truck: 7, apc: 4.5, tank: 3 }))
    assert.ok(Math.abs(specs[type].speed - baseline * 1.1) < 1e-9);
  assert.equal(specs.armoredInfantry.speed, 6.6);
  assert.equal(specs.grenadierInfantry.speed, 6.6);
  assert.equal(specs.heli.speed, 12);
  assert.equal(specs.aircraft.speed, 34);
});

test("grenade damage falls off linearly inside its blast radius", () => {
  assert.equal(grenadeDamageAtDistance(0), GRENADE_DAMAGE);
  assert.equal(grenadeDamageAtDistance(GRENADE_BLAST_RADIUS / 2), GRENADE_DAMAGE / 2);
  assert.equal(grenadeDamageAtDistance(GRENADE_BLAST_RADIUS), 0);
  assert.equal(grenadeDamageAtDistance(GRENADE_BLAST_RADIUS + 0.01), 0);
});

test("authored waves preserve size while adding the planned infantry mix", () => {
  const expected = [[10, 0, 0], [9, 2, 0], [7, 2, 1], [6, 2, 2], [5, 3, 2], [4, 3, 3], [3, 3, 2], [2, 3, 2], [1, 2, 1], [1, 2, 2]];
  wavePlans.forEach((plan, index) => {
    const counts = ["infantry", "armoredInfantry", "grenadierInfantry"].map(type => plan.filter(entry => entry === type).length);
    assert.deepEqual(counts, expected[index]);
  });
});

const matchupDamage = {
  infantry: [30, 200, 96], armoredInfantry: [24, 260, 96],
  grenadierInfantry: [30, 200, 96], jeep: [6, 400, 144],
  truck: [4.5, 400, 128], apc: [1.2, 500, 64],
  tank: [0.45, 600, 16], heli: [9, 180, 240], aircraft: [9, 180, 240],
};
for (const [enemy, expected] of Object.entries(matchupDamage)) {
  ["MG", "CANNON", "BOFORS"].forEach((weapon, index) => {
    test(`${weapon} direct and splash damage against ${enemy}`, () => {
      assert.ok(Math.abs(resolveWeaponDamage(weapons[weapon].damage, weapon, enemy) - expected[index]) < 1e-9);
      assert.ok(weaponEffectiveness[weapon][enemy] > 0, "soft counters never grant immunity");
      const blast = splashDamage(200, 10, 5, true);
      assert.equal(blast, 65);
      assert.equal(resolveWeaponDamage(blast, weapon, enemy), 65 * weaponEffectiveness[weapon][enemy]);
    });
  });
}

test("headshots preserve infantry critical behavior before resistance", () => {
  assert.equal(resolveWeaponDamage(30, "MG", "infantry", true), 100);
  assert.equal(resolveWeaponDamage(30, "MG", "armoredInfantry", true), 80);
  assert.equal(resolveWeaponDamage(400, "CANNON", "infantry", true), 500);
  assert.equal(resolveWeaponDamage(160, "BOFORS", "infantry", true), 240);
  assert.ok(Math.abs(resolveWeaponDamage(30, "MG", "tank", true) - 0.45) < 1e-9);
});

test("blast cannot double-hit, penetrate cover, or damage outside its radius", () => {
  assert.equal(splashDamage(320, 10, 0, true), 208);
  assert.equal(splashDamage(320, 10, 6, true), 83.2);
  assert.equal(splashDamage(320, 10, 0, true, true), 0);
  assert.equal(splashDamage(320, 10, 0, false), 0);
  for (const distance of [-1, 10, 11]) assert.equal(splashDamage(320, 10, distance, true), 0);
  assert.equal(splashDamage(320, 0, 0, true), 0);
});

test("Bofors ammunition and rate preserve its four-round automatic role", () => {
  const gun = weapons.BOFORS;
  assert.equal(gun.maxMag, 4);
  assert.equal(gun.maxReserve, 96);
  assert.equal(gun.fireRate, 0.75);
  assert.equal(gun.reload, 1.5);
  assert.equal(gun.projectileSpeed, 650);
  assert.equal(gun.proximityRadius, 6);
  assert.equal(gun.armingDistance, 20);
  assert.equal(weapons.CANNON.explosionRadius, 4);
  assert.equal(weapons.CANNON.explosionDamage, 120);
  assert.equal(Math.ceil(specs.jeep.hp / resolveWeaponDamage(30, "MG", "jeep")), 40);
  assert.equal(Math.ceil(specs.tank.hp / resolveWeaponDamage(400, "CANNON", "tank")), 2);
  assert.equal(Math.ceil(specs.tank.hp / resolveWeaponDamage(160, "BOFORS", "tank")), 75);
});

const fuseStart = { x: 0, y: 30, z: 0 };
const fuseEnd = { x: 100, y: 30, z: 0 };
test("fast flak shells detect aircraft near misses along the entire segment", () => {
  const center = { x: 50, y: 35, z: 0 };
  assert.equal(segmentHit(fuseStart, fuseEnd, center, 3.6), null);
  const hit = proximityHit(fuseStart, fuseEnd, center, 0, 20, 6, true);
  assert.ok(hit > 0.46 && hit < 0.5);
  assert.equal(proximityHit(fuseStart, fuseEnd, { x: 50, y: 37, z: 0 }, 0, 20, 6, true), null);
});

test("proximity fuses arm mid-step and never trigger early, on ground units, or on dead aircraft", () => {
  const center = { x: 22, y: 30, z: 0 };
  assert.equal(proximityHit(fuseStart, fuseEnd, center, 0, 20, 6, true), 0.2);
  assert.equal(proximityHit(fuseStart, fuseEnd, { x: 10, y: 30, z: 0 }, 0, 20, 6, true), null);
  assert.equal(proximityHit(fuseStart, { x: 10, y: 30, z: 0 }, center, 0, 20, 6, true), null);
  assert.equal(proximityHit(fuseStart, fuseEnd, center, 0, 20, 6, false), null);
  assert.equal(proximityHit(fuseStart, fuseEnd, center, 0, 20, 6, true, true), null);
  assert.equal(proximityHit(fuseStart, fuseEnd, center, 0, 20, 0, true), null);
  assert.equal(proximityHit(fuseStart, fuseStart, center, 30, 20, 6, true), null);
});

test("impact ordering chooses a single earliest detonation and physical hits win ties", () => {
  assert.deepEqual(projectileImpact(0.2, 0.4), { t: 0.2, kind: "physical" });
  assert.deepEqual(projectileImpact(0.4, 0.2), { t: 0.2, kind: "proximity" });
  assert.deepEqual(projectileImpact(0.2, 0.2), { t: 0.2, kind: "physical" });
  assert.deepEqual(projectileImpact(Infinity, 0.2), { t: 0.2, kind: "proximity" });
  assert.equal(projectileImpact(Infinity, Infinity), null);
});
