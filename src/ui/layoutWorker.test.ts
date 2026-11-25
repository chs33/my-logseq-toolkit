import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FORCE_SETTINGS } from "./graphSettings";

const graph = {
  type: "init",
  nodes: Array.from({ length: 8 }, (_, index) => ({
    depth: index === 0 ? 0 : 1 + Math.floor((index - 1) / 2),
    isCenter: index === 0
  })),
  edges: Array.from({ length: 7 }, (_, index) => ({
    source: Math.floor(index / 4), target: index + 1, weight: 1 + index % 8
  })),
  settings: DEFAULT_FORCE_SETTINGS
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["performance", "setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function createWorker() {
  const postMessage = vi.fn();
  const scope = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage };
  vi.stubGlobal("self", scope);
  await import("./layoutWorker");
  return {
    postMessage,
    send(data: unknown) { scope.onmessage!({ data } as MessageEvent); },
    positions(): Float32Array { return postMessage.mock.lastCall![0].positions; }
  };
}

describe("layout worker", () => {
  it("preserves the settled force layout while limiting position messages and stopping when settled", async () => {
    const worker = await createWorker();
    worker.send(graph);
    vi.runAllTimers();

    // Captured from the original force solver for this weighted, multi-depth graph.
    const expected = [
      -3.7205844, -6.8047380, 82.6259003, -17.2777710,
      27.2420177, 88.6557312, 29.3516998, -104.9702301,
      -70.4625092, 95.9456558, 125.8650131, -121.6369400,
      -60.2868500, 4.0722952, 188.4679871, -47.5618896
    ];
    Array.from(worker.positions()).forEach((value, index) => expect(value).toBeCloseTo(expected[index], 4));
    expect(worker.postMessage.mock.calls.length).toBeLessThan(10);
    expect(vi.getTimerCount()).toBe(0);
    const lastCall = worker.postMessage.mock.lastCall!;
    expect(lastCall[1].transfer).toEqual([lastCall[0].positions.buffer]);
  });

  it("coalesces a burst of drag and settings messages and uses the latest pin coordinates", async () => {
    const worker = await createWorker();
    worker.send(graph);
    for (let index = 0; index < 100; index += 1) {
      worker.send({ type: "pin", index: 1, x: 200 + index, y: -100 - index, pinned: true });
      worker.send({ type: "settings", settings: { ...DEFAULT_FORCE_SETTINGS, linkDistance: 95 + index } });
    }

    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersToNextTimer();
    expect(worker.positions()[2]).toBe(299);
    expect(worker.positions()[3]).toBe(-199);
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(worker.positions()[2]).toBe(299);
    expect(worker.positions()[3]).toBe(-199);

    worker.send({ type: "pin", index: 1, x: 299, y: -199, pinned: false });
    vi.runAllTimers();
    expect(worker.positions()[2]).not.toBe(299);
    expect(Array.from(worker.positions()).every(Number.isFinite)).toBe(true);
  });

  it("replaces pending graph work and does not reheat an unchanged settings update", async () => {
    const worker = await createWorker();
    worker.send(graph);
    vi.advanceTimersToNextTimer();
    worker.postMessage.mockClear();
    worker.send({ ...graph, nodes: [{ depth: 0, isCenter: true }], edges: [] });
    expect(vi.getTimerCount()).toBe(1);
    vi.runAllTimers();
    expect(worker.postMessage.mock.calls.every(call => call[0].positions.length === 2)).toBe(true);
    expect(Array.from(worker.positions())).toEqual([0, 0]);

    worker.send({ type: "settings", settings: { ...DEFAULT_FORCE_SETTINGS } });
    expect(vi.getTimerCount()).toBe(0);
    worker.send({ type: "settings", settings: { ...DEFAULT_FORCE_SETTINGS, repelForce: 0.5 } });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("returns an empty graph without scheduling unnecessary simulation work", async () => {
    const worker = await createWorker();
    worker.send(graph);
    worker.send({ ...graph, nodes: [], edges: [] });
    expect(worker.positions().length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
