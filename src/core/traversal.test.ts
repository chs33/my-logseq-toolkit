import { describe, expect, it } from "vitest";
import { pageNodeId } from "./ids";
import { overlaySuggestions } from "./suggestions";
import { buildActualGraph } from "./traversal";
import {
  ALL_RELATION_TYPES,
  type BlockRecord,
  type ExpansionContent,
  type GraphCenter,
  type GraphFilters,
  type PageRecord,
  type RelationKind,
  type RelationOccurrence,
  type RelationReader,
  type SuggestedRelationship
} from "./types";

const filters = (depth: 1 | 2 | 3 = 2): GraphFilters => ({
  depth,
  incoming: true,
  outgoing: true,
  relationTypes: ALL_RELATION_TYPES
});

class MemoryReader implements RelationReader {
  pages = new Map<string, PageRecord>();
  blocks = new Map<string, BlockRecord>();
  relations: RelationOccurrence[] = [];

  page(id: string, label = id): this {
    this.pages.set(id, { id, label, name: label });
    return this;
  }

  block(id: string, pageId: string, title = id): this {
    this.blocks.set(id, { id, uuid: `uuid-${id}`, pageId, title });
    return this;
  }

  relation(
    id: string,
    sourceBlockId: string,
    kind: RelationKind,
    target: { page?: string; block?: string; url?: string }
  ): this {
    const source = this.blocks.get(sourceBlockId)!;
    const base = {
      id,
      kind,
      sourceBlockId,
      sourceBlockUuid: source.uuid,
      sourcePageId: source.pageId,
      sourcePageLabel: this.pages.get(source.pageId)?.label,
      sourceContext: source.title
    };
    if (target.page) {
      this.relations.push({
        ...base,
        targetKind: "page",
        targetPageId: target.page,
        targetPageLabel: this.pages.get(target.page)?.label
      });
    } else if (target.block) {
      const block = this.blocks.get(target.block)!;
      this.relations.push({
        ...base,
        targetKind: "block",
        targetBlockId: block.id,
        targetBlockUuid: block.uuid,
        targetBlockPageId: block.pageId,
        targetBlockLabel: block.title,
        targetPageLabel: this.pages.get(block.pageId)?.label
      });
    } else if (target.url) {
      this.relations.push({ ...base, targetKind: "url", targetUrl: target.url });
    }
    return this;
  }

  async getPage(pageId: string) { return this.pages.get(pageId) ?? null; }
  async getBlock(blockId: string) { return this.blocks.get(blockId) ?? null; }
  async getPageBlocks(pageId: string) { return [...this.blocks.values()].filter((block) => block.pageId === pageId); }
  async getRelations(content: ExpansionContent, active: GraphFilters) {
    return this.relations.filter((relation) => {
      if (!active.relationTypes.has(relation.kind)) return false;
      const outgoing = active.outgoing && content.blockIds.has(relation.sourceBlockId);
      const incomingBlock = relation.targetKind === "block" && relation.targetBlockId && content.blockIds.has(relation.targetBlockId);
      const incomingPage = relation.targetKind === "page" && relation.targetPageId === content.pageId;
      return outgoing || (active.incoming && (incomingBlock || incomingPage));
    });
  }
}

function pageCenter(pageId: string, reader: MemoryReader): GraphCenter {
  return {
    kind: "page",
    pageId,
    label: reader.pages.get(pageId)!.label,
    contentBlockIds: new Set([...reader.blocks.values()].filter((block) => block.pageId === pageId).map((block) => block.id))
  };
}

function blockCenter(blockId: string, descendants: string[], reader: MemoryReader): GraphCenter {
  const block = reader.blocks.get(blockId)!;
  return {
    kind: "block",
    blockId,
    blockUuid: block.uuid,
    pageId: block.pageId,
    label: block.title,
    contentBlockIds: new Set([blockId, ...descendants])
  };
}

function basicPages(...ids: string[]) {
  const reader = new MemoryReader();
  ids.forEach((id) => reader.page(id, `Page ${id}`));
  return reader;
}

