import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type { GraphModel, GraphNode, VisualEdge } from "../core/types";
import type { GraphDisplaySettings, GraphForceSettings } from "./graphSettings";
import type { InteractionFocus } from "./interaction";

interface Point { x: number; y: number }
interface Transform extends Point { scale: number }

interface GraphCanvasProps {
  model: GraphModel;
  focus: InteractionFocus;
  fitToken: number;
  display: GraphDisplaySettings;
  forces: GraphForceSettings;
  onFocus: (focus: InteractionFocus) => void;
  onNodeClick: (node: GraphNode) => void;
}

interface Gesture {
  mode: "pan" | "node";
  pointerId: number;
  start: Point;
  origin: Point;
  nodeIndex?: number;
  moved: boolean;
}

function seedPositions(nodes: GraphNode[]): Float32Array {
  const positions = new Float32Array(nodes.length * 2);
  const groups = new Map<number, number[]>();
  nodes.forEach((node, index) => {
    const group = groups.get(node.depth) ?? [];
    group.push(index);
    groups.set(node.depth, group);
  });
  for (const [depth, indices] of groups) {
    if (depth === 0) continue;
    indices.forEach((nodeIndex, ordinal) => {
      const angle = (ordinal / indices.length) * Math.PI * 2 - Math.PI / 2 + depth * 0.31;
      const radius = 100 + (depth - 1) * 115;
      positions[nodeIndex * 2] = Math.cos(angle) * radius;
      positions[nodeIndex * 2 + 1] = Math.sin(angle) * radius;
    });
  }
  return positions;
}

function lineDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function drawArrow(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle - 0.48) * size, to.y - Math.sin(angle - 0.48) * size);
  context.lineTo(to.x - Math.cos(angle + 0.48) * size, to.y - Math.sin(angle + 0.48) * size);
  context.closePath();
  context.fill();
}

