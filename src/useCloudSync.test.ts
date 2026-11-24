import { describe, expect, it } from "vitest";
import type { AppRecord } from "./types";
import { applyRemote, pendingRecords, sameRecords } from "./useCloudSync";

const task = (id: string, updatedAt: number, extra: Partial<AppRecord> = {}) => ({ id, type: "task", title: id, list: "Home", dueDate: "2026-11-25", assignee: "", completed: false, updatedAt, ...extra }) as AppRecord;

describe("record sync helpers", () => {
  it("treats a record as unsent until the cloud has confirmed that version", () => {
    const records = [task("a", 10), task("b", 20), task("c", 30)];
    const pending = pendingRecords(records, { a: 10, b: 15 });
    expect(pending.map((record) => record.id)).toEqual(["b", "c"]);
  });

  it("never sends legacy journal entries to the shared store", () => {
    const journal = { id: "j", type: "journal", title: "t", body: "b", date: "2026-11-24", updatedAt: 5 } as AppRecord;
    expect(pendingRecords([journal], {})).toEqual([]);
  });

  it("compares record lists by identity regardless of order", () => {
    const a = task("a", 1), b = task("b", 2);
    expect(sameRecords([a, b], [b, a])).toBe(true);
    expect(sameRecords([a, b], [a, task("b", 2)])).toBe(false);
    expect(sameRecords([a], [a, b])).toBe(false);
  });

  it("keeps the newest copy of each record when applying cloud changes", () => {
    const local = [task("a", 10, { title: "local newer" } as Partial<AppRecord>), task("b", 10)];
    const remote = [task("a", 5, { title: "remote older" } as Partial<AppRecord>), task("b", 20, { title: "remote newer" } as Partial<AppRecord>), task("c", 1)];
    const merged = applyRemote(local, remote, false);
    const byId = Object.fromEntries(merged.map((record) => [record.id, record]));
    expect((byId.a as { title: string }).title).toBe("local newer");
    expect((byId.b as { title: string }).title).toBe("remote newer");
    expect(byId.c).toBeDefined();
  });

  it("returns the same array when nothing changed", () => {
    const local = [task("a", 10)];
    expect(applyRemote(local, [task("a", 10)], false)).toBe(local);
    expect(applyRemote(local, [], true)).toBe(local);
  });

  it("drops this device's untouched starter samples when joining a store that already has records", () => {
    const local = [task("sample-1", 1, { sample: true }), task("mine", 2)];
    const merged = applyRemote(local, [task("family", 3)], true);
    expect(merged.map((record) => record.id).sort()).toEqual(["family", "mine"]);
  });
});
