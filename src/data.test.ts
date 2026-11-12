import { describe, expect, it } from "vitest";
import { calculatePerformanceMetrics, calculateRecentProgress, dateKey, mergeRecords, monthCheckinCount } from "./data";
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

  it("keeps performance analytics inside the chosen dates and only plans through today", () => {
    const habits = [
      { id: "weekly", type: "habit" as const, name: "Read", goal: 7, cadence: "week" as const, updatedAt: 1 },
      { id: "monthly", type: "habit" as const, name: "Walk", goal: 30, cadence: "month" as const, updatedAt: 1 },
    ];
    const records: AppRecord[] = [
      ...Array.from({ length: 7 }, (_, index): AppRecord => ({ id: `weekly:${index}`, type: "checkin", habitId: "weekly", date: `2026-11-${String(index + 1).padStart(2, "0")}`, completed: true, updatedAt: index })),
      ...[1, 2, 3].map((day): AppRecord => ({ id: `monthly:${day}`, type: "checkin", habitId: "monthly", date: `2026-11-${String(day).padStart(2, "0")}`, completed: true, updatedAt: day })),
      { id: "future", type: "checkin", habitId: "weekly", date: "2026-11-10", completed: true, updatedAt: 19 },
      { id: "outside", type: "checkin", habitId: "weekly", date: "2026-11-15", completed: true, updatedAt: 20 },
      { id: "unchecked", type: "checkin", habitId: "monthly", date: "2026-11-04", completed: false, updatedAt: 21 },
      { id: "deleted", type: "checkin", habitId: "monthly", date: "2026-11-05", completed: true, updatedAt: 22, deletedAt: 23 },
    ];
    const metrics = calculatePerformanceMetrics(records, habits, "2026-11-01", "2026-11-14", "2026-11-07");
    expect(metrics).toMatchObject({ rangeDays: 14, elapsedDays: 7, completedCount: 10, plannedToDate: 14, completionPercent: 71, activeDays: 7, bestStreak: 7 });
    expect(metrics.habits.map(({ id, completed, planned }) => ({ id, completed, planned }))).toEqual([
      { id: "weekly", completed: 7, planned: 7 }, { id: "monthly", completed: 3, planned: 7 },
    ]);
    expect(metrics.weeks).toHaveLength(2);
    expect(metrics.weeks[0]).toMatchObject({ completed: 10, planned: 14, percent: 71, isFuture: false });
    expect(metrics.weeks[1]).toMatchObject({ completed: 0, isFuture: true });
  });

  it("returns an empty performance window when the dates are reversed", () => {
    const metrics = calculatePerformanceMetrics([], [], "2026-12-01", "2026-11-01", "2026-11-11");
    expect(metrics).toMatchObject({ rangeDays: 0, elapsedDays: 0, completedCount: 0, completionPercent: 0, activeDays: 0 });
    expect(metrics.weeks).toHaveLength(0);
  });
});
