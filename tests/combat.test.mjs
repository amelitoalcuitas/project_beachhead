import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bearing,
  bearingDelta,
  canEngage,
  segmentHit,
  terrainIntersection,
} from "../src/combat.ts";
import { specs } from "../src/content.ts";

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
