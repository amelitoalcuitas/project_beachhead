import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Battlefield, terrainHeight } from "./battlefield";
import { WeaponView } from "./weapon-view";
import { CombatHud, devToolsMarkup, screenMarkup } from "./hud";
import {
  weapons, wavePlans, specs, weaponEffectiveness, weaponRoles,
} from "./content";
import { enemyModel, animateEnemy } from "./enemy-models";
import {
  advanceEnemyFire,
  enemyProjectileDamage,
  resolveWeaponDamage,
  resolveSplashDamage,
  splashDamage,
  proximityHit,
  projectileImpact,
  ballisticVelocity,
  bearing,
  canEngage,
  groundImpactVolume,
  grenadeDamageAtDistance,
  segmentHit,
  terrainIntersection,
} from "./combat";
import { isInfantryType, type EnemyType, type Weapon, type State } from "./types";
import "./style.css";

interface Enemy {
  type: EnemyType;
  group: THREE.Group;
  hp: number;
  speed: number;
  fire: number;
  burstRemaining: number;
  dead: boolean;
  target: THREE.Vector3;
  passes: number;
  unloaded: boolean;
  parachuting: boolean;
  warning: number;
  sightTimer: number;
  canAttack: boolean;
}
interface Shot {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  explosionDamage: number;
  splash: number;
  life: number;
  owner: "player" | "enemy";
  weapon: Weapon;
  projectile?: "grenade";
  gravity?: number;
  previous: THREE.Vector3;
  distanceTravelled?: number;
  proximityRadius?: number;
  armingDistance?: number;
  sourceBearing?: number;
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
  curlAxis: THREE.Vector3;
  spin: number;
  driftPhase: number;
  driftSpeed: number;
  driftAmount: number;
  growth: number;
  opacity: number;
}
interface MuzzleSmokeTrail {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  points: THREE.Vector3[];
  weapon: Weapon;
  life: number;
  maxLife: number;
  attachmentDuration: number;
  driftAxis: THREE.Vector3;
  driftPhase: number;
}
interface MuzzleFlashLight {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
  baseIntensity: number;
}
interface WreckageParticle {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
  growth: number;
  opacity: number;
  isFlame: boolean;
}
interface Wreckage {
  group: THREE.Group;
  life: number;
  smokeTimer: number;
  flameTimer: number;
  particles: WreckageParticle[];
}
interface Corpse {
  group: THREE.Group;
  life: number;
}
interface ScorchMark {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = screenMarkup;
const overlay = document.querySelector<HTMLElement>("#overlay")!;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcc8455, 210, 950);
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
// Dusk lighting: a low, warm sun with a rosy sky bounce and a cooling
// twilight tint rising from the ground into shadow.
scene.add(new THREE.HemisphereLight(0xff9d6b, 0x4a3a52, 1.6));
const sun = new THREE.DirectionalLight(0xff7a3d, 2.9);
sun.position.set(-260, 55, -140);
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
const wreckageBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
// Procedural smoke texture: several overlapping soft blobs so
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
// Dark irregular scorch decal for ground impacts.
const scorchTexture = (() => {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2,
    cy = size / 2;
  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const angle = (i / blobs) * Math.PI * 2 + Math.random() * 0.6;
    const dist = Math.random() * size * 0.18;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist * 0.9;
    const radius = size * (0.18 + Math.random() * 0.22);
    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
    const alpha = 0.45 + Math.random() * 0.25;
    gradient.addColorStop(0, `rgba(28,22,16,${alpha})`);
    gradient.addColorStop(0.5, `rgba(42,34,24,${alpha * 0.55})`);
    gradient.addColorStop(1, "rgba(52,44,34,0)");
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
  muzzleSmokes: MuzzleSmoke[] = [],
  wreckages: Wreckage[] = [],
  corpses: Corpse[] = [],
  scorchMarks: ScorchMark[] = [];
let muzzleSmokeTrail: MuzzleSmokeTrail | undefined;
// Pool of reusable point lights for gunfire flashes - both the player's shots
// and enemy fire briefly light up their surroundings. Pooling avoids the
// cost of constantly allocating/disposing lights during heavy firefights.
const MUZZLE_LIGHT_POOL_SIZE = 12;
const muzzleLightPool: THREE.PointLight[] = Array.from(
  { length: MUZZLE_LIGHT_POOL_SIZE },
  () => {
    const light = new THREE.PointLight(0xffffff, 0, 14, 2);
    light.visible = false;
    scene.add(light);
    return light;
  },
);
let muzzleLightCursor = 0;
const activeMuzzleFlashes: MuzzleFlashLight[] = [];
function addMuzzleFlash(
  position: THREE.Vector3,
  color: number,
  intensity: number,
  distance: number,
  duration: number,
) {
  const light = muzzleLightPool[muzzleLightCursor];
  muzzleLightCursor = (muzzleLightCursor + 1) % muzzleLightPool.length;
  const existing = activeMuzzleFlashes.findIndex(
    (flash) => flash.light === light,
  );
  if (existing >= 0) activeMuzzleFlashes.splice(existing, 1);
  light.color.setHex(color);
  light.position.copy(position);
  light.distance = distance;
  light.intensity = intensity;
  light.visible = true;
  activeMuzzleFlashes.push({ light, life: duration, maxLife: duration, baseIntensity: intensity });
}
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
let infiniteAmmo = false,
  godMode = false,
  nextStartWave = 1;
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
  heavyAttackReady = 0,
  airWarningEnemyId: number | null = null;
let messageTimer = 0,
  bannerTimer = 0,
  inspectionTimer = 0;
// Muzzle smoke state - builds up during sustained fire, dissipates when not firing
let muzzleSmoke = 0,
  smokeAccumulator = 0;
let audioContext: AudioContext | undefined,
  noiseBuffer: AudioBuffer | undefined,
  explosionReverbBuffer: AudioBuffer | undefined;
const lookDirection = new THREE.Vector3(),
  targetCenter = new THREE.Vector3(),
  muzzleRight = new THREE.Vector3();
// Project the view-model muzzle through the world camera so differing FOVs
// and zoom keep flashes, tracers, and smoke aligned with the barrel.
function muzzleOrigin(forwardOffset: number) {
  const screenMuzzle = weaponView.muzzleScreenPosition();
  const direction = new THREE.Vector3(screenMuzzle.x, screenMuzzle.y, 0.5)
    .unproject(camera)
    .sub(camera.position)
    .normalize();
  camera.getWorldDirection(lookDirection);
  return playerPosition.clone()
    .addScaledVector(direction, forwardOffset / direction.dot(lookDirection));
}
function muzzleOffsetForWeapon(selectedWeapon: Weapon) {
  return selectedWeapon === "MG"
    ? 2.8
    : selectedWeapon === "CANNON"
      ? 3.5
      : 3.8;
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
const spreadBiasMax = { MG: 0.018, CANNON: 0.004, BOFORS: 0.006 } as const;
const MG_ADS_SPREAD_MULTIPLIER = 0.2;
// Cold Browning still has a cone so the opening burst is not laser-accurate.
const MG_MIN_BLOOM = 0.22;
// Use standard Earth gravity for every player-fired weapon so drop is
// physically consistent across the machine gun, cannon, and Bofors cannon.
const PLAYER_PROJECTILE_GRAVITY = 9.81;
const ENEMY_PROJECTILE_GRAVITY = 24.5 * 0.3;
function bloomFromHeat(heat: number) {
  const t = THREE.MathUtils.clamp(heat, 0, 1);
  // Cubic ease-in: bloom stays modest at first, then opens to the cap
  return t * t * t;
}
function bloomAmount(heat: number, currentWeapon: Weapon) {
  const bloom = bloomFromHeat(heat);
  if (currentWeapon !== "MG") return bloom;
  return MG_MIN_BLOOM + (1 - MG_MIN_BLOOM) * bloom;
}
function applyBloomSpread() {
  const baseSpread = bloomAmount(spreadHeat, weapon) * weapons[weapon].spread;
  spreadAngle = zoom && weapon === "MG"
    ? baseSpread * MG_ADS_SPREAD_MULTIPLIER
    : baseSpread;
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

    const reverbDuration = 1.6;
    explosionReverbBuffer = audioContext.createBuffer(
      2,
      audioContext.sampleRate * reverbDuration,
      audioContext.sampleRate,
    );
    for (
      let channel = 0;
      channel < explosionReverbBuffer.numberOfChannels;
      channel++
    ) {
      const impulse = explosionReverbBuffer.getChannelData(channel);
      for (let i = 0; i < impulse.length; i++) {
        const decay = Math.pow(1 - i / impulse.length, 2.4);
        impulse[i] = (Math.random() * 2 - 1) * decay;
      }
    }
  }
  void audioContext.resume();
}
function reloadSoundForWeapon(w: Weapon) {
  return w === "MG" ? "reload-mg" : w === "CANNON" ? "reload-cannon" : "reload-bofors";
}
function sound(
  kind:
    | "gun"
    | "cannon"
    | "bofors"
    | "impact"
    | "reload-mg"
    | "reload-cannon"
    | "reload-bofors"
    | "air-warning",
  pan = 0,
) {
  if (!audioContext || !noiseBuffer) return;
  const ctx = audioContext;
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const now = ctx.currentTime;

  if (kind === "air-warning") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampedPan;
    for (let pulse = 0; pulse < 2; pulse++) {
      const start = now + pulse * 0.35;
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(500, start);
      osc.frequency.exponentialRampToValueAtTime(1100, start + 0.3);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.07, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(panner).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        if (pulse === 1) panner.disconnect();
      };
    }
    return;
  }

  if (kind === "reload-mg") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampedPan;
    const noise = ctx.createBufferSource(),
      noiseFilter = ctx.createBiquadFilter(),
      noiseGain = ctx.createGain();
    noise.buffer = noiseBuffer;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 2800;
    noiseFilter.Q.value = 1.2;
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    noise.connect(noiseFilter).connect(noiseGain).connect(panner).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.06);
    for (let i = 0; i < 2; i++) {
      const tick = ctx.createOscillator(),
        tickGain = ctx.createGain();
      tick.type = "square";
      tick.frequency.setValueAtTime(1800 - i * 200, now + i * 0.035);
      tickGain.gain.setValueAtTime(0.0001, now + i * 0.035);
      tickGain.gain.exponentialRampToValueAtTime(0.06, now + i * 0.035 + 0.003);
      tickGain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.035 + 0.025);
      tick.connect(tickGain).connect(panner).connect(ctx.destination);
      tick.start(now + i * 0.035);
      tick.stop(now + i * 0.035 + 0.03);
      tick.onended = () => {
        tick.disconnect();
        tickGain.disconnect();
      };
    }
    noise.onended = () => {
      noise.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
      panner.disconnect();
    };
    return;
  }

  if (kind === "reload-cannon") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampedPan;
    const thump = ctx.createBufferSource(),
      thumpFilter = ctx.createBiquadFilter(),
      thumpGain = ctx.createGain(),
      clunk = ctx.createOscillator(),
      clunkGain = ctx.createGain();
    thump.buffer = noiseBuffer;
    thumpFilter.type = "lowpass";
    thumpFilter.frequency.value = 420;
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    clunk.type = "sine";
    clunk.frequency.setValueAtTime(95, now);
    clunk.frequency.exponentialRampToValueAtTime(48, now + 0.18);
    clunkGain.gain.setValueAtTime(0.0001, now);
    clunkGain.gain.exponentialRampToValueAtTime(0.2, now + 0.012);
    clunkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    thump.connect(thumpFilter).connect(thumpGain).connect(panner).connect(ctx.destination);
    clunk.connect(clunkGain).connect(panner).connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.28);
    clunk.start(now);
    clunk.stop(now + 0.25);
    thump.onended = () => {
      thump.disconnect();
      thumpFilter.disconnect();
      thumpGain.disconnect();
      clunk.disconnect();
      clunkGain.disconnect();
      panner.disconnect();
    };
    return;
  }

  if (kind === "reload-bofors") {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampedPan;
    const slide = ctx.createBufferSource(),
      slideFilter = ctx.createBiquadFilter(),
      slideGain = ctx.createGain(),
      latch = ctx.createOscillator(),
      latchGain = ctx.createGain();
    slide.buffer = noiseBuffer;
    slideFilter.type = "bandpass";
    slideFilter.frequency.setValueAtTime(1800, now);
    slideFilter.frequency.exponentialRampToValueAtTime(3200, now + 0.18);
    slideFilter.Q.value = 0.8;
    slideGain.gain.setValueAtTime(0.0001, now);
    slideGain.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
    slideGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    latch.type = "triangle";
    latch.frequency.setValueAtTime(1250, now + 0.2);
    latchGain.gain.setValueAtTime(0.0001, now + 0.2);
    latchGain.gain.exponentialRampToValueAtTime(0.09, now + 0.21);
    latchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    slide.connect(slideFilter).connect(slideGain).connect(panner).connect(ctx.destination);
    latch.connect(latchGain).connect(panner).connect(ctx.destination);
    slide.start(now);
    slide.stop(now + 0.24);
    latch.start(now + 0.2);
    latch.stop(now + 0.32);
    latch.onended = () => {
      slide.disconnect();
      slideFilter.disconnect();
      slideGain.disconnect();
      latch.disconnect();
      latchGain.disconnect();
      panner.disconnect();
    };
    return;
  }

  const source = ctx.createBufferSource(),
    filter = ctx.createBiquadFilter(),
    gain = ctx.createGain(),
    panner = ctx.createStereoPanner();
  source.buffer = noiseBuffer;
  filter.type = "lowpass";
  filter.frequency.value =
    kind === "gun" ? 2600 : kind === "cannon" ? 520 : kind === "bofors" ? 1600 : 650;
  const duration = kind === "gun" ? 0.085 : kind === "cannon" ? 0.5 : kind === "bofors" ? 0.18 : 0.45;
  gain.gain.setValueAtTime(
    kind === "gun" ? 0.14 : kind === "cannon" ? 0.26 : 0.22,
    now,
  );
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  panner.pan.value = clampedPan;
  source.connect(filter).connect(gain).connect(panner).connect(ctx.destination);
  source.start(now);
  source.stop(now + duration);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
    panner.disconnect();
  };

  if (kind === "gun") {
    const thump = ctx.createOscillator(),
      thumpGain = ctx.createGain(),
      thumpPanner = ctx.createStereoPanner();
    thumpPanner.pan.value = clampedPan;
    thump.type = "triangle";
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(70, now + 0.05);
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.12, now + 0.004);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    thump.connect(thumpGain).connect(thumpPanner).connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.08);
    thump.onended = () => {
      thump.disconnect();
      thumpGain.disconnect();
      thumpPanner.disconnect();
    };
  }

  if (kind === "cannon") {
    const crack = ctx.createOscillator(),
      crackGain = ctx.createGain(),
      crackPanner = ctx.createStereoPanner();
    crackPanner.pan.value = clampedPan;
    crack.type = "triangle";
    crack.frequency.setValueAtTime(140, now);
    crack.frequency.exponentialRampToValueAtTime(55, now + 0.08);
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    crack.connect(crackGain).connect(crackPanner).connect(ctx.destination);
    crack.start(now);
    crack.stop(now + 0.12);
    crack.onended = () => {
      crack.disconnect();
      crackGain.disconnect();
      crackPanner.disconnect();
    };
  }
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
// Vehicle armor hit: dry metallic impact dominated by noise and a brief plate clang.
function vehicleHitSound(kill: boolean, pan = 0) {
  if (!audioContext || !noiseBuffer) return;
  const ctx = audioContext;
  const now = ctx.currentTime;
  const clangDuration = kill ? 0.055 : 0.042;
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const panner = ctx.createStereoPanner();
  panner.pan.value = clampedPan;
  panner.connect(ctx.destination);

  const strike = ctx.createBufferSource(),
    strikeFilter = ctx.createBiquadFilter(),
    strikeGain = ctx.createGain();
  strike.buffer = noiseBuffer;
  strikeFilter.type = "bandpass";
  strikeFilter.frequency.value = kill ? 2800 : 3400;
  strikeFilter.Q.value = 1.8;
  strikeGain.gain.setValueAtTime(0.0001, now);
  strikeGain.gain.exponentialRampToValueAtTime(kill ? 0.3 : 0.24, now + 0.002);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
  strike.connect(strikeFilter).connect(strikeGain).connect(panner);
  strike.start(now);
  strike.stop(now + 0.035);

  const scrape = ctx.createBufferSource(),
    scrapeFilter = ctx.createBiquadFilter(),
    scrapeGain = ctx.createGain();
  scrape.buffer = noiseBuffer;
  scrapeFilter.type = "bandpass";
  scrapeFilter.frequency.value = kill ? 720 : 880;
  scrapeFilter.Q.value = 2.2;
  scrapeGain.gain.setValueAtTime(0.0001, now);
  scrapeGain.gain.exponentialRampToValueAtTime(kill ? 0.2 : 0.15, now + 0.003);
  scrapeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  scrape.connect(scrapeFilter).connect(scrapeGain).connect(panner);
  scrape.start(now);
  scrape.stop(now + 0.05);

  const clangA = ctx.createOscillator(),
    clangB = ctx.createOscillator(),
    clangGain = ctx.createGain();
  clangA.type = "sawtooth";
  clangB.type = "square";
  clangA.frequency.value = kill ? 260 : 310;
  clangB.frequency.value = kill ? 278 : 325;
  clangGain.gain.setValueAtTime(0.0001, now);
  clangGain.gain.exponentialRampToValueAtTime(kill ? 0.1 : 0.07, now + 0.002);
  clangGain.gain.exponentialRampToValueAtTime(0.0001, now + clangDuration);
  clangA.connect(clangGain);
  clangB.connect(clangGain);
  clangGain.connect(panner);
  clangA.start(now);
  clangB.start(now);
  clangA.stop(now + clangDuration + 0.01);
  clangB.stop(now + clangDuration + 0.01);

  const thunk = ctx.createBufferSource(),
    thunkFilter = ctx.createBiquadFilter(),
    thunkGain = ctx.createGain();
  thunk.buffer = noiseBuffer;
  thunkFilter.type = "lowpass";
  thunkFilter.frequency.value = kill ? 420 : 340;
  thunkGain.gain.setValueAtTime(0.0001, now);
  thunkGain.gain.exponentialRampToValueAtTime(kill ? 0.18 : 0.13, now + 0.004);
  thunkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  thunk.connect(thunkFilter).connect(thunkGain).connect(panner);
  thunk.start(now);
  thunk.stop(now + 0.08);

  strike.onended = () => {
    strike.disconnect();
    strikeFilter.disconnect();
    strikeGain.disconnect();
    scrape.disconnect();
    scrapeFilter.disconnect();
    scrapeGain.disconnect();
    clangA.disconnect();
    clangB.disconnect();
    clangGain.disconnect();
    thunk.disconnect();
    thunkFilter.disconnect();
    thunkGain.disconnect();
    panner.disconnect();
  };
}
// Explosion: a sharp crack, a descending rumbling body, and a deep sub-bass
// boom with a short outdoor reflection tail for weight and space.
function explosionSound(pan = 0, size = 1, volume = 1) {
  if (!audioContext || !noiseBuffer || !explosionReverbBuffer || volume <= 0)
    return;
  const ctx = audioContext;
  const now = ctx.currentTime;
  const clampedPan = Math.max(-1, Math.min(1, pan));
  const scale = THREE.MathUtils.clamp(size / 2.5, 0.55, 1.6);
  const panner = ctx.createStereoPanner(),
    dryGain = ctx.createGain(),
    reverbPreDelay = ctx.createDelay(),
    reverb = ctx.createConvolver(),
    reverbGain = ctx.createGain(),
    outputGain = ctx.createGain();
  panner.pan.value = clampedPan;
  dryGain.gain.value = 0.86;
  reverbPreDelay.delayTime.value = 0.035;
  reverb.buffer = explosionReverbBuffer;
  reverbGain.gain.value = 0.38 + Math.min(0.16, size * 0.025);
  outputGain.gain.value = Math.min(1, volume);
  panner.connect(dryGain).connect(outputGain);
  panner
    .connect(reverbPreDelay)
    .connect(reverb)
    .connect(reverbGain)
    .connect(outputGain);
  outputGain.connect(ctx.destination);

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
  };
  window.setTimeout(
    () => {
      panner.disconnect();
      dryGain.disconnect();
      reverbPreDelay.disconnect();
      reverb.disconnect();
      reverbGain.disconnect();
      outputGain.disconnect();
    },
    (bodyDuration + explosionReverbBuffer.duration + 0.15) * 1000,
  );
}
// Sand impact: a soft, dry, grainy "puff" of a bullet kicking up sand/dirt -
// no tonal ring or whistle, just noise-based texture and a bit of scatter.
function ricochetSound(pan = 0, volume = 1) {
  if (!audioContext || !noiseBuffer || volume <= 0) return;
  const ctx = audioContext;
  const now = ctx.currentTime;
  const panner = ctx.createStereoPanner(),
    outputGain = ctx.createGain();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  outputGain.gain.value = Math.min(1, volume);
  panner.connect(outputGain).connect(ctx.destination);
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
      if (remaining === 0) {
        panner.disconnect();
        outputGain.disconnect();
      }
    };
  }
}
// Headshot: bullet strike on a steel helmet - sharp snap, brief metallic
// "dink", and a damped thud from the head behind the shell.
function splatSound(pan = 0) {
  if (!audioContext || !noiseBuffer) return;
  const ctx = audioContext;
  const now = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(ctx.destination);

  const strike = ctx.createBufferSource(),
    strikeFilter = ctx.createBiquadFilter(),
    strikeGain = ctx.createGain();
  strike.buffer = noiseBuffer;
  strikeFilter.type = "bandpass";
  strikeFilter.frequency.value = 3400;
  strikeFilter.Q.value = 1.6;
  strikeGain.gain.setValueAtTime(0.0001, now);
  strikeGain.gain.exponentialRampToValueAtTime(0.24, now + 0.002);
  strikeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
  strike.connect(strikeFilter).connect(strikeGain).connect(panner);
  strike.start(now);
  strike.stop(now + 0.025);

  const ringA = ctx.createOscillator(),
    ringB = ctx.createOscillator(),
    ringGain = ctx.createGain();
  ringA.type = "sine";
  ringB.type = "triangle";
  const base = 920 + Math.random() * 140;
  ringA.frequency.setValueAtTime(base, now);
  ringB.frequency.setValueAtTime(base * 1.13, now);
  ringGain.gain.setValueAtTime(0.0001, now);
  ringGain.gain.exponentialRampToValueAtTime(0.18, now + 0.003);
  ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  ringA.connect(ringGain);
  ringB.connect(ringGain);
  ringGain.connect(panner);
  ringA.start(now);
  ringB.start(now);
  ringA.stop(now + 0.07);
  ringB.stop(now + 0.07);

  const shell = ctx.createOscillator(),
    shellGain = ctx.createGain();
  shell.type = "square";
  shell.frequency.setValueAtTime(480 + Math.random() * 60, now);
  shellGain.gain.setValueAtTime(0.0001, now);
  shellGain.gain.exponentialRampToValueAtTime(0.1, now + 0.004);
  shellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
  shell.connect(shellGain).connect(panner);
  shell.start(now);
  shell.stop(now + 0.05);

  const thud = ctx.createBufferSource(),
    thudFilter = ctx.createBiquadFilter(),
    thudGain = ctx.createGain();
  thud.buffer = noiseBuffer;
  thudFilter.type = "lowpass";
  thudFilter.frequency.value = 280;
  thudGain.gain.setValueAtTime(0.0001, now + 0.008);
  thudGain.gain.exponentialRampToValueAtTime(0.14, now + 0.012);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  thud.connect(thudFilter).connect(thudGain).connect(panner);
  thud.start(now + 0.008);
  thud.stop(now + 0.09);

  thud.onended = () => {
    strike.disconnect();
    strikeFilter.disconnect();
    strikeGain.disconnect();
    ringA.disconnect();
    ringB.disconnect();
    ringGain.disconnect();
    shell.disconnect();
    shellGain.disconnect();
    thud.disconnect();
    thudFilter.disconnect();
    thudGain.disconnect();
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
  for (const smoke of muzzleSmokes) {
    smoke.sprite.removeFromParent();
    (smoke.sprite.material as THREE.SpriteMaterial).dispose();
  }
  for (const wreckage of wreckages) removeWreckage(wreckage);
  for (const corpse of corpses) removeCorpse(corpse);
  if (muzzleSmokeTrail) {
    muzzleSmokeTrail.mesh.removeFromParent();
    muzzleSmokeTrail.mesh.geometry.dispose();
    muzzleSmokeTrail.mesh.material.dispose();
    muzzleSmokeTrail = undefined;
  }
  enemies.length = shots.length = effects.length = tracers.length = muzzleSmokes.length = wreckages.length = corpses.length = 0;
  trigger = zoom = false;
  muzzleSmoke = smokeAccumulator = 0;
  heldKeys.clear();
  accumulator = 0;
  heavyAttackReady = 0;
  airWarningEnemyId = null;
  hud.setAirWarning(null);
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
  wave = nextStartWave;
  endless = wave > 10;
  nextStartWave = 1;
  spawnIndex = 0;
  spawnTimer = spawnInterval(wave);
  intermission = 0;
  weapon = "MG";
  reload = cooldown = switchTime = 0;
  weaponView.select(weapon, true);
  for (const definition of Object.values(weapons)) {
    definition.mag = definition.maxMag;
    definition.reserve = definition.maxReserve;
  }
  activePlan = [...wavePlans[Math.min(wave - 1, 9)]];
  simulationTime = 0;
  state = "combat";
  camera.position.copy(playerPosition);
  camera.rotation.set(-0.055, 0, 0, "YXZ");
  overlay.style.display = "none";
  initializeAudio();
  capturePointer();
  beginWave();
}
function selectWeapon(next: Weapon) {
  if (!active() || next === weapon) return;
  weapon = next;
  reload = 0;
  switchTime = 0.4;
  cooldown = 0.4;
  trigger = false;
  weaponView.select(next);
  message(weaponRoles[next]);
}
function reloadWeapon() {
  if (!active() || reload > 0 || switchTime > 0) return;
  const definition = weapons[weapon];
  if (definition.mag === definition.maxMag || definition.reserve === 0) return;
  reload = definition.reload;
  sound(reloadSoundForWeapon(weapon));
}
function completeReload() {
  const definition = weapons[weapon],
    rounds = Math.min(definition.maxMag - definition.mag, definition.reserve);
  definition.mag += rounds;
  definition.reserve -= rounds;
  reload = 0;
  sound(reloadSoundForWeapon(weapon));
}
function addParachute(group: THREE.Group) {
  const parachute = new THREE.Group();
  parachute.name = "parachute";
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0xd6d0ae,
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  canopy.position.y = 5.2;
  canopy.scale.y = 0.65;
  parachute.add(canopy);

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x403f34 });
  for (const x of [-1.7, 1.7]) {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 4.9, 0),
        new THREE.Vector3(x * 0.4, 2.25, 0),
      ]),
      lineMaterial,
    );
    parachute.add(line);
  }
  group.add(parachute);
}

