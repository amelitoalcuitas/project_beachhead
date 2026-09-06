import * as THREE from "three";
import type { EnemyType } from "./types";

const materials = new Map<number, THREE.MeshStandardMaterial>();
function material(color: number) {
  if (!materials.has(color))
    materials.set(
      color,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.72,
        metalness: 0.2,
      }),
    );
  return materials.get(color)!;
}
function block(
  group: THREE.Group,
  size: number[],
  at: number[],
  color: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...(size as [number, number, number])),
    material(color),
  );
  mesh.position.set(...(at as [number, number, number]));
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function cylinder(
  group: THREE.Group,
  r: number,
  h: number,
  at: number[],
  color: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 12),
    material(color),
  );
  mesh.position.set(...(at as [number, number, number]));
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

export function enemyModel(type: EnemyType, color: number) {
  const g = new THREE.Group();
  if (type === "infantry") {
    block(g, [1, 1.15, 0.65], [0, 1.75, 0], color);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.44, 10, 8),
      material(0x454e3c),
    );
    helmet.position.set(0, 2.75, 0);
    g.add(helmet);
    cylinder(g, 0.3, 0.48, [0, 2.42, -0.06], 0xc89d70);
    for (const side of [-1, 1]) {
      const leg = block(g, [0.35, 1.1, 0.42], [side * 0.28, 0.55, 0], 0x424b35);
      leg.name = "leg";
      leg.userData.side = side;
      block(g, [0.35, 0.85, 0.35], [side * 0.68, 1.65, -0.2], color);
    }
    block(g, [0.85, 0.7, 0.3], [0, 1.7, 0.48], 0x645d43);
    block(g, [0.15, 0.15, 1.35], [0.4, 1.7, -0.75], 0x272c29);
    g.scale.setScalar(1.15);
  } else if (type === "heli") {
    const fuselage = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      material(color),
    );
    fuselage.scale.set(2, 1.8, 3.5);
    g.add(fuselage);
    block(g, [2.8, 1.4, 1.1], [0, 0.3, -2.5], 0x294752);
    block(g, [0.6, 0.6, 6], [0, 0.3, 5], color);
    block(g, [0.15, 2, 1.4], [0, 1.2, 7.5], color);
    const rotor = new THREE.Group();
    rotor.name = "rotor";
    rotor.position.y = 2.3;
    block(rotor, [13, 0.12, 0.25], [0, 0, 0], 0x252b29);
    block(rotor, [0.25, 0.12, 13], [0, 0, 0], 0x252b29);
    g.add(rotor);
    for (const side of [-1, 1]) {
      block(g, [0.16, 0.16, 5], [side * 2, -1.8, 0], 0x394139);
      block(g, [0.12, 1.1, 0.12], [side * 1.8, -1.3, 0], 0x394139);
      cylinder(g, 0.4, 1.4, [side * 2.2, -0.3, 0], 0x282e25).rotation.x =
        Math.PI / 2;
    }
  } else if (type === "aircraft") {
    const body = cylinder(g, 1, 8, [0, 0, 0], color);
    body.rotation.x = Math.PI / 2;
    block(g, [12, 0.2, 2], [0, 0, 0.6], color);
    block(g, [5, 0.16, 1.2], [0, 0.5, 3.5], color);
    block(g, [0.2, 2, 1.5], [0, 1, 3.2], color);
    block(g, [1, 0.65, 1.7], [0, 0.8, -1], 0x294650);
  } else {
    const tank = type === "tank" || type === "apc",
      length = type === "truck" ? 8 : tank ? 7 : 5;
    block(g, [4, 1.35, length], [0, 1.8, 0], color);
    if (tank) {
      for (const side of [-1, 1]) {
        block(g, [0.85, 1.6, 6.8], [side * 2.1, 0.9, 0], 0x2f332c);
        for (let i = 0; i < 6; i++)
          cylinder(
            g,
            0.58,
            0.9,
            [side * 2.2, 0.9, -2.6 + i],
            0x626747,
          ).rotation.z = Math.PI / 2;
      }
      cylinder(g, 1.5, 0.9, [0, 2.7, 0], color);
      const turret = block(g, [2.5, 0.8, 2.7], [0, 3.1, 0], color);
      turret.name = "turret";
      const barrel = cylinder(
        g,
        type === "tank" ? 0.23 : 0.12,
        4,
        [0, 3.15, -2.8],
        0x353d2d,
      );
      barrel.rotation.x = Math.PI / 2;
    } else {
      for (const side of [-1, 1])
        for (const z of [-length * 0.32, length * 0.32])
          cylinder(g, 0.85, 0.55, [side * 2, 0.9, z], 0x242a25).rotation.z =
            Math.PI / 2;
      block(g, [3.5, 1.5, 2], [0, 2.9, -1.4], color);
      block(g, [3, 0.7, 0.06], [0, 3.1, -2.43], 0x304650);
      if (type === "truck") block(g, [3.8, 2.2, 4.3], [0, 3.1, 1.5], 0x7c7858);
      else block(g, [0.2, 0.2, 2], [0, 3.7, -0.6], 0x30352c);
    }
    for (const side of [-1, 1])
      block(
        g,
        [0.4, 0.28, 0.12],
        [side * 1.3, 1.6, -length / 2 - 0.07],
        0xcbbb7a,
      );
    block(g, [0.6, 0.14, 0.08], [0, 2.4, -length / 2 - 0.08], 0xd0bf84);
  }
  return g;
}

export function animateEnemy(
  group: THREE.Group,
  type: EnemyType,
  time: number,
  moving: boolean,
) {
  if (type === "infantry")
    group.children.forEach((part) => {
      if (part.name === "leg")
        part.rotation.x = moving
          ? Math.sin(time * 9) * 0.45 * part.userData.side
          : 0;
    });
  if (type === "heli") {
    const rotor = group.getObjectByName("rotor");
    if (rotor) rotor.rotation.y = time * 32;
    group.rotation.z = Math.sin(time * 1.4) * 0.05;
  }
}
