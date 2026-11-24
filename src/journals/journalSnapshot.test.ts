import { describe, expect, it } from "vitest";
import { hasUserProperties, inspectJournalSnapshot, parseJournalRows, summarizeJournals, type Entity } from "./journalSnapshot";
import { emptyJournal, sdkQueryShape, today } from "./journalFixtures";

describe("journal database snapshots", () => {
  it("ignores only creator/editor audit properties, including SDK display maps", () => {
    expect(hasUserProperties({ properties: { ":logseq.property/created-by-ref": 12939 } })).toBe(false);
    expect(hasUserProperties({ properties: { ":logseq.property/updated-by-ref": 12939 } })).toBe(false);
    expect(hasUserProperties({ properties: { ":logseq.property/created-by-ref": 12939, mood: false } })).toBe(true);
    expect(inspectJournalSnapshot(emptyJournal(), today)).toBeNull();
    expect(inspectJournalSnapshot(sdkQueryShape(emptyJournal()) as Entity, today)).toBeNull();
  });

  it("excludes today independently of the displayed date format", () => {
    expect(inspectJournalSnapshot(emptyJournal({ "block/journal-day": 20261105 }), today)).toBe("today");
  });

  it("preserves flat DB properties even with false or empty values", () => {
    for (const value of [false, "", 0]) {
      expect(inspectJournalSnapshot(emptyJournal({ "user.property/mood": value }), today)).toBe("properties");
    }
    expect(inspectJournalSnapshot(emptyJournal({ "logseq.property/icon": "star" }), today)).toBe("properties");
  });

  it("preserves user tags and outgoing references", () => {
    expect(inspectJournalSnapshot(emptyJournal({ "block/tags": [{ "db/id": 999 }] }), today)).toBe("content");
    expect(inspectJournalSnapshot(emptyJournal({ "block/refs": [{ "db/id": 999 }] }), today)).toBe("content");
  });

  it("preserves backlinks and aliases to either the journal or a blank block", () => {
    for (const key of ["block/_refs", "block/_alias"]) {
      expect(inspectJournalSnapshot(emptyJournal({ [key]: [{ "db/id": 999 }] }), today)).toBe("references");
      expect(inspectJournalSnapshot(emptyJournal({
        "block/_page": [{ "db/id": 3, "block/title": "", [key]: [{ "db/id": 999 }] }]
      }), today)).toBe("references");
    }
  });

  it("inspects all descendant blocks, including blank blocks with metadata", () => {
    const blank = { "db/id": 3, "block/title": " \n", "logseq.property/created-by-ref": { "db/id": 12939 } };
    expect(inspectJournalSnapshot(emptyJournal({ "block/_page": [blank] }), today)).toBeNull();
    for (const extra of [{ "block/title": "Nested note" }, { "block/marker": "TODO" }, { "block/tags": [{ "db/id": 1 }] }]) {
      expect(inspectJournalSnapshot(emptyJournal({ "block/_page": [blank, { ...blank, "db/id": 4, ...extra }] }), today)).toBe("content");
    }
    expect(inspectJournalSnapshot(emptyJournal({ "block/_page": [{ ...blank, "user.property/mood": "ok" }] }), today)).toBe("properties");
  });

  it("fails closed on uninspected children and malformed query results", () => {
    expect(inspectJournalSnapshot(emptyJournal({ "block/_parent": [{ "db/id": 33 }] }), today)).toBe("unreadable");
    expect(inspectJournalSnapshot(emptyJournal({ "block/_page": null }), today)).toBe("unreadable");
    expect(inspectJournalSnapshot(emptyJournal({ "block/_refs": {} }), today)).toBe("unreadable");
    for (const result of [null, undefined, {}, [null], [[null]], [[{}, {}]]]) {
      expect(() => parseJournalRows(result)).toThrow();
    }
  });

  it("reports a separate reason for each skipped journal", () => {
    const pages = [emptyJournal(), emptyJournal({ "block/journal-day": 20261105 }),
      emptyJournal({ "user.property/mood": 0 }), emptyJournal({ "block/_refs": [{ "db/id": 99 }] }),
      emptyJournal({ "block/_page": [{ "db/id": 1, "block/title": "note" }] }),
      emptyJournal({ "block/_page": null })];
    expect(summarizeJournals(pages, today)).toMatchObject({
      journals: 6, candidates: [pages[0]],
      excluded: { today: 1, properties: 1, references: 1, content: 1, unreadable: 1 }
    });
  });
});
