import type { GraphNode, VisualEdge } from "../core/types";
import { GraphGeometry, type GraphTransform } from "./graphGeometry";
import type { GraphDisplaySettings } from "./graphSettings";
import { isSameFocus, type InteractionFocus } from "./interaction";

export interface IndexedEdge { edge: VisualEdge; source: number; target: number }

const NODE_COLORS = ["#aeb6c4", "#8fa5ff", "#b298ff", "#69a9d8"];
// Normal, highlighted and dimmed actual edges, then the same for suggestions.
const EDGE_COLORS = [
  "rgba(137,147,164,.34)", "rgba(126,156,255,.95)", "rgba(137,147,164,.06)",
  "rgba(178,152,255,.58)", "rgba(178,152,255,.95)", "rgba(178,152,255,.06)"
];
const LABEL_PIXEL_BUDGET = 4_000_000;

interface LabelSprite { canvas: HTMLCanvasElement; width: number; height: number }

/** Model indexes and label bitmaps survive frames; screen geometry survives hover. */
export class CanvasRenderer {
  readonly geometry: GraphGeometry;
  private readonly incidentEdges = new Map<string, number[]>();
  private readonly edgeById = new Map<string, number>();
  private readonly edgeByOccurrence = new Map<string, number>();
  private readonly nodeById = new Map<string, number>();
  private readonly activeNodes: Uint8Array;
  private readonly activeEdges: Uint8Array;
  private focus: InteractionFocus | null = null;
  private readonly edgeGroups = Array.from({ length: 6 }, () => [] as number[]);
  private readonly nodeGroups = Array.from({ length: 12 }, () => [] as number[]);
  private readonly labels = new Map<number, LabelSprite>();
  private labelPixels = 0;
  private labelRatio = 0;
  private readonly text: string[];

  constructor(readonly nodes: readonly GraphNode[], readonly edges: readonly IndexedEdge[]) {
    this.geometry = new GraphGeometry(nodes.length, edges);
    this.activeNodes = new Uint8Array(nodes.length);
    this.activeEdges = new Uint8Array(edges.length);
    this.text = nodes.map(node => node.label.length > 44 ? `${node.label.slice(0, 42)}…` : node.label);
    nodes.forEach((node, i) => this.nodeById.set(node.id, i));
    edges.forEach(({ edge }, i) => {
      this.edgeById.set(edge.id, i);
      for (const item of edge.actualOccurrences) this.edgeByOccurrence.set(item.occurrence.id, i);
      for (const id of [edge.nodeA, edge.nodeB]) {
        const incident = this.incidentEdges.get(id);
        if (incident) incident.push(i);
        else this.incidentEdges.set(id, [i]);
      }
    });
  }

  private updateFocus(focus: InteractionFocus) {
    if (this.focus && isSameFocus(this.focus, focus)) return;
    this.focus = focus;
    this.activeNodes.fill(0);
    this.activeEdges.fill(0);
    const activate = (i: number | undefined) => {
      if (i === undefined) return;
      this.activeEdges[i] = 1;
      this.activeNodes[this.edges[i].source] = 1;
      this.activeNodes[this.edges[i].target] = 1;
    };
    if (focus.edgeId) activate(this.edgeById.get(focus.edgeId));
    if (focus.occurrenceId) activate(this.edgeByOccurrence.get(focus.occurrenceId));
    if (focus.nodeId) {
      const node = this.nodeById.get(focus.nodeId);
      if (node !== undefined) this.activeNodes[node] = 1;
      for (const i of this.incidentEdges.get(focus.nodeId) ?? []) activate(i);
    }
  }

