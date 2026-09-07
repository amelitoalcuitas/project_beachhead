import type { State, Weapon } from "../types.ts";

export interface SessionState {
  state: State;
  pausedState: State;
  playerHp: number;
  score: number;
  wave: number;
  spawnIndex: number;
  spawnTimer: number;
  intermission: number;
  infiniteAmmo: boolean;
  godMode: boolean;
  nextStartWave: number;
  endless: boolean;
  heavyAttackReady: number;
  airWarningEnemyId: number | null;
}

export function createSessionState(): SessionState {
  return {
    state: "title",
    pausedState: "combat",
    playerHp: 1000,
    score: 0,
    wave: 1,
    spawnIndex: 0,
    spawnTimer: 0,
    intermission: 0,
    infiniteAmmo: false,
    godMode: false,
    nextStartWave: 1,
    endless: false,
    heavyAttackReady: 0,
    airWarningEnemyId: null,
  };
}

export function isActive(session: SessionState): boolean {
  return session.state === "combat" || session.state === "intermission";
}

export function isCombat(session: SessionState): boolean {
  return session.state === "combat";
}
