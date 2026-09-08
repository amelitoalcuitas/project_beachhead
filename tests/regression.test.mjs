import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "../src/pc-shim/index.ts";
import * as pc from "playcanvas";
import { AIM_CONVERGENCE_DISTANCE, WeaponSystem } from "../src/gameplay/weapons.ts";
import { EffectsSystem } from "../src/rendering/effects.ts";
import { CANNON_MARK_LIFETIME, cannonImpactMarkApplies, cannonMarkOpacity, mgImpactSurface } from "../src/rendering/gun-effects.ts";
import { Game } from "../src/game/game.ts";

if (!globalThis.document) {
  globalThis.document = {
    createElement: (tag) => {
      if (tag === "canvas") {
        const canvas = {
          width: 0,
          height: 0,
          getContext: (type) => {
            if (type === "2d") {
              return {
                createRadialGradient: () => ({ addColorStop: () => {} }),
                beginPath: () => {},
                arc: () => {},
                fill: () => {},
                fillStyle: "",
              };
            }
            return null;
          },
        };
        return canvas;
      }
      return null;
    },
  };
}
if (!globalThis.innerWidth) globalThis.innerWidth = 1920;
if (!globalThis.innerHeight) globalThis.innerHeight = 1080;

test("native gun-effect routing limits persistent marks to grounded cannon rounds", () => {
  assert.equal(CANNON_MARK_LIFETIME, 15);
  assert.equal(cannonImpactMarkApplies("CANNON", { x: 0, y: 0, z: 0 }), true);
  assert.equal(cannonImpactMarkApplies("BOFORS", { x: 0, y: 0, z: 0 }), true);
  assert.equal(cannonImpactMarkApplies("MG", { x: 0, y: 0, z: 0 }), false);
  assert.equal(cannonImpactMarkApplies("CANNON", { x: 0, y: 50, z: 0 }), false);
  assert.equal(cannonMarkOpacity(15), 0.56);
  assert.equal(cannonMarkOpacity(7.5), 0.28);
  assert.equal(cannonMarkOpacity(0), 0);
});

test("native MG impacts select terrain, armor, and infantry responses", () => {
  assert.equal(mgImpactSurface(), "terrain");
  assert.equal(mgImpactSurface("tank"), "armor");
  assert.equal(mgImpactSurface("apc"), "armor");
  assert.equal(mgImpactSurface("infantry"), "infantry");
  assert.equal(mgImpactSurface("armoredInfantry"), "infantry");
});

test("WeaponSystem.resetState preserves weapon when keepWeapon is true", () => {
  const mockDeps = {
    session: {},
    camera: new THREE.PerspectiveCamera(),
    playerPosition: new THREE.Vector3(),
    lookDirection: new THREE.Vector3(),
    weaponView: { muzzleScreenPosition: () => new THREE.Vector2(0, 0) },
    screens: { message: () => {} },
    audio: { sound: () => {} },
    effects: null,
    projectiles: null,
    sphereGeometry: new THREE.SphereGeometry(1, 8, 6),
    projectileLayer: new THREE.Group(),
    isActive: () => true,
    setShake: () => {},
    getShake: () => 0,
    addShake: () => {},
  };
  const system = new WeaponSystem(mockDeps);
  system.weapon = "CANNON";
  system.reload = 0.5;
  system.cooldown = 0.2;
  system.spreadHeat = 0.8;
  system.resetState(true);
  assert.equal(system.weapon, "CANNON");
  assert.equal(system.reload, 0);
  assert.equal(system.cooldown, 0);
  assert.equal(system.spreadHeat, 0);
  system.resetState();
  assert.equal(system.weapon, "MG");
});

