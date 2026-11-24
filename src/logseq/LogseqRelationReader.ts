import type {
  BlockRecord,
  EntityId,
  ExpansionContent,
  GraphFilters,
  PageRecord,
  RelationOccurrence,
  RelationReader
} from "../core/types";
import { parseBlockRelationships, type ParseResolver } from "./contentParser";

type RawEntity = Record<string, any>;

const value = <T = unknown>(entity: RawEntity, ...keys: string[]): T | undefined => {
  for (const key of keys) {
    if (entity[key] !== undefined) return entity[key] as T;
  }
  return undefined;
};

const rawId = (entity: unknown): unknown => {
  if (entity && typeof entity === "object") {
    return value(entity as RawEntity, "id", "db/id", ":db/id");
  }
  return entity;
};

const entityId = (entity: unknown): EntityId => String(rawId(entity));

const uuidOf = (entity: RawEntity): string =>
  String(value(entity, "uuid", "block/uuid", ":block/uuid") ?? "");

const titleOf = (entity: RawEntity): string =>
  String(value(entity, "title", "fullTitle", "content", "block/title", ":block/title") ?? "");

const pageNameOf = (entity: RawEntity): string =>
  String(
    value(
      entity,
      "originalName",
      "title",
      "name",
      "block/original-name",
      ":block/original-name",
      "block/name",
      ":block/name"
    ) ?? "Untitled page"
  );

const pageRefOf = (entity: RawEntity): unknown =>
  value(entity, "page", "block/page", ":block/page");

const parentRefOf = (entity: RawEntity): unknown =>
  value(entity, "parent", "block/parent", ":block/parent");

const rawChildrenOf = (entity: RawEntity): unknown[] =>
  value<unknown[]>(entity, "children", "block/children", ":block/children") ?? [];

const expandedChildrenOf = (entity: RawEntity): RawEntity[] =>
  rawChildrenOf(entity).filter(
    (child): child is RawEntity => Boolean(child) && typeof child === "object" && !Array.isArray(child)
  );

function originalId(id: EntityId): EntityId | number {
  return /^\d+$/u.test(id) ? Number(id) : id;
}

function unwrapRows(input: unknown): RawEntity[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((row) => {
    if (Array.isArray(row)) return row.filter((item) => item && typeof item === "object");
    return row && typeof row === "object" ? [row] : [];
  }) as RawEntity[];
}

export class LogseqRelationReader implements RelationReader, ParseResolver {
  private pageCache = new Map<EntityId, PageRecord>();
  private blockCache = new Map<EntityId, BlockRecord>();
  private pageLookup = new Map<string, PageRecord | null>();
  private blockLookup = new Map<string, BlockRecord | null>();
  private pageBlocksCache = new Map<EntityId, BlockRecord[]>();
  private pageRequests = new Map<string, Promise<PageRecord | null>>();
  private blockRequests = new Map<string, Promise<BlockRecord | null>>();
  private pageBlockRequests = new Map<EntityId, Promise<BlockRecord[]>>();

  private rememberPage(raw: RawEntity): PageRecord {
    const page: PageRecord = {
      id: entityId(raw),
      uuid: uuidOf(raw) || undefined,
      name: value<string>(raw, "name", "block/name", ":block/name"),
      label: pageNameOf(raw)
    };
    this.pageCache.set(page.id, page);
    if (page.uuid) this.pageLookup.set(page.uuid.toLowerCase(), page);
    if (page.name) this.pageLookup.set(page.name.toLowerCase(), page);
    this.pageLookup.set(page.label.toLowerCase(), page);
    return page;
  }

  private rememberBlock(raw: RawEntity, fallbackPageId?: EntityId): BlockRecord {
    const pageRef = pageRefOf(raw);
    if (pageRef && typeof pageRef === "object") this.rememberPage(pageRef as RawEntity);
    const pageId = pageRef !== undefined ? entityId(pageRef) : fallbackPageId ?? "";
    const children = expandedChildrenOf(raw).map((child) => this.rememberBlock(child, pageId));
    const block: BlockRecord = {
      id: entityId(raw),
      uuid: uuidOf(raw),
      pageId,
      title: titleOf(raw),
      parentId: parentRefOf(raw) !== undefined ? entityId(parentRefOf(raw)) : undefined,
      children
    };
    this.blockCache.set(block.id, block);
    if (block.uuid) this.blockLookup.set(block.uuid.toLowerCase(), block);
    return block;
  }

  async getPage(pageId: EntityId): Promise<PageRecord | null> {
    const cached = this.pageCache.get(pageId);
    if (cached) return cached;
    const requestKey = `id:${pageId}`;
    const pending = this.pageRequests.get(requestKey);
    if (pending) return pending;
    const request = (async () => {
      const raw = await logseq.Editor.getPage(originalId(pageId) as any);
      return raw ? this.rememberPage(raw as RawEntity) : null;
    })().finally(() => this.pageRequests.delete(requestKey));
    this.pageRequests.set(requestKey, request);
    return request;
  }

  async getBlock(blockId: EntityId): Promise<BlockRecord | null> {
    const cached = this.blockCache.get(blockId);
    if (cached) return cached;
    const requestKey = `id:${blockId}`;
    const pending = this.blockRequests.get(requestKey);
    if (pending) return pending;
    const request = (async () => {
      const raw = await logseq.Editor.getBlock(originalId(blockId) as any, { includeChildren: true });
      return raw ? this.rememberBlock(raw as RawEntity) : null;
    })().finally(() => this.blockRequests.delete(requestKey));
    this.blockRequests.set(requestKey, request);
    return request;
  }

