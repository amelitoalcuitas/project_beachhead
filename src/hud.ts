import * as THREE from "three";
import {
  bearing,
  bearingDelta,
  radarContactPosition,
  RADAR_RANGE_METERS,
  RADAR_RING_INTERVAL_METERS,
  RADAR_RADIUS_PERCENT,
} from "./combat";
import type { Weapon } from "./types";
import { enemyNames, weaponRoles } from "./content";

export function devToolsMarkup() {
  const weaponFields = [
    ["damage", "DAMAGE"], ["fireRate", "FIRE RATE / SEC"], ["reload", "RELOAD TIME / SEC"],
    ["maxMag", "MAGAZINE SIZE"], ["maxReserve", "RESERVE AMMO"],
    ["bulletDrop", "BULLET DROP"], ["projectileSpeed", "PROJECTILE SPEED"], ["spread", "BULLET SPREAD"],
    ["explosionDamage", "EXPLOSION DAMAGE"], ["explosionRadius", "EXPLOSION RADIUS"],
  ];
  const enemyFields = [
    ["hp", "HP"], ["speed", "MOVEMENT SPEED"], ["attack", "DAMAGE"], ["attackRate", "ATTACK RATE / SEC"],
    ["range", "ATTACK RANGE"], ["bulletDrop", "BULLET DROP"], ["projectileSpeed", "PROJECTILE SPEED"],
    ["explosionDamage", "EXPLOSION DAMAGE"], ["explosionRadius", "EXPLOSION RADIUS"],
  ];
  const fieldMarkup = (group: string, type: string, fields: string[][]) =>
    fields.map(([stat, label]) => `<label>${label}<input class="dev-stat" data-dev-group="${group}" data-dev-type="${type}" data-dev-stat="${stat}" type="number" min="0" step="any"></label>`).join("");
  const weaponMarkup = ["MG", "CANNON", "BOFORS"].map((type) => {
    const label =
      type === "MG"
        ? "BROWNING"
        : type === "CANNON"
          ? "AT GUN"
          : "BOFORS";
    const fields = type === "BOFORS"
      ? [...weaponFields, ["proximityRadius", "AIR PROXIMITY RADIUS"], ["armingDistance", "FUSE ARMING DISTANCE"]]
      : weaponFields;
    return `<details class="dev-subsection"><summary>${label}</summary><div class="dev-field-grid">${fieldMarkup("weapon", type, fields)}</div></details>`;
  }).join("");
  const enemyMarkup = ["infantry", "armoredInfantry", "grenadierInfantry", "jeep", "truck", "apc", "tank", "heli", "aircraft"].map((type) => `<details class="dev-subsection"><summary>${enemyNames[type as keyof typeof enemyNames]}</summary><div class="dev-field-grid">${fieldMarkup("enemy", type, enemyFields)}</div></details>`).join("");
  return `<details class="dev-tools" aria-label="Developer tools"><summary><span>DEVELOPER TOOLS</span><small>LIVE TUNING / LOCAL ONLY</small></summary><div class="dev-tools-content"><div class="dev-tools-grid"><label>SKIP TO WAVE<input id="devWave" type="number" min="1" max="999" value="1" inputmode="numeric"></label><button class="dev-button" id="devApplyWave">APPLY</button><label class="dev-toggle"><input id="devInfiniteAmmo" type="checkbox"> INFINITE AMMO</label><label class="dev-toggle"><input id="devGodMode" type="checkbox"> GOD MODE</label><button class="dev-button" id="devResupply">FULL RESUPPLY</button><button class="dev-button" id="devRepair">REPAIR INTEGRITY</button></div><div class="dev-section-title">WEAPON SYSTEMS</div>${weaponMarkup}<div class="dev-section-title">ENEMY TYPES</div>${enemyMarkup}</div></details>`;
}

