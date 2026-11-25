/// <reference lib="webworker" />

import type { GraphForceSettings } from "./graphSettings";

interface LayoutNode {
  depth: number;
  isCenter: boolean;
}

interface LayoutEdge {
  source: number;
  target: number;
  weight: number;
}

type WorkerRequest =
  | { type: "init"; nodes: LayoutNode[]; edges: LayoutEdge[]; settings: GraphForceSettings }
  | { type: "settings"; settings: GraphForceSettings }
  | { type: "pin"; index: number; x: number; y: number; pinned: boolean };

let nodes: LayoutNode[] = [];
let edges: LayoutEdge[] = [];
let settings: GraphForceSettings = {
  centerForce: 0.55,
  repelForce: 0.8,
  linkForce: 0.65,
  linkDistance: 95
};
let x = new Float32Array();
let y = new Float32Array();
let vx = new Float32Array();
let vy = new Float32Array();
let ax = new Float32Array();
let ay = new Float32Array();
let pinned = new Uint8Array();
let edgeDistanceOffsets = new Float64Array();
let cellX = new Float64Array();
let cellY = new Float64Array();
let gridX = new Float64Array();
let gridY = new Float64Array();
let gridHead = new Int32Array();
let gridTail = new Int32Array();
let nextInCell = new Int32Array();
let gridMask = 0;
let iteration = 0;
let pendingRun: ReturnType<typeof setTimeout> | null = null;
let lastEmission = -Infinity;

const FRAME_INTERVAL_MS = 1000 / 60;
const BATCH_BUDGET_MS = 8;
const MAX_ITERATIONS = 360;

function initialize() {
  const counts = new Map<number, number>();
  const seen = new Map<number, number>();
  nodes.forEach((node) => counts.set(node.depth, (counts.get(node.depth) ?? 0) + 1));
  x = new Float32Array(nodes.length);
  y = new Float32Array(nodes.length);
  vx = new Float32Array(nodes.length);
  vy = new Float32Array(nodes.length);
  ax = new Float32Array(nodes.length);
  ay = new Float32Array(nodes.length);
  pinned = new Uint8Array(nodes.length);
  edgeDistanceOffsets = Float64Array.from(edges, edge => Math.min(24, Math.log2(edge.weight + 1) * 5));
  cellX = new Float64Array(nodes.length);
  cellY = new Float64Array(nodes.length);
  nextInCell = new Int32Array(nodes.length);
  // Keep the hash table below half full, including when every node has its own cell.
  let capacity = 1;
  while (capacity < nodes.length * 2) capacity *= 2;
  gridMask = capacity - 1;
  gridX = new Float64Array(capacity);
  gridY = new Float64Array(capacity);
  gridHead = new Int32Array(capacity);
  gridTail = new Int32Array(capacity);
  nodes.forEach((node, index) => {
    if (node.isCenter) return;
    const ordinal = seen.get(node.depth) ?? 0;
    seen.set(node.depth, ordinal + 1);
    const count = counts.get(node.depth) ?? 1;
    const angle = (ordinal / count) * Math.PI * 2 - Math.PI / 2 + node.depth * 0.31;
    const radius = 100 + Math.max(0, node.depth - 1) * 115;
    x[index] = Math.cos(angle) * radius;
    y[index] = Math.sin(angle) * radius;
  });
  iteration = 0;
  lastEmission = -Infinity;
}

function gridSlot(cx: number, cy: number): number {
  let slot = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & gridMask;
  while (gridHead[slot] !== -1 && (gridX[slot] !== cx || gridY[slot] !== cy)) {
    slot = (slot + 1) & gridMask;
  }
  return slot;
}

