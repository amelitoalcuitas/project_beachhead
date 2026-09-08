import * as THREE from "../pc-shim/index.ts";
import { isInfantryType, type EnemyType } from "../types.ts";

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
  if (isInfantryType(type)) {
    block(g, [1, 1.15, 0.65], [0, 1.75, 0], color);
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.44, 10, 8),
      material(type === "armoredInfantry" ? 0x3d4535 : 0x454e3c),
    );
    helmet.position.set(0, 2.75, 0);
    helmet.scale.set(1.05, 0.88, 1.05);
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
    if (type === "armoredInfantry") {
      block(g, [1.15, 0.95, 0.75], [0, 1.85, 0], 0x4a5240);
      block(g, [0.55, 0.35, 0.2], [0, 2.35, 0.42], 0x3d4535);
    }
    if (type === "grenadierInfantry") {
      block(g, [0.22, 0.55, 0.22], [0.55, 1.55, 0.15], 0x5a4a32);
      cylinder(g, 0.08, 0.35, [0.55, 1.95, 0.15], 0x3d3528);
    }
    g.scale.setScalar(1.15);
  } else if (type === "heli") {
    // Focke-Achgelis Fa 223 Drache - twin rotor lattice booms
    const fuselage = new THREE.Mesh(
      new THREE.SphereGeometry(1, 12, 10),
      material(color),
    );
    fuselage.scale.set(1.8, 1.6, 3.2);
    g.add(fuselage);
    block(g, [2.4, 1.2, 1], [0, 0.3, -2.2], 0x294752);
    block(g, [0.5, 0.5, 5.5], [0, 0.3, 4.8], color);
    for (const side of [-1, 1]) {
      block(g, [0.12, 0.12, 7], [side * 2.8, 1.8, 0], 0x394139);
      const rotor = new THREE.Group();
      rotor.name = side === -1 ? "rotor" : "rotor2";
      rotor.position.set(side * 2.8, 2.4, 0);
      block(rotor, [11, 0.1, 0.22], [0, 0, 0], 0x252b29);
      block(rotor, [0.22, 0.1, 11], [0, 0, 0], 0x252b29);
      g.add(rotor);
      block(g, [0.14, 0.14, 4.5], [side * 2.2, -1.6, 0], 0x394139);
      cylinder(g, 0.35, 1.2, [side * 2.4, -0.4, 0], 0x282e25).rotation.x =
        Math.PI / 2;
    }
  } else if (type === "aircraft") {
    // Junkers Ju 87 Stuka - gull wing, fixed landing gear, inverted gull
    const body = cylinder(g, 0.9, 7.5, [0, 0, 0], color);
    body.rotation.x = Math.PI / 2;
    block(g, [11, 0.18, 1.8], [0, -0.4, 0.5], color);
    block(g, [4.5, 0.14, 1.1], [0, 0.8, 3.2], color);
    block(g, [0.18, 1.8, 1.4], [0, 1.2, 3], color);
    block(g, [1.1, 0.7, 1.5], [0, 0.6, -1.2], 0x294650);
    for (const side of [-1, 1]) {
      block(g, [0.12, 1.6, 0.12], [side * 1.4, -1.2, 1.8], 0x30352c);
      block(g, [0.35, 0.08, 0.5], [side * 1.4, -1.9, 1.8], 0x30352c);
    }
    block(g, [0.5, 0.5, 0.8], [0, 0.2, -3.2], 0x252b29);
  } else if (type === "jeep") {
    // Kubelwagen - open tub body, spare wheel
    block(g, [3.6, 0.9, 4.8], [0, 1.5, 0], color);
    block(g, [3.2, 0.7, 2.2], [0, 2.35, -1.2], color);
    for (const side of [-1, 1])
      for (const z of [-1.6, 1.6])
        cylinder(g, 0.75, 0.5, [side * 2, 0.85, z], 0x242a25).rotation.z =
          Math.PI / 2;
    cylinder(g, 0.55, 0.12, [1.6, 2.1, 0.8], 0x3a3f36).rotation.z = Math.PI / 2;
    block(g, [0.15, 0.9, 0.06], [0, 2.7, -2.45], 0x304650);
    block(g, [0.6, 0.14, 0.08], [0, 2.2, -2.48], 0xd0bf84);
  } else if (type === "truck") {
    // Opel Blitz - cab + cargo bed
    const length = 8;
    block(g, [3.8, 1.35, length], [0, 1.8, 0], color);
    block(g, [3.2, 1.8, 2.4], [0, 2.9, -2.6], color);
    block(g, [3.5, 1.6, 4.2], [0, 3.2, 1.8], 0x7c7858);
    block(g, [3, 0.7, 0.06], [0, 3.1, -3.65], 0x304650);
    for (const side of [-1, 1])
      for (const z of [-length * 0.32, length * 0.32])
        cylinder(g, 0.85, 0.55, [side * 2, 0.9, z], 0x242a25).rotation.z =
          Math.PI / 2;
    block(g, [0.6, 0.14, 0.08], [0, 2.4, -length / 2 - 0.08], 0xd0bf84);
  } else {
    const tank = type === "tank" || type === "apc",
      length = tank ? 7 : 5;
    block(g, [4, 1.35, length], [0, 1.8, 0], color);
    if (tank) {
      if (type === "apc") {
        // Sd.Kfz 251 halftrack
        block(g, [3.8, 1.5, 5.5], [0, 2.6, 0.2], color);
        block(g, [0.12, 0.9, 3.8], [0, 3.35, 0.2], 0x3a4035);
        for (const side of [-1, 1]) {
          for (let i = 0; i < 5; i++)
            cylinder(
              g,
              0.5,
              0.75,
              [side * 2.1, 0.9, -2.2 + i * 1.1],
              0x626747,
            ).rotation.z = Math.PI / 2;
          block(g, [0.85, 1.5, 5.5], [side * 2.1, 0.9, 0], 0x2f332c);
        }
        const turret = block(g, [2.2, 0.7, 2.4], [0, 3.15, -0.8], color);
        turret.name = "turret";
        const barrel = cylinder(g, 0.1, 3.2, [0, 3.15, -2.6], 0x353d2d);
        barrel.rotation.x = Math.PI / 2;
      } else {
        // Panzer IV silhouette
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
        block(g, [3.2, 0.5, 4.5], [0, 2.35, 0.2], color);
        const turret = block(g, [2.8, 0.9, 3], [0, 3.05, -0.3], color);
        turret.name = "turret";
        const barrel = cylinder(g, 0.23, 4.5, [0, 3.1, -2.9], 0x353d2d);
        barrel.rotation.x = Math.PI / 2;
        block(g, [0.5, 0.35, 0.4], [0, 3.55, 0.8], 0x3a4035);
      }
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
  if (isInfantryType(type))
    group.children.forEach((part) => {
      if (part.name === "leg")
        part.rotation.x = moving
          ? Math.sin(time * 9) * 0.45 * part.userData.side
          : 0;
    });
  if (type === "heli") {
    const rotor = group.getObjectByName("rotor");
    const rotor2 = group.getObjectByName("rotor2");
    if (rotor) rotor.rotation.y = time * 32;
    if (rotor2) rotor2.rotation.y = -time * 32;
    group.rotation.z = Math.sin(time * 1.4) * 0.05;
  }
}
