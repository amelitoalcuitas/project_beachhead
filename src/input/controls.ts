import * as THREE from "../pc-shim/index.ts";
import type { Game } from "../game/game.ts";
import type { Weapon } from "../types.ts";

export function bindControls(game: Game) {
  document.querySelector("#start")!.addEventListener("click", () => game.reset());
  game.installDevTools();
  document.querySelector("#pauseButton")!.addEventListener("click", () => game.pause());
  document
    .querySelectorAll<HTMLElement>("[data-weapon]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        game.selectWeapon(button.dataset.weapon as Weapon),
      ),
    );
  game.controlsRef.addEventListener("unlock", () => {
    if (game.active()) {
      game.lastAutoPauseTimeRef = performance.now();
      game.pause();
    }
  });
  if (typeof document.addEventListener === "function") {
    document.addEventListener("pointerlockerror", () => {
      game.message("CLICK TO AIM · ARROW KEYS ALSO AVAILABLE");
      game.armPointerLockRetry();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) game.pause();
    });
  }
  if (typeof window.addEventListener === "function") {
    window.addEventListener("blur", () => game.pause());
  }
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (game.state === "paused") {
        if (performance.now() - game.lastAutoPauseTimeRef > 250) game.resume();
      } else {
        game.pause();
      }
      return;
    }
    if (game.state === "paused" && event.key === "Enter") {
      game.resume();
      return;
    }
    if (!game.active()) return;
    if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      game.heldKeysRef.add(event.key);
    }
    if (event.key.toLowerCase() === "r") game.reloadWeapon();
    if (event.code === "Space") {
      event.preventDefault();
      if (game.state === "intermission") {
        game.beginWaveNow();
      } else {
        game.triggerRef = true;
        game.fire();
      }
    }
    if (event.key === "Shift") {
      event.preventDefault();
      game.zoomRef = true;
    }
    const selected = (
      { "1": "MG", "2": "CANNON", "3": "BOFORS" } as Record<string, Weapon>
    )[event.key];
    if (selected) game.selectWeapon(selected);
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") game.triggerRef = false;
    else if (event.key === "Shift") game.zoomRef = false;
    else game.heldKeysRef.delete(event.key);
  });
  game.domElement.addEventListener("mousedown", (event) => {
    if (game.state !== "combat") return;
    if (game.awaitingPointerLockClickRef) return;
    if (event.button === 0) {
      game.triggerRef = true;
      game.fire();
    }
    if (event.button === 2) game.zoomRef = true;
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) game.triggerRef = false;
    if (event.button === 2) game.zoomRef = false;
  });
  game.domElement.addEventListener("mousemove", (event) => {
    if (game.active() && !game.controlsRef.isLocked && event.buttons)
      game.aim(event.movementX * 0.002, event.movementY * 0.002);
  });
  game.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("resize", () => {
    const g = game as unknown as {
      camera: THREE.PerspectiveCamera;
      renderer: THREE.WebGLRenderer;
      weaponView: { resize(aspect: number): void };
    };
    g.camera.aspect = innerWidth / innerHeight;
    g.camera.updateProjectionMatrix();
    g.renderer.setSize(innerWidth, innerHeight);
    g.weaponView.resize(g.camera.aspect);
  });
}