  private configureLabel(context: CanvasRenderingContext2D, center: boolean) {
    context.font = `${center ? 600 : 450} ${center ? 12 : 10.5}px Inter, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.strokeStyle = "rgba(20,22,27,.88)";
    context.fillStyle = center ? "#eef1f7" : "#c7ccd5";
  }

  private drawLabel(context: CanvasRenderingContext2D, index: number, x: number, y: number, ratio: number) {
    let sprite = this.labels.get(index);
    if (!sprite && this.labelPixels < LABEL_PIXEL_BUDGET) {
      const canvas = context.canvas.ownerDocument.createElement("canvas");
      const label = canvas.getContext("2d");
      if (label) {
        this.configureLabel(label, this.nodes[index].isCenter);
        const width = Math.ceil(label.measureText(this.text[index]).width) + 8;
        const height = 24;
        canvas.width = Math.ceil(width * ratio);
        canvas.height = Math.ceil(height * ratio);
        label.scale(ratio, ratio);
        this.configureLabel(label, this.nodes[index].isCenter);
        label.strokeText(this.text[index], width / 2, 3);
        label.fillText(this.text[index], width / 2, 3);
        sprite = { canvas, width, height };
        this.labels.set(index, sprite);
        this.labelPixels += canvas.width * canvas.height;
      }
    }
    if (sprite) {
      context.drawImage(sprite.canvas, Math.round((x - sprite.width / 2) * ratio) / ratio,
        Math.round((y - 3) * ratio) / ratio, sprite.width, sprite.height);
    } else {
      this.configureLabel(context, this.nodes[index].isCenter);
      context.strokeText(this.text[index], x, y);
      context.fillText(this.text[index], x, y);
    }
  }

  draw(context: CanvasRenderingContext2D, width: number, height: number, ratio: number,
    transform: GraphTransform, display: GraphDisplaySettings, focus: InteractionFocus) {
    this.updateFocus(focus);
    if (ratio !== this.labelRatio) {
      this.labels.clear();
      this.labelPixels = 0;
      this.labelRatio = ratio;
    }
    const hasFocus = Boolean(focus.nodeId || focus.edgeId || focus.occurrenceId);
    const { points, visibleEdges, visibleNodes } = this.geometry;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";

    for (const group of this.edgeGroups) group.length = 0;
    for (const i of visibleEdges) {
      const active = this.activeEdges[i];
      const group = (this.edges[i].edge.suggested ? 3 : 0) + (active ? 1 : hasFocus ? 2 : 0);
      this.edgeGroups[group].push(i);
    }
    for (let group = 0; group < this.edgeGroups.length; group += 1) {
      const indices = this.edgeGroups[group];
      if (indices.length === 0) continue;
      context.strokeStyle = EDGE_COLORS[group];
      context.fillStyle = EDGE_COLORS[group];
      context.lineWidth = display.linkThickness * (group % 3 === 1 ? 1.9 : 1);
      context.setLineDash(group >= 3 ? [5, 5] : []);
      context.beginPath();
      for (const i of indices) {
        const { source, target } = this.edges[i];
        context.moveTo(points[source * 2], points[source * 2 + 1]);
        context.lineTo(points[target * 2], points[target * 2 + 1]);
      }
      context.stroke();
      if (!display.arrows || group % 3 === 2) continue;
      // Huge filled paths are expensive for the browser to tessellate.
      for (let start = 0; start < indices.length; start += 64) {
        context.beginPath();
        for (let offset = start; offset < Math.min(indices.length, start + 64); offset += 1) {
          const i = indices[offset];
          const { source, target, edge } = this.edges[i];
          const ax = points[source * 2];
          const ay = points[source * 2 + 1];
          const bx = points[target * 2];
          const by = points[target * 2 + 1];
          const length = Math.max(transform.scale, Math.hypot(bx - ax, by - ay));
          const ux = (bx - ax) / length;
          const uy = (by - ay) / length;
          if (edge.suggested || edge.countsByDirection.aToB > 0) {
            const radius = (this.nodes[target].isCenter ? 7 : display.nodeSize) + 3;
            appendArrow(context, ax, ay, bx - ux * radius, by - uy * radius);
          }
          if (!edge.suggested && edge.countsByDirection.bToA > 0) {
            const radius = (this.nodes[source].isCenter ? 7 : display.nodeSize) + 3;
            appendArrow(context, bx, by, ax + ux * radius, ay + uy * radius);
          }
        }
        context.fill();
      }
    }
    context.setLineDash([]);

    for (const group of this.nodeGroups) group.length = 0;
    for (const i of visibleNodes) {
      const node = this.nodes[i];
      const color = node.isCenter ? 1 : node.suggestedOnly ? 2 : node.kind === "url" ? 3 : 0;
      const group = color + (this.activeNodes[i] ? 4 : hasFocus ? 8 : 0);
      this.nodeGroups[group].push(i);
    }
    for (let group = 0; group < this.nodeGroups.length; group += 1) {
      const indices = this.nodeGroups[group];
      if (indices.length === 0) continue;
      const active = group >= 4 && group < 8;
      context.globalAlpha = group >= 8 ? 0.12 : 1;
      context.fillStyle = NODE_COLORS[group % 4];
      context.beginPath();
      for (const i of indices) {
        const node = this.nodes[i];
        const radius = nodeRadius(node, display.nodeSize) + (active ? 2 : 0);
        context.moveTo(points[i * 2] + radius, points[i * 2 + 1]);
        context.arc(points[i * 2], points[i * 2 + 1], radius, 0, Math.PI * 2);
      }
      context.fill();
      if (active) {
        context.strokeStyle = "rgba(185,201,255,.8)";
        context.lineWidth = 1.5;
        context.beginPath();
        for (const i of indices) {
          const radius = nodeRadius(this.nodes[i], display.nodeSize) + 5;
          context.moveTo(points[i * 2] + radius, points[i * 2 + 1]);
          context.arc(points[i * 2], points[i * 2 + 1], radius, 0, Math.PI * 2);
        }
        context.stroke();
      }
    }

    const labelScale = 0.32 + display.textFadeThreshold * 0.95;
    for (const i of visibleNodes) {
      const node = this.nodes[i];
      const active = Boolean(this.activeNodes[i]);
      if (!node.isCenter && !active && transform.scale < labelScale) continue;
      context.globalAlpha = hasFocus && !active ? 0.12 : 1;
      const radius = nodeRadius(node, display.nodeSize) + (active ? 2 : 0);
      this.drawLabel(context, i, points[i * 2], points[i * 2 + 1] + radius + 5, ratio);
    }
    context.globalAlpha = 1;
  }
}

function nodeRadius(node: GraphNode, size: number): number {
  return node.isCenter ? 7 : node.kind === "url" ? size * 0.9 : size;
}

function appendArrow(context: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number) {
  const angle = Math.atan2(by - ay, bx - ax);
  context.moveTo(bx, by);
  context.lineTo(bx - Math.cos(angle - 0.48) * 5.5, by - Math.sin(angle - 0.48) * 5.5);
  context.lineTo(bx - Math.cos(angle + 0.48) * 5.5, by - Math.sin(angle + 0.48) * 5.5);
  context.closePath();
}