test("player rounds converge from the visible muzzle onto the camera crosshair", () => {
  for (const weapon of ["MG", "CANNON", "BOFORS"]) {
  for (const pitch of [-35, -20, 0, 30, 85]) {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1400);
  camera.position.set(4, 7, 18);
  camera.rotation.set(pitch * Math.PI / 180, 0.7, 0, "YXZ");
  const playerPosition = camera.position.clone();
  let shot;
  const system = new WeaponSystem({
    session: { state: "combat", infiniteAmmo: true },
    camera,
    playerPosition,
    lookDirection: new THREE.Vector3(),
    weaponView: {
      muzzleScreenPosition: () => new THREE.Vector2(0.22, -0.31),
      fire: () => {},
    },
    screens: { message: () => {} },
    audio: { sound: () => {} },
    effects: {
      addMuzzleSmoke: () => {},
      startMuzzleSmokeTrail: () => {},
      addMuzzleFlash: () => {},
    },
    projectiles: { addShot: (nextShot) => { shot = nextShot; } },
    sphereGeometry: new THREE.SphereGeometry(1, 8, 6),
    projectileLayer: new THREE.Group(),
    isActive: () => true,
    setShake: () => {},
    getShake: () => 0,
    addShake: () => {},
  });
  system.weapon = weapon;
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try { system.fire(); } finally { Math.random = originalRandom; }

  assert.ok(shot);
  // Use the renderer's engine as the reference, not the aiming helper under test.
  const renderedCamera = new pc.GraphNode();
  renderedCamera.setEulerAngles(pitch, 0.7 * 180 / Math.PI, 0);
  const crosshairDirection = renderedCamera.forward;
  const crosshairPoint = playerPosition.clone()
    .addScaledVector(crosshairDirection, AIM_CONVERGENCE_DISTANCE);
  const projectileDirection = shot.velocity.clone().normalize();
  const travelled = crosshairPoint.distanceTo(shot.mesh.position);
  const arrived = shot.mesh.position.clone().addScaledVector(projectileDirection, travelled);
  assert.ok(arrived.distanceTo(crosshairPoint) < 1e-4, `${weapon} at pitch ${pitch}`);
  }
  }
});

test("player rounds use the crosshair hit distance when one is available", () => {
  const camera = new THREE.PerspectiveCamera();
  const playerPosition = new THREE.Vector3(0, 7, 18);
  camera.position.copy(playerPosition);
  let shot;
  const system = new WeaponSystem({
    session: { state: "combat", infiniteAmmo: true },
    camera,
    playerPosition,
    lookDirection: new THREE.Vector3(),
    weaponView: {
      muzzleScreenPosition: () => new THREE.Vector2(0.2, -0.2),
      fire: () => {},
    },
    screens: { message: () => {} },
    audio: { sound: () => {} },
    effects: {
      addMuzzleSmoke: () => {},
      startMuzzleSmokeTrail: () => {},
      addMuzzleFlash: () => {},
    },
    projectiles: { addShot: (nextShot) => { shot = nextShot; } },
    sphereGeometry: new THREE.SphereGeometry(),
    projectileLayer: new THREE.Group(),
    isActive: () => true,
    setShake: () => {},
    getShake: () => 0,
    addShake: () => {},
    aimDistance: () => 42,
  });
  system.weapon = "CANNON";
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try { system.fire(); } finally { Math.random = originalRandom; }

  const crosshairPoint = playerPosition.clone().add(new THREE.Vector3(0, 0, -42));
  const projectileDirection = shot.velocity.clone().normalize();
  const travelled = crosshairPoint.distanceTo(shot.mesh.position);
  const arrived = shot.mesh.position.clone().addScaledVector(projectileDirection, travelled);
  assert.ok(arrived.distanceTo(crosshairPoint) < 1e-9);
});

test("EffectsSystem.clear removes and disposes scorch marks", () => {
  const mockDeps = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    effectLayer: new THREE.Group(),
    smokeLayer: new THREE.Group(),
    playerPosition: new THREE.Vector3(),
    audio: { sound: () => {} },
    muzzlePan: () => 0,
    muzzleOrigin: () => new THREE.Vector3(),
    muzzleOffsetForWeapon: () => 0,
    addShake: () => {},
  };
  const sphereGeometry = new THREE.SphereGeometry(1, 8, 6);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const effects = new EffectsSystem(mockDeps, sphereGeometry, boxGeometry);

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  effects.deps.effectLayer.add(mesh);
  effects.scorchMarks.push({ mesh, life: 5, maxLife: 5 });

  assert.equal(effects.scorchMarks.length, 1);
  assert.equal(effects.deps.effectLayer.children.length, 1);

  let geometryDisposeCount = 0;
  let materialDisposeCount = 0;
  mesh.geometry.addEventListener("dispose", () => geometryDisposeCount++);
  mesh.material.addEventListener("dispose", () => materialDisposeCount++);

  effects.clear();

  assert.equal(effects.scorchMarks.length, 0);
  assert.equal(effects.deps.effectLayer.children.length, 0);
  assert.equal(geometryDisposeCount, 1);
  assert.equal(materialDisposeCount, 1);
  assert.strictEqual(mesh.parent, null);

  effects.clear();
  assert.equal(effects.scorchMarks.length, 0);
  assert.equal(effects.deps.effectLayer.children.length, 0);
  assert.equal(geometryDisposeCount, 1);
  assert.equal(materialDisposeCount, 1);
});

