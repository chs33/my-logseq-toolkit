export interface GraphPoint { x: number; y: number }
export interface GraphTransform extends GraphPoint { scale: number }
export interface EdgeEndpoints { source: number; target: number }

export function segmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
}

/** Clip to the viewport, including edges whose endpoints are both offscreen. */
function clipSegment(ax: number, ay: number, bx: number, by: number, width: number, height: number): number[] | null {
  const dx = bx - ax;
  const dy = by - ay;
  let start = 0;
  let end = 1;
  for (let axis = 0; axis < 2; axis += 1) {
    const origin = axis === 0 ? ax : ay;
    const delta = axis === 0 ? dx : dy;
    const maximum = axis === 0 ? width : height;
    if (delta === 0) {
      if (origin < -16 || origin > maximum + 16) return null;
      continue;
    }
    const a = (-16 - origin) / delta;
    const b = (maximum + 16 - origin) / delta;
    start = Math.max(start, Math.min(a, b));
    end = Math.min(end, Math.max(a, b));
    if (start > end) return null;
  }
  return [ax + start * dx, ay + start * dy, ax + end * dx, ay + end * dy];
}

const CELL_SIZE = 32;

/** Screen-space geometry is rebuilt only when layout, viewport or zoom changes. */
export class GraphGeometry {
  readonly points: Float64Array;
  readonly visibleNodes: number[] = [];
  readonly visibleEdges: number[] = [];
  private readonly nodeCells = new Map<number, number[]>();
  private readonly edgeCells = new Map<number, number[]>();
  private columns = 1;
  private rows = 1;
  private nodeHitsReady = false;
  private edgeHitsReady = false;
  private width = 0;
  private height = 0;

  constructor(nodeCount: number, private readonly edges: readonly EdgeEndpoints[]) {
    this.points = new Float64Array(nodeCount * 2);
  }

  update(positions: Float32Array, transform: GraphTransform, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.columns = Math.ceil(width / CELL_SIZE) + 2;
    this.rows = Math.ceil(height / CELL_SIZE) + 2;
    this.nodeHitsReady = false;
    this.edgeHitsReady = false;
    this.visibleNodes.length = 0;
    this.visibleEdges.length = 0;
    for (let i = 0; i < this.points.length; i += 2) {
      const x = positions[i] * transform.scale + transform.x;
      const y = positions[i + 1] * transform.scale + transform.y;
      this.points[i] = x;
      this.points[i + 1] = y;
      // Include the widest truncated label, even when its node is just offscreen.
      if (x >= -320 && x <= width + 320 && y >= -48 && y <= height + 20) this.visibleNodes.push(i / 2);
    }
    for (let i = 0; i < this.edges.length; i += 1) {
      const { source, target } = this.edges[i];
      if (clipSegment(this.points[source * 2], this.points[source * 2 + 1], this.points[target * 2], this.points[target * 2 + 1], width, height)) {
        this.visibleEdges.push(i);
      }
    }
  }

  private cell(x: number, y: number): number {
    return Math.max(0, Math.min(this.columns - 1, Math.floor(x / CELL_SIZE) + 1)) +
      Math.max(0, Math.min(this.rows - 1, Math.floor(y / CELL_SIZE) + 1)) * this.columns;
  }

  private add(cells: Map<number, number[]>, key: number, value: number) {
    const bucket = cells.get(key);
    if (bucket) bucket.push(value);
    else cells.set(key, [value]);
  }

  private prepareNodeHits() {
    if (this.nodeHitsReady) return;
    this.nodeHitsReady = true;
    this.nodeCells.clear();
    for (const i of this.visibleNodes) {
      const x = this.points[i * 2];
      const y = this.points[i * 2 + 1];
      if (x >= -16 && x <= this.width + 16 && y >= -16 && y <= this.height + 16) {
        this.add(this.nodeCells, this.cell(x, y), i);
      }
    }
  }

  private prepareEdgeHits() {
    if (this.edgeHitsReady) return;
    this.edgeHitsReady = true;
    this.edgeCells.clear();
    for (const i of this.visibleEdges) {
      const { source, target } = this.edges[i];
      const clipped = clipSegment(this.points[source * 2], this.points[source * 2 + 1], this.points[target * 2], this.points[target * 2 + 1], this.width, this.height)!;
      const [ax, ay, bx, by] = clipped;
      // Sample at half-cell spacing. Neighbor-cell queries cover segment boundaries.
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / (CELL_SIZE / 2)));
      let previous = -1;
      for (let step = 0; step <= steps; step += 1) {
        const key = this.cell(ax + (bx - ax) * step / steps, ay + (by - ay) * step / steps);
        if (key !== previous) this.add(this.edgeCells, key, i);
        previous = key;
      }
    }
  }

  private candidates(cells: Map<number, number[]>, x: number, y: number): Set<number> {
    const key = this.cell(x, y);
    const cx = key % this.columns;
    const cy = Math.floor(key / this.columns);
    const result = new Set<number>();
    for (let row = Math.max(0, cy - 1); row <= Math.min(this.rows - 1, cy + 1); row += 1) {
      for (let column = Math.max(0, cx - 1); column <= Math.min(this.columns - 1, cx + 1); column += 1) {
        for (const candidate of cells.get(column + row * this.columns) ?? []) result.add(candidate);
      }
    }
    return result;
  }

  hitNode(x: number, y: number, threshold: number): number | undefined {
    this.prepareNodeHits();
    let nearest: number | undefined;
    let distance = threshold * threshold;
    for (const i of this.candidates(this.nodeCells, x, y)) {
      const d = (x - this.points[i * 2]) ** 2 + (y - this.points[i * 2 + 1]) ** 2;
      if (d < distance || (d === distance && nearest !== undefined && i < nearest)) {
        nearest = i;
        distance = d;
      }
    }
    return nearest;
  }

  hitEdge(x: number, y: number): number | undefined {
    this.prepareEdgeHits();
    let nearest: number | undefined;
    let distance = 36;
    for (const i of this.candidates(this.edgeCells, x, y)) {
      const { source, target } = this.edges[i];
      const d = segmentDistanceSquared(x, y, this.points[source * 2], this.points[source * 2 + 1], this.points[target * 2], this.points[target * 2 + 1]);
      if (d < distance || (d === distance && nearest !== undefined && i < nearest)) {
        nearest = i;
        distance = d;
      }
    }
    return nearest;
  }
}
