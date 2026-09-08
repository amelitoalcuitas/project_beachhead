import type { Position } from "../gameplay/combat.ts";

export type ImpactMaterial = "sand" | "masonry" | "wood" | "metal" | "organic" | "air";
export interface CannonImpactContext {
  material: ImpactMaterial;
  normal: Position;
  incoming: Position;
}
interface ImpactProfile {
  dustColor: number;
  debrisColor: number;
  plumeHeight: number;
  plumeWidth: number;
  fireScale: number;
  fireDuration: number;
  lifetime: number;
  lightIntensity: number;
}
const IMPACT_PROFILES: Record<ImpactMaterial, ImpactProfile> = {
  sand: { dustColor: 0xb58c56, debrisColor: 0x997044, plumeHeight: 1.8, plumeWidth: 1.2, fireScale: 0.42, fireDuration: 0.22, lifetime: 1.6, lightIntensity: 6 },
  masonry: { dustColor: 0x77716a, debrisColor: 0xaaa18f, plumeHeight: 0.65, plumeWidth: 1.5, fireScale: 0.85, fireDuration: 0.42, lifetime: 1.45, lightIntensity: 9 },
  wood: { dustColor: 0x665345, debrisColor: 0x88603b, plumeHeight: 0.8, plumeWidth: 1.3, fireScale: 0.8, fireDuration: 0.48, lifetime: 1.5, lightIntensity: 8 },
  metal: { dustColor: 0x42464a, debrisColor: 0x777e83, plumeHeight: 0.65, plumeWidth: 1.15, fireScale: 0.75, fireDuration: 0.36, lifetime: 1.25, lightIntensity: 10 },
  organic: { dustColor: 0x8e816b, debrisColor: 0x74664e, plumeHeight: 0.75, plumeWidth: 1, fireScale: 0.55, fireDuration: 0.25, lifetime: 1.2, lightIntensity: 6 },
  air: { dustColor: 0x55565a, debrisColor: 0x777e83, plumeHeight: 0.55, plumeWidth: 1.45, fireScale: 0.9, fireDuration: 0.36, lifetime: 1.2, lightIntensity: 8 },
};
export function cannonImpactProfile(material: ImpactMaterial): Readonly<ImpactProfile> {
  return IMPACT_PROFILES[material];
}