export const screenMarkup = `
<div id="hud">
  <div class="vignette"></div><div id="damageVeil"></div>
  <header class="operation"><span class="eyebrow">FIRST ARMY · COASTAL DEFENSE</span><strong>BEACHHEAD <span>/ NORMANDY</span></strong><div class="live"><i></i><span id="status">STANDING BY</span></div></header>
  <section class="compass" aria-label="Horizontal enemy compass"><div class="compass-meta"><span>TACTICAL BEARING</span><b id="heading">000° N</b><span><i class="red-dot"></i> HOSTILES</span></div><div class="compass-window" id="compassTrack"><div id="ticks"></div><div id="pins"></div><div class="heading-needle"></div></div><div class="compass-baseline"></div></section>
  <section class="score-block"><span class="eyebrow">MISSION SCORE</span><strong id="score">000000</strong><small>WAVE <b id="wave">01</b> <span>/</span> CONTACTS <b id="threats">00</b></small></section>
  <aside class="objective"><span class="eyebrow">PRIMARY OBJECTIVE</span><p>HOLD THE BEACHHEAD</p><div id="objectiveDetail">Watch the shoreline. Hold your position.</div></aside>
  <div class="reticle" id="reticle"><i></i><i></i><i></i><i></i><b></b></div><div id="hitMarker">×</div><div id="directionRing" aria-hidden="true"></div><div id="airWarningLabel" hidden></div>
  <div id="targetInfo" class="target-info"></div><div class="message" id="message"></div><div class="wave-banner" id="banner"></div><div id="bottomPrompt" class="bottom-prompt"><span id="bottomPromptLabel"></span><div class="bottom-progress"><div id="bottomProgressFill"></div></div></div>
  <section class="health-block panel"><div class="panel-heading"><span>◆ BUNKER INTEGRITY</span><b id="integrityState">OPERATIONAL</b></div><div class="health-number"><strong id="hp">1000</strong><span>/ 1000</span></div><div class="bar"><div class="fill" id="hpFill"></div></div><div class="radar-row"><div class="radar" role="img" aria-label="Proximity scanner: forward is up, 200 meter radius, hollow markers are beyond range"><div id="radarRings"></div><div class="radar-sweep"></div><div id="radarNorth" class="radar-north">N</div><div class="radar-self">▲</div><div id="radarContacts"></div></div><div class="radar-caption"><span class="eyebrow">PROXIMITY SCAN</span><b id="closest">NO CONTACT</b><small>Rings: ${RADAR_RING_INTERVAL_METERS} m · radius: ${RADAR_RANGE_METERS} m</small><small id="radarDistant">No distant contacts</small></div></div></section>
  <nav class="loadout" aria-label="Weapons"><button data-weapon="MG" class="selected" title="${weaponRoles.MG}"><kbd>1</kbd><span>BROWNING</span><small>.30 CAL</small></button><button data-weapon="CANNON" title="${weaponRoles.CANNON}"><kbd>2</kbd><span>AT GUN</span><small>57 MM</small></button><button data-weapon="BOFORS" title="${weaponRoles.BOFORS}"><kbd>3</kbd><span>BOFORS</span><small>40 MM · AA</small></button></nav>
  <section class="ammo-block panel"><div class="panel-heading"><span id="weaponName">M1919A4 BROWNING</span><b id="weaponStatus">READY</b></div><div class="ammo-number"><strong id="ammo">120</strong><span>/ <b id="reserve">480</b><small>RESERVE</small></span></div><div class="rounds" id="rounds"></div><div class="reload-meter"><div id="reloadFill"></div></div><div class="ammo-footer"><span id="ammoType">.30 CAL · AUTOMATIC</span><span><kbd>R</kbd> RELOAD</span></div></section>
  <footer class="control-strip"><span>MOUSE <b>AIM</b></span><span>LMB <b>FIRE</b></span><span>RMB <b>ZOOM</b></span><span>1–3 <b>WEAPONS</b></span><span>ESC <b>PAUSE</b></span><button id="pauseButton">Ⅱ PAUSE</button></footer>
</div>
<div class="overlay" id="overlay"><div class="card"><div class="eyebrow"><span class="tag">OPERATION OVERLORD</span> NORMANDY BEACHHEAD</div><h1>BEACHHEAD<span>LAST STAND</span></h1><div class="title-rule"></div><p>A grey dawn over the Channel.<br>A position you cannot abandon.</p><p class="description">Man the emplacement. Watch every bearing. Stop German infantry, armor, and aircraft before they overrun your beachhead.</p><div class="mission-stats"><div><b>360°</b><span>BATTLEFIELD</span></div><div><b>03</b><span>WEAPON SYSTEMS</span></div><div><b>10</b><span>ASSAULT WAVES</span></div></div><button class="button" id="start">DEPLOY TO EMPLACEMENT <span>→</span></button>${devToolsMarkup()}<div class="hint">Mouse to aim and fire · 1–3 weapons · R reload · Esc pause</div></div><div class="title-coordinate">SECTOR OMAHA / UTAH BEACH<br>DEFENSIVE POSITION · 06 JUN 1944 · 06:40 HRS</div></div>`;

