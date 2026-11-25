import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type { GraphModel, GraphNode } from "../core/types";
import type { GraphDisplaySettings, GraphForceSettings } from "./graphSettings";
import { isSameFocus, type InteractionFocus } from "./interaction";
import { CanvasRenderer } from "./canvasRenderer";

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

export const GraphCanvas = memo(function GraphCanvas({
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
  const frameWindowRef = useRef<Window | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const focusRef = useRef(focus);
  const displayRef = useRef(display);
  const forcesRef = useRef(forces);
  const didAutoFit = useRef(false);
  const viewportRef = useRef({ width: 0, height: 0, ratio: 1 });
  const geometryDirty = useRef(true);
  const pendingHover = useRef<Point | null>(null);
  const pendingPin = useRef<{ type: "pin"; index: number; x: number; y: number; pinned: boolean } | null>(null);
  const hoverRef = useRef<(point: Point) => boolean>(() => false);
  const needsDraw = useRef(false);

  const nodes = useMemo(() => [...model.nodes.values()], [model]);
  const edges = useMemo(() => [...model.edges.values()], [model]);
  const nodeIndex = useMemo(() => new Map(nodes.map((node, index) => [node.id, index])), [nodes]);
  const indexedEdges = useMemo(() => edges.map((edge) => ({
    edge,
    source: nodeIndex.get(edge.nodeA)!,
    target: nodeIndex.get(edge.nodeB)!
  })).filter((edge) => edge.source !== undefined && edge.target !== undefined), [edges, nodeIndex]);

  const renderer = useMemo(() => new CanvasRenderer(nodes, indexedEdges), [nodes, indexedEdges]);
  const rendererRef = useRef(renderer);
  if (rendererRef.current !== renderer) {
    rendererRef.current = renderer;
    geometryDirty.current = true;
  }

  focusRef.current = focus;
  displayRef.current = display;
  forcesRef.current = forces;

  const requestDraw = useCallback((draw = true) => {
    needsDraw.current ||= draw;
    if (frameRef.current !== null) return;
    // The canvas lives in Logseq's document; our plugin iframe stays hidden.
    const view = canvasRef.current?.ownerDocument.defaultView;
    if (!view) return;
    frameWindowRef.current = view;
    frameRef.current = view.requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingPin.current) {
        workerRef.current?.postMessage(pendingPin.current);
        pendingPin.current = null;
      }
      if (pendingHover.current) {
        needsDraw.current = hoverRef.current(pendingHover.current) || needsDraw.current;
        pendingHover.current = null;
      }
      if (needsDraw.current) drawRef.current();
      needsDraw.current = false;
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
    geometryDirty.current = true;
    requestDraw();
  }, [requestDraw]);

  const ensureGeometry = () => {
    if (!geometryDirty.current) return;
    const { width, height } = viewportRef.current;
    renderer.geometry.update(positionsRef.current, transformRef.current, width, height);
    geometryDirty.current = false;
  };

  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const { width, height, ratio } = viewportRef.current;
    if (width === 0 || height === 0) return;
    ensureGeometry();
    renderer.draw(context, width, height, ratio, transformRef.current, displayRef.current, focusRef.current);
  };

  useEffect(() => {
    positionsRef.current = seedPositions(nodes);
    geometryDirty.current = true;
    pendingHover.current = null;
    pendingPin.current = null;
    gestureRef.current = null;
    transformRef.current = { x: 0, y: 0, scale: 1 };
    didAutoFit.current = false;
    const worker = new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: "positions"; positions: Float32Array }>) => {
      if (event.data.type !== "positions") return;
      const gesture = gestureRef.current;
      if (gesture?.mode === "node" && gesture.nodeIndex !== undefined && gesture.moved) {
        // An older worker snapshot must not move the node away from the pointer.
        event.data.positions[gesture.nodeIndex * 2] = positionsRef.current[gesture.nodeIndex * 2];
        event.data.positions[gesture.nodeIndex * 2 + 1] = positionsRef.current[gesture.nodeIndex * 2 + 1];
      }
      positionsRef.current = event.data.positions;
      geometryDirty.current = true;
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
    let previousWidth = canvas.clientWidth;
    let previousHeight = canvas.clientHeight;
    const resize = () => {
      const ratio = Math.min(2, canvas.ownerDocument.defaultView?.devicePixelRatio || 1);
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      viewportRef.current = { width, height, ratio };
      geometryDirty.current = true;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      if (transformRef.current.x === 0 && transformRef.current.y === 0) fit();
      else {
        transformRef.current.x += (width - previousWidth) / 2;
        transformRef.current.y += (height - previousHeight) / 2;
        requestDraw();
      }
      previousWidth = width;
      previousHeight = height;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, [fit, requestDraw]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      frameWindowRef.current?.cancelAnimationFrame(frameRef.current);
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

  const hitNode = (point: Point): number | undefined => {
    ensureGeometry();
    return renderer.geometry.hitNode(point.x, point.y, Math.max(8, displayRef.current.nodeSize + 4));
  };

  const emitFocus = (next: InteractionFocus) => {
    if (isSameFocus(focusRef.current, next)) return false;
    focusRef.current = next;
    onFocus(next);
    return true;
  };

  hoverRef.current = (point) => {
    const index = hitNode(point);
    const edgeIndex = index === undefined ? renderer.geometry.hitEdge(point.x, point.y) : undefined;
    const edge = edgeIndex === undefined ? undefined : indexedEdges[edgeIndex].edge;
    const changed = emitFocus(index !== undefined ? { nodeId: nodes[index].id } : edge ? { edgeId: edge.id } : {});
    if (canvasRef.current) canvasRef.current.style.cursor = index !== undefined || edge ? "pointer" : "grab";
    return changed;
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    pendingHover.current = null;
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
        pendingPin.current = {
          type: "pin",
          index: gesture.nodeIndex,
          x: worldX,
          y: worldY,
          pinned: true
        };
      }
      geometryDirty.current = true;
      requestDraw();
      return;
    }

    pendingHover.current = point;
    requestDraw(false);
  };

  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>, cancelled = false) => {
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
      pendingPin.current = null;
      if (!cancelled && !gesture.moved) onNodeClick(nodes[index]);
    }
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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
    geometryDirty.current = true;
    pendingHover.current = null;
    requestDraw();
  };

  return (
    <canvas
      ref={canvasRef}
      className="lg-canvas"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(event) => pointerUp(event)}
      onPointerCancel={(event) => pointerUp(event, true)}
      onLostPointerCapture={(event) => pointerUp(event, true)}
      onPointerLeave={() => {
        pendingHover.current = null;
        if (!gestureRef.current) { emitFocus({}); requestDraw(); }
      }}
      onWheel={wheel}
      role="img"
      aria-label={`Local relationship graph with ${nodes.length} nodes and ${edges.length} connections`}
    />
  );
});
