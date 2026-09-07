import { enemyNames } from "../content.ts";

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