interface Contact {
  id: number;
  x: number;
  z: number;
  distance: number;
  air: boolean;
  inRange: boolean;
}
interface HudSnapshot {
  heading: number;
  hp: number;
  score: number;
  wave: number;
  state: string;
  mag: number;
  reserve: number;
  maxMag: number;
  weapon: string;
  weaponName: string;
  reload: number;
  reloadDuration: number;
  switching: boolean;
  zoom: boolean;
  intermission: number;
  contacts: Contact[];
  spread: number;
}

export class CombatHud {
  private elements = new Map<string, HTMLElement>();
  private ticks: HTMLElement[] = [];
  private pins = new Map<number, HTMLElement>();
  private dots = new Map<number, HTMLElement>();
  private damageTime = 0;
  private hitTime = 0;
  private currentSpread = 0;
  private hitIndicators: { bearing: number; life: number }[] = [];
  private airWarning: { bearing: number; distance: number } | null = null;
  private camera: THREE.PerspectiveCamera;
  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    document
      .querySelectorAll<HTMLElement>("#hud [id]")
      .forEach((el) => this.elements.set(el.id, el));
    for (let angle = 0; angle < 360; angle += 5) {
      const tick = document.createElement("span");
      tick.className = "tick";
      if (angle % 15 === 0) {
        tick.classList.add("major");
        tick.textContent =
          angle % 45 === 0
            ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][angle / 45]
            : String(angle).padStart(3, "0");
      }
      this.el("ticks").append(tick);
      this.ticks.push(tick);
    }
    this.el("rounds").innerHTML = "<i></i>".repeat(24);
    for (let meters = RADAR_RING_INTERVAL_METERS; meters <= RADAR_RANGE_METERS; meters += RADAR_RING_INTERVAL_METERS) {
      const ring = document.createElement("span");
      ring.className = "radar-ring";
      const diameter = (meters / RADAR_RANGE_METERS) * RADAR_RADIUS_PERCENT * 2;
      ring.style.width = ring.style.height = `${diameter}%`;
      ring.setAttribute("aria-label", `${meters} meter range ring`);
      this.el("radarRings").append(ring);
    }
  }
  private el(id: string) {
    return this.elements.get(id)!;
  }
  private text(id: string, text: string) {
    const el = this.el(id);
    if (el.textContent !== text) el.textContent = text;
  }
  hit(kill = false) {
    this.hitTime = 0.18;
    this.el("hitMarker").style.color = kill ? "#f5bd67" : "#f5f0d8";
  }
  hurt() {
    this.damageTime = 0.65;
  }
  hitDirection(sourceBearing: number) {
    this.hitIndicators.push({ bearing: sourceBearing, life: 0.9 });
    if (this.hitIndicators.length > 4) this.hitIndicators.shift();
  }
  setAirWarning(bearing: number | null, distance = 0) {
    this.airWarning =
      bearing === null ? null : { bearing, distance };
  }
  update(dt: number, s: HudSnapshot) {
    const active = s.state !== "title";
    document.querySelector("#hud")!.classList.toggle("active", active);
    this.text(
      "heading",
      `${String(Math.round(s.heading) % 360).padStart(3, "0")}° ${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(s.heading / 45) % 8]}`,
    );
    this.ticks.forEach((tick, i) => {
      const delta = bearingDelta(i * 5, s.heading);
      tick.hidden = Math.abs(delta) > 92;
      tick.style.left = `${50 + (delta / 180) * 100}%`;
    });
    const ids = new Set(s.contacts.map((c) => c.id));
    const northAngle = (bearingDelta(0, s.heading) * Math.PI) / 180;
    this.el("radarNorth").style.left = `${50 + Math.sin(northAngle) * 47}%`;
    this.el("radarNorth").style.top = `${50 - Math.cos(northAngle) * 47}%`;
    for (const map of [this.pins, this.dots])
      for (const [id, element] of map)
        if (!ids.has(id)) {
          element.remove();
          map.delete(id);
        }
    for (const contact of s.contacts) {
      let pin = this.pins.get(contact.id),
        dot = this.dots.get(contact.id);
      if (!pin) {
        pin = document.createElement("span");
        pin.className = "enemy-pin";
        this.el("pins").append(pin);
        this.pins.set(contact.id, pin);
      }
      if (!dot) {
        dot = document.createElement("i");
        dot.className = "radar-dot";
        this.el("radarContacts").append(dot);
        this.dots.set(contact.id, dot);
      }
      const delta = bearingDelta(bearing(contact.x, contact.z), s.heading),
        clamped = Math.max(-86, Math.min(86, delta));
      pin.style.left = `${50 + (clamped / 180) * 100}%`;
      pin.className = `enemy-pin ${contact.air ? "air" : ""} ${contact.inRange ? "engaging" : ""} ${Math.abs(delta) > 90 ? "behind" : ""}`;
      pin.textContent =
        Math.abs(delta) > 90
          ? delta < 0
            ? "‹"
            : "›"
          : contact.air
            ? "⌃"
            : "◆";
      pin.setAttribute(
        "aria-label",
        `${contact.air ? "Air" : "Ground"} hostile ${Math.round(contact.distance)} meters, bearing ${Math.round(bearing(contact.x, contact.z))}`,
      );
      // Use the same direct target distance as the numeric readout, including altitude.
      const radarPosition = radarContactPosition(delta, contact.distance);
      dot.style.left = `${radarPosition.left}%`;
      dot.style.top = `${radarPosition.top}%`;
      dot.classList.toggle("distant", radarPosition.isDistant);
      dot.classList.toggle("engaging", contact.inRange);
      dot.setAttribute("aria-label", `${contact.air ? "Air" : "Ground"} hostile ${Math.round(contact.distance)} meters${radarPosition.isDistant ? ", beyond scanner range" : ""}`);
      dot.title = `${Math.round(contact.distance)} m${radarPosition.isDistant ? " · beyond scanner range" : ""}`;
    }
    const distantCount = s.contacts.filter(contact => contact.distance > RADAR_RANGE_METERS).length;
    this.text("radarDistant", distantCount ? `◇ ${distantCount} beyond ${RADAR_RANGE_METERS} m` : "No distant contacts");
    this.text("score", String(s.score).padStart(6, "0"));
    this.text("wave", String(s.wave).padStart(2, "0"));
    this.text("threats", String(s.contacts.length).padStart(2, "0"));
    this.text("hp", String(Math.ceil(s.hp)));
    this.el("hpFill").style.width = `${s.hp / 10}%`;
    this.text(
      "integrityState",
      s.hp < 300 ? "CRITICAL" : s.hp < 650 ? "DAMAGED" : "OPERATIONAL",
    );
    this.el("hpFill").classList.toggle("danger", s.hp < 300);
    this.text("weaponName", s.weaponName);
    this.text("ammo", String(s.mag).padStart(2, "0"));
    this.text("reserve", String(s.reserve));
    this.text(
      "weaponStatus",
      s.switching
        ? "SWITCHING"
        : s.reload > 0
          ? `RELOADING ${s.reload.toFixed(1)}s`
          : s.mag === 0
            ? "EMPTY"
            : "READY",
    );
    this.el("reloadFill").style.width =
      s.reload > 0 ? `${(1 - s.reload / s.reloadDuration) * 100}%` : "0%";
    this.el("rounds")
      .querySelectorAll("i")
      .forEach((round, i) =>
        round.classList.toggle(
          "spent",
          i >= Math.ceil((s.mag / s.maxMag) * 24),
        ),
      );
    this.text(
      "ammoType",
      s.weapon === "MG"
        ? ".30 CAL · AUTOMATIC"
        : s.weapon === "CANNON"
          ? "57 MM · ARMOR-PIERCING"
          : "40 MM · ASSISTED FLAK",
    );
    document
      .querySelectorAll<HTMLElement>("[data-weapon]")
      .forEach((button) =>
        button.classList.toggle("selected", button.dataset.weapon === s.weapon),
      );
    const nearest = s.contacts.reduce(
      (n, c) => Math.min(n, c.distance),
      Infinity,
    );
    this.text(
      "closest",
      Number.isFinite(nearest)
        ? `${Math.round(nearest)} M · NEAREST`
        : "NO CONTACT",
    );
    this.text(
      "status",
      s.state === "combat"
        ? "DEFENSE ACTIVE"
        : s.state === "intermission"
          ? "RESUPPLY IN PROGRESS"
          : s.state.toUpperCase(),
    );
    this.text(
      "objectiveDetail",
      s.state === "intermission"
        ? `Next assault in ${Math.ceil(s.intermission)}s · repairs + supplies · press SPACE to start now`
        : s.contacts.some((c) => c.inRange)
          ? "Enemies in firing range. Prioritize nearby threats."
          : "Red pins mark incoming contacts. Scan all bearings.",
    );
    const prompt = this.el("bottomPrompt");
    const promptLabel = this.el("bottomPromptLabel");
    const progressFill = this.el("bottomProgressFill");
    const isReloading = s.reload > 0;
    const isIntermission = s.state === "intermission";
    prompt.classList.toggle("show", isReloading || isIntermission);
    if (isReloading) {
      promptLabel.textContent = "Reloading";
      progressFill.style.width = `${(1 - s.reload / s.reloadDuration) * 100}%`;
    } else if (isIntermission) {
      promptLabel.textContent = "Press Space to Start";
      progressFill.style.width = `${Math.max(0, Math.min(1, 1 - s.intermission / 12)) * 100}%`;
    } else {
      promptLabel.textContent = "";
      progressFill.style.width = "0%";
    }
    this.damageTime = Math.max(0, this.damageTime - dt);
    this.hitTime = Math.max(0, this.hitTime - dt);
    this.hitIndicators = this.hitIndicators
      .map((indicator) => ({ ...indicator, life: indicator.life - dt }))
      .filter((indicator) => indicator.life > 0);
    this.renderDirectionRing(s.heading);
    this.el("damageVeil").style.opacity = String(this.damageTime);
    this.el("hitMarker").style.opacity = this.hitTime > 0 ? "1" : "0";
    this.el("reticle").classList.toggle("zoom", s.zoom);
    this.el("reticle").dataset.weapon = s.weapon;
    // Update dynamic crosshair to match bullet spread circumference
    this.currentSpread = s.spread || 0;
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const pixelPerRadian = (window.innerHeight / 2) / Math.tan(fovRad / 2);
    const spreadPx = this.currentSpread * pixelPerRadian;
    const range = CombatHud.reticleRange[s.weapon as Weapon] ?? CombatHud.reticleRange.MG;
    const size = THREE.MathUtils.clamp(range.min + spreadPx, range.min, range.max);
    this.updateCrosshairSpread(size);
  }
  private renderDirectionRing(heading: number) {
    const ring = this.el("directionRing");
    ring.replaceChildren();
    const label = this.el("airWarningLabel");
    if (this.airWarning) {
      const delta = bearingDelta(this.airWarning.bearing, heading);
      const air = document.createElement("span");
      air.className = "air-arrow";
      air.style.transform = `rotate(${delta}deg) translateY(-92px)`;
      air.textContent = "▲";
      ring.append(air);
      label.hidden = false;
      label.textContent = `INCOMING AIR · ${Math.round(this.airWarning.distance)} M`;
      label.style.transform = `translate(-50%, -50%) rotate(${delta}deg) translateY(-118px)`;
    } else {
      label.hidden = true;
      label.textContent = "";
    }
    for (const indicator of this.hitIndicators) {
      const arrow = document.createElement("span");
      arrow.className = "hit-arrow";
      const delta = bearingDelta(indicator.bearing, heading);
      arrow.style.transform = `rotate(${delta}deg) translateY(-78px)`;
      arrow.style.opacity = String(Math.min(1, indicator.life / 0.35));
      arrow.textContent = "▲";
      ring.append(arrow);
    }
  }
  // Base/max on-screen size (px) of the reticle per weapon, so heavy weapons
  // keep a clean, readable shape instead of collapsing to the spread floor.
  private static readonly reticleRange: Record<Weapon, { min: number; max: number }> = {
    MG: { min: 6, max: 90 },
    CANNON: { min: 30, max: 46 },
    BOFORS: { min: 48, max: 64 },
  };
  updateCrosshairSpread(size: number) {
    const reticle = this.el("reticle");
    reticle.style.width = `${size}px`;
    reticle.style.height = `${size}px`;
    // Tick and dot alignment are handled in CSS via 50% + translate so border-box
    // borders do not offset the reticle center.
  }
}