function removeParachute(group: THREE.Group) {
  const parachute = group.getObjectByName("parachute");
  if (!parachute) return;
  parachute.traverse((node) => {
    if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
      node.geometry.dispose();
      if (Array.isArray(node.material))
        node.material.forEach((material) => material.dispose());
      else node.material.dispose();
    }
  });
  parachute.removeFromParent();
}

function spawn(type: EnemyType, near?: THREE.Vector3, parachuting = false) {
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
    if (!parachuting)
      group.position.y = terrainHeight(group.position.x, group.position.z);
  }
  if (parachuting) addParachute(group);
  const enemy: Enemy = {
    type,
    group,
    hp: definition.hp,
    speed: definition.speed * Math.min(1.65, 1 + wave * 0.025),
    fire: 1 / definition.attackRate + Math.random() * 2.5,
    burstRemaining: 0,
    dead: false,
    target: playerPosition.clone(),
    passes: 0,
    unloaded: false,
    parachuting,
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
const WRECKAGE_LIFETIME = 45;
const WRECKAGE_FADE_DURATION = 6;
const CORPSE_LIFETIME = 30;
const CORPSE_FADE_DURATION = 5;

function addWreckageParticle(
  wreckage: Wreckage,
  color: number,
  life: number,
  size: number,
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  growth: number,
  opacity: number,
  isFlame = false,
) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: smokeTexture,
      color,
      transparent: true,
      depthWrite: false,
      depthTest: !isFlame,
      blending: isFlame ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity,
    }),
  );
  sprite.position.copy(position);
  sprite.scale.setScalar(size);
  sprite.renderOrder = isFlame ? 2 : 1;
  smokeLayer.add(sprite);
  wreckage.particles.push({
    sprite,
    life,
    maxLife: life,
    velocity,
    growth,
    opacity,
    isFlame,
  });
}

