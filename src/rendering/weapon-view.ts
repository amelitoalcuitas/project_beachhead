import * as THREE from "../pc-shim/index.ts";
import type { Weapon } from "../types.ts";
import { createBarrelJacket } from "./weapon-geometry.ts";

export class WeaponView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(
    60,
    innerWidth / innerHeight,
    0.05,
    20,
  );
  private mount = new THREE.Group();
  private models = new Map<Weapon, THREE.Group>();
  private flash: THREE.Mesh;
  private recoil = 0;
  private flashTime = 0;
  private swap = 0;
  private current: Weapon = "MG";
  private cannonRecoiling = new THREE.Group();
  private cannonBreech = new THREE.Group();
  private cannonHandle = new THREE.Group();
  private cannonLoadingRound = new THREE.Group();
  private cannonSpentCase = new THREE.Group();
  private cannonShotTime = Infinity;
  private boforsBarrel = new THREE.Group();
  private boforsClip = new THREE.Group();
  private boforsRounds: THREE.Group[] = [];
  private mgBarrelGroup = new THREE.Group();
  private mgBolt = new THREE.Group();
  private mgChargingHandle = new THREE.Group();
  private mgAmmoBox = new THREE.Group();
  private mgTopCover = new THREE.Group();
  private mgSpentCases: { mesh: THREE.Group; age: number }[] = [];
  private mgCaseIndex = 0;
  private mgShotTime = Infinity;
  private mgBeltRounds: THREE.Group[] = [];
  private readonly hipPositions: Record<Weapon, THREE.Vector3> = {
    MG: new THREE.Vector3(0.3, -0.1, 0),
    CANNON: new THREE.Vector3(0.42, -0.8, -0.65),
    BOFORS: new THREE.Vector3(0.55, -0.4, -0.3),
  };
  private readonly aimPositions: Record<Weapon, THREE.Vector3> = {
    MG: new THREE.Vector3(0.12, -0.19, -0.6),
    CANNON: new THREE.Vector3(0.12, 0.32, -1.45),
    BOFORS: new THREE.Vector3(-0.22, -0.1, -1.6),
  };
  private readonly muzzlePositions: Record<Weapon, THREE.Vector3> = {
    MG: new THREE.Vector3(0.12, -0.48, -2.981),
    CANNON: new THREE.Vector3(0.12, -0.32, -4.058),
    BOFORS: new THREE.Vector3(0.12, -0.32, -3.809),
  };

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xffe8c3, 0x566777, 2.5));
    const light = new THREE.DirectionalLight(0xffda9a, 3);
    light.position.set(-2, 4, 1);
    this.scene.add(light, this.mount);
    const steel = new THREE.MeshStandardMaterial({
      color: 0x657078,
      metalness: 0.25,
      roughness: 0.36,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x161d22,
      metalness: 0.2,
      roughness: 0.45,
    });
    const olive = new THREE.MeshStandardMaterial({
      color: 0x697052,
      metalness: 0.15,
      roughness: 0.64,
    });
    const brass = new THREE.MeshStandardMaterial({
      color: 0xbf9143,
      metalness: 0.4,
      roughness: 0.3,
    });
    const part = (
      group: THREE.Group,
      size: number[],
      at: number[],
      material: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...(size as [number, number, number])),
        material,
      );
      mesh.position.set(...(at as [number, number, number]));
      group.add(mesh);
      return mesh;
    };
    const barrel = (
      group: THREE.Group,
      radius: number,
      length: number,
      x: number,
      y: number,
      z: number,
      material: THREE.Material,
    ) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, length, 20),
        material,
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    for (const name of ["MG", "CANNON", "BOFORS"] as const) {
      const model = new THREE.Group();
      model.userData.skipRaycast = true;
      if (name === "MG") {
        this.mgBarrelGroup.name = "mg-barrel-assembly";
        this.mgBolt.name = "mg-bolt";
        this.mgChargingHandle.name = "mg-charging-handle";
        this.mgAmmoBox.name = "mg-ammo-box";
        this.mgTopCover.name = "mg-top-cover";
        model.add(this.mgBarrelGroup, this.mgBolt, this.mgChargingHandle, this.mgAmmoBox, this.mgTopCover);

        // Riveted receiver plates leave the feed tray and bottom ejection port open.
        part(model, [0.025, 0.23, 0.85], [-0.06, -0.505, -0.9], steel);
        part(model, [0.025, 0.28, 0.85], [0.3, -0.48, -0.9], steel);
        part(model, [0.36, 0.025, 0.34], [0.12, -0.63, -1.14], dark);
        part(model, [0.36, 0.025, 0.17], [0.12, -0.63, -0.56], dark);
        part(model, [0.36, 0.28, 0.055], [0.12, -0.48, -0.45], steel);
        part(model, [0.29, 0.018, 0.22], [0.12, -0.365, -1.0], dark);
        for (const side of [-1, 1]) {
          for (const z of [-1.24, -1.06, -0.72, -0.53]) {
            const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), dark);
            rivet.position.set(0.12 + side * 0.194, -0.54, z);
            model.add(rivet);
          }
        }
        this.mgTopCover.position.set(0.12, -0.29, -1.31);
        part(this.mgTopCover, [0.37, 0.035, 0.82], [0, 0, 0.41], dark);
        part(this.mgTopCover, [0.25, 0.016, 0.6], [0, 0.024, 0.4], steel);
        part(this.mgTopCover, [0.08, 0.035, 0.07], [0, 0.026, 0.77], dark);

        const jacket = new THREE.Mesh(createBarrelJacket(), steel);
        jacket.name = "mg-barrel-jacket";
        jacket.position.set(0.12, -0.48, -1.38);
        model.add(jacket);
        barrel(this.mgBarrelGroup, 0.041, 1.61, 0.12, -0.48, -2.17, dark);
        barrel(model, 0.097, 0.075, 0.12, -0.48, -1.38, dark);
        barrel(model, 0.092, 0.075, 0.12, -0.48, -2.83, dark);
        barrel(this.mgBarrelGroup, 0.055, 0.105, 0.12, -0.48, -2.92, steel);
        barrel(this.mgBarrelGroup, 0.032, 0.006, 0.12, -0.48, -2.978, dark);

        // The A4 uses a rear pistol grip and tripod, rather than A6 carrying handle/bipod.
        const grip = part(model, [0.105, 0.29, 0.13], [0.12, -0.69, -0.39], dark);
        grip.rotation.x = -0.16;
        part(model, [0.025, 0.075, 0.04], [0.12, -0.61, -0.53], steel);
        part(model, [0.12, 0.025, 0.18], [0.12, -0.69, -0.5], dark);
        this.mgChargingHandle.position.set(0.34, -0.45, -0.99);
        part(model, [0.018, 0.045, 0.36], [0.316, -0.45, -0.9], dark);
        part(this.mgChargingHandle, [0.11, 0.035, 0.035], [0.035, 0, 0], steel);
        part(this.mgChargingHandle, [0.04, 0.075, 0.045], [0.1, 0, 0], dark);
        this.mgBolt.position.set(0.12, -0.475, -0.97);
        part(this.mgBolt, [0.25, 0.19, 0.3], [0, 0, 0], steel);
        part(this.mgBolt, [0.09, 0.025, 0.16], [0, 0.105, 0], dark);

        this.mgAmmoBox.position.set(-0.43, -0.59, -0.95);
        part(this.mgAmmoBox, [0.25, 0.28, 0.32], [0, 0, 0], olive);
        part(this.mgAmmoBox, [0.27, 0.025, 0.34], [0, 0.15, 0], dark);
        part(this.mgAmmoBox, [0.14, 0.025, 0.025], [0, 0.185, 0.11], steel);
        const beltFabric = new THREE.MeshStandardMaterial({color: 0x71654c, roughness: 0.95});
        for (let i = 0; i < 8; i++) {
          const round = new THREE.Group();
          round.name = `mg-belt-round-${i}`;
          barrel(round, 0.018, 0.12, 0, 0, 0, brass);
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.055, 10), steel);
          tip.rotation.x = -Math.PI / 2;
          tip.position.z = -0.0875;
          round.add(tip);
          part(round, [0.045, 0.03, 0.035], [0, -0.006, 0.027], beltFabric);
          model.add(round);
          this.mgBeltRounds.push(round);
        }
        // A small pool lets successive bottom-ejected cases finish their trajectories.
        for (let i = 0; i < 6; i++) {
          const casing = new THREE.Group();
          casing.name = `mg-spent-case-${i}`;
          barrel(casing, 0.018, 0.07, 0, 0, 0, brass);
          barrel(casing, 0.021, 0.008, 0, 0, 0.036, brass);
          casing.visible = false;
          model.add(casing);
          this.mgSpentCases.push({mesh: casing, age: Infinity});
        }

        part(model, [0.18, 0.09, 0.23], [0.12, -0.71, -1.15], olive);
        const pintle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.25, 12), steel);
        pintle.position.set(0.12, -0.85, -1.15);
        model.add(pintle);
        for (const [x, z, tilt] of [[-0.17, -0.8, -0.55], [0.41, -0.8, 0.55], [0.12, -1.53, 0]]) {
          const leg = part(model, [0.055, 0.42, 0.07], [x, -1.07, z], olive);
          leg.rotation.z = tilt;
          if (tilt === 0) leg.rotation.x = -0.6;
        }
        // One receiver-mounted rear peep and front blade share the ADS axis.
        const rearSight = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 20), dark);
        rearSight.name = "mg-sight";
        rearSight.position.copy(this.aimPositions.MG);
        model.add(rearSight);
        for (const x of [0.08, 0.16])
          part(model, [0.012, 0.08, 0.022], [x, -0.222, -0.6], steel);
        part(model, [0.09, 0.018, 0.035], [0.12, -0.265, -0.6], dark);
        part(model, [0.018, 0.09, 0.025], [0.12, -0.251, -1.3], dark);
        for (const x of [0.079, 0.161])
          part(model, [0.014, 0.095, 0.025], [x, -0.247, -1.3], steel);
      } else if (name === "CANNON") {
        // M1: plain muzzle, hydro-spring recoil cradle and vertical sliding breech.
        this.cannonRecoiling.name = "at-recoiling-assembly";
        this.cannonBreech.name = "at-breech-block";
        this.cannonLoadingRound.name = "at-loading-round";
        this.cannonSpentCase.name = "at-spent-case";
        model.add(this.cannonRecoiling, this.cannonLoadingRound, this.cannonSpentCase);
        const tube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.062, 0.108, 2.8, 24), olive,
        );
        tube.rotation.x = -Math.PI / 2;
        tube.position.set(0.12, -0.32, -2.65);
        this.cannonRecoiling.add(tube);
        barrel(this.cannonRecoiling, 0.045, 0.008, 0.12, -0.32, -4.054, dark);
        barrel(this.cannonRecoiling, 0.13, 0.5, 0.12, -0.32, -1.32, steel);
        barrel(model, 0.105, 1.4, 0.12, -0.57, -1.8, olive);
        barrel(this.cannonRecoiling, 0.045, 0.8, 0.12, -0.57, -1.2, steel);
        for (const x of [-0.13, 0.37]) {
          part(model, [0.1, 0.32, 0.9], [x, -0.57, -1.4], olive);
          part(model, [0.055, 0.045, 1.05], [x, -0.38, -1.4], steel);
        }
        // Separate cheeks leave a real chamber opening when the wedge drops.
        for (const x of [-0.07, 0.31])
          part(this.cannonRecoiling, [0.11, 0.38, 0.47], [x, -0.32, -0.92], steel);
        part(this.cannonRecoiling, [0.48, 0.065, 0.47], [0.12, -0.1, -0.92], olive);
        barrel(this.cannonRecoiling, 0.086, 0.018, 0.12, -0.32, -1.145, dark);
        this.cannonBreech.position.set(0.12, -0.32, -0.81);
        part(this.cannonBreech, [0.27, 0.31, 0.18], [0, 0, 0], steel);
        part(this.cannonBreech, [0.11, 0.13, 0.025], [0, 0, 0.1], dark);
        this.cannonRecoiling.add(this.cannonBreech);
        this.cannonHandle.position.set(0.4, -0.27, -0.86);
        part(this.cannonHandle, [0.045, 0.25, 0.04], [0, -0.1, 0], steel);
        part(this.cannonHandle, [0.12, 0.05, 0.06], [0.04, -0.22, 0], dark);
        this.cannonRecoiling.add(this.cannonHandle);

        const shield = new THREE.Shape();
        shield.moveTo(-0.98, -1.02);
        shield.lineTo(1.22, -1.02);
        shield.lineTo(1.22, -0.07);
        for (let i = 0; i < 8; i++) {
          const x = 1.22 - i * 0.275;
          shield.bezierCurveTo(x - 0.04, -0.07, x - 0.04, 0.035, x - 0.1375, 0.035);
          shield.bezierCurveTo(x - 0.235, 0.035, x - 0.235, -0.07, x - 0.275, -0.07);
        }
        shield.closePath();
        const barrelOpening = new THREE.Path();
        barrelOpening.absellipse(0.12, -0.38, 0.22, 0.33, 0, Math.PI * 2, true);
        shield.holes.push(barrelOpening);
        const shieldMesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(shield, {depth: 0.045, bevelEnabled: false, curveSegments: 6}), olive,
        );
        shieldMesh.position.z = -2.25;
        model.add(shieldMesh);
        for (const x of [-0.78, 1.02]) {
          part(model, [0.05, 0.7, 0.045], [x, -0.5, -2.18], steel);
          for (const y of [-0.2, -0.45, -0.7, -0.9])
            barrel(model, 0.018, 0.025, x, y, -2.135, steel);
        }
        part(model, [1.6, 0.15, 0.18], [0.12, -1.02, -1.75], olive);
        for (const side of [-1, 1]) {
          const wheel = new THREE.Group();
          wheel.position.set(0.12 + side * 0.92, -1.05, -1.75);
          wheel.rotation.y = Math.PI / 2;
          const tire = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.1, 10, 32), dark);
          wheel.add(tire);
          barrel(wheel, 0.27, 0.12, 0, 0, 0, olive);
          barrel(wheel, 0.095, 0.18, 0, 0, 0, steel);
          for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3;
            barrel(wheel, 0.035, 0.015, Math.cos(angle) * 0.18, Math.sin(angle) * 0.18, 0.07, dark);
          }
          model.add(wheel);
          const trail = part(model, [0.13, 0.14, 1.7], [0.12 + side * 0.58, -1.15, -0.3], olive);
          trail.rotation.y = side * 0.32;
          part(model, [0.3, 0.3, 0.09], [0.12 + side * 0.84, -1.22, 0.49], steel);
        }
        const elevationWheel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.019, 8, 24), dark);
        elevationWheel.position.set(-0.42, -0.51, -1.0);
        model.add(elevationWheel);
        for (const angle of [0, Math.PI / 2]) {
          const spoke = part(model, [0.29, 0.019, 0.025], [-0.42, -0.51, -1.0], steel);
          spoke.rotation.z = angle;
        }
        part(model, [0.045, 0.07, 0.1], [-0.56, -0.51, -0.95], dark);
        part(model, [0.08, 0.08, 0.55], [-0.34, -0.51, -0.58], olive);
        part(model, [0.18, 0.26, 0.09], [-0.34, -0.51, -0.28], dark);

        for (const shell of [this.cannonLoadingRound, this.cannonSpentCase]) {
          barrel(shell, 0.055, 0.32, 0, 0, 0, brass);
          barrel(shell, 0.066, 0.018, 0, 0, 0.165, brass);
          shell.visible = false;
        }
        const projectile = new THREE.Mesh(new THREE.ConeGeometry(0.054, 0.14, 16), dark);
        projectile.rotation.x = -Math.PI / 2;
        projectile.position.z = -0.23;
        this.cannonLoadingRound.add(projectile);
      } else {
        // The top feed and recoil cradle distinguish the L/60 from the AT gun.
        part(model, [0.6, 0.42, 1.05], [0.12, -0.54, -1.12], olive);
        part(model, [0.38, 0.32, 0.7], [0.12, -0.35, -1.0], steel);
        part(model, [0.7, 0.12, 0.9], [0.12, -0.79, -1.2], dark);
        part(model, [0.26, 0.6, 0.32], [0.12, -1.08, -1.12], olive);
        part(model, [1.25, 0.12, 0.95], [0.12, -1.4, -1.12], olive);
        model.add(this.boforsBarrel);
        barrel(this.boforsBarrel, 0.065, 2.5, 0.12, -0.32, -2.5, steel);
        barrel(this.boforsBarrel, 0.105, 0.85, 0.12, -0.32, -1.65, olive);
        barrel(this.boforsBarrel, 0.082, 0.1, 0.12, -0.32, -3.75, steel);
        barrel(this.boforsBarrel, 0.052, 0.008, 0.12, -0.32, -3.805, dark);
        for (const x of [-0.14, 0.38]) {
          barrel(model, 0.055, 1.05, x, -0.49, -1.65, dark);
          part(model, [0.08, 0.38, 0.48], [x, -0.73, -1.3], olive);
        }
        for (const x of [-0.4, 0.64]) {
          const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 24), dark);
          wheel.position.set(x, -0.58, -0.85);
          model.add(wheel);
          part(model, [0.3, 0.025, 0.025], [x, -0.58, -0.85], steel);
          part(model, [0.025, 0.3, 0.025], [x, -0.58, -0.85], steel);
        }
        part(model, [0.28, 0.14, 0.4], [0.12, -0.14, -1.04], dark);
        this.boforsClip.position.set(0.12, -0.08, -1.04);
        model.add(this.boforsClip);
        for (let i = 0; i < 4; i++) {
          const round = new THREE.Group();
          // Rounds lie parallel to the barrel and feed down from the clip.
          round.position.set(0, 0.055 + i * 0.078, 0.14);
          round.rotation.x = -Math.PI / 2;
          const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.22, 12), brass);
          casing.position.y = 0.11;
          const tip = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.09, 12), steel);
          tip.position.y = 0.265;
          round.add(casing, tip);
          this.boforsClip.add(round);
          this.boforsRounds.push(round);
        }
        part(this.boforsClip, [0.12, 0.025, 0.34], [0, 0.005, -0.015], steel);
        for (const x of [-0.052, 0.052])
          part(this.boforsClip, [0.015, 0.34, 0.045], [x, 0.17, 0.13], steel);
      }
      if (name === "BOFORS") {
        const sightRadius = name === "BOFORS" ? 0.16 : 0.082;
        const sight = new THREE.Mesh(
          new THREE.TorusGeometry(sightRadius, 0.012, 8, 32),
          steel,
        );
        sight.name = `${name.toLowerCase()}-sight`;
        sight.position.copy(this.aimPositions[name]);
        model.add(sight);
        const sightSupportHeight = 0.26;
        part(model, [0.025, sightSupportHeight, 0.025], [
          sight.position.x,
          sight.position.y - sightRadius - sightSupportHeight / 2,
          sight.position.z,
        ], dark);
      }
      model.visible = name === "MG";
      this.mount.add(model);
      this.models.set(name, model);
    }
    // Anchor the base at the opening; spin around the bore without tilting the flame.
    const flashGeometry = new THREE.ConeGeometry(0.09, 0.5, 10);
    flashGeometry.translate(0, 0.25, 0);
    flashGeometry.rotateX(-Math.PI / 2);
    this.flash = new THREE.Mesh(
      flashGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffd077,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flash.name = "weapon-muzzle-flash";
    this.flash.position.copy(this.muzzlePositions.MG);
    this.flash.visible = false;
    this.mount.add(this.flash);
  }
  select(name: Weapon, reset = false) {
    if (name === this.current && !reset) return;
    this.current = name;
    this.recoil = 0;
    this.mgCaseIndex = 0;
    this.cannonShotTime = Infinity;
    this.cannonSpentCase.visible = false;
    this.cannonLoadingRound.visible = false;
    this.mgShotTime = Infinity;
    this.mgSpentCases.forEach(casing => { casing.mesh.visible = false; casing.age = Infinity; });
    this.flashTime = 0;
    this.flash.position.copy(this.muzzlePositions[name]);
    this.swap = reset ? 0 : 0.4;
    this.models.forEach((model, key) => (model.visible = key === name));
  }
  fire(weapon: Weapon) {
    if (weapon === "CANNON") this.cannonShotTime = 0;
    if (weapon === "MG") {
      this.mgShotTime = 0;
      this.mgSpentCases[this.mgCaseIndex].age = -0.035;
      this.mgCaseIndex = (this.mgCaseIndex + 1) % this.mgSpentCases.length;
    }
    this.recoil = weapon === "MG" ? 0.06 : weapon === "CANNON" ? 0.25 : 0.12;
    this.flashTime = weapon === "MG" ? 0.045 : weapon === "CANNON" ? 0.085 : 0.065;
    const flashScale = weapon === "MG" ? 0.7 : weapon === "CANNON" ? 1.05 : 0.85;
    this.flash.scale.setScalar(flashScale);
    const flashColor =
      weapon === "MG" ? 0xffd47d : weapon === "CANNON" ? 0xffb45d : 0xffc069;
    (this.flash.material as THREE.MeshBasicMaterial).color.setHex(flashColor);
    this.flash.rotation.z = Math.random() * Math.PI * 2;
  }
  muzzleScreenPosition() {
    this.scene.updateMatrixWorld(true);
    return this.flash.getWorldPosition(new THREE.Vector3()).project(this.camera);
  }
  muzzleViewPose() {
    this.scene.updateMatrixWorld(true);
    const position = this.flash.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), this.mount.rotation.x)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mount.rotation.y)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), this.mount.rotation.z)
      .normalize();
    return { position, direction };
  }
  update(
    dt: number,
    time: number,
    reloading: boolean,
    zoom: boolean,
    magazine: number,
    reloadProgress: number,
    reloadMagazine = magazine,
  ) {
    this.recoil *= Math.exp(-dt * 18);
    this.flashTime -= dt;
    this.swap = Math.max(0, this.swap - dt);
    const aimPosition = this.aimPositions[this.current];
    // Raise AT gun ADS above the receiver; align the other weapons through their sights.
    const isCannon = this.current === "CANNON";
    const isCannonAds = zoom && isCannon;
    const tiltForReload = reloading && this.current === "BOFORS";
    const hipPosition = this.hipPositions[this.current];
    const viewPitch = isCannonAds ? 0.1 : 0;
    this.mount.position.set(
      zoom ? -aimPosition.x : hipPosition.x,
      (zoom ? -aimPosition.y : hipPosition.y) +
        (tiltForReload ? -0.25 : 0) -
        this.swap * 0.7 +
        (zoom ? 0 : Math.sin(time * 1.8) * 0.006),
      (zoom ? (isCannon ? -0.15 : this.current === "BOFORS" ? 0.25 : 0.05) : hipPosition.z) + (this.current === "MG" && !zoom ? this.recoil * 0.3 : 0),
    );
    this.mount.rotation.set(viewPitch + (tiltForReload ? -0.2 : 0), 0, tiltForReload ? -0.1 : 0);
    if (!zoom && this.current !== "MG" && !tiltForReload) this.alignHipBarrel();
    if (isCannon) this.updateCannon(dt, reloading, magazine, reloadProgress);
    if (this.current === "MG") this.updateMG(dt, reloading, magazine, reloadProgress, reloadMagazine);
    this.boforsBarrel.position.z = this.recoil;
    this.boforsClip.position.y = -0.08 + (reloading ? Math.sin(reloadProgress * Math.PI) * 0.45 : 0);
    this.boforsRounds.forEach((round, i) => {
      round.visible = i < (reloading && reloadProgress > 0.5 ? reloadMagazine : magazine);
    });
    this.flash.position.copy(this.muzzlePositions[this.current]);
    if (this.current === "BOFORS") this.flash.position.z += this.recoil;
    if (isCannon) this.flash.position.z += this.cannonRecoiling.position.z;
    if (this.current === "MG") this.flash.position.z += this.mgBarrelGroup.position.z;
    // The hidden mesh is only a muzzle anchor. GunEffectsSystem renders the
    // visible flash natively in PlayCanvas's weapon overlay layer.
    this.flash.visible = false;
  }
  private alignHipBarrel() {
    // Aim the actual bore, rather than the model origin, at the reticle in
    // the separate weapon camera. Both yaw and pitch must account for its offset.
    const convergenceDepth = 8;
    const bore = this.muzzlePositions[this.current];
    const dx = -this.mount.position.x;
    const dy = -this.mount.position.y;
    const dz = -convergenceDepth - this.mount.position.z;
    const yaw = Math.atan2(-dx, -dz) + Math.asin(bore.x / Math.hypot(dx, dz));
    const localZ = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
    const pitch = Math.atan2(dy, -localZ) - Math.asin(bore.y / Math.hypot(dy, localZ));
    this.mount.rotation.set(pitch, yaw, 0, "YXZ");
  }
  private updateMG(dt: number, reloading: boolean, magazine: number, reloadProgress: number, reloadMagazine: number) {
    this.mgShotTime += dt;
    // Idle uses Infinity as a sentinel; never feed it into trigonometry or transforms.
    const shotTime = Number.isFinite(this.mgShotTime) ? this.mgShotTime : 1;
    const barrelRecoil = shotTime < 0.025
      ? 0.022 * THREE.MathUtils.smoothstep(shotTime, 0, 0.025)
      : 0.022 * (1 - THREE.MathUtils.smoothstep(shotTime, 0.025, 0.095));
    this.mgBarrelGroup.position.z = barrelRecoil;
    const boltTravel = shotTime < 0.045
      ? 0.13 * THREE.MathUtils.smoothstep(shotTime, 0.012, 0.045)
      : 0.13 * (1 - THREE.MathUtils.smoothstep(shotTime, 0.045, 0.105));
    this.mgBolt.position.z = -0.97 + boltTravel;
    this.mgChargingHandle.position.z = -0.99 + boltTravel;

    for (const casing of this.mgSpentCases) {
      casing.age += dt;
      casing.mesh.visible = casing.age >= 0 && casing.age < 0.4;
      if (!casing.mesh.visible) continue;
      const age = casing.age;
      casing.mesh.position.set(0.12 + age * 0.2, -0.65 - age * 0.8 - 3 * age ** 2, -0.83 + age * 0.25);
      casing.mesh.rotation.set(age * 5, age * 3, age * 7);
    }

    const opening = reloading ? THREE.MathUtils.smoothstep(reloadProgress, 0, 0.18) : 0;
    const closing = reloading ? THREE.MathUtils.smoothstep(reloadProgress, 0.65, 0.79) : 0;
    this.mgTopCover.rotation.x = -1.3 * opening * (1 - closing);
    const boxOut = reloading ? THREE.MathUtils.smoothstep(reloadProgress, 0.18, 0.34) : 0;
    const boxIn = reloading ? THREE.MathUtils.smoothstep(reloadProgress, 0.38, 0.55) : 0;
    this.mgAmmoBox.position.set(-0.43 - (boxOut - boxIn) * 0.12, -0.59 - (boxOut - boxIn) * 0.45, -0.95);
    if (reloading) {
      const charge = THREE.MathUtils.smoothstep(reloadProgress, 0.81, 0.88)
        * (1 - THREE.MathUtils.smoothstep(reloadProgress, 0.9, 0.98));
      this.mgChargingHandle.position.z = -0.99 + charge * 0.18;
      this.mgBolt.position.z = -0.97 + charge * 0.18;
    }

    const feed = reloading ? 0 : THREE.MathUtils.smoothstep(shotTime, 0.018, 0.055)
      * (1 - THREE.MathUtils.smoothstep(shotTime, 0.07, 0.11));
    const newBelt = reloading && reloadProgress >= 0.42;
    const beltRounds = newBelt ? reloadMagazine : magazine;
    const layingBelt = newBelt ? 1 - THREE.MathUtils.smoothstep(reloadProgress, 0.42, 0.62) : 0;
    this.mgBeltRounds.forEach((round, i) => {
      round.position.set(-0.08 - i * 0.045 + feed * 0.045, -0.335 - Math.sin(i / 7 * Math.PI / 2) * 0.1 + layingBelt * 0.18, -0.95);
      round.visible = i < beltRounds && (!reloading || reloadProgress < 0.18 || newBelt);
    });
  }
  private updateCannon(dt: number, reloading: boolean, magazine: number, reloadProgress: number) {
    this.cannonShotTime += dt;
    const shotTime = this.cannonShotTime;
    const recoil = shotTime < 0.055
      ? 0.3 * THREE.MathUtils.smoothstep(shotTime, 0, 0.055)
      : 0.3 * (1 - THREE.MathUtils.smoothstep(shotTime, 0.055, 0.48));
    this.cannonRecoiling.position.z = recoil;
    // The breech stays open after extraction until a fresh round is seated.
    const opened = Number.isFinite(shotTime)
      ? THREE.MathUtils.smoothstep(shotTime, 0.18, 0.3)
      : magazine === 0 ? 1 : 0;
    const closing = reloading
      ? THREE.MathUtils.smoothstep(reloadProgress, 0.8, 0.96)
      : magazine > 0 ? THREE.MathUtils.smoothstep(shotTime, 0.7, 0.9) : 0;
    this.cannonBreech.position.y = -0.32 - 0.31 * opened * (1 - closing);
    this.cannonHandle.rotation.z = -opened * (1 - closing) * 0.85;

    const ejectionTime = shotTime - 0.28;
    this.cannonSpentCase.visible = ejectionTime >= 0 && ejectionTime < 0.6;
    if (this.cannonSpentCase.visible) {
      this.cannonSpentCase.position.set(0.12 + ejectionTime * 0.7, -0.32 - 2.8 * ejectionTime ** 2, -0.55 + ejectionTime * 1.1);
      this.cannonSpentCase.rotation.set(ejectionTime * 2, ejectionTime * 1.5, ejectionTime * 2.5);
    }
    this.cannonLoadingRound.visible = reloading && reloadProgress >= 0.28 && reloadProgress < 0.84;
    if (this.cannonLoadingRound.visible) {
      const align = THREE.MathUtils.smoothstep(reloadProgress, 0.28, 0.48);
      const insert = THREE.MathUtils.smoothstep(reloadProgress, 0.48, 0.84);
      this.cannonLoadingRound.position.set(0.12 + (1 - align) * 0.42, -0.32 - (1 - align) * 0.12, -0.2 - insert * 0.85);
      this.cannonLoadingRound.rotation.y = (1 - align) * -0.35;
    }
  }
  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
  render(renderer: THREE.WebGLRenderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