export function GraphCanvas({
  model,
  focus,
  fitToken,
  display,
  forces,
  onFocus,
  onNodeClick
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const positionsRef = useRef<Float32Array>(new Float32Array());
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef<number | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const focusRef = useRef(focus);
  const displayRef = useRef(display);
  const forcesRef = useRef(forces);
  const didAutoFit = useRef(false);

  const nodes = useMemo(() => [...model.nodes.values()], [model]);
  const edges = useMemo(() => [...model.edges.values()], [model]);
  const nodeIndex = useMemo(() => new Map(nodes.map((node, index) => [node.id, index])), [nodes]);
  const indexedEdges = useMemo(() => edges.map((edge) => ({
    edge,
    source: nodeIndex.get(edge.nodeA)!,
    target: nodeIndex.get(edge.nodeB)!
  })).filter((edge) => edge.source !== undefined && edge.target !== undefined), [edges, nodeIndex]);

  focusRef.current = focus;
  displayRef.current = display;
  forcesRef.current = forces;

  const requestDraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      drawRef.current();
    });
  }, []);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const positions = positionsRef.current;
    if (!canvas || positions.length === 0) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < positions.length; index += 2) {
      minX = Math.min(minX, positions[index]);
      maxX = Math.max(maxX, positions[index]);
      minY = Math.min(minY, positions[index + 1]);
      maxY = Math.max(maxY, positions[index + 1]);
    }
    const graphWidth = Math.max(100, maxX - minX + 110);
    const graphHeight = Math.max(100, maxY - minY + 90);
    const scale = Math.min(1.8, Math.max(0.12, Math.min(width / graphWidth, height / graphHeight)));
    transformRef.current = {
      scale,
      x: width / 2 - ((minX + maxX) / 2) * scale,
      y: height / 2 - ((minY + maxY) / 2) * scale
    };
    requestDraw();
  }, [requestDraw]);

  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const transform = transformRef.current;
    const positions = positionsRef.current;
    const activeFocus = focusRef.current;
    const activeDisplay = displayRef.current;
    const hasFocus = Boolean(activeFocus.nodeId || activeFocus.edgeId || activeFocus.occurrenceId);
    const occurrenceEdge = activeFocus.occurrenceId
      ? edges.find((edge) => edge.actualOccurrences.some((item) => item.occurrence.id === activeFocus.occurrenceId))?.id
      : undefined;
    const activeEdgeIds = new Set<string>();
    const activeNodeIds = new Set<string>();
    if (activeFocus.nodeId) activeNodeIds.add(activeFocus.nodeId);
    for (const edge of edges) {
      if (
        activeFocus.edgeId === edge.id || occurrenceEdge === edge.id ||
        Boolean(activeFocus.nodeId && (edge.nodeA === activeFocus.nodeId || edge.nodeB === activeFocus.nodeId))
      ) {
        activeEdgeIds.add(edge.id);
        activeNodeIds.add(edge.nodeA);
        activeNodeIds.add(edge.nodeB);
      }
    }

    context.save();
    context.translate(transform.x, transform.y);
    context.scale(transform.scale, transform.scale);
    context.lineCap = "round";

    for (const { edge, source, target } of indexedEdges) {
      const a = { x: positions[source * 2], y: positions[source * 2 + 1] };
      const b = { x: positions[target * 2], y: positions[target * 2 + 1] };
      const active = activeEdgeIds.has(edge.id);
      const dimmed = hasFocus && !active;
      const color = edge.suggested ? "178, 152, 255" : active ? "126, 156, 255" : "137, 147, 164";
      context.strokeStyle = `rgba(${color}, ${dimmed ? 0.06 : active ? 0.95 : edge.suggested ? 0.58 : 0.34})`;
      context.fillStyle = context.strokeStyle;
      context.lineWidth = (active ? activeDisplay.linkThickness * 1.9 : activeDisplay.linkThickness) / transform.scale;
      context.setLineDash(edge.suggested ? [5 / transform.scale, 5 / transform.scale] : []);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();

      if (activeDisplay.arrows && !dimmed) {
        const radiusA = (nodes[source].isCenter ? 7 : activeDisplay.nodeSize) / transform.scale;
        const radiusB = (nodes[target].isCenter ? 7 : activeDisplay.nodeSize) / transform.scale;
        const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const ux = (b.x - a.x) / length;
        const uy = (b.y - a.y) / length;
        const size = 5.5 / transform.scale;
        if (edge.suggested || edge.countsByDirection.aToB > 0) {
          drawArrow(context, a, { x: b.x - ux * (radiusB + 3 / transform.scale), y: b.y - uy * (radiusB + 3 / transform.scale) }, size);
        }
        if (!edge.suggested && edge.countsByDirection.bToA > 0) {
          drawArrow(context, b, { x: a.x + ux * (radiusA + 3 / transform.scale), y: a.y + uy * (radiusA + 3 / transform.scale) }, size);
        }
      }
    }
    context.setLineDash([]);

    const labelScale = 0.32 + activeDisplay.textFadeThreshold * 0.95;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const point = { x: positions[index * 2], y: positions[index * 2 + 1] };
      const active = activeNodeIds.has(node.id);
      const dimmed = hasFocus && !active;
      const baseRadius = node.isCenter ? 7 : node.kind === "url" ? activeDisplay.nodeSize * 0.9 : activeDisplay.nodeSize;
      const radius = (baseRadius + (active ? 2 : 0)) / transform.scale;
      let color = "#aeb6c4";
      if (node.isCenter) color = "#8fa5ff";
      else if (node.suggestedOnly) color = "#b298ff";
      else if (node.kind === "url") color = "#69a9d8";
      context.globalAlpha = dimmed ? 0.12 : 1;
      context.fillStyle = color;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      if (active) {
        context.strokeStyle = "rgba(185, 201, 255, .8)";
        context.lineWidth = 1.5 / transform.scale;
        context.beginPath();
        context.arc(point.x, point.y, radius + 3 / transform.scale, 0, Math.PI * 2);
        context.stroke();
      }

      const showLabel = node.isCenter || active || transform.scale >= labelScale;
      if (showLabel) {
        const fontSize = (node.isCenter ? 12 : 10.5) / transform.scale;
        context.font = `${node.isCenter ? 600 : 450} ${fontSize}px Inter, system-ui, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "top";
        context.lineWidth = 3 / transform.scale;
        context.strokeStyle = "rgba(20, 22, 27, .88)";
        context.fillStyle = node.isCenter ? "#eef1f7" : "#c7ccd5";
        const label = node.label.length > 44 ? `${node.label.slice(0, 42)}…` : node.label;
        context.strokeText(label, point.x, point.y + radius + 5 / transform.scale);
        context.fillText(label, point.x, point.y + radius + 5 / transform.scale);
      }
      context.globalAlpha = 1;
    }
    context.restore();
  };

  useEffect(() => {
    positionsRef.current = seedPositions(nodes);
    transformRef.current = { x: 0, y: 0, scale: 1 };
    didAutoFit.current = false;
    const worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: "positions"; positions: Float32Array }>) => {
      if (event.data.type !== "positions") return;
      positionsRef.current = event.data.positions;
      if (!didAutoFit.current) {
        didAutoFit.current = true;
        fit();
      } else {
        requestDraw();
      }
    };
    worker.postMessage({
      type: "init",
      nodes: nodes.map((node) => ({ depth: node.depth, isCenter: node.isCenter })),
      edges: indexedEdges.map(({ edge, source, target }) => ({
        source,
        target,
        weight: Math.max(1, edge.actualOccurrences.length + edge.suggestions.length)
      })),
      settings: forcesRef.current
    });
    requestDraw();
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [model, nodes, indexedEdges, fit, requestDraw]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: "settings", settings: forces });
  }, [forces]);

  useEffect(() => requestDraw(), [focus, display, requestDraw]);
  useEffect(() => { if (fitToken > 0) fit(); }, [fitToken, fit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      if (transformRef.current.x === 0 && transformRef.current.y === 0) fit();
      else requestDraw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [fit, requestDraw]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const localPoint = (event: ReactPointerEvent | ReactWheelEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const worldPoint = (point: Point): Point => {
    const transform = transformRef.current;
    return { x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale };
  };

  const hitNode = (screen: Point): number | undefined => {
    const world = worldPoint(screen);
    const positions = positionsRef.current;
    const threshold = Math.max(8, displayRef.current.nodeSize + 4) / transformRef.current.scale;
    let best: number | undefined;
    let bestDistance = threshold;
    for (let index = 0; index < nodes.length; index += 1) {
      const distance = Math.hypot(world.x - positions[index * 2], world.y - positions[index * 2 + 1]);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  };

  const hitEdge = (screen: Point): VisualEdge | undefined => {
    const transform = transformRef.current;
    const positions = positionsRef.current;
    let best: VisualEdge | undefined;
    let bestDistance = 6;
    for (const { edge, source, target } of indexedEdges) {
      const a = {
        x: positions[source * 2] * transform.scale + transform.x,
        y: positions[source * 2 + 1] * transform.scale + transform.y
      };
      const b = {
        x: positions[target * 2] * transform.scale + transform.x,
        y: positions[target * 2 + 1] * transform.scale + transform.y
      };
      const distance = lineDistance(screen, a, b);
      if (distance < bestDistance) {
        best = edge;
        bestDistance = distance;
      }
    }
    return best;
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    const index = hitNode(point);
    if (index !== undefined) {
      const positions = positionsRef.current;
      gestureRef.current = {
        mode: "node",
        pointerId: event.pointerId,
        start: point,
        origin: { x: positions[index * 2], y: positions[index * 2 + 1] },
        nodeIndex: index,
        moved: false
      };
    } else {
      gestureRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        start: point,
        origin: { x: transformRef.current.x, y: transformRef.current.y },
        moved: false
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event);
    const gesture = gestureRef.current;
    if (gesture?.pointerId === event.pointerId) {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      gesture.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
      if (gesture.mode === "pan") {
        transformRef.current.x = gesture.origin.x + dx;
        transformRef.current.y = gesture.origin.y + dy;
      } else if (gesture.nodeIndex !== undefined) {
        const worldX = gesture.origin.x + dx / transformRef.current.scale;
        const worldY = gesture.origin.y + dy / transformRef.current.scale;
        positionsRef.current[gesture.nodeIndex * 2] = worldX;
        positionsRef.current[gesture.nodeIndex * 2 + 1] = worldY;
        workerRef.current?.postMessage({
          type: "pin",
          index: gesture.nodeIndex,
          x: worldX,
          y: worldY,
          pinned: true
        });
      }
      requestDraw();
      return;
    }

    const index = hitNode(point);
    if (index !== undefined) {
      onFocus({ nodeId: nodes[index].id });
      event.currentTarget.style.cursor = "pointer";
      return;
    }
    const edge = hitEdge(point);
    onFocus(edge ? { edgeId: edge.id } : {});
    event.currentTarget.style.cursor = edge ? "pointer" : "grab";
  };

  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.mode === "node" && gesture.nodeIndex !== undefined) {
      const index = gesture.nodeIndex;
      const positions = positionsRef.current;
      workerRef.current?.postMessage({
        type: "pin",
        index,
        x: positions[index * 2],
        y: positions[index * 2 + 1],
        pinned: false
      });
      if (!gesture.moved) onNodeClick(nodes[index]);
    }
    event.currentTarget.releasePointerCapture(event.pointerId);
    gestureRef.current = null;
  };

  const wheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = localPoint(event);
    const previous = transformRef.current;
    const world = worldPoint(point);
    const scale = Math.min(4, Math.max(0.08, previous.scale * Math.exp(-event.deltaY * 0.0012)));
    transformRef.current = {
      scale,
      x: point.x - world.x * scale,
      y: point.y - world.y * scale
    };
    requestDraw();
  };

  return (
    <canvas
      ref={canvasRef}
      className="lg-canvas"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onPointerLeave={() => { if (!gestureRef.current) onFocus({}); }}
      onWheel={wheel}
      role="img"
      aria-label={`Local relationship graph with ${nodes.length} nodes and ${edges.length} connections`}
    />
  );
}
