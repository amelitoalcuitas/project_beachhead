import { devToolsMarkup } from "./dev-tools.ts";
import { weaponRoles } from "../content.ts";
import { RADAR_RANGE_METERS, RADAR_RING_INTERVAL_METERS } from "../gameplay/combat.ts";

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

export class ScreenMessages {
  private bannerTimer = 0;
  private messageTimer = 0;

  banner(title: string, subtitle = "") {
    const element = document.querySelector<HTMLElement>("#banner")!;
    element.innerHTML = title + '<div class="small">' + subtitle + "</div>";
    element.classList.add("show");
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => element.classList.remove("show"), 2600);
  }

  message(text: string) {
    const element = document.querySelector<HTMLElement>("#message")!;
    element.textContent = text;
    element.classList.add("show");
    window.clearTimeout(this.messageTimer);
    this.messageTimer = window.setTimeout(() => element.classList.remove("show"), 1600);
  }

  clearTimers() {
    window.clearTimeout(this.bannerTimer);
    window.clearTimeout(this.messageTimer);
    document.querySelector("#message")?.classList.remove("show");
  }

  showEnd(
    overlay: HTMLElement,
    victory: boolean,
    score: number,
    wave: number,
    onRestart: () => void,
    onEndless?: () => void,
  ) {
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
    document.querySelector("#restart")!.addEventListener("click", onRestart);
    document.querySelector("#endless")?.addEventListener("click", onEndless!);
  }

  showPause(
    overlay: HTMLElement,
    onResume: () => void,
    onRestart: () => void,
    installDevTools: () => void,
  ) {
    overlay.innerHTML =
      '<div class="card"><div class="eyebrow">EMPLACEMENT / STANDBY</div><h1>HOLD<span>POSITION</span></h1><div class="title-rule"></div><p>Combat is paused.</p><button class="button" id="resume">RESUME DEFENSE →</button><button class="button secondary" id="restart">RESTART MISSION</button>' +
      devToolsMarkup() +
      '<div class="hint">Mouse: aim · Left click: fire · Right click: zoom<br>1–3: weapons · R: reload<br>Arrow keys also aim. If the pointer is not captured, drag to aim.</div></div>';
    overlay.style.display = "flex";
    installDevTools();
    document.querySelector("#resume")!.addEventListener("click", onResume);
    document.querySelector("#restart")!.addEventListener("click", onRestart);
  }
}
