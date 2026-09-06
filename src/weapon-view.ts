import * as THREE from "three";
import type { Weapon } from "./types";

export class WeaponView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(
    60,
    innerWidth / innerHeight,
    0.05,
    20,
  );
  private mount = new THREE.Group();
  private models = new Map<string, THREE.Group>();
  private flash: THREE.Mesh;
  private recoil = 0;
  private flashTime = 0;
  private swap = 0;
  private current = "MG";

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
    for (const name of ["MG", "CANNON", "ROCKET"]) {
      const model = new THREE.Group();
      part(
        model,
        [0.4, 0.36, 1.05],
        [0.12, -0.45, -1.05],
        name === "ROCKET" ? olive : steel,
      );
      part(model, [0.55, 0.12, 0.7], [0.12, -0.63, -0.8], dark);
      part(model, [0.15, 0.4, 0.22], [0.4, -0.69, -0.7], olive);
      part(model, [0.15, 0.4, 0.22], [-0.19, -0.69, -0.7], olive);
      part(model, [0.26, 0.4, 0.3], [0.12, -0.9, -1.2], steel);
      part(model, [0.32, 0.025, 0.55], [0.12, -0.255, -1.1], dark);
      part(model, [0.1, 0.07, 0.32], [0.12, -0.22, -1.08], olive);
      part(model, [0.03, 0.18, 0.3], [0.33, -0.43, -0.96], olive);
      for (const x of [-0.09, 0.33])
        for (const z of [-1.42, -0.75]) {
          const bolt = new THREE.Mesh(
            new THREE.SphereGeometry(0.025, 8, 6),
            brass,
          );
          bolt.position.set(x, -0.27, z);
          model.add(bolt);
        }
      if (name === "MG") {
        barrel(model, 0.064, 1.7, 0.12, -0.32, -2.35, steel);
        barrel(model, 0.083, 0.9, 0.12, -0.32, -1.8, dark);
        for (let i = 0; i < 9; i++)
          barrel(model, 0.092, 0.027, 0.12, -0.32, -1.5 - i * 0.08, steel);
        part(model, [0.45, 0.36, 0.45], [-0.4, -0.51, -1.3], olive);
        for (let i = 0; i < 8; i++)
          barrel(
            model,
            0.025,
            0.21,
            -0.42 + i * 0.055,
            -0.3 - Math.sin(i * 0.3) * 0.025,
            -1.18,
            brass,
          );
        part(model, [0.045, 0.17, 0.035], [0.12, -0.21, -2.95], dark);
      } else if (name === "CANNON") {
        barrel(model, 0.14, 2, 0.12, -0.32, -2.2, steel);
        barrel(model, 0.2, 0.7, 0.12, -0.32, -1.45, olive);
        part(model, [0.38, 0.24, 0.3], [0.12, -0.32, -3.25], dark);
        for (const x of [-0.075, 0.315])
          part(model, [0.015, 0.13, 0.18], [x, -0.32, -3.25], steel);
      } else {
        barrel(model, 0.23, 2, 0.12, -0.32, -1.9, olive);
        barrel(model, 0.26, 0.15, 0.12, -0.32, -2.9, brass);
        barrel(model, 0.19, 0.02, 0.12, -0.32, -2.99, dark);
        part(model, [0.12, 0.24, 0.36], [0.42, -0.15, -1.6], dark);
      }
      const sight = new THREE.Mesh(
        new THREE.TorusGeometry(0.082, 0.012, 8, 24),
        steel,
      );
      sight.position.set(0.12, -0.1, -1.6);
      model.add(sight);
      part(model, [0.025, 0.16, 0.025], [0.12, -0.2, -1.6], dark);
      model.visible = name === "MG";
      this.mount.add(model);
      this.models.set(name, model);
    }
    this.flash = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 0.6, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffd077,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.set(0.12, -0.32, -3.3);
    this.flash.visible = false;
    this.mount.add(this.flash);
  }
  select(name: string) {
    if (name === this.current) return;
    this.current = name;
    this.swap = 0.4;
    this.models.forEach((model, key) => (model.visible = key === name));
  }
  fire(weapon: Weapon) {
    this.recoil = weapon === "MG" ? 0.06 : weapon === "CANNON" ? 0.25 : 0.22;
    this.flashTime = weapon === "MG" ? 0.04 : weapon === "CANNON" ? 0.12 : 0.1;
    // Adjust flash size based on weapon
    const flashScale = weapon === "MG" ? 0.6 : weapon === "CANNON" ? 1.8 : 1.4;
    this.flash.scale.setScalar(flashScale);
    // Vary flash color by weapon type
    const flashColor = weapon === "MG" ? 0xffd077 : weapon === "CANNON" ? 0xffaa55 : 0xff8844;
    (this.flash.material as THREE.MeshBasicMaterial).color.setHex(flashColor);
  }
  update(dt: number, time: number, reloading: boolean, zoom: boolean) {
    this.recoil *= Math.exp(-dt * 18);
    this.flashTime -= dt;
    this.swap = Math.max(0, this.swap - dt);
    this.mount.position.set(
      zoom ? -0.08 : 0.3,
      -0.1 +
        (reloading ? -0.25 : 0) -
        this.swap * 0.7 +
        Math.sin(time * 1.8) * 0.006,
      this.recoil,
    );
    this.mount.rotation.set(reloading ? -0.2 : 0, 0, reloading ? -0.1 : 0);
    this.flash.visible = this.flashTime > 0;
    this.flash.rotation.y = time * 40;
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
