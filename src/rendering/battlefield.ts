import * as THREE from "../pc-shim/index.ts";

export function terrainHeight(x: number, z: number) {
  const distance = Math.hypot(x, z - 18);
  const blend = THREE.MathUtils.smoothstep(distance, 25, 140);
  const shore = THREE.MathUtils.smoothstep(z, -290, -220);
  return (
    blend *
    shore *
    (1.8 + Math.sin(x * 0.028 + z * 0.015) * 1.4 + Math.sin(z * 0.038) * 0.9)
  );
}

export class Battlefield {
  readonly group = new THREE.Group();
  readonly occluders: THREE.Object3D[] = [];
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private smoke: THREE.Sprite[] = [];
  private flag: THREE.Mesh;
  private materialCache = new Map<number, THREE.MeshStandardMaterial>();

  private material(color: number) {
    if (!this.materialCache.has(color))
      this.materialCache.set(
        color,
        new THREE.MeshStandardMaterial({ color, roughness: 0.84 }),
      );
    return this.materialCache.get(color)!;
  }
  private block(
    parent: THREE.Object3D,
    size: number[],
    at: number[],
    color: number,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...(size as [number, number, number])),
      this.material(color),
    );
    mesh.position.set(...(at as [number, number, number]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1100, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: `varying vec3 vDirection; void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        // Dusk sky: a hot orange band low on the horizon burning up through
        // rose and violet into a deep, cooling twilight blue at the zenith,
        // with a soft glowing sun disc low over the horizon.
        fragmentShader: `varying vec3 vDirection; void main(){vec3 d=normalize(vDirection); float h=max(d.y,0.); vec3 horizon=vec3(1.,.53,.22); vec3 mid=vec3(.72,.32,.42); vec3 zenith=vec3(.13,.13,.32); vec3 c=mix(horizon,mid,pow(h,.4)); c=mix(c,zenith,pow(h,1.6)); float s=pow(max(dot(d,normalize(vec3(-.85,.14,-.5))),0.),260.); c+=vec3(1.,.62,.28)*s*1.4; float glow=pow(max(dot(d,normalize(vec3(-.85,.14,-.5))),0.),8.); c+=vec3(1.,.42,.16)*glow*.3; gl_FragColor=vec4(c,1.);}`,
      }),
    );
    this.group.add(sky);
    const geo = new THREE.PlaneGeometry(1600, 1600, 200, 200);
    geo.rotateX(-Math.PI / 2);
    const positions = geo.attributes.position;
    const colors = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        z = positions.getZ(i),
        y = terrainHeight(x, z);
      positions.setY(i, y);
      const col = new THREE.Color().setHSL(
        0.068 + Math.sin(x * 0.15) * 0.006,
        0.42,
        0.5 + Math.sin(x * 0.04 + z * 0.03) * 0.035,
      );
      if (z < -270) col.multiplyScalar(0.68);
      colors.push(col.r, col.g, col.b);
    }
    geo.computeVertexNormals();
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const sandCanvas = document.createElement("canvas");
    sandCanvas.width = sandCanvas.height = 256;
    const ctx = sandCanvas.getContext("2d")!;
    ctx.fillStyle = "#c99568";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 16000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "#e0ae7e" : "#a97e5a";
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
    }
    const sand = new THREE.CanvasTexture(sandCanvas);
    sand.wrapS = sand.wrapT = THREE.RepeatWrapping;
    sand.repeat.set(180, 180);
    const terrain = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: sand,
        roughness: 1,
      }),
    );
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.occluders.push(terrain);
    const waterMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      transparent: true,
      vertexShader: `varying vec3 vPos; void main(){vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      // Sunset water: deep plum-blue troughs catching an orange glaze near
      // the shore where the low sun reflects across the swell.
      fragmentShader: `varying vec3 vPos; uniform float time; void main(){float wave=sin(vPos.y*.15+time*1.3+sin(vPos.x*.02)*1.4); float detail=sin(vPos.x*.3+vPos.y*.18-time)*.08; vec3 c=mix(vec3(.1,.16,.28),vec3(.55,.4,.32),wave*.3+.45+detail); float shore=smoothstep(260.,298.,-vPos.y); float foam=pow(max(0.,sin(vPos.y*.46+time*1.5+sin(vPos.x*.04))),9.); c=mix(c,vec3(.95,.78,.6),foam*shore*.85); float glint=pow(max(0.,sin(vPos.y*.22+time*.9)),22.); c+=vec3(1.,.55,.22)*glint*.35; gl_FragColor=vec4(c,1.);}`,
    });
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 600),
      waterMaterial,
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(0, 0.18, -570);
    this.group.add(this.water);
    // Scattered stones add texture to the open sand.
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      this.material(0x7b7764),
      180,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 180; i++) {
      const x = (Math.random() - 0.5) * 850,
        z = Math.random() * 720 - 240;
      dummy.position.set(x, terrainHeight(x, z), z);
      dummy.rotation.set(Math.random(), Math.random() * 6, Math.random());
      dummy.scale.set(
        1 + Math.random() * 3,
        0.5 + Math.random() * 1.2,
        1 + Math.random() * 2,
      );
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.group.add(rocks);
    for (const [x, z, height] of [
      [-32, -22, 14],
      [-39, -28, 17],
      [42, -42, 15],
      [50, -37, 12],
    ])
      this.palm(x, z, height);
    // A curved access road and its wheel ruts connect the bunker to the shore.
    for (const offset of [0, -2.2, 2.2]) {
      const road = new THREE.PlaneGeometry(offset === 0 ? 7 : 0.42, 260, 1, 80);
      road.rotateX(-Math.PI / 2);
      const vertices = road.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const z = vertices.getZ(i) - 95,
          x = vertices.getX(i) + 35 + Math.sin((z + 30) * 0.013) * 22 + offset;
        vertices.setXYZ(
          i,
          x,
          terrainHeight(x, z) + 0.025 + (offset === 0 ? 0 : 0.01),
          z,
        );
      }
      road.computeVertexNormals();
      const mesh = new THREE.Mesh(
        road,
        this.material(offset === 0 ? 0xb3a17f : 0x948467),
      );
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const watchtower = new THREE.Group();
    watchtower.userData.impactMaterial = "wood";
    for (const x of [-2.1, 2.1])
      for (const z of [-2.1, 2.1])
        this.block(watchtower, [0.24, 11, 0.24], [x, 5.5, z], 0x6e6249);
    this.block(watchtower, [5, 0.35, 5], [0, 9, 0], 0x796a4d);
    this.block(watchtower, [5.6, 0.25, 5.6], [0, 12, 0], 0x555e45);
    for (const x of [-2.3, 2.3])
      this.block(watchtower, [0.15, 1.2, 4.7], [x, 9.7, 0], 0x8a795a);
    for (let i = 0; i < 9; i++)
      this.block(watchtower, [1.1, 0.14, 0.14], [0, 1 + i, 2.2], 0x8f7d57);
    watchtower.position.set(-63, terrainHeight(-63, -70), -70);
    this.group.add(watchtower);
    this.occluders.push(watchtower);
    const shelter = new THREE.Group();
    this.block(shelter, [9, 2, 1], [0, 1, 0], 0x888674);
    this.block(shelter, [1, 3, 5], [-4, 1.5, 2], 0x91917b);
    this.block(shelter, [10, 0.35, 6], [0, 3, 2], 0x717969);
    shelter.position.set(52, terrainHeight(52, -90), -90);
    shelter.rotation.y = -0.4;
    this.group.add(shelter);
    this.occluders.push(shelter);
    for (let i = 0; i < 10; i++) {
      const x = -24 + i * 5,
        z = -37;
      this.block(
        this.group,
        [0.13, 2, 0.13],
        [x, terrainHeight(x, z) + 1, z],
        0x65664f,
      );
      const wire = new THREE.Mesh(
        new THREE.TorusGeometry(0.65, 0.018, 3, 16),
        this.material(0x4c5347),
      );
      wire.position.set(x + 2, terrainHeight(x, z) + 0.9, z);
      wire.rotation.y = Math.PI / 2;
      this.group.add(wire);
    }
    for (let i = 0; i < 28; i++)
      this.palm(
        (i % 2 ? 1 : -1) * (55 + Math.random() * 330),
        Math.random() * 560 - 220,
        9 + Math.random() * 6,
      );
    for (let i = 0; i < 32; i++) {
      const barrier = new THREE.Group(),
        x = (Math.random() - 0.5) * 380,
        z = -65 - Math.random() * 160;
      for (const angle of [-0.7, 0.7]) {
        const rail = this.block(
          barrier,
          [0.35, 4, 0.35],
          [0, 1.6, 0],
          0x444e48,
        );
        rail.rotation.z = angle;
      }
      const third = this.block(barrier, [0.35, 4, 0.35], [0, 1.6, 0], 0x444e48);
      third.rotation.x = Math.PI / 2;
      barrier.position.set(x, terrainHeight(x, z), z);
      this.group.add(barrier);
    }
    for (const [x, z] of [
      [-145, -110],
      [200, -160],
      [-250, 140],
    ]) {
      const ruin = new THREE.Group();
      this.block(ruin, [18, 5, 1], [0, 2.5, 0], 0x999681);
      this.block(ruin, [1, 9, 10], [-8.5, 4.5, 4], 0xaaa38a);
      this.block(ruin, [9, 3, 1], [4, 1.5, 8], 0x777866);
      ruin.position.set(x, terrainHeight(x, z), z);
      this.group.add(ruin);
      this.occluders.push(ruin);
    }
    for (let i = 0; i < 4; i++) {
      const ship = new THREE.Group();
      this.block(ship, [12, 4, 38], [0, 2, 0], 0x4e6060);
      this.block(ship, [7, 3, 10], [0, 5, 6], 0x8f998c);
      this.block(ship, [0.4, 13, 0.4], [0, 11, 8], 0x3f504b);
      ship.position.set(-270 + i * 180, 0, -350 - i * 32);
      ship.rotation.y = -0.2;
      this.group.add(ship);
    }
    for (let i = 0; i < 12; i++) {
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(
          65 + Math.random() * 90,
          40 + Math.random() * 90,
          7,
        ),
        this.material(0x7b8271),
      );
      hill.position.set(-650 + i * 120, 0, 570 + Math.random() * 130);
      this.group.add(hill);
    }
    const bunker = new THREE.Group();
    bunker.position.set(0, 0, 18);
    this.block(bunker, [10, 0.5, 10], [0, 2.5, 0], 0x747669);
    for (let layer = 0; layer < 3; layer++)
      for (let i = 0; i < 28; i++) {
        const a = ((i + layer * 0.5) / 28) * Math.PI * 2;
        const bag = new THREE.Mesh(
          new THREE.SphereGeometry(1, 8, 6),
          this.material(layer % 2 ? 0x9b9270 : 0xb4a47b),
        );
        bag.scale.set(0.63, 0.36, 0.42);
        bag.position.set(
          Math.sin(a) * 4.7,
          3.2 + layer * 0.62,
          Math.cos(a) * 4.7,
        );
        bag.rotation.y = a;
        bag.castShadow = bag.receiveShadow = true;
        bunker.add(bag);
      }
    for (const [x, z] of [
      [-3, 1],
      [-2, 2],
      [3, 2],
    ]) {
      this.block(bunker, [1.1, 0.7, 0.8], [x, 3, z], 0x596345);
      this.block(bunker, [1.2, 0.06, 0.84], [x, 3.38, z], 0x363f30);
    }
    this.block(bunker, [0.08, 10, 0.08], [-6, 5, 2], 0x505952);
    this.flag = this.block(bunker, [2, 1.15, 0.035], [-5, 9, 2], 0xb08f4f);
    this.group.add(bunker);
    const smokeCanvas = document.createElement("canvas");
    smokeCanvas.width = smokeCanvas.height = 64;
    const sc = smokeCanvas.getContext("2d")!,
      gradient = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(47,45,40,.6)");
    gradient.addColorStop(1, "rgba(47,45,40,0)");
    sc.fillStyle = gradient;
    sc.fillRect(0, 0, 64, 64);
    const smokeTexture = new THREE.CanvasTexture(smokeCanvas);
    for (const [x, z] of [
      [-110, -165],
      [185, -220],
      [280, 190],
    ])
      for (let i = 0; i < 12; i++) {
        const puff = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: smokeTexture,
            transparent: true,
            depthWrite: false,
            opacity: 0.65,
          }),
        );
        puff.userData = { baseX: x, baseZ: z, offset: i * 3 };
        puff.position.set(x, 4 + i * 3, z);
        puff.scale.setScalar(9 + i * 0.8);
        this.smoke.push(puff);
        this.group.add(puff);
      }
  }
  private palm(x: number, z: number, height: number) {
    const palm = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.65, height, 7),
      this.material(0x786448),
    );
    trunk.position.y = height / 2;
    trunk.rotation.z = 0.09;
    trunk.castShadow = true;
    palm.add(trunk);
    for (let j = 0; j < 8; j++) {
      const frond = new THREE.Group();
      frond.position.set(-height * 0.045, height, 0);
      frond.rotation.y = (j * Math.PI) / 4;
      for (let k = 0; k < 4; k++) {
        const leaf = new THREE.Mesh(
          new THREE.ConeGeometry(0.8 - k * 0.14, 2.8, 3),
          this.material(j % 2 ? 0x5f7145 : 0x778651),
        );
        leaf.rotation.x = Math.PI / 2 + 0.17 * k;
        leaf.position.set(0, -k * k * 0.15, 1 + k * 1.3);
        frond.add(leaf);
      }
      palm.add(frond);
    }
    palm.position.set(x, terrainHeight(x, z), z);
    this.group.add(palm);
  }
  update(time: number) {
    this.water.material.uniforms.time.value = time;
    this.flag.rotation.y = Math.sin(time * 3) * 0.15;
    for (const puff of this.smoke) {
      const age = (time * 1.1 + puff.userData.offset) % 40;
      puff.position.set(
        puff.userData.baseX + age * 0.24,
        4 + age,
        puff.userData.baseZ,
      );
      puff.scale.setScalar(8 + age * 0.35);
      (puff.material as THREE.SpriteMaterial).opacity = 0.7 * (1 - age / 40);
    }
  }
}
