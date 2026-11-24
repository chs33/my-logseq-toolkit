export type EntityId = string;

export type RelationKind =
  | "page_reference"
  | "block_reference"
  | "embed"
  | "external_url";

export type GraphNodeKind = "page" | "center_block" | "url";

export interface PageRecord {
  id: EntityId;
  uuid?: string;
  name?: string;
  label: string;
}

export interface BlockRecord {
  id: EntityId;
  uuid: string;
  pageId: EntityId;
  title: string;
  parentId?: EntityId;
  children?: BlockRecord[];
}

export type GraphCenter =
  | {
      kind: "page";
      pageId: EntityId;
      label: string;
      contentBlockIds: ReadonlySet<EntityId>;
    }
  | {
      kind: "block";
      blockId: EntityId;
      blockUuid: string;
      pageId: EntityId;
      label: string;
      contentBlockIds: ReadonlySet<EntityId>;
    };

export interface RelationOccurrence {
  id: string;
  kind: RelationKind;
  sourceBlockId: EntityId;
  sourceBlockUuid?: string;
  sourcePageId: EntityId;
  sourcePageLabel?: string;
  sourceContext?: string;
  targetKind: "page" | "block" | "url";
  targetPageId?: EntityId;
  targetPageLabel?: string;
  targetBlockId?: EntityId;
  targetBlockUuid?: string;
  targetBlockPageId?: EntityId;
  targetBlockLabel?: string;
  targetUrl?: string;
}

export interface SuggestedEndpoint {
  kind: "page" | "block" | "url";
  id?: EntityId;
  url?: string;
  pageId?: EntityId;
  label?: string;
}

export interface SuggestedRelationship {
  id: string;
  source: SuggestedEndpoint;
  target: SuggestedEndpoint;
  score?: number;
  reason?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  pageId?: EntityId;
  blockId?: EntityId;
  blockUuid?: string;
  url?: string;
  label: string;
  depth: number;
  isCenter: boolean;
  suggestedOnly: boolean;
}

export interface DirectionCounts {
  aToB: number;
  bToA: number;
}

export type TypeCounts = Record<RelationKind, number>;

export interface ProjectedOccurrence {
  occurrence: RelationOccurrence;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface VisualEdge {
  id: string;
  nodeA: string;
  nodeB: string;
  actualOccurrences: ProjectedOccurrence[];
  countsByDirection: DirectionCounts;
  countsByType: TypeCounts;
  suggested: boolean;
  suggestions: SuggestedRelationship[];
}

export interface GraphModel {
  center: GraphCenter;
  nodes: Map<string, GraphNode>;
  edges: Map<string, VisualEdge>;
  occurrences: Map<string, ProjectedOccurrence>;
}

export interface ExpansionContent {
  blockIds: ReadonlySet<EntityId>;
  pageId?: EntityId;
}

export interface GraphFilters {
  depth: 1 | 2 | 3;
  incoming: boolean;
  outgoing: boolean;
  relationTypes: ReadonlySet<RelationKind>;
}

export interface RelationReader {
  getPage(pageId: EntityId): Promise<PageRecord | null>;
  getBlock(blockId: EntityId): Promise<BlockRecord | null>;
  getPageBlocks(pageId: EntityId): Promise<BlockRecord[]>;
  getRelations(content: ExpansionContent, filters: GraphFilters): Promise<RelationOccurrence[]>;
}

export const ALL_RELATION_TYPES: ReadonlySet<RelationKind> = new Set([
  "page_reference",
  "block_reference",
  "embed",
  "external_url"
]);

export const DEFAULT_FILTERS: GraphFilters = {
  depth: 2,
  incoming: true,
  outgoing: true,
  relationTypes: ALL_RELATION_TYPES
};
