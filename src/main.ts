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
interface MuzzleSmoke {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
  spin: number;
  driftPhase: number;
  driftSpeed: number;
  driftAmount: number;
  growth: number;
}

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = screenMarkup;
const overlay = document.querySelector<HTMLElement>("#overlay")!;
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

const hud = new CombatHud(camera);
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
  effectLayer = new THREE.Group(),
  smokeLayer = new THREE.Group();
scene.add(enemyLayer, projectileLayer, effectLayer, smokeLayer);
const raycaster = new THREE.Raycaster();
const sphereGeometry = new THREE.SphereGeometry(1, 8, 6);
// Procedural wispy smoke sprite texture: several overlapping soft blobs so
// each puff reads as an irregular cloud instead of a flat, hard-edged circle.
const smokeTexture = (() => {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2,
    cy = size / 2;
  const blobs = 7;
  for (let i = 0; i < blobs; i++) {
    const angle = (i / blobs) * Math.PI * 2 + Math.random() * 0.8;
    const dist = Math.random() * size * 0.22;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist * 0.85;
    const radius = size * (0.22 + Math.random() * 0.24);
    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
    const alpha = 0.35 + Math.random() * 0.25;
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.55, `rgba(230,228,222,${alpha * 0.45})`);
    gradient.addColorStop(1, "rgba(210,208,200,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(bx, by, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
})();
const enemies: Enemy[] = [],
  shots: Shot[] = [],
  effects: Effect[] = [],
  tracers: Tracer[] = [],
  muzzleSmokes: MuzzleSmoke[] = [];
const heldKeys = new Set<string>();
let lastAutoPauseTime = 0;
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
// Muzzle smoke state - builds up during sustained fire, dissipates when not firing
let muzzleSmoke = 0,
  smokeAccumulator = 0,
  wasFiring = false;
let audioContext: AudioContext | undefined,
  noiseBuffer: AudioBuffer | undefined;
const lookDirection = new THREE.Vector3(),
  targetCenter = new THREE.Vector3(),
  muzzleRight = new THREE.Vector3(),
  muzzleUp = new THREE.Vector3();
// The viewmodel gun sits offset to the right/below screen center (see
// WeaponView's mount position) - mirror that offset in world space so
// muzzle flashes, tracers and smoke appear to come from the gun itself
// instead of dead-center on the camera.
function muzzleOrigin(forwardOffset: number) {
  camera.getWorldDirection(lookDirection);
  muzzleRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  muzzleUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const sideAngle = zoom ? 0.01 : 0.127;
  const upAngle = zoom ? 0.02 : 0.127;
  return playerPosition
    .clone()
    .addScaledVector(lookDirection, forwardOffset)
    .addScaledVector(muzzleRight, forwardOffset * sideAngle)
    .addScaledVector(muzzleUp, -forwardOffset * upAngle);
}
// Stereo pan (-1..1) for a world position relative to the camera, used to
// give hit-confirm sounds a bit of left/right positioning.
function muzzlePan(position: THREE.Vector3) {
  camera.getWorldDirection(lookDirection);
  muzzleRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const toTarget = position.clone().sub(playerPosition);
  if (toTarget.lengthSq() < 1e-6) return 0;
  toTarget.normalize();
  return THREE.MathUtils.clamp(toTarget.dot(muzzleRight) * 1.5, -1, 1);
}
// Bullet spread state - heat builds during sustained fire, recovers when not firing
let spreadHeat = 0,
  spreadAngle = 0,
  spreadX = 0,
  spreadY = 0;
const spreadMax = { MG: 0.1, CANNON: 0.012, ROCKET: 0.016 } as const;
const spreadBiasMax = { MG: 0.018, CANNON: 0.004, ROCKET: 0.006 } as const;
function bloomFromHeat(heat: number) {
  const t = THREE.MathUtils.clamp(heat, 0, 1);
  // Cubic ease-in: first ~1.5s stays tight, then opens to the cap
  return t * t * t;
}
function applyBloomSpread() {
  spreadAngle = bloomFromHeat(spreadHeat) * spreadMax[weapon];
}
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
// Soft hit-marker "thup": a muted, dry tap like hitting folded cloth - no
// metallic ring or sharp click, just a brief muffled noise body plus a
// low, quick thump for a bit of weight.
function hitMarkerSound(kill: boolean, pan = 0) {
  if (!audioContext || !noiseBuffer) return;
  const ctx = audioContext;
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const thup = (
    startTime: number,
    duration: number,
    noiseVolume: number,
    thumpVolume: number,
    lowFreq: number,
  ) => {
    const noise = ctx.createBufferSource(),
      noiseFilter = ctx.createBiquadFilter(),
      noiseGain = ctx.createGain(),
      thump = ctx.createOscillator(),
      thumpGain = ctx.createGain(),
      panner = ctx.createStereoPanner();
    panner.pan.value = clampedPan;
    // Muffled noise body - heavily lowpassed so it sounds dry/padded, not crisp
    noise.buffer = noiseBuffer;
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 420;
    noiseFilter.Q.value = 0.2;
    noiseGain.gain.setValueAtTime(0.0001, startTime);
    noiseGain.gain.exponentialRampToValueAtTime(noiseVolume, startTime + 0.008);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    // Soft low thump for a touch of bassy weight, no overtones/ringing
    thump.type = "sine";
    thump.frequency.setValueAtTime(lowFreq, startTime);
    thump.frequency.exponentialRampToValueAtTime(lowFreq * 0.65, startTime + duration);
    thumpGain.gain.setValueAtTime(0.0001, startTime);
    thumpGain.gain.exponentialRampToValueAtTime(thumpVolume, startTime + 0.01);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    noise
      .connect(noiseFilter)
      .connect(noiseGain)
      .connect(panner)
      .connect(ctx.destination);
    thump.connect(thumpGain).connect(panner).connect(ctx.destination);
    noise.start(startTime);
    noise.stop(startTime + duration + 0.02);
    thump.start(startTime);
    thump.stop(startTime + duration + 0.02);
    noise.onended = () => {
      noise.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
    };
    thump.onended = () => {
      thump.disconnect();
      thumpGain.disconnect();
      panner.disconnect();
    };
  };
  const now = ctx.currentTime;
  if (kill) thup(now, 0.1, 0.32, 0.26, 160);
  else thup(now, 0.07, 0.24, 0.18, 200);
}
// Explosion: a sharp crack, a descending rumbling body, and a deep sub-bass
// boom underneath for weight - used for enemy deaths and projectile impacts.
function explosionSound(pan = 0, size = 1) {
  if (!audioContext || !noiseBuffer) return;
  const ctx = audioContext;
  const now = ctx.currentTime;
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const scale = THREE.MathUtils.clamp(size / 2.5, 0.55, 1.6);
  const panner = ctx.createStereoPanner();
  panner.pan.value = clampedPan;
  panner.connect(ctx.destination);

  // Sharp initial crack - brief bright noise burst
  const crack = ctx.createBufferSource(),
    crackFilter = ctx.createBiquadFilter(),
    crackGain = ctx.createGain();
  crack.buffer = noiseBuffer;
  crackFilter.type = "highpass";
  crackFilter.frequency.value = 1500;
  crackGain.gain.setValueAtTime(0.001, now);
  crackGain.gain.exponentialRampToValueAtTime(0.32 * scale, now + 0.004);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  crack.connect(crackFilter).connect(crackGain).connect(panner);
  crack.start(now);
  crack.stop(now + 0.06);
  crack.onended = () => {
    crack.disconnect();
    crackFilter.disconnect();
    crackGain.disconnect();
  };

  // Rumbling body - noise sweeping from a bright crack down into a dull roar
  const bodyDuration = 0.55 * scale;
  const body = ctx.createBufferSource(),
    bodyFilter = ctx.createBiquadFilter(),
    bodyGain = ctx.createGain();
  body.buffer = noiseBuffer;
  bodyFilter.type = "lowpass";
  bodyFilter.Q.value = 0.4;
  bodyFilter.frequency.setValueAtTime(2600, now);
  bodyFilter.frequency.exponentialRampToValueAtTime(180, now + bodyDuration);
  bodyGain.gain.setValueAtTime(0.001, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.4 * scale, now + 0.02);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + bodyDuration);
  body.connect(bodyFilter).connect(bodyGain).connect(panner);
  body.start(now);
  body.stop(now + bodyDuration + 0.02);
  body.onended = () => {
    body.disconnect();
    bodyFilter.disconnect();
    bodyGain.disconnect();
  };

  // Sub-bass boom - gives the blast physical weight
  const boomDuration = 0.4 * scale;
  const boom = ctx.createOscillator(),
    boomGain = ctx.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(105, now);
  boom.frequency.exponentialRampToValueAtTime(32, now + boomDuration);
  boomGain.gain.setValueAtTime(0.001, now);
  boomGain.gain.exponentialRampToValueAtTime(0.5 * scale, now + 0.015);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + boomDuration);
  boom.connect(boomGain).connect(panner);
  boom.start(now);
  boom.stop(now + boomDuration + 0.02);
  boom.onended = () => {
    boom.disconnect();
    boomGain.disconnect();
    panner.disconnect();
  };
}
// Sand impact: a soft, dry, grainy "puff" of a bullet kicking up sand/dirt -
// no tonal ring or whistle, just noise-based texture and a bit of scatter.
function ricochetSound(pan = 0) {
  if (!audioContext || !noiseBuffer) return;
  const ctx = audioContext;
  const now = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(ctx.destination);
  const layers: { node: AudioScheduledSourceNode; extras: AudioNode[] }[] = [];

  // Soft puff body - band-limited noise, dry and grainy rather than sharp
  const puff = ctx.createBufferSource(),
    puffFilter = ctx.createBiquadFilter(),
    puffGain = ctx.createGain();
  puff.buffer = noiseBuffer;
  puffFilter.type = "bandpass";
  puffFilter.frequency.value = 1200;
  puffFilter.Q.value = 0.5;
  puffGain.gain.setValueAtTime(0.001, now);
  puffGain.gain.exponentialRampToValueAtTime(0.17, now + 0.008);
  puffGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  puff.connect(puffFilter).connect(puffGain).connect(panner);
  layers.push({ node: puff, extras: [puffFilter, puffGain] });

  // Dull low body for a bit of weight - lowpassed noise, not a tone
  const thump = ctx.createBufferSource(),
    thumpFilter = ctx.createBiquadFilter(),
    thumpGain = ctx.createGain();
  thump.buffer = noiseBuffer;
  thumpFilter.type = "lowpass";
  thumpFilter.frequency.value = 260;
  thumpGain.gain.setValueAtTime(0.001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.11, now + 0.01);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  thump.connect(thumpFilter).connect(thumpGain).connect(panner);
  layers.push({ node: thump, extras: [thumpFilter, thumpGain] });

  // A few tiny staggered grains of scattering sand/grit
  for (let i = 0; i < 4; i++) {
    const startTime = now + 0.008 + Math.random() * 0.045;
    const grain = ctx.createBufferSource(),
      grainFilter = ctx.createBiquadFilter(),
      grainGain = ctx.createGain();
    grain.buffer = noiseBuffer;
    grainFilter.type = "highpass";
    grainFilter.frequency.value = 2800 + Math.random() * 2200;
    grainGain.gain.setValueAtTime(0.001, startTime);
    grainGain.gain.exponentialRampToValueAtTime(
      0.015 + Math.random() * 0.018,
      startTime + 0.002,
    );
    grainGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.02);
    grain.connect(grainFilter).connect(grainGain).connect(panner);
    grain.start(startTime);
    grain.stop(startTime + 0.03);
    layers.push({ node: grain, extras: [grainFilter, grainGain] });
  }

  puff.start(now);
  puff.stop(now + 0.08);
  thump.start(now);
  thump.stop(now + 0.11);
  let remaining = layers.length;
  for (const { node, extras } of layers) {
    node.onended = () => {
      node.disconnect();
      for (const extra of extras) extra.disconnect();
      remaining--;
      if (remaining === 0) panner.disconnect();
    };
  }
}
// Headshot clank: a solid, punchy strike on a steel helmet - dense low thud
// plus a short metallic knock, without the hollow, ringing "tin can" tail.
function splatSound(pan = 0) {
  if (!audioContext) return;
  const ctx = audioContext;
  const now = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(ctx.destination);
  const layers: { node: AudioScheduledSourceNode; extras: AudioNode[] }[] = [];

  // Sharp transient strike - bright broadband click for the moment of impact
  if (noiseBuffer) {
    const click = ctx.createBufferSource(),
      clickFilter = ctx.createBiquadFilter(),
      clickGain = ctx.createGain();
    click.buffer = noiseBuffer;
    clickFilter.type = "highpass";
    clickFilter.frequency.value = 2800;
    clickGain.gain.setValueAtTime(0.001, now);
    clickGain.gain.exponentialRampToValueAtTime(0.26, now + 0.003);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    click.connect(clickFilter).connect(clickGain).connect(panner);
    click.start(now);
    click.stop(now + 0.02);
    layers.push({ node: click, extras: [clickFilter, clickGain] });
  }

  // Dense low body - gives the strike solid weight/mass rather than a hollow
  // shell; a short lowpassed noise thump, not a pure tone
  if (noiseBuffer) {
    const thud = ctx.createBufferSource(),
      thudFilter = ctx.createBiquadFilter(),
      thudGain = ctx.createGain();
    thud.buffer = noiseBuffer;
    thudFilter.type = "lowpass";
    thudFilter.Q.value = 1.2;
    thudFilter.frequency.setValueAtTime(650, now);
    thudFilter.frequency.exponentialRampToValueAtTime(200, now + 0.09);
    thudGain.gain.setValueAtTime(0.001, now);
    thudGain.gain.exponentialRampToValueAtTime(0.34, now + 0.005);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    thud.connect(thudFilter).connect(thudGain).connect(panner);
    thud.start(now);
    thud.stop(now + 0.11);
    layers.push({ node: thud, extras: [thudFilter, thudGain] });
  }

  // Brief metallic knock - a single quick tone, damped fast so it reads as a
  // dense "clank" rather than a ringing tin-can rattle
  const knock = ctx.createOscillator(),
    knockGain = ctx.createGain();
  knock.type = "triangle";
  const freq = 620 + Math.random() * 120;
  knock.frequency.setValueAtTime(freq, now);
  knock.frequency.exponentialRampToValueAtTime(freq * 0.8, now + 0.07);
  knockGain.gain.setValueAtTime(0.001, now);
  knockGain.gain.exponentialRampToValueAtTime(0.22, now + 0.004);
  knockGain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
  knock.connect(knockGain).connect(panner);
  knock.start(now);
  knock.stop(now + 0.08);
  layers.push({ node: knock, extras: [knockGain] });

  let remaining = layers.length;
  for (const { node, extras } of layers) {
    node.onended = () => {
      node.disconnect();
      for (const extra of extras) extra.disconnect();
      remaining--;
      if (remaining === 0) panner.disconnect();
    };
  }
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
  for (const smoke of muzzleSmokes) {
    smoke.sprite.removeFromParent();
    (smoke.sprite.material as THREE.SpriteMaterial).dispose();
  }
  enemies.length = shots.length = effects.length = tracers.length = muzzleSmokes.length = 0;
  trigger = zoom = false;
  heldKeys.clear();
  accumulator = 0;
  heavyAttackReady = 0;
  window.clearTimeout(bannerTimer);
  window.clearTimeout(messageTimer);
  document.querySelector("#message")!.classList.remove("show");
}
let awaitingPointerLockClick = false;
function armPointerLockRetry() {
  // Browsers refuse to re-grant pointer lock from a keyboard-triggered
  // gesture (e.g. pressing Escape again) right after the lock was exited
  // via Escape. Fall back to arming a one-shot click to regain the lock,
  // and suppress the weapon firing on that reclaiming click.
  if (awaitingPointerLockClick) return;
  awaitingPointerLockClick = true;
  renderer.domElement.addEventListener(
    "mousedown",
    () => {
      awaitingPointerLockClick = false;
      if (active() && !controls.isLocked) capturePointer();
    },
    { once: true },
  );
}
function capturePointer() {
  // The Three.js version in this project discards the request's promise.
  // Handle browsers that deny capture and retain drag/keyboard aiming.
  const request = renderer.domElement.requestPointerLock() as
    | Promise<void>
    | undefined;
  if (request?.catch) {
    request.catch(() => {
      message("CLICK TO AIM · ARROW KEYS ALSO AVAILABLE");
      armPointerLockRetry();
    });
  } else {
    // Some browsers neither return a promise nor reject synchronously;
    // verify shortly after whether the lock was actually granted.
    window.setTimeout(() => {
      if (active() && !controls.isLocked) {
        message("CLICK TO AIM · ARROW KEYS ALSO AVAILABLE");
        armPointerLockRetry();
      }
    }, 60);
  }
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
  explosionSound(muzzlePan(position), size);
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
function bloodSplat(position: THREE.Vector3) {
  for (let i = 0; i < 7; i++)
    addEffect(
      position,
      i < 3 ? 0x8a1414 : 0x5c0d0d,
      0.05 + Math.random() * 0.05,
      0.32 + Math.random() * 0.18,
      new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 5,
        (Math.random() - 0.5) * 5,
      ),
      0,
    );
}
function ricochetSparks(position: THREE.Vector3) {
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    const upBias = 0.3 + Math.random() * 0.5;
    addEffect(
      position,
      i < 2 ? 0xffffff : 0xffcc44,
      i < 2 ? 0.04 : 0.03,
      0.15,
      new THREE.Vector3(
        Math.cos(angle) * speed * (1 - upBias),
        speed * upBias,
        Math.sin(angle) * speed * (1 - upBias),
      ),
      0,
    );
  }
}
function addMuzzleSmoke(position: THREE.Vector3, weapon: Weapon) {
  const baseSize = weapon === "MG" ? 0.5 : weapon === "CANNON" ? 0.95 : 0.8;
  // Spawn a small cluster of overlapping puffs per shot so the plume reads
  // as a billowing, irregular cloud rather than one flat circle.
  const puffs = weapon === "MG" ? 2 : 3;
  for (let p = 0; p < puffs; p++) {
    if (muzzleSmokes.length >= 70) return;
    const material = new THREE.SpriteMaterial({
      map: smokeTexture,
      color: 0xcac6bc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      rotation: Math.random() * Math.PI * 2,
    });
    const sprite = new THREE.Sprite(material);
    const jitter = 0.3;
    sprite.position.copy(position).add(
      new THREE.Vector3(
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter * 0.6,
        (Math.random() - 0.5) * jitter,
      ),
    );
    const size = baseSize * (0.65 + Math.random() * 0.7);
    sprite.scale.setScalar(size);
    smokeLayer.add(sprite);
    const life = 1.5 + Math.random() * 1.2;
    muzzleSmokes.push({
      sprite,
      life,
      maxLife: life,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.7,
        1 + Math.random() * 1.4,
        (Math.random() - 0.5) * 0.7,
      ),
      spin: (Math.random() - 0.5) * 1.2,
      driftPhase: Math.random() * Math.PI * 2,
      driftSpeed: 1.2 + Math.random() * 1.6,
      driftAmount: 0.35 + Math.random() * 0.35,
      growth: 0.45 + Math.random() * 0.55,
    });
  }
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
const HEADSHOT_MULTIPLIER = 2.5;
function hitEnemy(
  enemy: Enemy,
  amount: number,
  source: Weapon,
  position: THREE.Vector3,
  headshot = false,
) {
  if (enemy.dead) return;
  const armor =
    (enemy.type === "tank" || enemy.type === "apc") && source === "MG";
  enemy.hp -= amount * (headshot ? HEADSHOT_MULTIPLIER : 1) * (armor ? 0.12 : 1);
  sparks(position);
  if (headshot) bloodSplat(position);
  hud.hit(enemy.hp <= 0);
  if (headshot) splatSound(muzzlePan(position));
  else hitMarkerSound(enemy.hp <= 0, muzzlePan(position));
  if (enemy.hp > 0) {
    if (armor) message("ARMOR RESISTS · SWITCH TO HEAVY WEAPONS");
    else if (headshot) message("HEADSHOT · CRITICAL DAMAGE");
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
  weaponView.fire(weapon);
  shake = weapon === "MG" ? 0.025 : 0.1;
  sound(weapon === "MG" ? "gun" : "heavy");
  
  // Build up muzzle smoke during sustained fire
  const smokeBuildup = weapon === "MG" ? 0.08 : weapon === "CANNON" ? 0.15 : 0.12;
  muzzleSmoke = Math.min(1, muzzleSmoke + smokeBuildup);
  
  // Heat rises steadily; actual cone uses an ease-in so bloom stays small at first
  let heatPerShot = weapon === "MG" ? 0.05 : weapon === "CANNON" ? 0.06 : 0.08;
  if (weapon === "MG") {
    const curveFactor = 0.96;
    heatPerShot *= (1 + spreadHeat * curveFactor);
  }
  spreadHeat = Math.min(1, spreadHeat + heatPerShot);
  applyBloomSpread();
  const bloom = bloomFromHeat(spreadHeat);
  const kick = (weapon === "MG" ? 0.0014 : weapon === "CANNON" ? 0.0003 : 0.0004) * (0.2 + bloom);
  const bias = spreadBiasMax[weapon];
  spreadX = THREE.MathUtils.clamp(spreadX + (Math.random() - 0.5) * kick * 2, -bias, bias);
  spreadY = THREE.MathUtils.clamp(spreadY + (Math.random() - 0.5) * kick * 2, -bias, bias);
  
  camera.getWorldDirection(lookDirection);
  // Apply spread offset to aim direction (aim stays from the eye/camera so
  // the crosshair remains accurate; only the visible origin below is offset)
  const aimDirection = lookDirection.clone();
  aimDirection.x += spreadX;
  aimDirection.y += spreadY;
  // Add random spread within the current spread angle
  const randomSpread = (Math.random() - 0.5) * spreadAngle;
  const randomYaw = (Math.random() - 0.5) * spreadAngle;
  aimDirection.applyAxisAngle(new THREE.Vector3(1, 0, 0), randomSpread);
  aimDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), randomYaw);
  aimDirection.normalize();
  
  // Calculate muzzle position based on weapon type (offset to match the
  // on-screen gun position rather than spawning from dead-center)
  const muzzleOffset = weapon === "MG" ? 2.8 : weapon === "CANNON" ? 3.5 : 3.2;
  const origin = muzzleOrigin(muzzleOffset);
  
  // Add visible muzzle smoke at the muzzle position (not for MG - emitted on stop-fire)
  if (weapon !== "MG") addMuzzleSmoke(origin, weapon);

  if (weapon === "MG") {
    // Create individual visible projectile for MG instead of tracer line
    const mesh = new THREE.Mesh(
      sphereGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffd47c }),
    );
    mesh.scale.setScalar(0.12);
    mesh.position.copy(origin).addScaledVector(aimDirection, 1.5);
    projectileLayer.add(mesh);
    const velocity = aimDirection.clone().multiplyScalar(650);
    shots.push({
      mesh,
      velocity,
      damage: definition.damage,
      splash: 0,
      life: 1.2,
      owner: "player",
      weapon,
      previous: mesh.position.clone(),
    });
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
    // Apply bullet drop to projectiles (CANNON, ROCKET, and MG)
    if (shot.owner === "player") {
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
      let headshotHit = false;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        if (enemy.type === "infantry") {
          // Small headshot hitbox around the helmet - checked separately from
          // the body so a shot to the head can register bonus damage.
          targetCenter.copy(enemy.group.position);
          targetCenter.y += 3.15;
          const headT = segmentHit(
            shot.previous,
            shot.mesh.position,
            targetCenter,
            0.55,
          );
          targetCenter.copy(enemy.group.position);
          targetCenter.y += 1.7;
          const bodyT = segmentHit(
            shot.previous,
            shot.mesh.position,
            targetCenter,
            1.5,
          );
          const isHead = headT !== null && (bodyT === null || headT <= bodyT);
          const t = isHead ? headT : bodyT;
          if (t !== null && t < bestT) {
            bestT = t;
            enemyHit = enemy;
            hit = true;
            headshotHit = isHead;
          }
        } else {
          targetCenter.copy(enemy.group.position);
          targetCenter.y += specs[enemy.type].air ? 0 : 1.7;
          const t = segmentHit(
            shot.previous,
            shot.mesh.position,
            targetCenter,
            specs[enemy.type].air ? 3.6 : 3.2,
          );
          if (t !== null && t < bestT) {
            bestT = t;
            enemyHit = enemy;
            hit = true;
            headshotHit = false;
          }
        }
      }
      if (hit) {
        shot.mesh.position.lerpVectors(
          shot.previous,
          shot.mesh.position,
          bestT,
        );
        if (enemyHit)
          hitEnemy(
            enemyHit,
            shot.damage,
            shot.weapon,
            shot.mesh.position,
            headshotHit,
          );
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
        if (shot.weapon === "MG") {
          ricochetSparks(shot.mesh.position);
          // Only play the ground/obstruction ricochet sound when the bullet
          // didn't hit an enemy - enemy hits already get the hit-marker sound.
          if (!enemyHit) ricochetSound(muzzlePan(shot.mesh.position));
        } else explode(shot.mesh.position, shot.weapon === "ROCKET" ? 4.5 : 3.2);
      }
    }
    // Only add tracer for cannon/rocket projectiles, not MG bullets
    if (shot.weapon !== "MG") {
      addTracer(
        shot.previous,
        shot.mesh.position,
        shot.owner === "enemy" ? 0xff8060 : 0xffce77,
        0.06,
      );
    }
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
  // Update muzzle smoke particles: rise, curl sideways, spin, expand and fade
  for (let i = muzzleSmokes.length - 1; i >= 0; i--) {
    const smoke = muzzleSmokes[i];
    smoke.life -= dt;
    smoke.driftPhase += smoke.driftSpeed * dt;
    smoke.velocity.multiplyScalar(Math.exp(-dt * 0.7));
    smoke.sprite.position.addScaledVector(smoke.velocity, dt);
    smoke.sprite.position.x += Math.sin(smoke.driftPhase) * smoke.driftAmount * dt;
    smoke.sprite.position.z += Math.cos(smoke.driftPhase * 0.7) * smoke.driftAmount * dt;
    smoke.sprite.scale.addScalar(smoke.growth * dt);
    const material = smoke.sprite.material as THREE.SpriteMaterial;
    material.rotation += smoke.spin * dt;
    const lifeRatio = Math.max(0, smoke.life / smoke.maxLife);
    // Quick fade-in so the puff doesn't pop, then a soft fade-out as it dissipates
    const fadeIn = Math.min(1, (smoke.maxLife - smoke.life) / 0.2);
    material.opacity = Math.min(fadeIn, lifeRatio * lifeRatio + lifeRatio * 0.3) * 0.55;
    if (smoke.life <= 0) {
      smoke.sprite.removeFromParent();
      material.dispose();
      muzzleSmokes.splice(i, 1);
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
  
  // Spread recovery - hold heat while firing, settle quickly after the trigger is released
  const spreadRecovery = trigger
    ? 0
    : weapon === "MG"
      ? 2.2
      : weapon === "CANNON"
        ? 1.8
        : 2.4;
  spreadHeat = THREE.MathUtils.lerp(spreadHeat, 0, Math.min(1, spreadRecovery * dt));
  spreadX = THREE.MathUtils.lerp(spreadX, 0, Math.min(1, spreadRecovery * dt));
  spreadY = THREE.MathUtils.lerp(spreadY, 0, Math.min(1, spreadRecovery * dt));
  applyBloomSpread();
  
  // Muzzle smoke: emit burst on MG stop-fire, then dissipate
  if (wasFiring && !trigger && weapon === "MG" && muzzleSmoke > 0.05) {
    const smokeOrigin = muzzleOrigin(2.8);
    const count = Math.floor(muzzleSmoke * 5) + 1;
    for (let i = 0; i < count; i++) addMuzzleSmoke(smokeOrigin, "MG");
  }
  wasFiring = trigger;
  if (!trigger) {
    muzzleSmoke = Math.max(0, muzzleSmoke - dt * 0.8);
  }
  
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
    spread: spreadAngle,
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
  if (active()) {
    lastAutoPauseTime = performance.now();
    pause();
  }
});
document.addEventListener("pointerlockerror", () => {
  message("CLICK TO AIM · ARROW KEYS ALSO AVAILABLE");
  armPointerLockRetry();
});
window.addEventListener("blur", pause);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state === "paused") {
      // Pressing Escape while the pointer is locked makes the browser force
      // an unlock (and our "unlock" listener already paused the game) just
      // before this same keydown reaches us. Ignore that echo so we don't
      // immediately try to re-lock the pointer, which browsers block right
      // after an Escape-triggered unlock (leaving mouse-look broken).
      if (performance.now() - lastAutoPauseTime > 250) resume();
    } else {
      pause();
    }
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
  if (event.code === "Space") {
    event.preventDefault();
    if (state === "intermission") {
      beginWave();
    } else {
      trigger = true;
      fire();
    }
  }
  if (event.key === "Shift") {
    event.preventDefault();
    zoom = true;
  }
  const selected = (
    { "1": "MG", "2": "CANNON", "3": "ROCKET" } as Record<string, Weapon>
  )[event.key];
  if (selected) selectWeapon(selected);
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") trigger = false;
  else if (event.key === "Shift") zoom = false;
  else heldKeys.delete(event.key);
});
renderer.domElement.addEventListener("mousedown", (event) => {
  if (state !== "combat") return;
  if (awaitingPointerLockClick) return;
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

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  weaponView.resize(camera.aspect);
});
requestAnimationFrame(animate);
