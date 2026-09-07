import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { WeaponView } from "../src/weapon-view.ts";

// WeaponView only needs viewport dimensions; geometry checks need no WebGL context.
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;

function readyCannon() {
  const view = new WeaponView();
  view.select("CANNON");
  view.update(1, 1, false, true, 1, 0);
  return view;
}

function part(view, name) {
  const mesh = view.scene.getObjectByName(name);
  assert.ok(mesh, name);
  return mesh;
}

function assertClearSight(view) {
  view.scene.updateMatrixWorld(true);
  assert.equal(view.scene.getObjectByName("cannon-sight"), undefined);
  const muzzle = view.muzzleScreenPosition();
  assert.ok(Math.abs(muzzle.x) < 1e-9, "ADS follows the barrel centerline");
  assert.ok(muzzle.y < 0, "The eye looks over the top of the gun");
  const model = part(view, "at-recoiling-assembly").parent;
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(model, true).length, 0);
}

test("AT barrel recoils inside a stationary carriage with a clear ADS sightline", () => {
  const view = readyCannon();
  const assembly = part(view, "at-recoiling-assembly");
  const mount = assembly.parent.parent;
  const startPosition = mount.position.clone();
  assertClearSight(view);
  view.fire("CANNON");
  view.update(0.055, 1.055, false, true, 0, 0);
  assert.ok(assembly.position.z > 0.29);
  assert.ok(mount.position.equals(startPosition));
  assertClearSight(view);
  view.update(0.5, 1.555, false, true, 0, 0);
  assert.equal(assembly.position.z, 0);
  assertClearSight(view);
});

test("AT breech opens for extraction and stays open while empty", () => {
  const view = readyCannon();
  view.fire("CANNON");
  view.update(0.3, 1.3, false, true, 0, 0);
  assert.ok(part(view, "at-breech-block").position.y < -0.6);
  assert.equal(part(view, "at-spent-case").visible, true);
  view.update(1, 2.3, false, true, 0, 0);
  assert.equal(part(view, "at-spent-case").visible, false);
  assert.ok(part(view, "at-breech-block").position.y < -0.6);
});

test("AT reload seats a forward-pointing round before closing the breech", () => {
  const view = readyCannon();
  view.fire("CANNON");
  view.update(1, 2, false, true, 0, 0);
  view.update(0.1, 2.1, true, true, 0, 0.5);
  const shell = part(view, "at-loading-round");
  assert.equal(shell.visible, true);
  assert.ok(Math.abs(shell.rotation.y) < 1e-9);
  const insertionStart = shell.position.z;
  view.update(0.2, 2.3, true, true, 0, 0.75);
  assert.ok(shell.position.z < insertionStart);
  assert.ok(part(view, "at-breech-block").position.y < -0.6);
  assertClearSight(view);
  view.update(0.3, 2.6, true, true, 0, 0.96);
  assert.equal(shell.visible, false);
  assert.equal(part(view, "at-breech-block").position.y, -0.32);
});

test("AT animation pauses and interrupted reloads leave no floating shells", () => {
  const view = readyCannon();
  view.fire("CANNON");
  view.update(0.3, 1.3, true, true, 0, 0.5);
  const assembly = part(view, "at-recoiling-assembly");
  const recoil = assembly.position.z;
  const shell = part(view, "at-loading-round");
  const shellPosition = shell.position.clone();
  view.update(0, 1.3, true, true, 0, 0.5);
  assert.equal(assembly.position.z, recoil);
  assert.ok(shell.position.equals(shellPosition));
  view.select("MG");
  assert.equal(shell.visible, false);
  assert.equal(part(view, "at-spent-case").visible, false);
  view.select("CANNON");
  view.update(1, 2.3, false, true, 0, 0);
  assert.ok(part(view, "at-breech-block").position.y < -0.6);
  view.update(0.1, 2.4, false, true, 1, 0);
  assert.equal(part(view, "at-breech-block").position.y, -0.32);
});

test("AT infinite-ammo shots still cycle the breech and return to ready", () => {
  const view = readyCannon();
  view.fire("CANNON");
  view.update(0.3, 1.3, false, true, 1, 0);
  assert.ok(part(view, "at-breech-block").position.y < -0.6);
  view.update(0.7, 2, false, true, 1, 0);
  assert.equal(part(view, "at-breech-block").position.y, -0.32);
});

function readyMG() {
  const view = new WeaponView();
  view.update(1, 1, false, true, 120, 0);
  return view;
}

function visibleParts(view, prefix, count) {
  return Array.from({ length: count }, (_, i) => part(view, `${prefix}-${i}`)).filter(mesh => mesh.visible);
}

