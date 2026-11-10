import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_TO_SHORT_NAME } from "../lib/members";

const script = readFileSync(new URL("./ReviewJournal.gs", import.meta.url), "utf8");
const headers = ["No.", "アルバム名", "Kohei", "UID", "Kaede", "Meri", "アーティスト", "Kwisoo", "Eddie", "Hanawa"];
const row = ["12", "Album", "7 old", "abc12345", "", "", "Artist", "", "", ""];

function fixture(headerRow = headers) {
  const properties = new Map<string, string>();
  const locked = { value: false };
  const lock = {
    waitLock: vi.fn(() => { locked.value = true; }),
    releaseLock: vi.fn(() => { locked.value = false; }),
  };
  const spreadsheetId = "test-spreadsheet";
  const sheets = new Map<string, FakeSheet>();
  class FakeSheet {
    maxRows = 1000;
    constructor(public name: string, public rows: string[][]) {}
    getName() { return this.name; }
    getParent() { return spreadsheet; }
    getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
    getLastRow() { return this.rows.length; }
    getMaxRows() { return this.maxRows; }
    insertRowsAfter(after: number, count: number) { expect(after).toBe(this.maxRows); this.maxRows += count; }
    setFrozenRows = vi.fn();
    getRange(startRow: number, column: number, numRows = 1, numColumns = 1) {
      const range = {
        getSheet: () => this,
        getRow: () => startRow,
        getLastRow: () => startRow + numRows - 1,
        getColumn: () => column,
        getLastColumn: () => column + numColumns - 1,
        getNumRows: () => numRows,
        getNumColumns: () => numColumns,
        getDisplayValues: () => Array.from({ length: numRows }, (_, r) =>
          Array.from({ length: numColumns }, (_, c) => this.rows[startRow + r - 1]?.[column + c - 1] ?? "")),
        setValues: (values: string[][]) => {
          expect(locked.value).toBe(true);
          if (this.name === "Release Master") throw new Error("Must never write source reviews");
          if (startRow + numRows - 1 > this.maxRows) throw new Error("Exceeds grid rows");
          values.forEach((r, i) => { this.rows[startRow + i - 1] = [...r]; });
        },
      };
      return range;
    }
  }
  const spreadsheet = {
    getId: () => spreadsheetId,
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: vi.fn((name: string) => { const sheet = new FakeSheet(name, []); sheets.set(name, sheet); return sheet; }),
    toast: vi.fn(),
  };
  const source = new FakeSheet("Release Master", [[...headerRow], [...row]]);
  sheets.set(source.name, source);
  const triggers: ReturnType<typeof trigger>[] = [];
  function trigger(id = "trigger-1", handler = "recordRyuryuReviewEdit") {
    return {
      getHandlerFunction: () => handler,
      getTriggerSourceId: () => spreadsheetId,
      getEventType: () => "ON_EDIT",
      getUniqueId: () => id,
    };
  }
  const createTrigger = vi.fn(() => { const t = trigger(); triggers.push(t); return t; });
  const builder = { forSpreadsheet: vi.fn(() => builder), onEdit: vi.fn(() => builder), create: createTrigger };
  const context = createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: vi.fn() },
    LockService: { getDocumentLock: () => lock },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (key: string) => properties.get(key) ?? null,
      setProperty: (key: string, value: string) => properties.set(key, value),
    }) },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: () => builder, EventType: { ON_EDIT: "ON_EDIT" } },
    Utilities: { getUuid: () => "event-uuid" },
  });
  runInContext(script, context);
  const install = () => runInContext("installRyuryuReviewJournal()", context);
  const edit = (options: { row?: number; column?: number; rows?: number; columns?: number; value?: string | number; oldValue?: string; triggerUid?: string } = {}) => {
    context.event = {
      source: spreadsheet, triggerUid: "trigger-1",
      range: source.getRange(options.row ?? 2, options.column ?? 3, options.rows ?? 1, options.columns ?? 1),
      ...Object.fromEntries(Object.entries(options).filter(([key]) => ["value", "oldValue", "triggerUid"].includes(key))),
    };
    return runInContext("recordRyuryuReviewEdit(event)", context);
  };
  const journal = () => sheets.get("_review_edit_log")!;
  const entries = () => journal().rows.slice(1).map(r => Object.fromEntries(journal().rows[0].map((key, i) => [key, r[i]])));
  return { source, sheets, spreadsheet, properties, install, edit, journal, entries, triggers, trigger, createTrigger, lock, context };
}

