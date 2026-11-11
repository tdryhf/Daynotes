import { describe, expect, it } from "vitest";
import { calculateRecentProgress, dateKey, mergeRecords, monthCheckinCount } from "./data";
import type { AppRecord } from "./types";

describe("daybook record helpers", () => {
  it("formats calendar dates in local time", () => {
    expect(dateKey(new Date(2026, 10, 11, 23))).toBe("2026-11-11");
  });

  it("keeps the latest edit when records merge", () => {
    const older: AppRecord = { id: "habit-1", type: "habit", name: "Read", goal: 12, cadence: "month", updatedAt: 10 };
    const newer: AppRecord = { ...older, name: "Read a little", updatedAt: 20 };
    expect(mergeRecords([older], [newer])).toEqual([newer]);
  });

  it("counts completed check-ins in the selected local month", () => {
    const records: AppRecord[] = [
      { id: "h:1", type: "checkin", habitId: "h", date: "2026-11-01", completed: true, updatedAt: 1 },
      { id: "h:2", type: "checkin", habitId: "h", date: "2026-11-02", completed: false, updatedAt: 2 },
      { id: "h:3", type: "checkin", habitId: "h", date: "2026-10-30", completed: true, updatedAt: 3 },
      { id: "h:4", type: "checkin", habitId: "h", date: "2026-11-03", completed: true, updatedAt: 4, deletedAt: 5 },
    ];
    expect(monthCheckinCount(records, "h", new Date(2026, 10, 11))).toBe(1);
  });

  it("builds a seven-day trend and cadence goal progress from live check-ins", () => {
    const habits: AppRecord[] = [
      { id: "h1", type: "habit", name: "Read", goal: 5, cadence: "week", updatedAt: 1 },
      { id: "h2", type: "habit", name: "Walk", goal: 10, cadence: "month", updatedAt: 1 },
    ];
    const records: AppRecord[] = [
      { id: "h1:1", type: "checkin", habitId: "h1", date: "2026-11-10", completed: true, updatedAt: 1 },
      { id: "h2:1", type: "checkin", habitId: "h2", date: "2026-11-10", completed: true, updatedAt: 1 },
      { id: "h2:2", type: "checkin", habitId: "h2", date: "2026-11-11", completed: false, updatedAt: 1 },
      { id: "h1:3", type: "checkin", habitId: "h1", date: "2026-11-11", completed: true, updatedAt: 1, deletedAt: 2 },
    ];
    const progress = calculateRecentProgress(records, habits as Extract<AppRecord, { type: "habit" }>[], new Date(2026, 10, 11, 12));
    expect(progress.days).toHaveLength(7);
    expect(progress.days.at(-2)).toMatchObject({ date: "2026-11-10", completed: 2, rate: 100 });
    expect(progress.total).toBe(2);
    expect(progress.activeDays).toBe(1);
    expect(progress.targets.map(({ completed, percent }) => ({ completed, percent }))).toEqual([{ completed: 1, percent: 20 }, { completed: 1, percent: 10 }]);
  });
});