describe("semantic graph traversal", () => {
  it("AT-01 builds a page-centered depth-1 graph", async () => {
    const reader = basicPages("A", "B", "C")
      .block("A1", "A").block("A2", "A")
      .relation("r1", "A1", "page_reference", { page: "B" })
      .relation("r2", "A2", "page_reference", { page: "C" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    expect([...graph.nodes.keys()].sort()).toEqual(["page:A", "page:B", "page:C"]);
    expect(graph.edges.size).toBe(2);
  });

  it("AT-02 and AT-08 restrict a block center to its subtree", async () => {
    const reader = basicPages("A", "B", "C", "D")
      .block("A1.1", "A").block("A1.1.1", "A").block("A1.2", "A").block("A2", "A")
      .relation("inside", "A1.1.1", "page_reference", { page: "B" })
      .relation("sibling", "A1.2", "page_reference", { page: "C" })
      .relation("other", "A2", "page_reference", { page: "D" });
    const graph = await buildActualGraph(blockCenter("A1.1", ["A1.1.1"], reader), filters(1), reader);
    expect(graph.nodes.has("page:B")).toBe(true);
    expect(graph.nodes.has("page:C")).toBe(false);
    expect(graph.nodes.has("page:D")).toBe(false);
  });

  it("AT-03 promotes an external block target but retains exact provenance", async () => {
    const reader = basicPages("A", "P").block("A1", "A").block("B", "P")
      .relation("r", "A1", "block_reference", { block: "B" });
    const graph = await buildActualGraph(blockCenter("A1", [], reader), filters(1), reader);
    expect(graph.nodes.has("page:P")).toBe(true);
    expect(graph.nodes.has("block:B")).toBe(false);
    expect(graph.occurrences.get("r")?.occurrence.targetBlockId).toBe("B");
  });

  it("AT-04, AT-05, and AT-26 use page-based depth and expand all reached-page blocks", async () => {
    const reader = basicPages("A", "P", "Q")
      .block("A1", "A").block("B", "P").block("C", "P")
      .relation("to-block", "A1", "block_reference", { block: "B" })
      .relation("from-unrelated-page-block", "C", "page_reference", { page: "Q" });
    const graph = await buildActualGraph(blockCenter("A1", [], reader), filters(2), reader);
    expect(graph.nodes.get("page:P")?.depth).toBe(1);
    expect(graph.nodes.get("page:Q")?.depth).toBe(2);
  });

  it("AT-06 finds incoming block references to a page block", async () => {
    const reader = basicPages("A", "B").block("A1", "A").block("B1", "B")
      .relation("incoming", "B1", "block_reference", { block: "A1" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    const occurrence = graph.occurrences.get("incoming")!;
    expect(occurrence.sourceNodeId).toBe("page:B");
    expect(occurrence.targetNodeId).toBe("page:A");
  });

  it("AT-07 finds incoming references to a block-center descendant", async () => {
    const reader = basicPages("A", "B").block("A1", "A").block("A2", "A").block("B1", "B")
      .relation("incoming", "B1", "block_reference", { block: "A2" });
    const graph = await buildActualGraph(blockCenter("A1", ["A2"], reader), filters(1), reader);
    expect(graph.nodes.has("page:B")).toBe(true);
  });

  it("AT-09 projects a same-page target outside the center subtree to its page", async () => {
    const reader = basicPages("A").block("A1", "A").block("A2", "A")
      .relation("same-page", "A1", "block_reference", { block: "A2" });
    const graph = await buildActualGraph(blockCenter("A1", [], reader), filters(1), reader);
    expect(graph.nodes.has("block:A1")).toBe(true);
    expect(graph.nodes.has("page:A")).toBe(true);
    expect(graph.edges.size).toBe(1);
  });

  it("AT-10 suppresses page-center self-projected relationships", async () => {
    const reader = basicPages("A").block("A1", "A").block("A2", "A")
      .relation("internal", "A1", "block_reference", { block: "A2" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    expect(graph.edges.size).toBe(0);
    expect(graph.nodes.size).toBe(1);
  });

  it("AT-11 aggregates repeated occurrences into one visual edge", async () => {
    const reader = basicPages("A", "B");
    for (let index = 1; index <= 5; index += 1) {
      reader.block(`A${index}`, "A").relation(`r${index}`, `A${index}`, "page_reference", { page: "B" });
    }
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    expect(graph.edges.size).toBe(1);
    expect([...graph.edges.values()][0].actualOccurrences).toHaveLength(5);
    expect(graph.occurrences.size).toBe(5);
  });

  it("AT-12 and AT-17 aggregate mixed types without losing counts", async () => {
    const reader = basicPages("A", "B").block("A1", "A").block("A2", "A").block("A3", "A").block("B1", "B")
      .relation("page", "A1", "page_reference", { page: "B" })
      .relation("block", "A2", "block_reference", { block: "B1" })
      .relation("embed", "A3", "embed", { block: "B1" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    const edge = [...graph.edges.values()][0];
    expect(edge.countsByType).toMatchObject({ page_reference: 1, block_reference: 1, embed: 1 });
  });

  it("AT-13 and AT-14 preserve one-way and bidirectional counts", async () => {
    const reader = basicPages("A", "B").block("A1", "A").block("B1", "B")
      .relation("ab", "A1", "page_reference", { page: "B" })
      .relation("ba", "B1", "page_reference", { page: "A" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    const edge = [...graph.edges.values()][0];
    expect(edge.countsByDirection).toEqual({ aToB: 1, bToA: 1 });
    const oneWayReader = basicPages("A", "B").block("A1", "A")
      .relation("ab", "A1", "page_reference", { page: "B" });
    const oneWay = await buildActualGraph(pageCenter("A", oneWayReader), filters(1), oneWayReader);
    expect([...oneWay.edges.values()][0].countsByDirection).toEqual({ aToB: 1, bToA: 0 });
  });

  it("AT-15 and AT-16 treats normalized URLs as terminal aggregated nodes", async () => {
    const reader = basicPages("A").block("A1", "A").block("A2", "A")
      .relation("u1", "A1", "external_url", { url: "https://EXAMPLE.com:443/paper" })
      .relation("u2", "A2", "external_url", { url: "https://example.com/paper" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(3), reader);
    const urls = [...graph.nodes.values()].filter((node) => node.kind === "url");
    expect(urls).toHaveLength(1);
    expect(urls[0].depth).toBe(1);
    expect([...graph.edges.values()][0].actualOccurrences).toHaveLength(2);
  });

  it("respects relation and direction filters", async () => {
    const reader = basicPages("A", "B", "C").block("A1", "A").block("B1", "B")
      .relation("embed", "A1", "embed", { page: "B" })
      .relation("incoming", "B1", "page_reference", { page: "A" });
    const active: GraphFilters = {
      ...filters(1),
      incoming: false,
      relationTypes: new Set(["embed"])
    };
    const graph = await buildActualGraph(pageCenter("A", reader), active, reader);
    expect(graph.nodes.has("page:B")).toBe(true);
    expect(graph.occurrences.has("incoming")).toBe(false);
  });

  it("expands same-depth pages concurrently with a bounded reader load", async () => {
    class ConcurrentReader extends MemoryReader {
      activeReads = 0;
      maxReads = 0;

      override async getRelations(content: ExpansionContent, active: GraphFilters) {
        if (content.pageId !== "A") {
          this.activeReads += 1;
          this.maxReads = Math.max(this.maxReads, this.activeReads);
          await new Promise((resolve) => setTimeout(resolve, 4));
          this.activeReads -= 1;
        }
        return super.getRelations(content, active);
      }
    }
    const reader = new ConcurrentReader();
    reader.page("A", "Page A").block("A1", "A");
    for (let index = 1; index <= 12; index += 1) {
      reader.page(`P${index}`, `Page ${index}`)
        .relation(`r${index}`, "A1", "page_reference", { page: `P${index}` });
    }
    await buildActualGraph(pageCenter("A", reader), filters(2), reader);
    expect(reader.maxReads).toBeGreaterThan(1);
    expect(reader.maxReads).toBeLessThanOrEqual(6);
  });
});

describe("suggestion overlay", () => {
  it("AT-19 creates a distinct suggested-only node and dashed-model edge", async () => {
    const reader = basicPages("A", "B").block("A1", "A");
    const graph = await buildActualGraph(pageCenter("A", reader), filters(2), reader);
    const suggestion: SuggestedRelationship = {
      id: "s1",
      source: { kind: "page", id: "A" },
      target: { kind: "page", id: "B" },
      reason: "Related topic"
    };
    await overlaySuggestions(graph, [suggestion], reader);
    expect(graph.nodes.get("page:B")?.suggestedOnly).toBe(true);
    expect([...graph.edges.values()][0].suggested).toBe(true);
  });

  it("AT-20 never expands a suggested-only node through actual links", async () => {
    const reader = basicPages("A", "B", "C", "D")
      .block("A1", "A").block("C1", "C")
      .relation("actual-ab", "A1", "page_reference", { page: "B" })
      .relation("actual-cd", "C1", "page_reference", { page: "D" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(3), reader);
    await overlaySuggestions(graph, [{
      id: "s-bc",
      source: { kind: "page", id: "B" },
      target: { kind: "page", id: "C" }
    }], reader);
    expect(graph.nodes.has("page:C")).toBe(true);
    expect(graph.nodes.has("page:D")).toBe(false);
  });

  it("AT-21 projects a suggested block endpoint to its page", async () => {
    const reader = basicPages("A", "B").block("A1", "A").block("BX", "B");
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    await overlaySuggestions(graph, [{
      id: "s-block",
      source: { kind: "page", id: "A" },
      target: { kind: "block", id: "BX" }
    }], reader);
    expect(graph.nodes.has(pageNodeId("B"))).toBe(true);
    expect(graph.nodes.has("block:BX")).toBe(false);
  });

  it("suppresses a suggestion that duplicates an actual visible relation", async () => {
    const reader = basicPages("A", "B").block("A1", "A")
      .relation("actual", "A1", "page_reference", { page: "B" });
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    await overlaySuggestions(graph, [{
      id: "duplicate",
      source: { kind: "page", id: "A" },
      target: { kind: "page", id: "B" }
    }], reader);
    expect([...graph.edges.values()].filter((edge) => edge.suggested)).toHaveLength(0);
  });

  it("ignores suggestions disconnected from the visible graph", async () => {
    const reader = basicPages("A", "B", "C").block("A1", "A");
    const graph = await buildActualGraph(pageCenter("A", reader), filters(1), reader);
    await overlaySuggestions(graph, [{
      id: "detached",
      source: { kind: "page", id: "B" },
      target: { kind: "page", id: "C" }
    }], reader);
    expect(graph.nodes.size).toBe(1);
    expect(graph.edges.size).toBe(0);
  });
});
