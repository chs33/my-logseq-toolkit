export type Entity = Record<string, unknown>;
export type Exclusion = "today" | "properties" | "content" | "references" | "unreadable";

// Read persisted data directly. Editor.getPage adds display properties (including
// created-by-ref), while getAllPages omits the journal date entirely.
const blockPull = `[* {:block/_refs [:db/id]} {:block/_alias [:db/id]}
  {:block/_parent [:db/id]}]`;
const pagePull = `[* {:block/tags [:db/id :db/ident]}
  {:block/refs [:db/id :db/ident]} {:block/_page ${blockPull}}
  {:block/_parent [:db/id]} {:block/_refs [:db/id]} {:block/_alias [:db/id]}]`;

export const JOURNAL_SCAN_QUERY = `[:find (pull ?page ${pagePull})
  :where [?page :block/journal-day]]`;
export const JOURNAL_RECHECK_QUERY = `[:find (pull ?page ${pagePull})
  :in $ ?page :where [?page :block/journal-day]]`;

const record = (value: unknown): value is Entity =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// datascriptQuery strips block/db namespaces without camel-casing. Also accept
// raw CLI pull output so the same classifier can be checked against the live DB.
export function attribute(entity: Entity, key: string): unknown {
  const short = key.slice(key.indexOf("/") + 1);
  for (const name of [key, `:${key}`, short]) {
    if (entity[name] !== undefined) return entity[name];
  }
  return undefined;
}

function collection(entity: Entity, key: string): Entity[] {
  const items = attribute(entity, key);
  // DataScript pull omits reverse attributes with no datoms.
  if (items === undefined) return [];
  if (!Array.isArray(items) || !items.every(record)) throw new Error(`Invalid ${key}`);
  return items;
}

export function parseJournalRows(result: unknown): Entity[] {
  if (!Array.isArray(result)) throw new Error("Logseq did not return journal query rows.");
  return result.map(row => {
    if (!Array.isArray(row) || row.length !== 1 || !record(row[0])) {
      throw new Error("Logseq returned an invalid journal query row.");
    }
    return row[0];
  });
}

const auditProperties = new Set([
  "logseq.property/created-by-ref",
  "logseq.property/updated-by-ref"
]);
const stripColon = (key: string): string => key.replace(/^:/u, "");

export function hasUserProperties(entity: Entity): boolean {
  const properties = attribute(entity, "block/properties");
  if (properties !== undefined) {
    if (!record(properties)) return true;
    if (Object.keys(properties).some(key => !auditProperties.has(stripColon(key)))) return true;
  }
  return Object.keys(entity).some(key => {
    const name = stripColon(key);
    if (!name.includes("/")) return false;
    const namespace = name.split("/")[0];
    return !["db", "block", "file", "block.temp"].includes(namespace) &&
      !auditProperties.has(name);
  });
}

function hasMetadataContent(entity: Entity): boolean {
  return ["body", "marker", "priority", "scheduled", "deadline", "link", "alias"].some(key => {
    const value = attribute(entity, `block/${key}`);
    return value !== undefined && value !== null && value !== "" &&
      (!Array.isArray(value) || value.length > 0);
  });
}

function ident(entity: Entity): string {
  return stripColon(String(attribute(entity, "db/ident") ?? ""));
}

const builtinPageTags = new Set(["logseq.class/Journal", "logseq.class/Page"]);
// The tags property has ident :block/tags ("tags" after SDK normalization).
const builtinPageRefs = new Set([...builtinPageTags, "block/tags", "tags"]);

export function inspectJournalSnapshot(page: Entity, today = new Date()): Exclusion | null {
  try {
    const id = attribute(page, "db/id");
    const uuid = attribute(page, "block/uuid");
    const name = attribute(page, "block/name");
    const day = attribute(page, "block/journal-day");
    if (!Number.isInteger(id) || typeof uuid !== "string" || !uuid ||
        typeof name !== "string" || !name || !/^\d{8}$/u.test(String(day))) return "unreadable";
    const localDay = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    if (Number(day) === localDay) return "today";
    if (hasUserProperties(page)) return "properties";
    if (hasMetadataContent(page) ||
        collection(page, "block/tags").some(tag => !builtinPageTags.has(ident(tag))) ||
        collection(page, "block/refs").some(ref => !builtinPageRefs.has(ident(ref)))) return "content";

    const blocks = collection(page, "block/_page");
    const blockIds = new Set(blocks.map(block => attribute(block, "db/id")));
    for (const parent of [page, ...blocks]) {
      // Preserve children missing from the page index instead of assuming empty.
      if (collection(parent, "block/_parent").some(child => !blockIds.has(attribute(child, "db/id")))) {
        return "unreadable";
      }
      if (collection(parent, "block/_refs").length || collection(parent, "block/_alias").length) {
        return "references";
      }
    }
    for (const block of blocks) {
      const title = attribute(block, "block/title");
      if (!Number.isInteger(attribute(block, "db/id")) || typeof title !== "string") return "unreadable";
      if (hasUserProperties(block)) return "properties";
      if (title.trim() || hasMetadataContent(block) ||
          collection(block, "block/tags").length || collection(block, "block/refs").length) return "content";
    }
    return null;
  } catch {
    return "unreadable";
  }
}

export function summarizeJournals(pages: Entity[], today = new Date()) {
  const excluded: Record<Exclusion, number> = { today: 0, properties: 0, content: 0, references: 0, unreadable: 0 };
  const candidates: Entity[] = [];
  for (const page of pages) {
    const reason = inspectJournalSnapshot(page, today);
    if (reason) excluded[reason] += 1;
    else candidates.push(page);
  }
  return { candidates, excluded, journals: pages.length };
}
