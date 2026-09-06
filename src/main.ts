import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Battlefield, terrainHeight } from "./battlefield";
import { WeaponView } from "./weapon-view";
import { CombatHud, screenMarkup } from "./hud";
import { weapons, wavePlans, specs } from "./content";
import { enemyModel, animateEnemy } from "./enemy-models";
import { bearing, canEngage, segmentHit, terrainIntersection } from "./combat";
import type { EnemyType, Weapon, State } from "./types";
import "./style.css";

interface Enemy {
  type: EnemyType;
  group: THREE.Group;
  hp: number;
  speed: number;
  fire: number;
  dead: boolean;
  target: THREE.Vector3;
  passes: number;
  unloaded: boolean;
  warning: number;
  sightTimer: number;
  canAttack: boolean;
}
interface Shot {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  splash: number;
  life: number;
  owner: "player" | "enemy";
  weapon: Weapon;
  previous: THREE.Vector3;
}
interface Effect {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  duration: number;
  growth: number;
}
interface Tracer {
  line: THREE.Line;
  life: number;
}

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = screenMarkup;
const overlay = document.querySelector<HTMLElement>("#overlay")!;
const hud = new CombatHud();
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb4b6a2, 230, 1000);
const camera = new THREE.PerspectiveCamera(
  75,
  innerWidth / innerHeight,
  0.1,
  1400,
);
const playerPosition = new THREE.Vector3(0, 7, 18);
camera.position.copy(playerPosition);
camera.rotation.x = -0.055;
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.domElement.setAttribute("aria-label", "3D beachhead battlefield");
renderer.domElement.tabIndex = 0;
app.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xc5e2ef, 0x96805a, 2));
const sun = new THREE.DirectionalLight(0xffdb9c, 3.2);
sun.position.set(-130, 160, -90);
sun.castShadow = true;
Object.assign(sun.shadow.camera, {
  left: -120,
  right: 120,
  top: 120,
  bottom: -120,
  near: 1,
  far: 500,
});
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.001;
sun.shadow.normalBias = 0.06;
scene.add(sun);
const battlefield = new Battlefield(scene);
const weaponView = new WeaponView();
const controls = new PointerLockControls(camera, renderer.domElement);
controls.pointerSpeed = 0.65;
controls.minPolarAngle = THREE.MathUtils.degToRad(5);
controls.maxPolarAngle = THREE.MathUtils.degToRad(125);
const enemyLayer = new THREE.Group(),
  projectileLayer = new THREE.Group(),
  effectLayer = new THREE.Group();
scene.add(enemyLayer, projectileLayer, effectLayer);
const raycaster = new THREE.Raycaster();
const sphereGeometry = new THREE.SphereGeometry(1, 8, 6);
const enemies: Enemy[] = [],
  shots: Shot[] = [],
  effects: Effect[] = [],
  tracers: Tracer[] = [];
const heldKeys = new Set<string>();
let state: State = "title",
  pausedState: State = "combat";
let playerHp = 1000,
  score = 0,
  wave = 1,
  spawnIndex = 0,
  spawnTimer = 0,
  intermission = 0;
let weapon: Weapon = "MG",
  reload = 0,
  cooldown = 0,
  switchTime = 0,
  trigger = false,
  zoom = false;
let simulationTime = 0,
  worldTime = 0,
  shake = 0,
  accumulator = 0,
  previousTime = performance.now();
let activePlan = [...wavePlans[0]],
  endless = false,
  heavyAttackReady = 0;
let messageTimer = 0,
  bannerTimer = 0,
  inspectionTimer = 0;
let audioContext: AudioContext | undefined,
  noiseBuffer: AudioBuffer | undefined;
const lookDirection = new THREE.Vector3(),
  targetCenter = new THREE.Vector3();
// Bullet spread state - increases during sustained fire, recovers when not firing
let spreadAngle = 0,
  spreadX = 0,
  spreadY = 0;
const active = () => state === "combat" || state === "intermission";

function initializeAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
    noiseBuffer = audioContext.createBuffer(
      1,
      audioContext.sampleRate,
      audioContext.sampleRate,
    );
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  void audioContext.resume();
}
function sound(kind: "gun" | "heavy" | "impact" | "reload", pan = 0) {
  if (!audioContext || !noiseBuffer) return;
  const source = audioContext.createBufferSource(),
    filter = audioContext.createBiquadFilter(),
    gain = audioContext.createGain(),
    panner = audioContext.createStereoPanner();
  source.buffer = noiseBuffer;
  filter.type = "lowpass";
  filter.frequency.value =
    kind === "gun" ? 2200 : kind === "reload" ? 3300 : 650;
  const duration = kind === "gun" ? 0.1 : kind === "reload" ? 0.08 : 0.45;
  gain.gain.setValueAtTime(
    kind === "gun" ? 0.11 : kind === "reload" ? 0.025 : 0.22,
    audioContext.currentTime,
  );
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    audioContext.currentTime + duration,
  );
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  source
    .connect(filter)
    .connect(gain)
    .connect(panner)
    .connect(audioContext.destination);
  source.start();
  source.stop(audioContext.currentTime + duration);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
    panner.disconnect();
  };
}
function banner(title: string, subtitle = "") {
  const element = document.querySelector<HTMLElement>("#banner")!;
  element.innerHTML = title + '<div class="small">' + subtitle + "</div>";
  element.classList.add("show");
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => element.classList.remove("show"), 2600);
}
function message(text: string) {
  const element = document.querySelector<HTMLElement>("#message")!;
  element.textContent = text;
  element.classList.add("show");
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(
    () => element.classList.remove("show"),
    1600,
  );
}
function releaseMesh(mesh: THREE.Mesh, disposeGeometry = false) {
  mesh.removeFromParent();
  if (disposeGeometry) mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material];
  materials.forEach((material) => material.dispose());
}
function clearRun() {
  for (const enemy of enemies) {
    enemy.group.removeFromParent();
    enemy.group.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
  }
  for (const shot of shots) releaseMesh(shot.mesh);
  for (const effect of effects) releaseMesh(effect.mesh);
  for (const tracer of tracers) {
    tracer.line.removeFromParent();
    tracer.line.geometry.dispose();
    (tracer.line.material as THREE.Material).dispose();
  }
  enemies.length = shots.length = effects.length = tracers.length = 0;
  trigger = zoom = false;
  heldKeys.clear();
  accumulator = 0;
  heavyAttackReady = 0;
  window.clearTimeout(bannerTimer);
  window.clearTimeout(messageTimer);
  document.querySelector("#message")!.classList.remove("show");
}
function capturePointer() {
  // The Three.js version in this project discards the request's promise.
  // Handle browsers that deny capture and retain drag/keyboard aiming.
  const request = renderer.domElement.requestPointerLock() as
    | Promise<void>
    | undefined;
  request?.catch(() => message("DRAG TO AIM · ARROW KEYS ALSO AVAILABLE"));
}
function reset() {
  clearRun();
  playerHp = 1000;
  score = 0;
  wave = 1;
  endless = false;
  spawnIndex = 0;
  spawnTimer = 2;
  intermission = 0;
  weapon = "MG";
  reload = cooldown = switchTime = 0;
  weaponView.select(weapon);
  for (const definition of Object.values(weapons)) {
    definition.mag = definition.maxMag;
    definition.reserve = definition.maxReserve;
  }
  activePlan = [...wavePlans[0]];
  simulationTime = 0;
  state = "combat";
  camera.position.copy(playerPosition);
  camera.rotation.set(-0.055, 0, 0, "YXZ");
  overlay.style.display = "none";
  initializeAudio();
  capturePointer();
  banner("WAVE 01", "NORTH SHORE / FIRST CONTACT");
}
function selectWeapon(next: Weapon) {
  if (!active() || next === weapon) return;
  weapon = next;
  reload = 0;
  switchTime = 0.4;
  cooldown = 0.4;
  trigger = false;
  weaponView.select(next);
  sound("reload");
}
function reloadWeapon() {
  if (!active() || reload > 0 || switchTime > 0) return;
  const definition = weapons[weapon];
  if (definition.mag === definition.maxMag || definition.reserve === 0) return;
  reload = definition.reload;
  sound("reload");
}
function completeReload() {
  const definition = weapons[weapon],
    rounds = Math.min(definition.maxMag - definition.mag, definition.reserve);
  definition.mag += rounds;
  definition.reserve -= rounds;
  reload = 0;
  sound("reload");
}
function spawn(type: EnemyType, near?: THREE.Vector3) {
  if (enemies.filter((enemy) => !enemy.dead).length >= 32) return;
  const definition = specs[type],
    group = enemyModel(type, definition.color);
  // The opening wave establishes the shoreline; later waves include the flanks and rear.
  const angle =
    wave === 1 ? (Math.random() - 0.5) * 2.4 : Math.random() * Math.PI * 2;
  const distance = definition.air
    ? 380 + Math.random() * 180
    : 190 + Math.random() * 230;
  group.position.set(
    Math.sin(angle) * distance,
    0,
    18 - Math.cos(angle) * distance,
  );
  if (!definition.air) group.position.z = Math.max(-250, group.position.z);
  group.position.y = definition.air
    ? type === "heli"
      ? 40
      : 70
    : terrainHeight(group.position.x, group.position.z);
  if (near) {
    group.position.copy(near);
    group.position.x += (Math.random() - 0.5) * 12;
    group.position.z += (Math.random() - 0.5) * 12;
    group.position.y = terrainHeight(group.position.x, group.position.z);
  }
  const enemy: Enemy = {
    type,
    group,
    hp: definition.hp,
    speed: definition.speed * Math.min(1.65, 1 + wave * 0.025),
    fire: 1.5 + Math.random() * 2.5,
    dead: false,
    target: playerPosition.clone(),
    passes: 0,
    unloaded: false,
    warning: 0,
    sightTimer: 0,
    canAttack: false,
  };
  if (type === "aircraft")
    enemy.target.set(
      -group.position.x * 0.65,
      70,
      18 + (18 - group.position.z) * 0.65,
    );
  group.traverse((node) => (node.userData.enemy = enemy));
  enemyLayer.add(group);
  enemies.push(enemy);
}
function addEffect(
  position: THREE.Vector3,
  color: number,
  size: number,
  duration: number,
  velocity: THREE.Vector3,
  growth: number,
) {
  if (effects.length >= 240) return;
  const mesh = new THREE.Mesh(
    sphereGeometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  mesh.position.copy(position);
  mesh.scale.setScalar(size);
  effectLayer.add(mesh);
  effects.push({ mesh, velocity, life: duration, duration, growth });
}
function explode(position: THREE.Vector3, size: number) {
  addEffect(position, 0xffbd55, size * 0.45, 0.28, new THREE.Vector3(), 8);
  for (let i = 0; i < 10; i++)
    addEffect(
      position,
      i < 4 ? 0xff9c3f : 0x514a3e,
      size * (i < 4 ? 0.13 : 0.23),
      i < 4 ? 0.7 : 2.2,
      new THREE.Vector3(
        (Math.random() - 0.5) * size * 6,
        Math.random() * size * 5,
        (Math.random() - 0.5) * size * 6,
      ),
      i < 4 ? 0.3 : 1.2,
    );
  sound("impact");
}
function sparks(position: THREE.Vector3) {
  for (let i = 0; i < 3; i++)
    addEffect(
      position,
      0xffd87a,
      0.06,
      0.22,
      new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 7,
        (Math.random() - 0.5) * 8,
      ),
      0,
    );
}
function addTracer(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color: number,
  life = 0.07,
) {
  if (tracers.length >= 80) return;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start, end]),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
  );
  effectLayer.add(line);
  tracers.push({ line, life });
}
function obstructionDistance(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
) {
  const ground = terrainIntersection(
    origin,
    direction,
    distance,
    terrainHeight,
  );
  raycaster.set(origin, direction);
  raycaster.far = distance;
  const hit = raycaster.intersectObjects(
    battlefield.occluders.slice(1),
    true,
  )[0];
  return Math.min(ground, hit?.distance ?? Infinity);
}
function enemyOrigin(enemy: Enemy) {
  return enemy.group.position
    .clone()
    .add(
      new THREE.Vector3(
        0,
        specs[enemy.type].air ? 0 : enemy.type === "infantry" ? 2 : 3,
        0,
      ),
    );
}
function clearLineOfSight(origin: THREE.Vector3) {
  const direction = playerPosition.clone().sub(origin),
    distance = direction.length();
  direction.normalize();
  return obstructionDistance(origin, direction, distance) > distance - 1;
}
function hitEnemy(
  enemy: Enemy,
  amount: number,
  source: Weapon,
  position: THREE.Vector3,
) {
  if (enemy.dead) return;
  const armor =
    (enemy.type === "tank" || enemy.type === "apc") && source === "MG";
  enemy.hp -= amount * (armor ? 0.12 : 1);
  sparks(position);
  hud.hit(enemy.hp <= 0);
  if (enemy.hp > 0) {
    if (armor) message("ARMOR RESISTS · SWITCH TO HEAVY WEAPONS");
    return;
  }
  enemy.dead = true;
  enemy.canAttack = false;
  enemy.group.removeFromParent();
  score += specs[enemy.type].score;
  explode(
    enemy.group.position.clone().add(new THREE.Vector3(0, 1, 0)),
    enemy.type === "infantry" ? 0.55 : specs[enemy.type].air ? 3.5 : 2.8,
  );
  message(
    specs[enemy.type].score +
      " POINTS / " +
      enemy.type.toUpperCase() +
      " DESTROYED",
  );
}
function fire() {
  if (state !== "combat" || reload > 0 || cooldown > 0 || switchTime > 0)
    return;
  const definition = weapons[weapon];
  if (definition.mag <= 0) {
    if (definition.reserve > 0) reloadWeapon();
    else message("AMMUNITION DEPLETED · SWITCH WEAPON");
    return;
  }
  definition.mag--;
  cooldown = 1 / definition.fireRate;
  weaponView.fire();
  shake = weapon === "MG" ? 0.025 : 0.1;
  sound(weapon === "MG" ? "gun" : "heavy");
  
  // Increase spread during sustained fire - more for MG, less for heavy weapons
  const spreadBuildup = weapon === "MG" ? 0.0035 : weapon === "CANNON" ? 0.0012 : 0.0018;
  const spreadKick = weapon === "MG" ? 0.0015 : weapon === "CANNON" ? 0.0004 : 0.0006;
  spreadAngle += spreadBuildup + Math.random() * spreadKick;
  spreadX += (Math.random() - 0.5) * spreadKick * 2;
  spreadY += (Math.random() - 0.5) * spreadKick * 2;
  
  camera.getWorldDirection(lookDirection);
  // Apply spread offset to aim direction
  const aimDirection = lookDirection.clone();
  aimDirection.x += spreadX;
  aimDirection.y += spreadY;
  // Add random spread within the current spread angle
  const randomSpread = (Math.random() - 0.5) * spreadAngle;
  const randomYaw = (Math.random() - 0.5) * spreadAngle;
  aimDirection.applyAxisAngle(new THREE.Vector3(1, 0, 0), randomSpread);
  aimDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), randomYaw);
  aimDirection.normalize();
  
  const origin = playerPosition.clone();
  if (weapon === "MG") {
    enemyLayer.updateMatrixWorld(true);
    raycaster.set(origin, aimDirection);
    raycaster.far = 750;
    const hit = raycaster
      .intersectObjects(enemyLayer.children, true)
      .find((hit) => !hit.object.userData.enemy.dead);
    const blocked = obstructionDistance(
      origin,
      aimDirection,
      hit?.distance ?? 750,
    );
    const distance = Math.min(hit?.distance ?? 750, blocked);
    const end = origin.clone().addScaledVector(aimDirection, distance);
    const muzzle = new THREE.Vector3(0.45, -0.43, -2)
      .applyQuaternion(camera.quaternion)
      .add(origin);
    // Create individual tracer rounds with shorter lifetime for clearly visible separate bullets
    addTracer(muzzle, end, 0xffd47c, 0.08);
    if (hit && hit.distance < blocked)
      hitEnemy(hit.object.userData.enemy, definition.damage, weapon, hit.point);
    else if (Number.isFinite(blocked)) sparks(end);
  } else {
    const mesh = new THREE.Mesh(
      sphereGeometry,
      new THREE.MeshBasicMaterial({
        color: weapon === "ROCKET" ? 0xffa057 : 0xffe4a5,
      }),
    );
    mesh.scale.setScalar(0.22);
    mesh.position.copy(origin).addScaledVector(aimDirection, 2);
    projectileLayer.add(mesh);
    const velocity = aimDirection
      .clone()
      .multiplyScalar(weapon === "ROCKET" ? 150 : 230);
    shots.push({
      mesh,
      velocity,
      damage: definition.damage,
      splash: definition.splash,
      life: 7,
      owner: "player",
      weapon,
      previous: mesh.position.clone(),
    });
  }
}
function enemyAttack(enemy: Enemy) {
  const origin = enemyOrigin(enemy);
  // Recheck at the moment of discharge, including after an attack wind-up.
  if (
    enemy.dead ||
    !canEngage(
      origin,
      playerPosition,
      specs[enemy.type].range,
      clearLineOfSight(origin),
    )
  )
    return false;
  const direction = playerPosition.clone().sub(origin).normalize();
  const mesh = new THREE.Mesh(
    sphereGeometry,
    new THREE.MeshBasicMaterial({ color: 0xff7150 }),
  );
  mesh.scale.setScalar(enemy.type === "tank" ? 0.36 : 0.16);
  mesh.position.copy(origin).addScaledVector(direction, 2);
  projectileLayer.add(mesh);
  sparks(origin);
  shots.push({
    mesh,
    velocity: direction.multiplyScalar(enemy.type === "infantry" ? 80 : 55),
    damage: specs[enemy.type].attack * 3,
    splash: 0,
    life: 6,
    owner: "enemy",
    weapon: "MG",
    previous: mesh.position.clone(),
  });
  return true;
}
function updateEnemies(dt: number) {
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const position = enemy.group.position,
      definition = specs[enemy.type];
    let moving = false;
    if (enemy.type === "aircraft") {
      const to = enemy.target.clone().sub(position);
      if (to.length() < 8) {
        enemy.passes++;
        if (enemy.passes >= 3) {
          enemy.dead = true;
          enemy.group.removeFromParent();
          continue;
        }
        enemy.target.set(-position.x, 70, 36 - position.z);
      }
      position.addScaledVector(to.normalize(), enemy.speed * dt);
      enemy.group.lookAt(enemy.target);
      enemy.group.rotateY(Math.PI);
    } else {
      const to = playerPosition.clone().sub(position);
      to.y = 0;
      const stop =
        enemy.type === "heli"
          ? 105
          : enemy.type === "tank"
            ? 115
            : enemy.type === "apc"
              ? 75
              : enemy.type === "infantry"
                ? 25
                : 45;
      if (to.length() > stop) {
        position.addScaledVector(to.normalize(), enemy.speed * dt);
        moving = true;
      }
      if (enemy.type === "heli") {
        position.y = 42 + Math.sin(simulationTime * 1.2 + enemy.group.id) * 5;
        position.x += Math.sin(simulationTime * 0.5 + enemy.group.id) * dt * 4;
      } else position.y = terrainHeight(position.x, position.z);
      enemy.group.rotation.y = Math.atan2(
        position.x - playerPosition.x,
        position.z - playerPosition.z,
      );
    }
    animateEnemy(
      enemy.group,
      enemy.type,
      simulationTime + enemy.group.id,
      moving,
    );
    if (
      enemy.type === "truck" &&
      !enemy.unloaded &&
      position.distanceTo(playerPosition) < 80 &&
      enemies.filter((e) => !e.dead).length <= 28
    ) {
      enemy.unloaded = true;
      for (let i = 0; i < 4; i++) spawn("infantry", position);
    }
    enemy.sightTimer -= dt;
    if (enemy.sightTimer <= 0) {
      const origin = enemyOrigin(enemy);
      enemy.canAttack = canEngage(
        origin,
        playerPosition,
        definition.range,
        origin.distanceTo(playerPosition) <= definition.range &&
          clearLineOfSight(origin),
      );
      enemy.sightTimer = 0.3;
    }
    if (!enemy.canAttack) {
      enemy.warning = 0;
      enemy.fire = Math.max(enemy.fire, 0.5);
      continue;
    }
    if (enemy.warning > 0) {
      enemy.warning -= dt;
      if (enemy.warning <= 0) {
        enemyAttack(enemy);
        enemy.fire = Math.max(2.5, 5 - wave * 0.12) + Math.random() * 2;
      }
      continue;
    }
    enemy.fire -= dt;
    if (enemy.fire > 0) continue;
    if (
      enemy.type === "tank" ||
      enemy.type === "heli" ||
      enemy.type === "aircraft"
    ) {
      if (simulationTime < heavyAttackReady) continue;
      heavyAttackReady = simulationTime + 1.6;
      enemy.warning = 0.85;
      message(enemy.type.toUpperCase() + " PREPARING TO FIRE");
      sparks(enemyOrigin(enemy));
    } else {
      enemyAttack(enemy);
      enemy.fire = Math.max(2.5, 5 - wave * 0.12) + Math.random() * 2;
    }
  }
}
function hurtPlayer(amount: number) {
  if (state !== "combat") return;
  playerHp = Math.max(0, playerHp - amount);
  hud.hurt();
  shake = 0.14;
  sound("impact");
  message("BUNKER HIT / −" + amount + " INTEGRITY");
}
function updateShots(dt: number) {
  const gravity = 24.5; // Increased gravity for more noticeable bullet drop over distance
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i];
    shot.previous.copy(shot.mesh.position);
    // Apply bullet drop to projectiles (CANNON and ROCKET)
    if (shot.owner === "player" && (shot.weapon === "CANNON" || shot.weapon === "ROCKET")) {
      shot.velocity.y -= gravity * dt;
    } else if (shot.owner === "enemy") {
      // Enemy projectiles also experience gravity (reduced for gameplay balance)
      shot.velocity.y -= gravity * 0.3 * dt;
    }
    shot.mesh.position.addScaledVector(shot.velocity, dt);
    shot.life -= dt;
    let hit = false,
      enemyHit: Enemy | undefined,
      bestT = Infinity;
    const step = shot.mesh.position.clone().sub(shot.previous),
      length = step.length(),
      direction = step.clone().normalize();
    const obstruction = obstructionDistance(shot.previous, direction, length);
    if (obstruction <= length) {
      bestT = obstruction / length;
      hit = true;
    }
    if (shot.owner === "enemy") {
      const t = segmentHit(
        shot.previous,
        shot.mesh.position,
        playerPosition,
        2.1,
      );
      if (t !== null && t < bestT) {
        shot.mesh.position.lerpVectors(shot.previous, shot.mesh.position, t);
        hurtPlayer(shot.damage);
        hit = true;
      }
    } else {
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        targetCenter.copy(enemy.group.position);
        targetCenter.y += specs[enemy.type].air ? 0 : 1.7;
        const t = segmentHit(
          shot.previous,
          shot.mesh.position,
          targetCenter,
          enemy.type === "infantry" ? 1.5 : specs[enemy.type].air ? 3.6 : 3.2,
        );
        if (t !== null && t < bestT) {
          bestT = t;
          enemyHit = enemy;
          hit = true;
        }
      }
      if (hit) {
        shot.mesh.position.lerpVectors(
          shot.previous,
          shot.mesh.position,
          bestT,
        );
        if (enemyHit)
          hitEnemy(enemyHit, shot.damage, shot.weapon, shot.mesh.position);
        for (const enemy of enemies)
          if (enemy !== enemyHit && !enemy.dead) {
            const distance = enemy.group.position.distanceTo(
              shot.mesh.position,
            );
            if (distance < shot.splash)
              hitEnemy(
                enemy,
                shot.damage * 0.65 * (1 - distance / shot.splash),
                shot.weapon,
                shot.mesh.position,
              );
          }
        explode(shot.mesh.position, shot.weapon === "ROCKET" ? 3 : 1.5);
      }
    }
    addTracer(
      shot.previous,
      shot.mesh.position,
      shot.owner === "enemy" ? 0xff8060 : 0xffce77,
      0.06,
    );
    if (hit || shot.life <= 0) {
      releaseMesh(shot.mesh);
      shots.splice(i, 1);
    }
  }
}
function updateEffects(dt: number) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const effect = effects[i];
    effect.life -= dt;
    effect.mesh.position.addScaledVector(effect.velocity, dt);
    effect.velocity.multiplyScalar(Math.exp(-dt * 2));
    effect.mesh.scale.addScalar(effect.growth * dt);
    (effect.mesh.material as THREE.MeshBasicMaterial).opacity =
      Math.max(0, effect.life / effect.duration) * 0.8;
    if (effect.life <= 0) {
      releaseMesh(effect.mesh);
      effects.splice(i, 1);
    }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) {
      const { line } = tracers[i];
      line.removeFromParent();
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      tracers.splice(i, 1);
    }
  }
}
function beginWave() {
  state = "combat";
  spawnIndex = 0;
  spawnTimer = 1;
  activePlan = [...wavePlans[Math.min(wave - 1, 9)]];
  if (wave > 10)
    activePlan.push(...wavePlans[8].slice(0, Math.min(8, wave - 10)));
  banner(
    "WAVE " + String(wave).padStart(2, "0"),
    wave > 4 ? "COMBINED ARMS / CHECK ALL BEARINGS" : "HOLD THE BEACHHEAD",
  );
}
function completeWave() {
  if (wave === 10 && !endless) {
    state = "victory";
    showEnd(true);
    return;
  }
  wave++;
  state = "intermission";
  intermission = 12;
  trigger = false;
  reload = 0;
  playerHp = Math.min(1000, playerHp + 150);
  for (const definition of Object.values(weapons)) {
    definition.reserve = Math.max(definition.reserve, definition.maxReserve);
    definition.mag = definition.maxMag;
  }
  banner("SECTOR SECURED", "+150 INTEGRITY / AMMUNITION RESUPPLIED");
}
function update(dt: number) {
  if (!active()) return;
  simulationTime += dt;
  worldTime += dt;
  updateEffects(dt);
  if (state === "intermission") {
    intermission -= dt;
    if (intermission <= 0) beginWave();
    return;
  }
  switchTime = Math.max(0, switchTime - dt);
  cooldown = cooldown <= dt + 1e-6 ? 0 : cooldown - dt;
  
  // Spread recovery - gradually return to zero (faster when not firing)
  const spreadRecovery = weapon === "MG" ? 3.5 : weapon === "CANNON" ? 1.8 : 2.4;
  spreadAngle = THREE.MathUtils.lerp(spreadAngle, 0, Math.min(1, spreadRecovery * dt));
  spreadX = THREE.MathUtils.lerp(spreadX, 0, Math.min(1, spreadRecovery * dt));
  spreadY = THREE.MathUtils.lerp(spreadY, 0, Math.min(1, spreadRecovery * dt));
  
  if (reload > 0) {
    reload -= dt;
    if (reload <= 0) completeReload();
  }
  if (trigger) fire();
  spawnTimer -= dt;
  if (
    spawnIndex < activePlan.length &&
    spawnTimer <= 0 &&
    enemies.filter((enemy) => !enemy.dead).length < 32
  ) {
    spawn(activePlan[spawnIndex++]);
    spawnTimer = Math.max(0.8, 3 - wave * 0.1);
  }
  updateEnemies(dt);
  updateShots(dt);
  if (playerHp <= 0) {
    state = "gameover";
    showEnd(false);
    return;
  }
  if (
    spawnIndex >= activePlan.length &&
    enemies.every((enemy) => enemy.dead) &&
    shots.length === 0
  )
    completeWave();
}
function showEnd(victory: boolean) {
  trigger = zoom = false;
  controls.unlock();
  overlay.innerHTML =
    '<div class="card"><div class="eyebrow">MISSION REPORT / SECTOR 07</div><h1>' +
    (victory ? "BEACHHEAD<span>SECURED</span>" : "LAST<span>STAND</span>") +
    '</h1><div class="title-rule"></div><p>' +
    (victory ? "You held the line." : "The emplacement has fallen.") +
    '</p><div class="mission-stats"><div><b>' +
    score.toLocaleString() +
    "</b><span>MISSION SCORE</span></div><div><b>" +
    wave +
    '</b><span>WAVE REACHED</span></div></div><button class="button" id="restart">REDEPLOY →</button>' +
    (victory
      ? '<button class="button secondary" id="endless">CONTINUE / ENDLESS SURVIVAL →</button>'
      : "") +
    "</div>";
  overlay.style.display = "flex";
  document.querySelector("#restart")!.addEventListener("click", reset);
  document.querySelector("#endless")?.addEventListener("click", () => {
    endless = true;
    wave = 11;
    playerHp = Math.max(500, playerHp);
    for (const definition of Object.values(weapons)) {
      definition.mag = definition.maxMag;
      definition.reserve = definition.maxReserve;
    }
    overlay.style.display = "none";
    beginWave();
    capturePointer();
  });
}
function pause() {
  if (!active()) return;
  pausedState = state;
  state = "paused";
  trigger = zoom = false;
  heldKeys.clear();
  controls.unlock();
  overlay.innerHTML =
    '<div class="card"><div class="eyebrow">EMPLACEMENT / STANDBY</div><h1>HOLD<span>POSITION</span></h1><div class="title-rule"></div><p>Combat is paused.</p><button class="button" id="resume">RESUME DEFENSE →</button><button class="button secondary" id="restart">RESTART MISSION</button><div class="hint">Mouse: aim · Left click: fire · Right click: zoom<br>1–3 or mouse wheel: weapons · R: reload<br>Arrow keys also aim. If the pointer is not captured, drag to aim.</div></div>';
  overlay.style.display = "flex";
  document.querySelector("#resume")!.addEventListener("click", resume);
  document.querySelector("#restart")!.addEventListener("click", reset);
}
function resume() {
  state = pausedState;
  overlay.style.display = "none";
  accumulator = 0;
  initializeAudio();
  capturePointer();
}
function updateHud(dt: number) {
  camera.getWorldDirection(lookDirection);
  const definition = weapons[weapon];
  hud.update(dt, {
    heading: bearing(lookDirection.x, lookDirection.z),
    hp: playerHp,
    score,
    wave,
    state,
    mag: definition.mag,
    reserve: definition.reserve,
    maxMag: definition.maxMag,
    weapon,
    weaponName: definition.name,
    reload,
    reloadDuration: definition.reload,
    switching: switchTime > 0,
    zoom,
    intermission,
    contacts: enemies
      .filter((enemy) => !enemy.dead)
      .map((enemy) => ({
        id: enemy.group.id,
        x: enemy.group.position.x - playerPosition.x,
        z: enemy.group.position.z - playerPosition.z,
        distance: enemy.group.position.distanceTo(playerPosition),
        air: !!specs[enemy.type].air,
        inRange: enemy.canAttack,
      })),
  });
  inspectionTimer -= dt;
  if (inspectionTimer <= 0 && active()) {
    inspectionTimer = 0.15;
    raycaster.set(playerPosition, lookDirection);
    raycaster.far = 650;
    const hit = raycaster
      .intersectObjects(enemyLayer.children, true)
      .find((hit) => !hit.object.userData.enemy.dead);
    const target = document.querySelector<HTMLElement>("#targetInfo")!;
    target.textContent =
      hit &&
      obstructionDistance(playerPosition, lookDirection, hit.distance) >
        hit.distance
        ? hit.object.userData.enemy.type.toUpperCase() +
          " / " +
          Math.round(hit.distance) +
          " M\n" +
          Math.ceil(hit.object.userData.enemy.hp) +
          " HP"
        : "";
  }
}
function aim(dx: number, dy: number) {
  camera.rotation.order = "YXZ";
  camera.rotation.y -= dx;
  camera.rotation.x = THREE.MathUtils.clamp(
    camera.rotation.x - dy,
    THREE.MathUtils.degToRad(-35),
    THREE.MathUtils.degToRad(85),
  );
}
function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  if (active()) {
    aim(
      ((heldKeys.has("ArrowRight") ? 1 : 0) -
        (heldKeys.has("ArrowLeft") ? 1 : 0)) *
        dt,
      ((heldKeys.has("ArrowDown") ? 1 : 0) -
        (heldKeys.has("ArrowUp") ? 1 : 0)) *
        dt,
    );
    accumulator = Math.min(accumulator + dt, 0.1);
    while (accumulator >= 1 / 60) {
      update(1 / 60);
      accumulator -= 1 / 60;
    }
  } else if (state === "title") {
    worldTime += dt;
  }
  battlefield.update(worldTime);
  camera.position.copy(playerPosition);
  // No camera recoil - spread affects bullet trajectory only, not view
  if (shake > 0 && active()) {
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt);
  }
  camera.fov = THREE.MathUtils.damp(camera.fov, zoom ? 45 : 75, 12, dt);
  camera.updateProjectionMatrix();
  weaponView.update(active() ? dt : 0, simulationTime, reload > 0, zoom);
  updateHud(dt);
  renderer.render(scene, camera);
  if (state !== "title") weaponView.render(renderer);
}
document.querySelector("#start")!.addEventListener("click", reset);
document.querySelector("#pauseButton")!.addEventListener("click", pause);
document
  .querySelectorAll<HTMLElement>("[data-weapon]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      selectWeapon(button.dataset.weapon as Weapon),
    ),
  );
