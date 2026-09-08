import * as THREE from "../pc-shim/index.ts";

export function createBarrelJacket() {
  const radius = 0.085;
  const thickness = 0.006;
  const length = 1.45;
  const columns = 8;
  const rows = 12;
  const holeRadius = 0.021;
  const cellWidth = Math.PI * 2 * radius / columns;
  const cellHeight = length / rows;
  const positions: number[] = [];
  const indices: number[] = [];
  // Explicit curved panels preserve the real openings: the compatibility
  // extruder only keeps outline corners, which collapse when rolled into a tube.
  const perimeter = [
    [-1, -1], [-0.5, -1], [0, -1], [0.5, -1],
    [1, -1], [1, -0.5], [1, 0], [1, 0.5],
    [1, 1], [0.5, 1], [0, 1], [-0.5, 1],
    [-1, 1], [-1, 0.5], [-1, 0], [-1, -0.5],
  ];
  const vertex = (x: number, y: number, depth: number) => {
    const angle = x / radius;
    positions.push(Math.cos(angle) * depth, Math.sin(angle) * depth, -y);
  };
  const quad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, c, a, c, d);
  };
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const base = positions.length / 3;
      const centerX = (column + 0.5) * cellWidth;
      const centerY = (row + 0.5) * cellHeight;
      for (const [px, py] of perimeter) {
        const x = px * cellWidth / 2;
        const y = py * cellHeight / 2;
        const holeScale = holeRadius / Math.hypot(x, y);
        vertex(centerX + x, centerY + y, radius + thickness);
        vertex(centerX + x * holeScale, centerY + y * holeScale, radius + thickness);
        vertex(centerX + x, centerY + y, radius);
        vertex(centerX + x * holeScale, centerY + y * holeScale, radius);
      }
      for (let segment = 0; segment < perimeter.length; segment++) {
        const a = base + segment * 4;
        const b = base + ((segment + 1) % perimeter.length) * 4;
        quad(a, a + 1, b + 1, b);
        quad(a + 2, b + 2, b + 3, a + 3);
        quad(a + 1, a + 3, b + 3, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  return geometry;
}