function createWreckage(enemy: Enemy) {
  if (isInfantryType(enemy.type) || specs[enemy.type].air) return;

  const position = enemy.group.position.clone();
  const group = new THREE.Group();
  const footprint =
    enemy.type === "tank"
      ? 1.35
      : enemy.type === "apc" || enemy.type === "truck"
        ? 1.15
        : 1;
  const debrisSpecs = [
    {
      size: [2.4, 0.55, 1.8],
      pos: [0, 0.28, 0],
      rot: [0.18, 0, 0.12],
      color: 0x2a2520,
    },
    {
      size: [1.1, 0.35, 0.9],
      pos: [-0.95, 0.42, 0.55],
      rot: [0.42, 0.55, -0.28],
      color: 0x1f1b18,
    },
    {
      size: [0.85, 0.28, 1.4],
      pos: [0.75, 0.35, -0.65],
      rot: [-0.22, -0.35, 0.48],
      color: 0x312b24,
    },
    {
      size: [0.55, 0.22, 0.55],
      pos: [0.2, 0.62, 0.35],
      rot: [0.65, 0.15, -0.55],
      color: 0x24201c,
    },
    {
      size: [1.6, 0.18, 0.45],
      pos: [-0.35, 0.22, -0.35],
      rot: [0.08, 0.82, 0.18],
      color: 0x35302a,
    },
  ];
  for (const spec of debrisSpecs) {
    const mesh = new THREE.Mesh(
      wreckageBoxGeometry,
      new THREE.MeshStandardMaterial({
        color: spec.color,
        emissive: 0x120b06,
        emissiveIntensity: 0.35,
        roughness: 0.92,
        metalness: 0.55,
        transparent: true,
        opacity: 1,
      }),
    );
    mesh.scale.set(
      spec.size[0] * footprint,
      spec.size[1] * footprint,
      spec.size[2] * footprint,
    );
    mesh.position.set(
      spec.pos[0] * footprint,
      spec.pos[1] * footprint,
      spec.pos[2] * footprint,
    );
    mesh.rotation.set(
      spec.rot[0],
      spec.rot[1] + enemy.group.rotation.y * 0.15,
      spec.rot[2],
    );
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.position.copy(position);
  group.rotation.y =
    enemy.group.rotation.y + (Math.random() - 0.5) * 0.35;
  effectLayer.add(group);
  const wreckage: Wreckage = {
    group,
    life: WRECKAGE_LIFETIME,
    smokeTimer: 0,
    flameTimer: 0,
    particles: [],
  };
  wreckages.push(wreckage);

  const fireOrigin = position.clone().add(new THREE.Vector3(0, 1.1, 0));
  for (let i = 0; i < 4; i++)
    addWreckageParticle(
      wreckage,
      i % 2 === 0 ? 0xff7628 : 0xffd05a,
      0.45 + Math.random() * 0.3,
      0.8 + Math.random() * 0.45,
      fireOrigin.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 1.4,
          0,
          (Math.random() - 0.5) * 1.4,
        ),
      ),
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.55,
        0.5 + Math.random() * 0.45,
        (Math.random() - 0.5) * 0.55,
      ),
      0.3,
      0.9,
      true,
    );
  for (let i = 0; i < 3; i++)
    addWreckageParticle(
      wreckage,
      0x5a554d,
      2.6 + Math.random(),
      1.7 + Math.random() * 0.7,
      fireOrigin.clone().add(
        new THREE.Vector3(
          (Math.random() - 0.5) * 1.2,
          0.45,
          (Math.random() - 0.5) * 1.2,
        ),
      ),
      new THREE.Vector3(
        (Math.random() - 0.5) * 0.75,
        1.35 + Math.random() * 0.65,
        (Math.random() - 0.5) * 0.75,
      ),
      0.7,
      0.48,
    );
}

