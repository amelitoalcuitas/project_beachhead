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

export const screenMarkup = `
<div id="hud">
  <div class="vignette"></div><div id="damageVeil"></div>
  <header class="operation"><span class="eyebrow">COASTAL DEFENSE COMMAND</span><strong>BEACHHEAD <span>/ 07</span></strong><div class="live"><i></i><span id="status">STANDING BY</span></div></header>
  <section class="compass" aria-label="Horizontal enemy compass"><div class="compass-meta"><span>TACTICAL BEARING</span><b id="heading">000° N</b><span><i class="red-dot"></i> HOSTILES</span></div><div class="compass-window" id="compassTrack"><div id="ticks"></div><div id="pins"></div><div class="heading-needle"></div></div><div class="compass-baseline"></div></section>
  <section class="score-block"><span class="eyebrow">MISSION SCORE</span><strong id="score">000000</strong><small>WAVE <b id="wave">01</b> <span>/</span> CONTACTS <b id="threats">00</b></small></section>
  <aside class="objective"><span class="eyebrow">PRIMARY OBJECTIVE</span><p>DEFEND THE BEACHHEAD</p><div id="objectiveDetail">Watch the shoreline. Hold your position.</div></aside>
  <div class="reticle" id="reticle"><i></i><i></i><i></i><i></i><b></b></div><div id="hitMarker">×</div>
  <div id="targetInfo" class="target-info"></div><div class="message" id="message"></div><div class="wave-banner" id="banner"></div>
  <section class="health-block panel"><div class="panel-heading"><span>◆ BUNKER INTEGRITY</span><b id="integrityState">OPERATIONAL</b></div><div class="health-number"><strong id="hp">1000</strong><span>/ 1000</span></div><div class="bar"><div class="fill" id="hpFill"></div></div><div class="radar-row"><div class="radar" role="img" aria-label="Proximity scanner: forward is up, 200 meter radius, hollow markers are beyond range"><div id="radarRings"></div><div class="radar-sweep"></div><div id="radarNorth" class="radar-north">N</div><div class="radar-self">▲</div><div id="radarContacts"></div></div><div class="radar-caption"><span class="eyebrow">PROXIMITY SCAN</span><b id="closest">NO CONTACT</b><small>Rings: ${RADAR_RING_INTERVAL_METERS} m · radius: ${RADAR_RANGE_METERS} m</small><small id="radarDistant">No distant contacts</small></div></div></section>
  <nav class="loadout" aria-label="Weapons"><button data-weapon="MG" class="selected"><kbd>1</kbd><span>MG</span><small>7.62 MM</small></button><button data-weapon="CANNON"><kbd>2</kbd><span>CANNON</span><small>40 MM</small></button><button data-weapon="ROCKET"><kbd>3</kbd><span>ROCKET</span><small>ANTI-ARMOR</small></button></nav>
  <section class="ammo-block panel"><div class="panel-heading"><span id="weaponName">MACHINE GUN</span><b id="weaponStatus">READY</b></div><div class="ammo-number"><strong id="ammo">120</strong><span>/ <b id="reserve">480</b><small>RESERVE</small></span></div><div class="rounds" id="rounds"></div><div class="reload-meter"><div id="reloadFill"></div></div><div class="ammo-footer"><span id="ammoType">7.62 MM · AUTOMATIC</span><span><kbd>R</kbd> RELOAD</span></div></section>
  <footer class="control-strip"><span>MOUSE <b>AIM</b></span><span>LMB <b>FIRE</b></span><span>RMB <b>ZOOM</b></span><span>1–3 <b>WEAPONS</b></span><span>ESC <b>PAUSE</b></span><button id="pauseButton">Ⅱ PAUSE</button></footer>
</div>
<div class="overlay" id="overlay"><div class="card"><div class="eyebrow"><span class="tag">OPERATION 07</span> COASTAL DEFENSE</div><h1>BEACHHEAD<span>LAST STAND</span></h1><div class="title-rule"></div><p>A quiet horizon.<br>A position you cannot abandon.</p><p class="description">Man the gun. Watch every bearing. Stop infantry, armor and aircraft before they overrun your beachhead.</p><div class="mission-stats"><div><b>360°</b><span>BATTLEFIELD</span></div><div><b>03</b><span>WEAPON SYSTEMS</span></div><div><b>10</b><span>ASSAULT WAVES</span></div></div><button class="button" id="start">DEPLOY TO EMPLACEMENT <span>→</span></button><div class="hint">Mouse to aim and fire · 1–3 weapons · R reload · Esc pause</div></div><div class="title-coordinate">SECTOR 07 / NORTH SHORE<br>DEFENSIVE POSITION · 06:40 HRS</div></div>`;

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
  private camera: THREE.Camera;
  constructor(camera: THREE.Camera) {
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
        ? "7.62 MM · AUTOMATIC"
        : s.weapon === "CANNON"
          ? "40 MM · HIGH EXPLOSIVE"
          : "ROCKET · ANTI-ARMOR",
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
        ? `Next assault in ${Math.ceil(s.intermission)}s · repairs + supplies`
        : s.contacts.some((c) => c.inRange)
          ? "Enemies in firing range. Prioritize nearby threats."
          : "Red pins mark incoming contacts. Scan all bearings.",
    );
    this.damageTime = Math.max(0, this.damageTime - dt);
    this.hitTime = Math.max(0, this.hitTime - dt);
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
  // Base/max on-screen size (px) of the reticle per weapon, so heavy weapons
  // keep a clean, readable shape instead of collapsing to the spread floor.
  private static readonly reticleRange: Record<Weapon, { min: number; max: number }> = {
    MG: { min: 6, max: 90 },
    CANNON: { min: 30, max: 46 },
    ROCKET: { min: 42, max: 56 },
  };
  updateCrosshairSpread(size: number) {
    const reticle = this.el("reticle");
    reticle.style.width = `${size}px`;
    reticle.style.height = `${size}px`;
    // Keep each tick centered on its cross-axis as the box resizes
    const half = `${size / 2 - 0.5}px`;
    const arms = reticle.querySelectorAll<HTMLElement>("i");
    arms.forEach((arm, i) => {
      if (i === 0) {
        arm.style.top = "0";
        arm.style.left = half;
      }
      if (i === 1) {
        arm.style.bottom = "0";
        arm.style.left = half;
      }
      if (i === 2) {
        arm.style.left = "0";
        arm.style.top = half;
      }
      if (i === 3) {
        arm.style.right = "0";
        arm.style.top = half;
      }
    });
    // Center dot centering is handled entirely in CSS (left/top 50% + margin).
  }
}
