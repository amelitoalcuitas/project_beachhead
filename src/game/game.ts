import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Battlefield } from "../rendering/battlefield.ts";
import { WeaponView } from "../rendering/weapon-view.ts";
import { CombatHud } from "../ui/hud.ts";
import { screenMarkup, ScreenMessages } from "../ui/screens.ts";
import { weapons, wavePlans, specs } from "../content.ts";
import type { EnemyType, Weapon, State } from "../types.ts";
import { bearing } from "../gameplay/combat.ts";
import { AudioManager } from "../audio/audio.ts";
import { createSessionState, isActive } from "./game-state.ts";
import { beginWave, completeWave, spawnInterval } from "./waves.ts";
import { bindControls } from "../input/controls.ts";
import { EffectsSystem } from "../rendering/effects.ts";
import { EnemySystem } from "../gameplay/enemies.ts";
import { ProjectileSystem } from "../gameplay/projectiles.ts";
import { WeaponSystem } from "../gameplay/weapons.ts";

export class Game {
  private readonly app: HTMLElement;
  private overlay!: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1400);
  private readonly playerPosition = new THREE.Vector3(0, 7, 18);
  private readonly renderer: THREE.WebGLRenderer;
  private hud!: CombatHud;
  private battlefield!: Battlefield;
  private readonly weaponView = new WeaponView();
  private controls!: PointerLockControls;
  private readonly enemyLayer = new THREE.Group();
  private readonly projectileLayer = new THREE.Group();
  private readonly effectLayer = new THREE.Group();
  private readonly smokeLayer = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly sphereGeometry = new THREE.SphereGeometry(1, 8, 6);
  private readonly wreckageBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly audio = new AudioManager();
  private readonly session = createSessionState();
  private readonly screens = new ScreenMessages();
  private readonly lookDirection = new THREE.Vector3();
  private readonly heldKeys = new Set<string>();
  private lastAutoPauseTime = 0;
  private simulationTime = 0;
  private worldTime = 0;
  private shake = 0;
  private accumulator = 0;
  private previousTime = performance.now();
  private activePlan = [...wavePlans[0]];
  private inspectionTimer = 0;
  private awaitingPointerLockClick = false;

  private readonly effects!: EffectsSystem;
  private readonly enemies!: EnemySystem;
  private readonly projectiles!: ProjectileSystem;
  private readonly weaponSystem!: WeaponSystem;

  constructor(app: HTMLElement) {
    this.app = app;
    this.app.innerHTML = screenMarkup;
    this.overlay = document.querySelector<HTMLElement>("#overlay")!;
    this.scene.fog = new THREE.Fog(0xcc8455, 210, 950);
    this.camera.position.copy(this.playerPosition);
    this.camera.rotation.x = -0.055;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.setAttribute("aria-label", "3D beachhead battlefield");
    this.renderer.domElement.tabIndex = 0;
    this.app.prepend(this.renderer.domElement);
    this.hud = new CombatHud(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xff9d6b, 0x4a3a52, 1.6));
    const sun = new THREE.DirectionalLight(0xff7a3d, 2.9);
    sun.position.set(-260, 55, -140);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 500 });
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.001;
    sun.shadow.normalBias = 0.06;
    this.scene.add(sun);
    this.battlefield = new Battlefield(this.scene);
    this.controls = new PointerLockControls(this.camera, this.renderer.domElement);
    this.controls.pointerSpeed = 0.65;
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(5);
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(125);
    this.scene.add(this.enemyLayer, this.projectileLayer, this.effectLayer, this.smokeLayer);

    const shakeApi = {
      addShake: (amount: number) => { this.shake = Math.max(this.shake, amount); },
      getShake: () => this.shake,
      setShake: (amount: number) => { this.shake = amount; },
    };

    this.weaponSystem = new WeaponSystem({
      session: this.session,
      camera: this.camera,
      playerPosition: this.playerPosition,
      lookDirection: this.lookDirection,
      weaponView: this.weaponView,
      screens: this.screens,
      audio: this.audio,
      effects: null,
      projectiles: null,
      sphereGeometry: this.sphereGeometry,
      projectileLayer: this.projectileLayer,
      isActive: () => this.active(),
      ...shakeApi,
    });

    this.effects = new EffectsSystem(
      {
        scene: this.scene,
        camera: this.camera,
        effectLayer: this.effectLayer,
        smokeLayer: this.smokeLayer,
        playerPosition: this.playerPosition,
        audio: this.audio,
        muzzlePan: (p) => this.weaponSystem.muzzlePan(p),
        muzzleOrigin: (o) => this.weaponSystem.muzzleOrigin(o),
        muzzleOffsetForWeapon: (w) => this.weaponSystem.muzzleOffsetForWeapon(w),
        addShake: shakeApi.addShake,
      },
      this.sphereGeometry,
      this.wreckageBoxGeometry,
    );

    this.projectiles = new ProjectileSystem({
      playerPosition: this.playerPosition,
      projectileLayer: this.projectileLayer,
      audio: this.audio,
      effects: this.effects,
      enemies: null,
      muzzlePan: (p) => this.weaponSystem.muzzlePan(p),
      onHurtPlayer: (amount, bearing) => this.hurtPlayer(amount, bearing),
    });

    this.enemies = new EnemySystem({
      session: this.session,
      playerPosition: this.playerPosition,
      enemyLayer: this.enemyLayer,
      getSimulationTime: () => this.simulationTime,
      battlefield: this.battlefield,
      raycaster: this.raycaster,
      hud: this.hud,
      audio: this.audio,
      screens: this.screens,
      effects: this.effects,
      projectiles: this.projectiles,
      sphereGeometry: this.sphereGeometry,
      projectileLayer: this.projectileLayer,
      getWeapon: () => this.weaponSystem.weapon,
      muzzlePan: (p) => this.weaponSystem.muzzlePan(p),
    });

    this.projectiles.wireEnemies(this.enemies);
    this.weaponSystem.wire(this.effects, this.projectiles);
  }

  start() { bindControls(this); requestAnimationFrame((n) => this.animate(n)); }
  active() { return isActive(this.session); }
  get state() { return this.session.state; } set state(v: State) { this.session.state = v; }
  get pausedState() { return this.session.pausedState; } set pausedState(v: State) { this.session.pausedState = v; }
  get playerHp() { return this.session.playerHp; } set playerHp(v: number) { this.session.playerHp = v; }
  get score() { return this.session.score; } set score(v: number) { this.session.score = v; }
  get wave() { return this.session.wave; } set wave(v: number) { this.session.wave = v; }
  get endless() { return this.session.endless; } set endless(v: boolean) { this.session.endless = v; }
  get infiniteAmmo() { return this.session.infiniteAmmo; } set infiniteAmmo(v: boolean) { this.session.infiniteAmmo = v; }
  get godMode() { return this.session.godMode; } set godMode(v: boolean) { this.session.godMode = v; }
  get nextStartWave() { return this.session.nextStartWave; } set nextStartWave(v: number) { this.session.nextStartWave = v; }
  get domElement() { return this.renderer.domElement; }
  get controlsRef() { return this.controls; }
  get heldKeysRef() { return this.heldKeys; }
  get lastAutoPauseTimeRef() { return this.lastAutoPauseTime; }
  set lastAutoPauseTimeRef(v: number) { this.lastAutoPauseTime = v; }
  get triggerRef() { return this.weaponSystem.trigger; } set triggerRef(v: boolean) { this.weaponSystem.trigger = v; }
  get zoomRef() { return this.weaponSystem.zoom; } set zoomRef(v: boolean) { this.weaponSystem.zoom = v; }
  get awaitingPointerLockClickRef() { return this.awaitingPointerLockClick; }
  set awaitingPointerLockClickRef(v: boolean) { this.awaitingPointerLockClick = v; }
  reset = () => this.resetRun();
  pause = () => this.pauseGame();
  resume = () => this.resumeGame();
  selectWeapon = (w: Weapon) => this.weaponSystem.selectWeapon(w);
  reloadWeapon = () => this.weaponSystem.reloadWeapon();
  fire = () => this.weaponSystem.fire();
  installDevTools = () => this.installDevToolsRun();
  resupplyWeapons = () => this.resupplyWeaponsRun();
  jumpToWave = (i: string) => this.jumpToWaveRun(i);
  capturePointer = () => this.capturePointerRun();
  armPointerLockRetry = () => this.armPointerLockRetryRun();
  message = (t: string) => this.screens.message(t);
  aim = (dx: number, dy: number) => this.aimRun(dx, dy);
  beginWaveNow = () => this.beginWaveRun();

  private clearRun() {
    this.enemies.clear();
    this.projectiles.clear();
    this.effects.clear();
    this.weaponSystem.resetState();
    this.weaponSystem.trigger = this.weaponSystem.zoom = false;
    this.heldKeys.clear();
    this.accumulator = 0;
    this.session.heavyAttackReady = 0;
    this.session.airWarningEnemyId = null;
    this.hud.setAirWarning(null);
    this.screens.clearTimers();
  }

  private armPointerLockRetryRun() {
    if (this.awaitingPointerLockClick) return;
    this.awaitingPointerLockClick = true;
    this.renderer.domElement.addEventListener(
      "mousedown",
      () => {
        this.awaitingPointerLockClick = false;
        if (this.active() && !this.controls.isLocked) this.capturePointerRun();
      },
      { once: true },
    );
  }

  private capturePointerRun() {
    const request = this.renderer.domElement.requestPointerLock() as Promise<void> | undefined;
    if (request?.catch) {
      request.catch(() => {
        this.screens.message("CLICK TO AIM · ARROW KEYS ALSO AVAILABLE");
        this.armPointerLockRetryRun();
      });
    } else {
      window.setTimeout(() => {
        if (this.active() && !this.controls.isLocked) {
          this.screens.message("CLICK TO AIM · ARROW KEYS ALSO AVAILABLE");
          this.armPointerLockRetryRun();
        }
      }, 60);
    }
  }

  private resetRun() {
    this.clearRun();
    this.session.playerHp = 1000;
    this.session.score = 0;
    this.session.wave = this.session.nextStartWave;
    this.session.endless = this.session.wave > 10;
    this.session.nextStartWave = 1;
    this.session.spawnIndex = 0;
    this.session.spawnTimer = spawnInterval(this.session.wave);
    this.session.intermission = 0;
    this.weaponSystem.weapon = "MG";
    this.weaponSystem.reload = this.weaponSystem.cooldown = this.weaponSystem.switchTime = 0;
    this.weaponView.select(this.weaponSystem.weapon, true);
    for (const definition of Object.values(weapons)) {
      definition.mag = definition.maxMag;
      definition.reserve = definition.maxReserve;
    }
    this.activePlan = [...wavePlans[Math.min(this.session.wave - 1, 9)]];
    this.simulationTime = 0;
    this.session.state = "combat";
    this.camera.position.copy(this.playerPosition);
    this.camera.rotation.set(-0.055, 0, 0, "YXZ");
    this.overlay.style.display = "none";
    this.audio.initialize();
    this.capturePointerRun();
    this.beginWaveRun();
  }

  private hurtPlayer(amount: number, sourceBearing?: number) {
    if (this.session.state !== "combat") return;
    if (this.session.godMode) return;
    this.session.playerHp = Math.max(0, this.session.playerHp - amount);
    this.hud.hurt();
    if (sourceBearing !== undefined) this.hud.hitDirection(sourceBearing);
    this.shake = 0.14;
    this.audio.sound("impact");
    this.screens.message("BUNKER HIT / −" + amount + " INTEGRITY");
  }

  private update(dt: number) {
    if (!this.active()) return;
    this.simulationTime += dt;
    this.worldTime += dt;
    this.effects.updateEffects(dt);
    if (this.session.state === "intermission") {
      this.session.intermission -= dt;
      if (this.session.intermission <= 0) this.beginWaveRun();
      return;
    }
    this.weaponSystem.switchTime = Math.max(0, this.weaponSystem.switchTime - dt);
    this.weaponSystem.cooldown = this.weaponSystem.cooldown <= dt + 1e-6 ? 0 : this.weaponSystem.cooldown - dt;
    this.weaponSystem.tickSpread(dt);
    this.weaponSystem.tickReload(dt);
    if (this.weaponSystem.trigger) this.weaponSystem.fire();
    this.session.spawnTimer -= dt;
    if (
      this.session.spawnIndex < this.activePlan.length &&
      this.session.spawnTimer <= 0 &&
      this.enemies.enemies.filter((enemy) => !enemy.dead).length < 32
    ) {
      this.enemies.spawn(this.activePlan[this.session.spawnIndex++]);
      this.session.spawnTimer = spawnInterval(this.session.wave);
    }
    this.enemies.updateEnemies(dt);
    this.projectiles.updateShots(dt);
    if (this.session.playerHp <= 0) {
      this.session.state = "gameover";
      this.showEnd(false);
      return;
    }
    if (
      this.session.spawnIndex >= this.activePlan.length &&
      this.enemies.enemies.every((enemy) => enemy.dead) &&
      this.projectiles.shots.length === 0
    )
      this.completeWaveRun();
  }

  private showEnd(victory: boolean) {
    this.weaponSystem.trigger = this.weaponSystem.zoom = false;
    this.controls.unlock();
    this.screens.showEnd(
      this.overlay,
      victory,
      this.session.score,
      this.session.wave,
      () => this.resetRun(),
      victory
        ? () => {
            this.session.endless = true;
            this.session.wave = 11;
            this.session.playerHp = Math.max(500, this.session.playerHp);
            for (const definition of Object.values(weapons)) {
              definition.mag = definition.maxMag;
              definition.reserve = definition.maxReserve;
            }
            this.overlay.style.display = "none";
            this.beginWaveRun();
            this.capturePointerRun();
          }
        : undefined,
    );
  }

  private resupplyWeaponsRun() {
    for (const definition of Object.values(weapons)) {
      definition.mag = definition.maxMag;
      definition.reserve = definition.maxReserve;
    }
    this.weaponSystem.reload = 0;
    this.screens.message("FULL AMMUNITION RESUPPLY");
  }

  private jumpToWaveRun(input: string) {
    const requestedWave = Number.parseInt(input, 10);
    if (!Number.isFinite(requestedWave)) return;
    const targetWave = THREE.MathUtils.clamp(requestedWave, 1, 999);
    if (this.session.state === "title") {
      this.session.nextStartWave = targetWave;
      return;
    }
    const wasPaused = this.session.state === "paused";
    this.clearRun();
    this.session.wave = targetWave;
    this.session.endless = targetWave > 10;
    this.beginWaveRun();
    if (wasPaused) {
      this.session.pausedState = "combat";
      this.session.state = "paused";
    }
  }

  private installDevToolsRun() {
    const waveInput = document.querySelector<HTMLInputElement>("#devWave");
    const applyWave = document.querySelector<HTMLButtonElement>("#devApplyWave");
    const infiniteAmmoToggle = document.querySelector<HTMLInputElement>("#devInfiniteAmmo");
    const godModeToggle = document.querySelector<HTMLInputElement>("#devGodMode");
    const resupply = document.querySelector<HTMLButtonElement>("#devResupply");
    const repair = document.querySelector<HTMLButtonElement>("#devRepair");
    if (!waveInput || !applyWave || !infiniteAmmoToggle || !godModeToggle || !resupply || !repair) return;
    waveInput.value = String(this.session.state === "title" ? this.session.nextStartWave : this.session.wave);
    infiniteAmmoToggle.checked = this.session.infiniteAmmo;
    godModeToggle.checked = this.session.godMode;
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
      this.session.infiniteAmmo = infiniteAmmoToggle.checked;
    });
    godModeToggle.addEventListener("change", () => {
      this.session.godMode = godModeToggle.checked;
    });
    applyWave.addEventListener("click", () => this.jumpToWaveRun(waveInput.value));
    waveInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.jumpToWaveRun(waveInput.value);
    });
    resupply.addEventListener("click", () => this.resupplyWeaponsRun());
    repair.addEventListener("click", () => {
      this.session.playerHp = 1000;
      this.screens.message("BUNKER INTEGRITY RESTORED");
    });
  }

  private pauseGame() {
    if (!this.active()) return;
    this.session.pausedState = this.session.state;
    this.session.state = "paused";
    this.weaponSystem.trigger = this.weaponSystem.zoom = false;
    this.heldKeys.clear();
    this.controls.unlock();
    this.screens.showPause(
      this.overlay,
      () => this.resumeGame(),
      () => this.resetRun(),
      () => this.installDevToolsRun(),
    );
  }

  private resumeGame() {
    this.session.state = this.session.pausedState;
    this.overlay.style.display = "none";
    this.accumulator = 0;
    this.audio.initialize();
    this.capturePointerRun();
  }

  private updateHud(dt: number) {
    this.camera.getWorldDirection(this.lookDirection);
    if (this.session.airWarningEnemyId !== null) {
      const warned = this.enemies.enemies.find(
        (enemy) => !enemy.dead && enemy.group.id === this.session.airWarningEnemyId,
      );
      if (warned) {
        const dx = warned.group.position.x - this.playerPosition.x;
        const dz = warned.group.position.z - this.playerPosition.z;
        this.hud.setAirWarning(
          bearing(dx, dz),
          warned.group.position.distanceTo(this.playerPosition),
        );
      } else {
        this.session.airWarningEnemyId = null;
        this.hud.setAirWarning(null);
      }
    } else {
      this.hud.setAirWarning(null);
    }
    const definition = weapons[this.weaponSystem.weapon];
    this.hud.update(dt, {
      heading: bearing(this.lookDirection.x, this.lookDirection.z),
      hp: this.session.playerHp,
      score: this.session.score,
      wave: this.session.wave,
      state: this.session.state,
      mag: definition.mag,
      reserve: definition.reserve,
      maxMag: definition.maxMag,
      weapon: this.weaponSystem.weapon,
      weaponName: definition.name,
      reload: this.weaponSystem.reload,
      reloadDuration: definition.reload,
      switching: this.weaponSystem.switchTime > 0,
      zoom: this.weaponSystem.zoom,
      intermission: this.session.intermission,
      spread: this.weaponSystem.spreadAngle,
      contacts: this.enemies.enemies
        .filter((enemy) => !enemy.dead)
        .map((enemy) => ({
          id: enemy.group.id,
          x: enemy.group.position.x - this.playerPosition.x,
          z: enemy.group.position.z - this.playerPosition.z,
          distance: enemy.group.position.distanceTo(this.playerPosition),
          air: !!specs[enemy.type].air,
          inRange: enemy.canAttack,
        })),
    });
    this.inspectionTimer -= dt;
    if (this.inspectionTimer <= 0 && this.active()) {
      this.inspectionTimer = 0.15;
      this.raycaster.set(this.playerPosition, this.lookDirection);
      this.raycaster.far = 650;
      const hit = this.raycaster
        .intersectObjects(this.enemyLayer.children, true)
        .find((h) => !h.object.userData.enemy.dead);
      const target = document.querySelector<HTMLElement>("#targetInfo")!;
      target.textContent =
        hit &&
        this.enemies.obstructionDistance(this.playerPosition, this.lookDirection, hit.distance) >
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

  private aimRun(dx: number, dy: number) {
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y -= dx;
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.camera.rotation.x - dy,
      THREE.MathUtils.degToRad(-35),
      THREE.MathUtils.degToRad(85),
    );
  }

  private animate(now: number) {
    requestAnimationFrame((n) => this.animate(n));
    const dt = Math.min((now - this.previousTime) / 1000, 0.05);
    this.previousTime = now;
    if (this.active()) {
      this.aimRun(
        ((this.heldKeys.has("ArrowRight") ? 1 : 0) - (this.heldKeys.has("ArrowLeft") ? 1 : 0)) * dt,
        ((this.heldKeys.has("ArrowDown") ? 1 : 0) - (this.heldKeys.has("ArrowUp") ? 1 : 0)) * dt,
      );
      this.accumulator = Math.min(this.accumulator + dt, 0.1);
      while (this.accumulator >= 1 / 60) {
        this.update(1 / 60);
        this.accumulator -= 1 / 60;
      }
    } else if (this.session.state === "title") {
      this.worldTime += dt;
    }
    this.battlefield.update(this.worldTime);
    this.camera.position.copy(this.playerPosition);
    if (this.shake > 0 && this.active()) {
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt);
    }
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, this.weaponSystem.zoom ? 45 : 75, 12, dt);
    this.camera.updateProjectionMatrix();
    this.weaponView.update(
      this.active() ? dt : 0,
      this.simulationTime,
      this.weaponSystem.reload > 0,
      this.weaponSystem.zoom,
      weapons[this.weaponSystem.weapon].mag,
      this.weaponSystem.reload > 0 ? 1 - this.weaponSystem.reload / weapons[this.weaponSystem.weapon].reload : 0,
      Math.min(weapons[this.weaponSystem.weapon].maxMag, weapons[this.weaponSystem.weapon].mag + weapons[this.weaponSystem.weapon].reserve),
    );
    this.updateHud(dt);
    this.renderer.render(this.scene, this.camera);
    if (this.session.state !== "title") this.weaponView.render(this.renderer);
  }

  private beginWaveRun() {
    beginWave(this.session, this.activePlan, {
      banner: (title, subtitle) => this.screens.banner(title, subtitle),
      showEnd: (victory) => this.showEnd(victory),
    });
  }

  private completeWaveRun() {
    completeWave(this.session, {
      banner: (title, subtitle) => this.screens.banner(title, subtitle),
      showEnd: (victory) => this.showEnd(victory),
    });
  }
}