function createCorpse(enemy: Enemy) {
  if (!isInfantryType(enemy.type)) return;

  const group = enemy.group;
  group.removeFromParent();
  const position = group.position.clone();
  position.y = terrainHeight(position.x, position.z);
  group.position.copy(position);
  group.rotation.x = Math.PI * 0.48 + (Math.random() - 0.5) * 0.15;
  group.rotation.z = (Math.random() - 0.5) * 0.25;
  group.position.y += 0.15;
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    const deadMaterials = materials.map((source) => {
      const dead = source.clone() as THREE.MeshStandardMaterial;
      dead.color.multiplyScalar(0.65);
      dead.emissive.setHex(0x0a0806);
      dead.emissiveIntensity = 0.1;
      dead.transparent = true;
      dead.opacity = 1;
      return dead;
    });
    node.material = Array.isArray(node.material)
      ? deadMaterials
      : deadMaterials[0];
  });
  effectLayer.add(group);
  corpses.push({ group, life: CORPSE_LIFETIME });
}

function removeCorpse(corpse: Corpse) {
  corpse.group.removeFromParent();
  corpse.group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach((material) => material.dispose());
  });
}

function updateCorpses(dt: number) {
  for (let i = corpses.length - 1; i >= 0; i--) {
    const corpse = corpses[i];
    corpse.life -= dt;
    const fadeProgress =
      corpse.life <= 0
        ? THREE.MathUtils.clamp(-corpse.life / CORPSE_FADE_DURATION, 0, 1)
        : 0;
    const opacity = 1 - fadeProgress;
    corpse.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) material.opacity = opacity;
    });
    if (corpse.life <= -CORPSE_FADE_DURATION) {
      removeCorpse(corpse);
      corpses.splice(i, 1);
    }
  }
}

function removeWreckage(wreckage: Wreckage) {
  wreckage.group.removeFromParent();
  wreckage.group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach((material) => material.dispose());
  });
  for (const particle of wreckage.particles) {
    particle.sprite.removeFromParent();
    particle.sprite.material.dispose();
  }
  wreckage.particles.length = 0;
}

