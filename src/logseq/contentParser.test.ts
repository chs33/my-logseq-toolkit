import { describe, expect, it } from "vitest";
import type { BlockRecord, PageRecord } from "../core/types";
import { ALL_RELATION_TYPES } from "../core/types";
import { parseBlockRelationships, type ParseResolver } from "./contentParser";

class Resolver implements ParseResolver {
  pages = new Map<string, PageRecord>([["gamma inventory", { id: "P", label: "Gamma Inventory" }]]);
  blocks = new Map<string, BlockRecord>([["target-uuid", { id: "B", uuid: "target-uuid", pageId: "P", title: "Empirical results" }]]);
  async resolvePage(value: string) { return this.pages.get(value.toLowerCase()) ?? null; }
  async resolveBlock(value: string) { return this.blocks.get(value.toLowerCase()) ?? null; }
  async getPageLabel(pageId: string) { return pageId === "P" ? "Gamma Inventory" : "Source"; }
}

const source: BlockRecord = {
  id: "A1",
  uuid: "source-uuid",
  pageId: "A",
  title: ""
};

describe("Logseq content relationship parser", () => {
  it("extracts page refs, block refs, embeds, and URLs with exact targets", async () => {
    const block = {
      ...source,
      title: "See [[Gamma Inventory]], ((target-uuid)), {{embed ((target-uuid))}}, and https://EXAMPLE.com:443/paper?q=1#x."
    };
    const occurrences = await parseBlockRelationships(block, new Resolver(), ALL_RELATION_TYPES);
    expect(occurrences.map((item) => item.kind)).toEqual([
      "page_reference",
      "block_reference",
      "embed",
      "external_url"
    ]);
    expect(occurrences[1]).toMatchObject({
      sourceBlockId: "A1",
      targetBlockId: "B",
      targetBlockPageId: "P",
      targetBlockLabel: "Empirical results"
    });
    expect(occurrences[3].targetUrl).toBe("https://EXAMPLE.com:443/paper?q=1#x");
  });

  it("does not double-count the reference inside an embed", async () => {
    const occurrences = await parseBlockRelationships(
      { ...source, title: "{{embed [[Gamma Inventory]]}}" },
      new Resolver(),
      ALL_RELATION_TYPES
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].kind).toBe("embed");
    expect(occurrences[0].targetKind).toBe("page");
  });

  it("retains separate occurrence identities for duplicate links in one block", async () => {
    const occurrences = await parseBlockRelationships(
      { ...source, title: "[[Gamma Inventory]] then [[Gamma Inventory]]" },
      new Resolver(),
      ALL_RELATION_TYPES
    );
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0].id).not.toBe(occurrences[1].id);
  });

  it("honors enabled relationship types", async () => {
    const occurrences = await parseBlockRelationships(
      { ...source, title: "[[Gamma Inventory]] and https://example.com" },
      new Resolver(),
      new Set(["external_url"])
    );
    expect(occurrences.map((item) => item.kind)).toEqual(["external_url"]);
  });
});
