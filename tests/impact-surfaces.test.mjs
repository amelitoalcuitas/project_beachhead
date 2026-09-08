import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mesh, Group } from '../src/pc-shim/nodes.ts';
import { BoxGeometry } from '../src/pc-shim/geometry.ts';
import { Vec3 } from '../src/pc-shim/math.ts';
import { Raycaster } from '../src/pc-shim/raycast.ts';
import { EnemySystem } from '../src/gameplay/enemies.ts';

function structure() {
  const root = new Group();
  root.userData.impactMaterial = 'wood';
  const wall = new Mesh(new BoxGeometry(10, 6, 0.5));
  wall.position.y = 10;
  root.add(wall);
  return { root, wall };
}
test('structure impacts hit actual walls and roofs instead of their bounding spheres', () => {
  const { root } = structure();
  const ray = new Raycaster(new Vec3(0, 10, 10), new Vec3(0, 0, -1));
  const hit = ray.intersectObject(root)[0];
  assert.equal(hit.distance, 9.75);
  assert.deepEqual([hit.normal.x, hit.normal.y, hit.normal.z], [0, 0, 1]);
  ray.set(new Vec3(0, 20, 0), new Vec3(0, -1, 0));
  const roof = ray.intersectObject(root)[0];
  assert.equal(roof.distance, 7);
  assert.equal(roof.normal.y, 1);
  ray.set(new Vec3(0, 14, 10), new Vec3(0, 0, -1));
  assert.equal(ray.intersectObject(root).length, 0);
});
test('rotated, scaled structure faces return normalized world normals', () => {
  const { root } = structure();
  root.rotation.y = Math.PI / 4;
  root.scale.set(2, 1, 0.5);
  const direction = new Vec3(-Math.SQRT1_2, 0, -Math.SQRT1_2);
  const ray = new Raycaster(new Vec3(10 * Math.SQRT1_2, 10, 10 * Math.SQRT1_2), direction);
  const hit = ray.intersectObject(root)[0];
  assert.ok(Math.abs(hit.distance - 9.875) < 1e-5);
  assert.ok(Math.abs(hit.normal.dot(direction) + 1) < 1e-5);
});
test('obstruction hits carry inherited material and terrain normals', () => {
  const { root } = structure();
  const enemies = new EnemySystem({ raycaster: new Raycaster(), battlefield: { occluders: [new Group(), root] } });
  const wall = enemies.obstructionImpact(new Vec3(0, 10, 10), new Vec3(0, 0, -1), 20);
  assert.equal(wall.material, 'wood');
  assert.equal(wall.normal.z, 1);
  const ground = enemies.obstructionImpact(new Vec3(60, 20, -70), new Vec3(0, -1, 0), 30);
  assert.equal(ground.material, 'sand');
  assert.ok(Math.abs(ground.normal.length() - 1) < 1e-6);
  assert.ok(ground.normal.y > 0);
});