function simulateTick(alpha: number) {
  const centerStrength = settings.centerForce * 0.0013 * alpha;
  for (let index = 0; index < nodes.length; index += 1) {
    ax[index] = -x[index] * centerStrength;
    ay[index] = -y[index] * centerStrength;
  }

  const desired = settings.linkDistance;
  const spring = settings.linkForce * 0.011 * alpha;
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];
    const dx = x[edge.target] - x[edge.source];
    const dy = y[edge.target] - y[edge.source];
    const distance = Math.max(1, Math.hypot(dx, dy));
    const weightedDesired = desired + edgeDistanceOffsets[edgeIndex];
    const force = (distance - weightedDesired) * spring;
    const fx = (dx / distance) * force;
    const fy = (dy / distance) * force;
    ax[edge.source] += fx;
    ay[edge.source] += fy;
    ax[edge.target] -= fx;
    ay[edge.target] -= fy;
  }

  // A uniform grid keeps collision/repulsion close to O(n) for local graphs.
  const cellSize = Math.max(36, desired * 0.62);
  gridHead.fill(-1);
  nextInCell.fill(-1);
  for (let index = 0; index < nodes.length; index += 1) {
    const cx = Math.floor(x[index] / cellSize);
    const cy = Math.floor(y[index] / cellSize);
    cellX[index] = cx;
    cellY[index] = cy;
    const slot = gridSlot(cx, cy);
    if (gridHead[slot] === -1) {
      gridX[slot] = cx;
      gridY[slot] = cy;
      gridHead[slot] = index;
    } else {
      nextInCell[gridTail[slot]] = index;
    }
    // Append in node order so floating-point force accumulation remains stable.
    gridTail[slot] = index;
  }
  const repelRange = cellSize * 1.85;
  const repelRangeSquared = repelRange * repelRange;
  for (let index = 0; index < nodes.length; index += 1) {
    const cx = cellX[index];
    const cy = cellY[index];
    for (let ox = -2; ox <= 2; ox += 1) {
      for (let oy = -2; oy <= 2; oy += 1) {
        const slot = gridSlot(cx + ox, cy + oy);
        for (let other = gridHead[slot]; other !== -1; other = nextInCell[other]) {
          if (other <= index) continue;
          let dx = x[other] - x[index];
          let dy = y[other] - y[index];
          if (dx * dx + dy * dy > repelRangeSquared) continue;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.1) {
            dx = ((index * 17 + other * 31) % 11 - 5) * 0.1;
            dy = ((index * 29 + other * 13) % 11 - 5) * 0.1;
            distance = Math.max(0.1, Math.hypot(dx, dy));
          }
          const force = (1 - distance / repelRange) * settings.repelForce * 0.9 * alpha;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          ax[index] -= fx;
          ay[index] -= fy;
          ax[other] += fx;
          ay[other] += fy;
        }
      }
    }
  }

  for (let index = 0; index < nodes.length; index += 1) {
    if (pinned[index]) {
      vx[index] = 0;
      vy[index] = 0;
      continue;
    }
    vx[index] = (vx[index] + ax[index]) * 0.84;
    vy[index] = (vy[index] + ay[index]) * 0.84;
    x[index] += vx[index];
    y[index] += vy[index];
  }
}

function emitPositions() {
  const positions = new Float32Array(nodes.length * 2);
  for (let index = 0; index < nodes.length; index += 1) {
    positions[index * 2] = x[index];
    positions[index * 2 + 1] = y[index];
  }
  self.postMessage({ type: "positions", positions }, { transfer: [positions.buffer] });
}

function scheduleRun() {
  // Settings and drag events update the current simulation; a burst needs only one batch.
  if (pendingRun === null) pendingRun = setTimeout(run, 0);
}

function run() {
  pendingRun = null;
  const started = performance.now();
  const batchSize = nodes.length > 900 ? 2 : nodes.length > 350 ? 3 : 5;
  for (let batch = 0; batch < batchSize && iteration < MAX_ITERATIONS; batch += 1) {
    const alpha = Math.max(0.035, Math.pow(0.986, iteration));
    simulateTick(alpha);
    iteration += 1;
    // Yield between ticks so new drag coordinates/settings are handled promptly.
    if (performance.now() - started >= BATCH_BUDGET_MS) break;
  }
  const now = performance.now();
  if (now - lastEmission >= FRAME_INTERVAL_MS || iteration >= MAX_ITERATIONS) {
    emitPositions();
    lastEmission = now;
  }
  if (iteration < MAX_ITERATIONS) scheduleRun();
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    if (pendingRun !== null) clearTimeout(pendingRun);
    pendingRun = null;
    nodes = message.nodes;
    edges = message.edges;
    settings = message.settings;
    initialize();
    if (nodes.length === 0) emitPositions();
    else scheduleRun();
    return;
  }
  if (message.type === "settings") {
    const next = message.settings;
    if (settings.centerForce === next.centerForce && settings.repelForce === next.repelForce
      && settings.linkForce === next.linkForce && settings.linkDistance === next.linkDistance) return;
    settings = next;
    iteration = Math.min(iteration, 95);
    if (nodes.length > 0) scheduleRun();
    return;
  }
  if (message.type === "pin" && message.index >= 0 && message.index < nodes.length) {
    x[message.index] = message.x;
    y[message.index] = message.y;
    pinned[message.index] = message.pinned ? 1 : 0;
    iteration = Math.min(iteration, 130);
    scheduleRun();
  }
};

export {};
