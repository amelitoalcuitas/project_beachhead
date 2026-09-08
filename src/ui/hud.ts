import * as THREE from "../pc-shim/index.ts";
import {
  bearing,
  bearingDelta,
  radarContactPosition,
  RADAR_RANGE_METERS,
  RADAR_RING_INTERVAL_METERS,
  RADAR_RADIUS_PERCENT,
} from "../gameplay/combat.ts";
import type { Weapon } from "../types.ts";
import { weaponRoles } from "../content.ts";

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
  private static readonly reticleRange: Record<Weapon, { min: number; max: number }> = {
    MG: { min: 6, max: 90 },
    CANNON: { min: 30, max: 46 },
    BOFORS: { min: 48, max: 64 },
  };
  updateCrosshairSpread(size: number) {
    const reticle = this.el("reticle");
    reticle.style.width = `${size}px`;
    reticle.style.height = `${size}px`;
  }
}