  async resolvePage(identifier: string): Promise<PageRecord | null> {
    const key = identifier.toLowerCase();
    if (this.pageLookup.has(key)) return this.pageLookup.get(key) ?? null;
    const requestKey = `lookup:${key}`;
    const pending = this.pageRequests.get(requestKey);
    if (pending) return pending;
    const request = (async () => {
      const raw = await logseq.Editor.getPage(identifier as any);
      const page = raw ? this.rememberPage(raw as RawEntity) : null;
      this.pageLookup.set(key, page);
      return page;
    })().finally(() => this.pageRequests.delete(requestKey));
    this.pageRequests.set(requestKey, request);
    return request;
  }

  async resolveBlock(identifier: string): Promise<BlockRecord | null> {
    const key = identifier.toLowerCase();
    if (this.blockLookup.has(key)) return this.blockLookup.get(key) ?? null;
    const requestKey = `lookup:${key}`;
    const pending = this.blockRequests.get(requestKey);
    if (pending) return pending;
    const request = (async () => {
      const raw = await logseq.Editor.getBlock(identifier as any, { includeChildren: false });
      const block = raw ? this.rememberBlock(raw as RawEntity) : null;
      this.blockLookup.set(key, block);
      return block;
    })().finally(() => this.blockRequests.delete(requestKey));
    this.blockRequests.set(requestKey, request);
    return request;
  }

  async getPageLabel(pageId: EntityId): Promise<string | undefined> {
    return (await this.getPage(pageId))?.label;
  }

  async getPageBlocks(pageId: EntityId): Promise<BlockRecord[]> {
    const cached = this.pageBlocksCache.get(pageId);
    if (cached) return cached;
    const pending = this.pageBlockRequests.get(pageId);
    if (pending) return pending;
    const request = (async () => {
      const page = await this.getPage(pageId);
      const identity = page?.uuid ?? page?.name ?? originalId(pageId);
      const rawTree = (await logseq.Editor.getPageBlocksTree(identity as any)) ?? [];
      const flat = await this.flattenRawTree(rawTree as RawEntity[], pageId);
      this.pageBlocksCache.set(pageId, flat);
      return flat;
    })().finally(() => this.pageBlockRequests.delete(pageId));
    this.pageBlockRequests.set(pageId, request);
    return request;
  }

  async getBlockSubtree(blockId: EntityId): Promise<BlockRecord[]> {
    const cached = this.blockCache.get(blockId);
    const identity = cached?.uuid ?? originalId(blockId);
    const raw = await logseq.Editor.getBlock(identity as any, { includeChildren: true });
    return raw ? this.flattenRawTree([raw as RawEntity]) : [];
  }

  private async flattenRawTree(roots: RawEntity[], fallbackPageId?: EntityId): Promise<BlockRecord[]> {
    const result: BlockRecord[] = [];
    const visited = new Set<EntityId>();
    const visit = async (raw: RawEntity, inheritedPageId?: EntityId): Promise<void> => {
      const block = this.rememberBlock(raw, inheritedPageId);
      if (visited.has(block.id)) return;
      visited.add(block.id);
      result.push(block);
      for (const child of rawChildrenOf(raw)) {
        if (Array.isArray(child) && child[0] === "uuid" && child[1]) {
          const expanded = await logseq.Editor.getBlock(String(child[1]), { includeChildren: true });
          if (expanded) await visit(expanded as RawEntity, block.pageId);
        } else if (child && typeof child === "object") {
          await visit(child as RawEntity, block.pageId);
        }
      }
    };
    for (const root of roots) await visit(root, fallbackPageId);
    return result;
  }

  private async parse(blocks: BlockRecord[], filters: GraphFilters): Promise<RelationOccurrence[]> {
    const parsed = await Promise.all(
      blocks.map((block) => parseBlockRelationships(block, this, filters.relationTypes))
    );
    return parsed.flat();
  }

  private async incomingBlocks(content: ExpansionContent): Promise<BlockRecord[]> {
    const targetIds = [...content.blockIds];
    if (content.pageId) targetIds.push(content.pageId);
    if (targetIds.length === 0) return [];
    const result = await logseq.DB.datascriptQuery(
      `[:find (pull ?source [* {:block/page [*]}])
        :in $ [?target ...]
        :where [?source :block/refs ?target]]`,
      targetIds.map(originalId)
    );
    return unwrapRows(result).map((raw) => this.rememberBlock(raw));
  }

  private pointsIntoContent(relation: RelationOccurrence, content: ExpansionContent): boolean {
    if (relation.targetKind === "block" && relation.targetBlockId) {
      return content.blockIds.has(relation.targetBlockId);
    }
    if (relation.targetKind === "page" && relation.targetPageId) {
      return content.pageId === relation.targetPageId;
    }
    return false;
  }

  async getRelations(
    content: ExpansionContent,
    filters: GraphFilters
  ): Promise<RelationOccurrence[]> {
    const byId = new Map<string, RelationOccurrence>();
    if (filters.outgoing) {
      const blocks = await Promise.all([...content.blockIds].map((id) => this.getBlock(id)));
      for (const occurrence of await this.parse(
        blocks.filter((block): block is BlockRecord => block !== null),
        filters
      )) {
        byId.set(occurrence.id, occurrence);
      }
    }
    if (filters.incoming) {
      const incoming = await this.incomingBlocks(content);
      for (const occurrence of await this.parse(incoming, filters)) {
        if (this.pointsIntoContent(occurrence, content)) byId.set(occurrence.id, occurrence);
      }
    }
    return [...byId.values()];
  }
}

export const logseqEntity = {
  entityId,
  pageNameOf,
  titleOf,
  uuidOf,
  pageRefOf,
  originalId
};