function updateWreckages(dt: number) {
  for (let i = wreckages.length - 1; i >= 0; i--) {
    const wreckage = wreckages[i];
    wreckage.life -= dt;
    const fading = wreckage.life <= 0;
    const fadeProgress = fading
      ? THREE.MathUtils.clamp(-wreckage.life / WRECKAGE_FADE_DURATION, 0, 1)
      : 0;
    const hullOpacity = 1 - fadeProgress;
    wreckage.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) {
        material.opacity = hullOpacity;
      }
    });
    if (!fading) {
      wreckage.smokeTimer -= dt;
      wreckage.flameTimer -= dt;
      if (wreckage.smokeTimer <= 0) {
        const origin = wreckage.group.position
          .clone()
          .add(new THREE.Vector3(0, 1.7, 0));
        addWreckageParticle(
          wreckage,
          0x6c665c,
          2.4 + Math.random() * 1.2,
          1.4 + Math.random() * 0.8,
          origin,
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.7,
            1.2 + Math.random() * 0.8,
            (Math.random() - 0.5) * 0.7,
          ),
          0.65,
          0.34,
        );
        wreckage.smokeTimer = 0.4 + Math.random() * 0.35;
      }
      if (wreckage.flameTimer <= 0) {
        const origin = wreckage.group.position
          .clone()
          .add(new THREE.Vector3(0, 0.9, 0));
        addWreckageParticle(
          wreckage,
          Math.random() > 0.35 ? 0xff7628 : 0xffc14d,
          0.35 + Math.random() * 0.25,
          0.65 + Math.random() * 0.4,
          origin,
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            0.35 + Math.random() * 0.35,
            (Math.random() - 0.5) * 0.5,
          ),
          0.35,
          0.78,
          true,
        );
        wreckage.flameTimer = 0.16 + Math.random() * 0.18;
      }
    }
    for (
      let particleIndex = wreckage.particles.length - 1;
      particleIndex >= 0;
      particleIndex--
    ) {
      const particle = wreckage.particles[particleIndex];
      particle.life -= dt;
      particle.velocity.multiplyScalar(Math.exp(-dt * 0.4));
      particle.sprite.position.addScaledVector(particle.velocity, dt);
      particle.sprite.scale.addScalar(particle.growth * dt);
      const age = particle.maxLife - particle.life;
      const fadeIn = particle.isFlame ? 1 : Math.min(1, age / 0.08);
      const fadeOut = Math.pow(Math.max(0, particle.life / particle.maxLife), 1.3);
      (particle.sprite.material as THREE.SpriteMaterial).opacity =
        particle.opacity * fadeIn * fadeOut * hullOpacity;
      if (particle.life <= 0) {
        particle.sprite.removeFromParent();
        particle.sprite.material.dispose();
        wreckage.particles.splice(particleIndex, 1);
      }
    }
    if (wreckage.life <= -WRECKAGE_FADE_DURATION) {
      removeWreckage(wreckage);
      wreckages.splice(i, 1);
    }
  }
}
function addScorchMark(position: THREE.Vector3, size: number) {
  const groundY = terrainHeight(position.x, position.z);
  if (position.y - groundY > 2.5) return;
  const sample = 0.75;
  const yWest = terrainHeight(position.x - sample, position.z);
  const yEast = terrainHeight(position.x + sample, position.z);
  const yNorth = terrainHeight(position.x, position.z - sample);
  const ySouth = terrainHeight(position.x, position.z + sample);
  const normal = new THREE.Vector3(yWest - yEast, 2 * sample, 0)
    .cross(new THREE.Vector3(0, yNorth - ySouth, 2 * sample))
    .normalize();
  if (normal.y < 0.1) return;
  const material = new THREE.MeshBasicMaterial({
    map: scorchTexture,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const radius = size * 1.15;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    material,
  );
  mesh.position.set(position.x, groundY + 0.05, position.z);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  mesh.rotateY(Math.random() * Math.PI * 2);
  effectLayer.add(mesh);
  scorchMarks.push({ mesh, life: 5, maxLife: 5 });
}
function updateScorchMarks(dt: number) {
  for (let i = scorchMarks.length - 1; i >= 0; i--) {
    const mark = scorchMarks[i];
    mark.life -= dt;
    const material = mark.mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 0.82 * Math.max(0, mark.life / mark.maxLife);
    if (mark.life <= 0) {
      mark.mesh.removeFromParent();
      material.dispose();
      mark.mesh.geometry.dispose();
      scorchMarks.splice(i, 1);
    }
  }
}
function applyExplosionToEnemies(
  origin: THREE.Vector3,
  amount: number,
  radius: number,
  source: Weapon | "vehicle",
  exclude?: Enemy,
  directionHint?: THREE.Vector3,
) {
  if (radius <= 0 || amount <= 0) return;
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    if (source === "vehicle" && !isInfantryType(enemy.type)) continue;
    targetCenter.copy(enemy.group.position);
    if (!specs[enemy.type].air) targetCenter.y += 1.7;
    const distance = targetCenter.distanceTo(origin);
    if (distance >= radius) continue;
    const blastOrigin = origin.clone();
    if (directionHint) blastOrigin.addScaledVector(directionHint, -0.03);
    const sightDirection = targetCenter.clone().sub(blastOrigin);
    const sightDistance = sightDirection.length();
    sightDirection.normalize();
    const clearSight =
      obstructionDistance(blastOrigin, sightDirection, sightDistance) >=
      sightDistance;
    const raw = splashDamage(
      amount,
      radius,
      distance,
      clearSight,
      enemy === exclude,
    );
    if (raw <= 0) continue;
    hitEnemy(
      enemy,
      raw,
      source,
      origin,
      false,
      source === "vehicle" ? "blast" : "splash",
    );
  }
}
function explode(
  position: THREE.Vector3,
  size: number,
  soundVolume = 1,
  style: "he" | "flak" | "default" | "vehicle" = "default",
) {
  const flashColor =
    style === "flak"
      ? 0xffe9ad
      : style === "he"
        ? 0xd4b870
        : style === "vehicle"
          ? 0xffc866
          : 0xffbd55;
  const debrisColor =
    style === "flak"
      ? 0x353b40
      : style === "he"
        ? 0x5a5248
        : style === "vehicle"
          ? 0x4a4035
          : 0x514a3e;
  const flashScale = style === "vehicle" ? 0.62 : 0.45;
  const flashDuration = style === "vehicle" ? 0.38 : 0.28;
  addEffect(
    position,
    flashColor,
    size * flashScale,
    flashDuration,
    new THREE.Vector3(),
    style === "vehicle" ? 10 : 8,
  );
  if (style === "vehicle") {
    addEffect(
      position,
      0xfff4d6,
      size * 0.72,
      0.14,
      new THREE.Vector3(),
      14,
    );
    addEffect(
      position.clone().add(new THREE.Vector3(0, size * 0.15, 0)),
      0xff9a3c,
      size * 0.34,
      0.22,
      new THREE.Vector3(0, size * 0.8, 0),
      6,
    );
  }
  const debrisCount = style === "vehicle" ? 14 : style === "flak" ? 7 : 10;
  for (let i = 0; i < debrisCount; i++)
    addEffect(
      position,
      i < 4 ? flashColor : debrisColor,
      size * (i < 4 ? 0.13 : 0.23),
      i < 4 ? 0.7 : 2.2,
      new THREE.Vector3(
        (Math.random() - 0.5) * size * 6,
        Math.random() * size * 5,
        (Math.random() - 0.5) * size * 6,
      ),
      i < 4 ? 0.3 : 1.2,
    );
  explosionSound(muzzlePan(position), size, soundVolume);
  const distance = position.distanceTo(playerPosition);
  const shakeScale = style === "vehicle" ? 0.065 : 0.05;
  const shakeAmount = THREE.MathUtils.clamp(
    size * shakeScale * (1 - distance / (size * 12)),
    0,
    size * shakeScale,
  );
  shake = Math.max(shake, shakeAmount);
  addScorchMark(position, size);
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
function infantryDeath(position: THREE.Vector3, headshot = false) {
  if (!headshot) bloodSplat(position);
  for (let i = 0; i < 4; i++)
    addEffect(
      position,
      0x8a7358,
      0.035 + Math.random() * 0.025,
      0.3 + Math.random() * 0.12,
      new THREE.Vector3(
        (Math.random() - 0.5) * 2.2,
        Math.random() * 1.2,
        (Math.random() - 0.5) * 2.2,
      ),
      0.08,
    );
}
function ricochetSparks(position: THREE.Vector3) {
  for (let i = 0; i < 5; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    const upBias = 0.3 + Math.random() * 0.5;
    addEffect(
      position,
      i < 2 ? 0xffe8a0 : 0xc8a040,
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
function addMuzzleSmoke(
  position: THREE.Vector3,
  weapon: Weapon,
  residual = false,
) {
  const baseSize =
    weapon === "MG" ? 0.5 : weapon === "CANNON" ? 0.95 : 0.8;
  const puffs = residual ? 1 : weapon === "MG" ? 1 : 3;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  for (let p = 0; p < puffs; p++) {
    if (muzzleSmokes.length >= 100) return;
    const material = new THREE.SpriteMaterial({
      map: smokeTexture,
      color:
        weapon === "MG"
          ? 0x8a8780
          : weapon === "CANNON"
            ? 0x6a6660
            : 0x7a7068,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      rotation: Math.random() * Math.PI * 2,
    });
    const sprite = new THREE.Sprite(material);
    const jitter = residual ? 0.12 : 0.26;
    sprite.position.copy(position).add(
      new THREE.Vector3(
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter * 0.6,
        (Math.random() - 0.5) * jitter,
      ),
    );
    const size = baseSize * (0.65 + Math.random() * 0.7);
    sprite.scale.set(size, size, 1);
    smokeLayer.add(sprite);
    const life = residual
      ? 1.7 + Math.random() * 0.7
      : 1.2 + Math.random() * 0.8;
    const ejectionSpeed = residual
      ? 0.08
      : weapon === "MG"
        ? 0.65
        : 1.1;
    const curlAxis = new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize()
      .applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (Math.random() - 0.5) * 0.55,
      );
    muzzleSmokes.push({
      sprite,
      life,
      maxLife: life,
      velocity: forward
        .clone()
        .multiplyScalar(ejectionSpeed)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.16,
            0.9 + Math.random() * 0.75,
            (Math.random() - 0.5) * 0.16,
          ),
        ),
      curlAxis,
      spin: (Math.random() - 0.5) * 0.75,
      driftPhase: Math.random() * Math.PI * 2,
      driftSpeed: 1 + Math.random() * 1.1,
      driftAmount: 0.18 + Math.random() * 0.24,
      growth: 0.48 + Math.random() * 0.35,
      opacity: residual
        ? 0.16 + Math.random() * 0.04
        : 0.22 + Math.random() * 0.07,
    });
  }
}
function startMuzzleSmokeTrail(position: THREE.Vector3, weapon: Weapon) {
  if (muzzleSmokeTrail) return;
  const pointCount = 9;
  const points = Array.from({ length: pointCount }, (_, index) =>
    position.clone().add(new THREE.Vector3(0, index * 0.008, 0)),
  );
  const positions = new Float32Array(pointCount * 2 * 3);
  const uvs = new Float32Array(pointCount * 2 * 2);
  const indices: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    const progress = i / (pointCount - 1);
    uvs.set([0, progress, 1, progress], i * 4);
    if (i < pointCount - 1) {
      const vertex = i * 2;
      indices.push(
        vertex,
        vertex + 1,
        vertex + 2,
        vertex + 1,
        vertex + 3,
        vertex + 2,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    map: smokeTexture,
    color:
      weapon === "MG"
        ? 0x8a8780
        : weapon === "CANNON"
          ? 0x6a6660
          : 0x7a7068,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  smokeLayer.add(mesh);
  muzzleSmokeTrail = {
    mesh,
    points,
    weapon,
    life: 2.1,
    maxLife: 2.1,
    attachmentDuration: 0.32,
    driftAxis: new THREE.Vector3()
      .setFromMatrixColumn(camera.matrixWorld, 0)
      .normalize(),
    driftPhase: Math.random() * Math.PI * 2,
  };
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
function updateMuzzleSmokeTrail(dt: number) {
  if (!muzzleSmokeTrail) return;
  const trail = muzzleSmokeTrail;
  trail.life -= dt;
  trail.driftPhase += dt * 1.15;
  const age = trail.maxLife - trail.life;
  const cameraRight = new THREE.Vector3()
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .normalize();
  const positions = trail.mesh.geometry.getAttribute(
    "position",
  ) as THREE.BufferAttribute;

  for (let i = 0; i < trail.points.length; i++) {
    const progress = i / (trail.points.length - 1);
    const point = trail.points[i];
    if (i === 0 && age < trail.attachmentDuration) {
      point.copy(muzzleOrigin(muzzleOffsetForWeapon(trail.weapon)));
    } else {
      point.y += (0.45 + progress * 1.1) * dt;
      point.addScaledVector(
        trail.driftAxis,
        Math.sin(trail.driftPhase + progress * 2.4) *
          (0.035 + progress * 0.12) *
          dt,
      );
    }

    const halfWidth = 0.035 + progress * 0.085 + age * 0.012;
    const left = point.clone().addScaledVector(cameraRight, -halfWidth);
    const right = point.clone().addScaledVector(cameraRight, halfWidth);
    positions.setXYZ(i * 2, left.x, left.y, left.z);
    positions.setXYZ(i * 2 + 1, right.x, right.y, right.z);
  }
  positions.needsUpdate = true;

  const fadeIn = Math.min(1, age / 0.1);
  const fadeOut = THREE.MathUtils.clamp(trail.life / 0.75, 0, 1);
  trail.mesh.material.opacity = 0.25 * fadeIn * fadeOut;
  if (trail.life <= 0) {
    trail.mesh.removeFromParent();
    trail.mesh.geometry.dispose();
    trail.mesh.material.dispose();
    muzzleSmokeTrail = undefined;
  }
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
        specs[enemy.type].air ? 0 : isInfantryType(enemy.type) ? 2 : 3,
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
  source: Weapon | "vehicle",
  position: THREE.Vector3,
  headshot = false,
  mode: "direct" | "splash" | "blast" = "direct",
) {
  if (enemy.dead) return;
  const weapon = source === "vehicle" ? "MG" : source;
  const resisted =
    mode === "direct" &&
    source !== "vehicle" &&
    weaponEffectiveness[weapon][enemy.type] < 0.5;
  const damage =
    mode === "blast"
      ? amount
      : mode === "splash"
        ? resolveSplashDamage(amount, weapon, enemy.type)
        : resolveWeaponDamage(amount, weapon, enemy.type, headshot);
  if (damage <= 0) return;
  enemy.hp -= damage;
  sparks(position);
  if (headshot) bloodSplat(position);
  hud.hit(enemy.hp <= 0);
  const hitPan = muzzlePan(position);
  if (headshot) splatSound(hitPan);
  else if (isInfantryType(enemy.type))
    hitMarkerSound(enemy.hp <= 0, hitPan);
  else vehicleHitSound(enemy.hp <= 0, hitPan);
  if (enemy.hp > 0) {
    if (resisted) {
      const recommended = specs[enemy.type].air ? "BOFORS" : "AT GUN";
      message("LOW EFFECTIVENESS · SWITCH TO " + recommended);
    }
    else if (headshot) message("HEADSHOT · CRITICAL DAMAGE");
    return;
  }
  enemy.dead = true;
  enemy.canAttack = false;
  if (isInfantryType(enemy.type)) {
    createCorpse(enemy);
    infantryDeath(position, headshot);
  } else {
    const definition = specs[enemy.type];
    const blastOrigin = enemy.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    createWreckage(enemy);
    enemy.group.removeFromParent();
    const groundVehicle = !definition.air;
    explode(
      blastOrigin,
      definition.air ? 3.5 : 3.8,
      groundVehicle ? 1.15 : 1,
      groundVehicle ? "vehicle" : "default",
    );
    applyExplosionToEnemies(
      blastOrigin,
      definition.explosionDamage,
      definition.explosionRadius,
      "vehicle",
    );
  }
  score += specs[enemy.type].score;
  message(
    specs[enemy.type].score +
      " POINTS / " +
      specs[enemy.type].name +
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
  if (!infiniteAmmo) definition.mag--;
  cooldown = 1 / definition.fireRate;
  weaponView.fire(weapon);
  shake = weapon === "MG" ? 0.025 : 0.1;
  sound(weapon === "MG" ? "gun" : weapon === "CANNON" ? "cannon" : "bofors");
  
  const smokeBuildup =
    weapon === "MG" ? 0.08 : weapon === "CANNON" ? 0.15 : 0.12;
  muzzleSmoke = Math.min(1, muzzleSmoke + smokeBuildup);
  
  // Heat rises steadily; MG cone starts at MG_MIN_BLOOM and eases up from there
  let heatPerShot = weapon === "MG" ? 0.05 : weapon === "CANNON" ? 0.06 : 0.08;
  if (weapon === "MG") {
    const curveFactor = 0.96;
    heatPerShot *= (1 + spreadHeat * curveFactor);
  }
  // Reduce heat per shot when zoomed for MG to minimize crosshair oscillation
  if (zoom && weapon === "MG") {
    heatPerShot *= 0.7;
  }
  spreadHeat = Math.min(1, spreadHeat + heatPerShot);
  applyBloomSpread();
  const bloom = bloomAmount(spreadHeat, weapon);
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
  const muzzleOffset = muzzleOffsetForWeapon(weapon);
  const origin = muzzleOrigin(muzzleOffset);
  
  // Every successful shot contributes to the live plume. Residual barrel
  // smoke continues separately as the accumulated heat dissipates.
  addMuzzleSmoke(origin, weapon);
  startMuzzleSmokeTrail(origin, weapon);
  // Briefly light up the surroundings with each shot - heavier weapons throw
  // a bigger, longer-lived flash than the rapid-fire MG.
  addMuzzleFlash(
    origin,
    weapon === "MG" ? 0xffe8a0 : weapon === "CANNON" ? 0xd4c8a0 : 0xff9955,
    weapon === "MG" ? 14 : 36,
    weapon === "MG" ? 12 : 22,
    weapon === "MG" ? 0.05 : 0.11,
  );

  if (weapon === "MG") {
    const mesh = new THREE.Mesh(
      sphereGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffe8a0 }),
    );
    mesh.scale.setScalar(0.12);
    mesh.position.copy(origin).addScaledVector(aimDirection, 1.5);
    projectileLayer.add(mesh);
    const velocity = aimDirection.clone().multiplyScalar(definition.projectileSpeed);
    shots.push({
      mesh,
      velocity,
      damage: definition.damage,
      explosionDamage: 0,
      splash: 0,
      life: 1.2,
      owner: "player",
      weapon,
      gravity: definition.bulletDrop,
      previous: mesh.position.clone(),
    });
  } else {
    const mesh = new THREE.Mesh(
      sphereGeometry,
      new THREE.MeshBasicMaterial({
        color: weapon === "BOFORS" ? 0xffe9a0 : 0xc8b888,
      }),
    );
    mesh.scale.setScalar(0.22);
    mesh.position.copy(origin);
    projectileLayer.add(mesh);
    const velocity = aimDirection.clone().multiplyScalar(definition.projectileSpeed);
    shots.push({
      mesh,
      velocity,
      damage: definition.damage,
      explosionDamage: definition.explosionDamage,
      splash: definition.explosionRadius,
      proximityRadius: definition.proximityRadius,
      armingDistance: definition.armingDistance,
      distanceTravelled: 0,
      life: 7,
      owner: "player",
      weapon,
      gravity: definition.bulletDrop,
      previous: mesh.position.clone(),
    });
  }
}
function enemyAttack(enemy: Enemy) {
  const origin = enemyOrigin(enemy);
  const definition = specs[enemy.type];
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
  const grenade = specs[enemy.type].grenade === true;
  const projectileSpeed = specs[enemy.type].projectileSpeed;
  const launchDirection = playerPosition.clone().sub(origin).normalize();
  const mesh = new THREE.Mesh(
    sphereGeometry,
    new THREE.MeshBasicMaterial({ color: grenade ? 0x4f6b3a : 0xff7150 }),
  );
  mesh.scale.setScalar(grenade ? 0.24 : enemy.type === "tank" ? 0.36 : 0.16);
  mesh.position.copy(origin).addScaledVector(launchDirection, 2);
  const velocity = ballisticVelocity(
    mesh.position,
    playerPosition,
    projectileSpeed,
    definition.bulletDrop,
  );
  projectileLayer.add(mesh);
  sparks(origin);
  addMuzzleFlash(
    origin,
    grenade ? 0x9fbf6a : 0xff7150,
    enemy.type === "tank" ? 30 : 18,
    enemy.type === "tank" ? 20 : 13,
    0.07,
  );
  shots.push({
    mesh,
    velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
    damage: enemyProjectileDamage(definition),
    explosionDamage: definition.explosionDamage,
    splash: grenade ? definition.explosionRadius : 0,
    life: grenade ? 8 : 6,
    owner: "enemy",
    weapon: "MG",
    projectile: grenade ? "grenade" : undefined,
    gravity: definition.bulletDrop,
    previous: mesh.position.clone(),
    sourceBearing: bearing(
      origin.x - playerPosition.x,
      origin.z - playerPosition.z,
    ),
  });
  return true;
}
function updateEnemies(dt: number) {
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    const position = enemy.group.position,
      definition = specs[enemy.type];
    let moving = false;
    if (enemy.parachuting) {
      const landingHeight = terrainHeight(position.x, position.z);
      position.y = Math.max(landingHeight, position.y - 7 * dt);
      if (position.y <= landingHeight) {
        position.y = landingHeight;
        enemy.parachuting = false;
        removeParachute(enemy.group);
      } else {
        animateEnemy(
          enemy.group,
          enemy.type,
          simulationTime + enemy.group.id,
          false,
        );
        continue;
      }
    }
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
          ? enemy.unloaded
            ? 105
            : 220
          : enemy.type === "tank"
            ? 115
            : enemy.type === "apc"
              ? 75
              : isInfantryType(enemy.type)
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
      (enemy.type === "truck" || enemy.type === "heli") &&
      !enemy.unloaded &&
      (enemy.type === "heli"
        ? position.distanceTo(playerPosition) < 220
        : position.distanceTo(playerPosition) < 80) &&
      enemies.filter((e) => !e.dead).length <= (enemy.type === "heli" ? 27 : 28)
    ) {
      enemy.unloaded = true;
      const infantryCount = enemy.type === "heli" ? 1 : 2;
      for (let i = 0; i < infantryCount; i++)
        spawn("infantry", position, enemy.type === "heli");
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
      if (airWarningEnemyId === enemy.group.id) airWarningEnemyId = null;
      enemy.warning = 0;
      enemy.burstRemaining = 0;
      enemy.fire = Math.max(enemy.fire, 0.5);
      continue;
    }
    if (enemy.warning > 0) {
      enemy.warning -= dt;
      if (enemy.warning <= 0) {
        if (airWarningEnemyId === enemy.group.id) airWarningEnemyId = null;
        enemyAttack(enemy);
        enemy.fire = 1 / specs[enemy.type].attackRate + Math.random() * 2;
      }
      continue;
    }
    if (definition.burst) {
      const next = advanceEnemyFire(enemy, dt, definition.burst, 1 / definition.attackRate + Math.random() * 2);
      enemy.fire = next.fire;
      enemy.burstRemaining = next.burstRemaining;
      if (next.shouldFire && !enemyAttack(enemy)) {
        enemy.burstRemaining = 0;
        enemy.fire = 1 / definition.attackRate + Math.random() * 2;
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
      message(specs[enemy.type].name + " PREPARING TO FIRE");
      sparks(enemyOrigin(enemy));
      if (enemy.type === "heli" || enemy.type === "aircraft") {
        sound("air-warning");
        airWarningEnemyId = enemy.group.id;
      }
    } else {
      enemyAttack(enemy);
      enemy.fire = 1 / specs[enemy.type].attackRate + Math.random() * 2;
    }
  }
}
function hurtPlayer(amount: number, sourceBearing?: number) {
  if (state !== "combat") return;
  if (godMode) return;
  playerHp = Math.max(0, playerHp - amount);
  hud.hurt();
  if (sourceBearing !== undefined) hud.hitDirection(sourceBearing);
  shake = 0.14;
  sound("impact");
  message("BUNKER HIT / −" + amount + " INTEGRITY");
}
function updateShots(dt: number) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const shot = shots[i];
    shot.previous.copy(shot.mesh.position);
    // Apply bullet drop to projectiles (CANNON, BOFORS, and MG)
    shot.velocity.y -=
      (shot.gravity ??
        (shot.owner === "player"
          ? PLAYER_PROJECTILE_GRAVITY
          : ENEMY_PROJECTILE_GRAVITY)) * dt;
    shot.mesh.position.addScaledVector(shot.velocity, dt);
    shot.life -= dt;
    const distanceTravelled = shot.distanceTravelled ?? 0;
    shot.distanceTravelled = distanceTravelled + shot.previous.distanceTo(shot.mesh.position);
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
      let playerHit = false;
      const t = segmentHit(
        shot.previous,
        shot.mesh.position,
        playerPosition,
        2.1,
      );
      if (t !== null && t < bestT) {
        shot.mesh.position.lerpVectors(shot.previous, shot.mesh.position, t);
        playerHit = true;
        hit = true;
      }
      if (hit && shot.projectile === "grenade") {
        const distance = shot.mesh.position.distanceTo(playerPosition);
        if (distance <= shot.splash)
          hurtPlayer(
            playerHit ? shot.damage : grenadeDamageAtDistance(distance),
            shot.sourceBearing,
          );
        explode(shot.mesh.position, 3.2, groundImpactVolume(distance));
      } else if (playerHit) hurtPlayer(shot.damage, shot.sourceBearing);
    } else {
      let headshotHit = false;
      let proximityT = Infinity;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        const fuseT = shot.weapon === "BOFORS"
          ? proximityHit(
              shot.previous, shot.mesh.position, enemy.group.position,
              distanceTravelled, shot.armingDistance ?? 0,
              shot.proximityRadius ?? 0, !!specs[enemy.type].air,
            )
          : null;
        if (fuseT !== null) proximityT = Math.min(proximityT, fuseT);
        if (isInfantryType(enemy.type)) {
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
      const impact = projectileImpact(bestT, proximityT);
      if (impact) {
        hit = true;
        bestT = impact.t;
        if (impact.kind === "proximity") {
          enemyHit = undefined;
          headshotHit = false;
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
        applyExplosionToEnemies(
          shot.mesh.position,
          shot.explosionDamage,
          shot.splash,
          shot.weapon,
          enemyHit,
          direction,
        );
        if (shot.weapon === "MG") {
          ricochetSparks(shot.mesh.position);
          // Only play the ground/obstruction ricochet sound when the bullet
          // didn't hit an enemy - enemy hits already get the hit-marker sound.
          if (!enemyHit) {
            const impactDistance =
              shot.mesh.position.distanceTo(playerPosition);
            ricochetSound(
              muzzlePan(shot.mesh.position),
              groundImpactVolume(impactDistance),
            );
          }
        } else {
          const impactVolume = enemyHit
            ? 1
            : groundImpactVolume(
                shot.mesh.position.distanceTo(playerPosition),
              );
          explode(
            shot.mesh.position,
            shot.weapon === "BOFORS" ? 2 : 3.2,
            impactVolume,
            shot.weapon === "BOFORS" ? "flak" : "he",
          );
        }
      }
    }
    // Only add tracer for cannon/Bofors projectiles, not MG bullets
    if (shot.weapon !== "MG" || shot.projectile === "grenade") {
      addTracer(
        shot.previous,
        shot.mesh.position,
        shot.owner === "enemy" ? 0xff8060 : 0xffce77,
        0.06,
      );
    }
    if (!hit && shot.life <= 0 && shot.projectile === "grenade") {
      const distance = shot.mesh.position.distanceTo(playerPosition);
      if (distance <= shot.splash)
        hurtPlayer(grenadeDamageAtDistance(distance), shot.sourceBearing);
      explode(shot.mesh.position, 3.2, groundImpactVolume(distance));
      hit = true;
    }
    if (hit || shot.life <= 0) {
      releaseMesh(shot.mesh);
      shots.splice(i, 1);
    }
  }
}
function updateEffects(dt: number) {
  updateWreckages(dt);
  updateCorpses(dt);
  updateScorchMarks(dt);
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
  // Circular puffs expand evenly while buoyancy and light lateral drift keep
  // the cloud from looking static or mechanically uniform.
  for (let i = muzzleSmokes.length - 1; i >= 0; i--) {
    const smoke = muzzleSmokes[i];
    smoke.life -= dt;
    smoke.driftPhase += smoke.driftSpeed * dt;
    smoke.velocity.multiplyScalar(Math.exp(-dt * 0.48));
    smoke.velocity.y += 0.28 * dt;
    smoke.sprite.position.addScaledVector(smoke.velocity, dt);
    smoke.sprite.position.addScaledVector(
      smoke.curlAxis,
      Math.sin(smoke.driftPhase) * smoke.driftAmount * dt,
    );
    smoke.sprite.scale.x += smoke.growth * dt;
    smoke.sprite.scale.y += smoke.growth * dt;
    const material = smoke.sprite.material as THREE.SpriteMaterial;
    material.rotation += smoke.spin * dt;
    const lifeRatio = Math.max(0, smoke.life / smoke.maxLife);
    const age = smoke.maxLife - smoke.life;
    const fadeIn = Math.min(1, age / 0.12);
    const fadeOut = Math.pow(lifeRatio, 1.4);
    const turbulence = 0.88 + Math.sin(smoke.driftPhase * 1.7) * 0.12;
    material.opacity = smoke.opacity * fadeIn * fadeOut * turbulence;
    if (smoke.life <= 0) {
      smoke.sprite.removeFromParent();
      material.dispose();
      muzzleSmokes.splice(i, 1);
    }
  }
  updateMuzzleSmokeTrail(dt);
  // Gunfire flashes pop bright then collapse fast, like a real muzzle flash.
  for (let i = activeMuzzleFlashes.length - 1; i >= 0; i--) {
    const flash = activeMuzzleFlashes[i];
    flash.life -= dt;
    if (flash.life <= 0) {
      flash.light.intensity = 0;
      flash.light.visible = false;
      activeMuzzleFlashes.splice(i, 1);
      continue;
    }
    const t = flash.life / flash.maxLife;
    flash.light.intensity = flash.baseIntensity * t * t;
  }
}
function spawnInterval(waveNumber: number) {
  if (waveNumber <= 1) return 5;
  if (waveNumber === 2) return 4.5;
  if (waveNumber === 3) return 4;
  const intervals = [3.6, 3.4, 3.2, 3.0, 2.8, 2.6, 2.4];
  if (waveNumber <= 10) return intervals[waveNumber - 4];
  return 2.2;
}
function beginWave() {
  state = "combat";
  spawnIndex = 0;
  spawnTimer = spawnInterval(wave);
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
  playerHp = Math.min(1000, playerHp + 200);
  for (const definition of Object.values(weapons)) {
    definition.reserve = Math.max(definition.reserve, definition.maxReserve);
    definition.mag = definition.maxMag;
  }
  banner("SECTOR SECURED", "+200 INTEGRITY / AMMUNITION RESUPPLIED");
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
  
  // A hot MG barrel releases sparse smoke after firing instead of one
  // artificial stop-fire burst. Active-fire smoke is emitted in fire().
  if (!trigger && weapon === "MG" && muzzleSmoke > 0.05) {
    smokeAccumulator += dt * (1.2 + muzzleSmoke * 3.8);
    while (smokeAccumulator >= 1) {
      addMuzzleSmoke(muzzleOrigin(muzzleOffsetForWeapon("MG")), "MG", true);
      smokeAccumulator--;
    }
  } else if (trigger || muzzleSmoke <= 0.05) {
    smokeAccumulator = 0;
  }
  if (!trigger) {
    muzzleSmoke = Math.max(0, muzzleSmoke - dt * 0.34);
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
    spawnTimer = spawnInterval(wave);
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
function resupplyWeapons() {
  for (const definition of Object.values(weapons)) {
    definition.mag = definition.maxMag;
    definition.reserve = definition.maxReserve;
  }
  reload = 0;
  message("FULL AMMUNITION RESUPPLY");
}
function jumpToWave(input: string) {
  const requestedWave = Number.parseInt(input, 10);
  if (!Number.isFinite(requestedWave)) return;
  const targetWave = THREE.MathUtils.clamp(requestedWave, 1, 999);
  if (state === "title") {
    nextStartWave = targetWave;
    return;
  }
  const wasPaused = state === "paused";
  clearRun();
  wave = targetWave;
  endless = targetWave > 10;
  beginWave();
  if (wasPaused) {
    pausedState = "combat";
    state = "paused";
  }
}
function installDevTools() {
  const waveInput = document.querySelector<HTMLInputElement>("#devWave");
  const applyWave = document.querySelector<HTMLButtonElement>("#devApplyWave");
  const infiniteAmmoToggle = document.querySelector<HTMLInputElement>("#devInfiniteAmmo");
  const godModeToggle = document.querySelector<HTMLInputElement>("#devGodMode");
  const resupply = document.querySelector<HTMLButtonElement>("#devResupply");
  const repair = document.querySelector<HTMLButtonElement>("#devRepair");
  if (!waveInput || !applyWave || !infiniteAmmoToggle || !godModeToggle || !resupply || !repair) return;
  waveInput.value = String(state === "title" ? nextStartWave : wave);
  infiniteAmmoToggle.checked = infiniteAmmo;
  godModeToggle.checked = godMode;
  document.querySelectorAll<HTMLInputElement>(".dev-stat").forEach((input) => {
    const group = input.dataset.devGroup;
    const type = input.dataset.devType;
    const stat = input.dataset.devStat;
    if (!group || !type || !stat) return;
    const target = (group === "weapon" ? weapons[type as Weapon] : specs[type as EnemyType]) as unknown as Record<string, number>;
    input.value = String(target[stat]);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (Number.isFinite(value) && value >= 0) target[stat] = value;
    });
  });
  infiniteAmmoToggle.addEventListener("change", () => {
    infiniteAmmo = infiniteAmmoToggle.checked;
  });
  godModeToggle.addEventListener("change", () => {
    godMode = godModeToggle.checked;
  });
  applyWave.addEventListener("click", () => jumpToWave(waveInput.value));
  waveInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") jumpToWave(waveInput.value);
  });
  resupply.addEventListener("click", resupplyWeapons);
  repair.addEventListener("click", () => {
    playerHp = 1000;
    message("BUNKER INTEGRITY RESTORED");
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
    '<div class="card"><div class="eyebrow">EMPLACEMENT / STANDBY</div><h1>HOLD<span>POSITION</span></h1><div class="title-rule"></div><p>Combat is paused.</p><button class="button" id="resume">RESUME DEFENSE →</button><button class="button secondary" id="restart">RESTART MISSION</button>' +
    devToolsMarkup() +
    '<div class="hint">Mouse: aim · Left click: fire · Right click: zoom<br>1–3: weapons · R: reload<br>Arrow keys also aim. If the pointer is not captured, drag to aim.</div></div>';
  overlay.style.display = "flex";
  installDevTools();
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
  if (airWarningEnemyId !== null) {
    const warned = enemies.find(
      (enemy) => !enemy.dead && enemy.group.id === airWarningEnemyId,
    );
    if (warned) {
      const dx = warned.group.position.x - playerPosition.x;
      const dz = warned.group.position.z - playerPosition.z;
      hud.setAirWarning(
        bearing(dx, dz),
        warned.group.position.distanceTo(playerPosition),
      );
    } else {
      airWarningEnemyId = null;
      hud.setAirWarning(null);
    }
  } else {
    hud.setAirWarning(null);
  }
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
        ? specs[hit.object.userData.enemy.type].name +
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
  weaponView.update(
    active() ? dt : 0, simulationTime, reload > 0, zoom,
    weapons[weapon].mag,
    reload > 0 ? 1 - reload / weapons[weapon].reload : 0,
    Math.min(weapons[weapon].maxMag, weapons[weapon].mag + weapons[weapon].reserve),
  );
  updateHud(dt);
  renderer.render(scene, camera);
  if (state !== "title") weaponView.render(renderer);
}
document.querySelector("#start")!.addEventListener("click", reset);
installDevTools();
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
    { "1": "MG", "2": "CANNON", "3": "BOFORS" } as Record<string, Weapon>
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


