import { wavePlans, weapons } from "../content.ts";
import type { EnemyType } from "../types.ts";
import type { SessionState } from "./game-state.ts";

export function spawnInterval(waveNumber: number) {
  if (waveNumber <= 1) return 5;
  if (waveNumber === 2) return 4.5;
  if (waveNumber === 3) return 4;
  const intervals = [3.6, 3.4, 3.2, 3.0, 2.8, 2.6, 2.4];
  if (waveNumber <= 10) return intervals[waveNumber - 4];
  return 2.2;
}

export interface WaveCallbacks {
  banner(title: string, subtitle?: string): void;
  showEnd(victory: boolean): void;
}

export function beginWave(
  session: SessionState,
  activePlan: EnemyType[],
  callbacks: WaveCallbacks,
) {
  session.state = "combat";
  session.spawnIndex = 0;
  session.spawnTimer = spawnInterval(session.wave);
  activePlan.length = 0;
  activePlan.push(...wavePlans[Math.min(session.wave - 1, 9)]);
  if (session.wave > 10)
    activePlan.push(...wavePlans[8].slice(0, Math.min(8, session.wave - 10)));
  callbacks.banner(
    "WAVE " + String(session.wave).padStart(2, "0"),
    session.wave > 4 ? "COMBINED ARMS / CHECK ALL BEARINGS" : "HOLD THE BEACHHEAD",
  );
}

export function completeWave(session: SessionState, callbacks: WaveCallbacks) {
  if (session.wave === 10 && !session.endless) {
    session.state = "victory";
    callbacks.showEnd(true);
    return;
  }
  session.wave++;
  session.state = "intermission";
  session.intermission = 12;
  session.playerHp = Math.min(1000, session.playerHp + 200);
  for (const definition of Object.values(weapons)) {
    definition.reserve = Math.max(definition.reserve, definition.maxReserve);
    definition.mag = definition.maxMag;
  }
  callbacks.banner("SECTOR SECURED", "+200 INTEGRITY / AMMUNITION RESUPPLIED");
}
