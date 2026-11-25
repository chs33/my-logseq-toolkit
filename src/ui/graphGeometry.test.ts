import { describe, expect, it } from "vitest";
import { GraphGeometry, segmentDistanceSquared } from "./graphGeometry";

describe("visible graph geometry and picking", () => {
  it("keeps crossing edges and nearby labels but culls geometry outside the viewport", () => {
    const geometry = new GraphGeometry(6, [{ source: 0, target: 1 }, { source: 2, target: 3 }]);
    geometry.update(new Float32Array([-1000, 100, 1000, 100, -500, -500, -500, 500, -25, 40, 1000, 1000]),
      { x: 0, y: 0, scale: 1 }, 400, 300);
    expect(geometry.visibleEdges).toEqual([0]);
    expect(geometry.visibleNodes).toEqual([4]);
    expect(geometry.hitEdge(200, 104)).toBe(0);
    expect(geometry.hitEdge(200, 107)).toBeUndefined();
    expect(geometry.hitNode(200, 100, 8)).toBeUndefined();
  });

  it("picks zero-length edges, negative coordinates, cell boundaries and equal-distance ties", () => {
    const geometry = new GraphGeometry(4, [{ source: 0, target: 1 }, { source: 2, target: 3 }]);
    geometry.update(new Float32Array([32, 32, 32, 32, -4, 100, -4, 200]), { x: 0, y: 0, scale: 1 }, 400, 300);
    expect(geometry.hitNode(31, 31, 8)).toBe(0);
    expect(geometry.hitEdge(35, 35)).toBe(0);
    expect(geometry.hitNode(0, 100, 8)).toBe(2);
    expect(geometry.hitEdge(0, 150)).toBe(1);
    expect(geometry.hitEdge(2, 150)).toBeUndefined();
  });

  it("invalidates hit geometry after dragging, panning, zooming and resizing", () => {
    const geometry = new GraphGeometry(2, [{ source: 0, target: 1 }]);
    const positions = new Float32Array([20, 20, 100, 100]);
    geometry.update(positions, { x: 0, y: 0, scale: 1 }, 400, 300);
    expect(geometry.hitNode(20, 20, 8)).toBe(0);
    positions[0] = 40;
    geometry.update(positions, { x: 10, y: 10, scale: 2 }, 800, 600);
    expect(geometry.hitNode(20, 20, 8)).toBeUndefined();
    expect(geometry.hitNode(90, 50, 8)).toBe(0);
    expect(geometry.hitEdge(150, 130)).toBe(0);
  });

  it("matches exhaustive nearest-node and nearest-edge picking on deterministic random graphs", () => {
    let state = 147;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const positions = Float32Array.from({ length: 600 }, () => random() * 2000 - 1000);
    const edges = Array.from({ length: 500 }, () => ({ source: Math.floor(random() * 300), target: Math.floor(random() * 300) }));
    const geometry = new GraphGeometry(300, edges);
    for (const scale of [0.08, 0.4, 1, 4]) {
      geometry.update(positions, { x: 240, y: 180, scale }, 480, 360);
      for (let sample = 0; sample < 150; sample += 1) {
        const x = random() * 480;
        const y = random() * 360;
        const threshold = 8 + random() * 5;
        let node: number | undefined;
        let edge: number | undefined;
        let nodeDistance = threshold ** 2;
        let edgeDistance = 36;
        for (let i = 0; i < 300; i += 1) {
          const d = (x - geometry.points[i * 2]) ** 2 + (y - geometry.points[i * 2 + 1]) ** 2;
          if (d < nodeDistance) { node = i; nodeDistance = d; }
        }
        edges.forEach(({ source, target }, i) => {
          const p = geometry.points;
          const d = segmentDistanceSquared(x, y, p[source * 2], p[source * 2 + 1], p[target * 2], p[target * 2 + 1]);
          if (d < edgeDistance) { edge = i; edgeDistance = d; }
        });
        expect(geometry.hitNode(x, y, threshold)).toBe(node);
        expect(geometry.hitEdge(x, y)).toBe(edge);
      }
    }
  });
});
