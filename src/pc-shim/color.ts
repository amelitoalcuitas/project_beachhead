// Color helpers used by the renderer when materialising a PlayCanvas standard
// material.
import * as pc from "playcanvas";

export function colorFromHex(hex: number | { r: number; g: number; b: number }): pc.Color {
  if (typeof hex !== "number") {
    return new pc.Color(hex.r, hex.g, hex.b, 1);
  }
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return new pc.Color(r, g, b, 1);
}