test("muzzle smoke gets a valid camera-relative drift axis before the first render", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.y = Math.PI / 3;
  const effects = new EffectsSystem({
    scene: new THREE.Scene(),
    camera,
    effectLayer: new THREE.Group(),
    smokeLayer: new THREE.Group(),
    playerPosition: new THREE.Vector3(),
    audio: { sound: () => {} },
    muzzlePan: () => 0,
    muzzleOrigin: () => new THREE.Vector3(),
    muzzleOffsetForWeapon: () => 3,
    addShake: () => {},
  }, new THREE.SphereGeometry(), new THREE.BoxGeometry());

  effects.startMuzzleSmokeTrail(new THREE.Vector3(), "MG");
  assert.ok(Math.abs(effects.muzzleSmokeTrail.driftAxis.length() - 1) < 1e-9);
  assert.ok(effects.muzzleSmokeTrail.driftAxis.x > 0);
  assert.ok(effects.muzzleSmokeTrail.driftAxis.z < 0);
});

test("Game wave-change preserves weapon and pause state", () => {
  const app = { innerHTML: "", querySelector: () => null };
  const origPointer = globalThis.PointerLockControls;
  const origQS = document.querySelector;

  // Create a mock renderer with just enough surface to satisfy Game.
  const mockRenderer = {
    setSize: () => {},
    setPixelRatio: () => {},
    render: () => {},
    clearDepth: () => {},
    domElement: document.createElement("canvas"),
    shadowMap: { enabled: false, type: 0 },
    outputColorSpace: "",
    toneMapping: 0,
    toneMappingExposure: 1,
    autoClear: true,
  };

  try {
    // Mock PointerLockControls.
    globalThis.PointerLockControls = class {
      lock() {}
      isLocked = false;
    };
    // Mock DOM selectors.
    document.querySelector = (sel) => {
      if (sel === "#overlay") {
        return { style: {}, appendChild: () => {}, querySelector: () => null };
      }
      if (sel === "#targetInfo") return { textContent: "" };
      return null;
    };

    // Instantiate Game with the mock renderer.
    const game = new Game(app, mockRenderer);
    game.beginWaveRun = () => {};

    // --- AT gun ---
    game.weaponSystem.weapon = "CANNON";
    game.jumpToWave("5");
    assert.equal(game.weaponSystem.weapon, "CANNON", "AT gun should persist across wave change");
    assert.equal(game.weaponView["current"], "CANNON", "WeaponView should sync to AT gun");

    // --- Pause state ---
    game.session.state = "paused";
    game.jumpToWave("6");
    assert.equal(game.session.state, "paused", "Pause state should be preserved across wave change");

    // --- Bofors ---
    game.weaponSystem.weapon = "BOFORS";
    game.jumpToWave("7");
    assert.equal(game.weaponSystem.weapon, "BOFORS", "Bofors should persist across wave change");
    assert.equal(game.weaponView["current"], "BOFORS", "WeaponView should sync to Bofors");

    // --- Full reset ---
    game.reset();
    assert.equal(game.weaponSystem.weapon, "MG", "Full reset should revert to MG");
    assert.equal(game.weaponView["current"], "MG", "WeaponView should sync to MG after reset");

    // --- Verify renderer was indeed used ---
    // (The mock renderer's methods would have been called during the test if the Game actually used it.)
    // As a sanity check, we can assert the renderer reference is the mock.
    assert.strictEqual(game["renderer"], mockRenderer, "Game should use the provided mock renderer");
  } finally {
    globalThis.PointerLockControls = origPointer;
    document.querySelector = origQS;
  }
});