controls.addEventListener("unlock", () => {
  if (active()) pause();
});
document.addEventListener("pointerlockerror", () =>
  message("DRAG TO AIM · ARROW KEYS ALSO AVAILABLE"),
);
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    pause();
    return;
  }
  if (state === "paused" && event.key === "Enter") {
    resume();
    return;
  }
  if (!active()) return;
  if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    heldKeys.add(event.key);
  }
  if (event.key.toLowerCase() === "r") reloadWeapon();
  const selected = (
    { "1": "MG", "2": "CANNON", "3": "ROCKET" } as Record<string, Weapon>
  )[event.key];
  if (selected) selectWeapon(selected);
});
window.addEventListener("keyup", (event) => heldKeys.delete(event.key));
renderer.domElement.addEventListener("mousedown", (event) => {
  if (state !== "combat") return;
  if (event.button === 0) {
    trigger = true;
    fire();
  }
  if (event.button === 2) zoom = true;
});
window.addEventListener("mouseup", (event) => {
  if (event.button === 0) trigger = false;
  if (event.button === 2) zoom = false;
});
renderer.domElement.addEventListener("mousemove", (event) => {
  if (active() && !controls.isLocked && event.buttons)
    aim(event.movementX * 0.002, event.movementY * 0.002);
});
renderer.domElement.addEventListener("contextmenu", (event) =>
  event.preventDefault(),
);
window.addEventListener(
  "wheel",
  (event) => {
    if (!active()) return;
    event.preventDefault();
    const choices: Weapon[] = ["MG", "CANNON", "ROCKET"];
    selectWeapon(
      choices[(choices.indexOf(weapon) + (event.deltaY > 0 ? 1 : 2)) % 3],
    );
  },
  { passive: false },
);
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  weaponView.resize(camera.aspect);
});
requestAnimationFrame(animate);