test("unfired Browning has finite transforms, a stable belt, and one clear ADS aperture", () => {
  const view = readyMG();
  const beltPosition = part(view, "mg-belt-round-0").position.clone();
  view.update(10, 11, false, true, 120, 0);
  view.scene.updateMatrixWorld(true);
  view.scene.traverse(mesh => assert.ok(mesh.matrixWorld.elements.every(Number.isFinite), mesh.name));
  assert.ok(part(view, "mg-belt-round-0").position.equals(beltPosition));
  let sights = 0;
  view.scene.traverse(mesh => { if (mesh.name === "mg-sight") sights++; });
  assert.equal(sights, 1);
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(part(view, "mg-barrel-assembly").parent, true).length, 0);
});

test("Browning short barrel recoil leaves the jacket and ADS steady", () => {
  const view = readyMG();
  const jacket = part(view, "mg-barrel-jacket");
  const before = jacket.getWorldPosition(new THREE.Vector3());
  view.fire("MG");
  view.update(0.025, 1.025, false, true, 119, 0);
  assert.ok(part(view, "mg-barrel-assembly").position.z > 0.02);
  assert.ok(part(view, "mg-bolt").position.z > -0.97);
  assert.ok(jacket.getWorldPosition(new THREE.Vector3()).equals(before));
  view.update(0.2, 1.225, false, true, 119, 0);
  assert.equal(part(view, "mg-barrel-assembly").position.z, 0);
});

test("rapid Browning fire keeps separate falling cases and reset clears them", () => {
  const view = readyMG();
  for (let i = 0; i < 4; i++) {
    view.fire("MG");
    view.update(1 / 9, 1 + (i + 1) / 9, false, true, 119 - i, 0);
  }
  const cases = visibleParts(view, "mg-spent-case", 6);
  assert.ok(cases.length >= 3);
  assert.ok(cases.every(mesh => mesh.position.y < -0.65));
  const positions = cases.map(mesh => mesh.position.clone());
  view.update(0, 2, false, true, 116, 0);
  cases.forEach((mesh, i) => assert.ok(mesh.position.equals(positions[i])));
  view.update(0.5, 2.5, false, true, 116, 0);
  assert.equal(visibleParts(view, "mg-spent-case", 6).length, 0);
  view.fire("MG");
  view.update(0.05, 2.55, false, true, 115, 0);
  view.select("MG", true);
  assert.equal(visibleParts(view, "mg-spent-case", 6).length, 0);
});

test("Browning reload opens the cover, seats available rounds, charges, and cancels cleanly", () => {
  const view = readyMG();
  const mount = part(view, "mg-barrel-assembly").parent.parent;
  const readyPosition = mount.position.clone();
  view.update(0.1, 2, true, true, 0, 0.3, 3);
  assert.ok(mount.position.equals(readyPosition), "Reload stays visible in ADS");
  assert.ok(part(view, "mg-top-cover").rotation.x < -1);
  assert.equal(visibleParts(view, "mg-belt-round", 8).length, 0);
  view.update(0.1, 2.1, true, true, 0, 0.6, 3);
  assert.equal(visibleParts(view, "mg-belt-round", 8).length, 3);
  view.update(0.1, 2.2, true, true, 0, 0.88, 3);
  assert.ok(Math.abs(part(view, "mg-top-cover").rotation.x) < 1e-9);
  assert.ok(part(view, "mg-charging-handle").position.z > -0.82);
  view.select("BOFORS");
  view.select("MG");
  view.update(1, 3.2, false, true, 0, 0);
  assert.ok(Math.abs(part(view, "mg-top-cover").rotation.x) < 1e-9);
  assert.equal(part(view, "mg-charging-handle").position.z, -0.99);
  assert.equal(visibleParts(view, "mg-belt-round", 8).length, 0);
  view.update(0.1, 3.3, false, true, 2, 0);
  assert.equal(visibleParts(view, "mg-belt-round", 8).length, 2);
});

test("AT ADS stays elevated while Bofors ADS aligns through its ring sight", () => {
  for (const weapon of ["CANNON", "BOFORS"]) {
    const view = new WeaponView();
    view.select(weapon);
    view.update(1, 1, false, true, 1, 0);
    const model = weapon === "CANNON" ? part(view, "at-recoiling-assembly").parent : part(view, "bofors-sight").parent;
    const mount = model.parent;
    if (weapon === "CANNON") {
      assert.ok(mount.position.y <= -0.28);
      assert.equal(mount.position.z, -0.15);
      assert.ok(mount.rotation.x > 0);
    } else {
      assert.ok(mount.position.equals(new THREE.Vector3(0.22, 0.1, 0.25)));
      assert.equal(mount.rotation.x, 0);
      const sight = part(view, "bofors-sight").getWorldPosition(new THREE.Vector3());
      assert.equal(sight.x, 0);
      assert.equal(sight.y, 0);
    }
    view.scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    assert.equal(ray.intersectObject(model, true).length, 0);
    assert.ok(view.muzzleScreenPosition().y < 0);
  }
});