describe("deployable Apps Script review journal", () => {
  it("only creates an empty journal and one trigger; keeps all source reviews unchanged", () => {
    const f = fixture();
    const before = JSON.stringify(f.source.rows);
    f.install();
    expect(f.journal().rows).toHaveLength(1);
    expect(f.createTrigger).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.source.rows)).toBe(before);
    expect(f.lock.releaseLock).toHaveBeenCalledOnce();
  });
  it("reads the production headers (Title / Artist) as well as the Japanese ones", () => {
    const productionHeaders = ["No.", "Title", "Kohei", "UID", "Kaede", "Meri", "Artist", "Kwisoo", "Eddie", "Hanawa"];
    const f = fixture(productionHeaders);
    f.install();
    f.source.rows[1][2] = "8 new";
    f.edit({ value: "8 new", oldValue: "7 old" });
    expect(f.entries()[0]).toMatchObject({ albumTitleJson: '"Album"', artistNameJson: '"Artist"', valueJson: '"8 new"', status: "recorded" });
  });

  it("names both accepted headers when the title column is missing", () => {
    const f = fixture(["No.", "Kohei", "UID", "Kaede", "Meri", "Artist", "Kwisoo", "Eddie", "Hanawa"]);
    expect(() => f.install()).toThrow("Title または アルバム名");
  });

  it("keeps the member mapping consistent with the app, including Kaede", () => {
    const f = fixture();
    expect(JSON.parse(runInContext("JSON.stringify(RYURYU_REVIEW_JOURNAL.members)", f.context)))
      .toEqual(Object.fromEntries(Object.entries(EMAIL_TO_SHORT_NAME).map(([email, name]) => [name, email])));
  });
  it("reuses its own trigger and leaves unrelated triggers intact", () => {
    const f = fixture();
    f.triggers.push(f.trigger("other", "existingHandler"));
    f.install(); f.install();
    expect(f.createTrigger).toHaveBeenCalledOnce();
    expect(f.triggers).toHaveLength(2);
  });
  it.each([
    { headerRow: headers.filter(h => h !== "UID") },
    { headerRow: [...headers, "Kohei"] },
  ])("refuses ambiguous or incomplete source headers", ({ headerRow }) => {
    const f = fixture(headerRow);
    expect(() => f.install()).toThrow();
    expect(f.spreadsheet.insertSheet).not.toHaveBeenCalled();
    expect(f.createTrigger).not.toHaveBeenCalled();
    expect(f.lock.releaseLock).toHaveBeenCalledOnce();
  });
  it("does not overwrite a pre-existing sheet with a different schema", () => {
    const f = fixture();
    const journal = f.spreadsheet.insertSheet("_review_edit_log");
    journal.rows = [["Existing important data"]];
    expect(() => f.install()).toThrow("列が想定と異なります");
    expect(journal.rows).toEqual([["Existing important data"]]);
    expect(f.createTrigger).not.toHaveBeenCalled();
  });
  it("refuses a marker from another administrator or a copied spreadsheet", () => {
    const f = fixture();
    f.properties.set("RYURYU_REVIEW_JOURNAL_INSTALLATION", "other-spreadsheet:trigger");
    expect(() => f.install()).toThrow("別の管理者またはコピー元");
    expect(f.createTrigger).not.toHaveBeenCalled();
  });
  it("refuses duplicate triggers instead of silently multiplying recorded events", () => {
    const f = fixture();
    f.triggers.push(f.trigger(), f.trigger("trigger-2"));
    expect(() => f.install()).toThrow("重複");
    expect(f.createTrigger).not.toHaveBeenCalled();
  });
  it.each(Object.entries(EMAIL_TO_SHORT_NAME))("records %s by header name after column reordering", (email, name) => {
    const f = fixture(); f.install();
    const column = headers.indexOf(name);
    f.source.rows[1][column] = "8 new review";
    f.edit({ column: column + 1, value: "8 new review", oldValue: "7 old" });
    const entry = f.entries()[0];
    expect(entry).toMatchObject({ albumUid: "abc12345", memberEmail: email, valueJson: '"8 new review"',
      previousValueJson: '"7 old"', captureKind: "single_event", status: "recorded" });
    expect(entry.recordedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(f.lock.releaseLock).toHaveBeenCalledTimes(2);
  });
  it("preserves zero scores and empty old values without truthiness conversion", () => {
    const f = fixture(); f.install(); f.source.rows[1][2] = "0";
    f.edit({ value: 0 });
    expect(f.entries()[0]).toMatchObject({ valueJson: '"0"', previousValueJson: "null", status: "recorded" });
  });
  it("captures an explicit clear instead of dropping empty reviews", () => {
    const f = fixture(); f.install(); f.source.rows[1][2] = "";
    f.edit({ oldValue: "7 old" });
    expect(f.entries()[0]).toMatchObject({ valueJson: '""', previousValueJson: '"7 old"', status: "recorded" });
  });
  it("preserves comment-only edits as text", () => {
    const f = fixture(); f.install(); f.source.rows[1][2] = "コメントのみ";
    f.edit({ value: "コメントのみ" });
    expect(JSON.parse(f.entries()[0].valueJson)).toBe("コメントのみ");
  });
  it("stores event and current values separately when a later change overtook capture", () => {
    const f = fixture(); f.install(); f.source.rows[1][2] = "9 newer";
    f.edit({ value: "8 earlier", oldValue: "7 old" });
    expect(f.entries()[0]).toMatchObject({ valueJson: '"8 earlier"', observedValueJson: '"9 newer"',
      status: "needs_review:value_changed_before_capture" });
  });
  it("does not treat a missing event value as an authoritative deletion", () => {
    const f = fixture(); f.install(); f.edit();
    expect(f.entries()[0].status).toBe("needs_review:event_value_missing");
  });
  it("records every affected member in pasted ranges as snapshots requiring review", () => {
    const f = fixture(); f.install(); f.source.rows.push([...row]); f.source.rows[2][3] = "xyz67890";
    f.edit({ column: 2, rows: 2, columns: 5 }); // title, Kohei, UID, Kaede, Meri
    expect(f.entries()).toHaveLength(6);
    expect(new Set(f.entries().map(e => e.memberEmail)).size).toBe(3);
    expect(f.entries().every(e => e.captureKind === "range_snapshot" && e.status === "needs_review:range_snapshot")).toBe(true);
    expect(f.entries().every(e => e.previousValueJson === "null")).toBe(true);
  });
  it.each(["", "invalid-uid", "=formula"])("keeps an unidentifiable review for checking (%s)", uid => {
    const f = fixture(); f.install(); f.source.rows[1][3] = uid;
    f.edit({ value: "7 old" });
    expect(f.entries()[0]).toMatchObject({ albumUid: "", status: "needs_review:invalid_uid", albumTitleJson: '"Album"' });
  });
  it("does not silently associate a duplicate UID with one album", () => {
    const f = fixture(); f.install(); f.source.rows.push([...row]);
    f.edit({ value: "7 old" });
    expect(f.entries()[0].status).toBe("needs_review:duplicate_uid");
  });
  it("JSON-encodes user strings so formulas cannot execute in the journal", () => {
    const f = fixture(); f.install(); f.source.rows[1][2] = '=HYPERLINK("https://example.com")';
    f.source.rows[1][1] = "=1+1";
    f.edit({ value: f.source.rows[1][2], oldValue: "=2+2" });
    const entry = f.entries()[0];
    expect(entry.status).toBe("needs_review:formula");
    expect([entry.valueJson, entry.previousValueJson, entry.observedValueJson, entry.albumTitleJson]
      .every(v => v.startsWith('"'))).toBe(true);
    expect(JSON.parse(entry.valueJson)).toBe(f.source.rows[1][2]);
  });
  it("skips non-review edits and header-only edits", () => {
    const f = fixture(); f.install(); f.edit({ column: 2, value: "new title" }); f.edit({ row: 1, value: "Kohei" });
    expect(f.entries()).toHaveLength(0);
  });
  it("refuses manual execution and unregistered triggers", () => {
    const f = fixture(); f.install();
    expect(() => runInContext("recordRyuryuReviewEdit()", f.context)).toThrow("編集トリガーからのみ");
    expect(() => f.edit({ triggerUid: "wrong" })).toThrow("登録したトリガー");
    expect(f.entries()).toHaveLength(0);
  });
  it("bounds large edits before any partial journal write", () => {
    const f = fixture(); f.install();
    expect(() => f.edit({ rows: 1001 })).toThrow("一括編集が大きすぎます");
    expect(f.entries()).toHaveLength(0);
  });
  it("extends the journal grid before appending beyond its initial row limit", () => {
    const f = fixture(); f.install();
    while (f.journal().rows.length < 1000) f.journal().rows.push([...f.journal().rows[0]]);
    f.edit({ value: "7 old" });
    expect(f.journal().getMaxRows()).toBe(1001);
    expect(f.journal().rows[1000][1]).toBe("event-uuid:C2");
  });
  it("leaves source data intact and releases the lock when journal append fails", () => {
    const f = fixture(); f.install();
    const before = JSON.stringify(f.source.rows);
    const getRange = f.journal().getRange.bind(f.journal());
    vi.spyOn(f.journal(), "getRange").mockImplementation((...args) => {
      const range = getRange(...args);
      if (args[0] > 1) range.setValues = () => { throw new Error("Storage unavailable"); };
      return range;
    });
    expect(() => f.edit({ value: "7 old" })).toThrow("Storage unavailable");
    expect(JSON.stringify(f.source.rows)).toBe(before);
    expect(f.lock.releaseLock).toHaveBeenCalledTimes(2);
  });
});
