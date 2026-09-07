export type Weapon = "MG" | "CANNON" | "BOFORS";
export type EnemyType =
  | "infantry"
  | "armoredInfantry"
  | "grenadierInfantry"
  | "jeep"
  | "truck"
  | "apc"
  | "tank"
  | "heli"
  | "aircraft";

export function isInfantryType(type: EnemyType) {
  return (
    type === "infantry" ||
    type === "armoredInfantry" ||
    type === "grenadierInfantry"
  );
}
export type State =
  | "title"
  | "combat"
  | "intermission"
  | "paused"
  | "gameover"
  | "victory";
