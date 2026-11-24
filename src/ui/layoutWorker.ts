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
let pinned = new Uint8Array();
let iteration = 0;
let generation = 0;

function initialize() {
  const counts = new Map<number, number>();
  const seen = new Map<number, number>();
  nodes.forEach((node) => counts.set(node.depth, (counts.get(node.depth) ?? 0) + 1));
  x = new Float32Array(nodes.length);
  y = new Float32Array(nodes.length);
  vx = new Float32Array(nodes.length);
  vy = new Float32Array(nodes.length);
  pinned = new Uint8Array(nodes.length);
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
}

function simulateTick(alpha: number) {
  const ax = new Float32Array(nodes.length);
  const ay = new Float32Array(nodes.length);
  const centerStrength = settings.centerForce * 0.0013 * alpha;
  for (let index = 0; index < nodes.length; index += 1) {
    ax[index] -= x[index] * centerStrength;
    ay[index] -= y[index] * centerStrength;
  }

  const desired = settings.linkDistance;
  const spring = settings.linkForce * 0.011 * alpha;
  for (const edge of edges) {
    const dx = x[edge.target] - x[edge.source];
    const dy = y[edge.target] - y[edge.source];
    const distance = Math.max(1, Math.hypot(dx, dy));
    const weightedDesired = desired + Math.min(24, Math.log2(edge.weight + 1) * 5);
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
  const grid = new Map<string, number[]>();
  for (let index = 0; index < nodes.length; index += 1) {
    const cx = Math.floor(x[index] / cellSize);
    const cy = Math.floor(y[index] / cellSize);
    const key = `${cx}:${cy}`;
    const cell = grid.get(key) ?? [];
    cell.push(index);
    grid.set(key, cell);
  }
  const repelRange = cellSize * 1.85;
  for (let index = 0; index < nodes.length; index += 1) {
    const cx = Math.floor(x[index] / cellSize);
    const cy = Math.floor(y[index] / cellSize);
    for (let ox = -2; ox <= 2; ox += 1) {
      for (let oy = -2; oy <= 2; oy += 1) {
        const cell = grid.get(`${cx + ox}:${cy + oy}`);
        if (!cell) continue;
        for (const other of cell) {
          if (other <= index) continue;
          let dx = x[other] - x[index];
          let dy = y[other] - y[index];
          let distance = Math.hypot(dx, dy);
          if (distance > repelRange) continue;
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

function run(localGeneration: number) {
  if (localGeneration !== generation) return;
  const batchSize = nodes.length > 900 ? 2 : nodes.length > 350 ? 3 : 5;
  for (let batch = 0; batch < batchSize; batch += 1) {
    const alpha = Math.max(0.035, Math.pow(0.986, iteration));
    simulateTick(alpha);
    iteration += 1;
  }
  emitPositions();
  if (iteration < 360) setTimeout(() => run(localGeneration), 0);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === "init") {
    generation += 1;
    nodes = message.nodes;
    edges = message.edges;
    settings = message.settings;
    initialize();
    run(generation);
    return;
  }
  if (message.type === "settings") {
    settings = message.settings;
    iteration = Math.min(iteration, 95);
    generation += 1;
    run(generation);
    return;
  }
  if (message.type === "pin" && message.index >= 0 && message.index < nodes.length) {
    x[message.index] = message.x;
    y[message.index] = message.y;
    pinned[message.index] = message.pinned ? 1 : 0;
    iteration = Math.min(iteration, 130);
    generation += 1;
    run(generation);
  }
};

export {};
