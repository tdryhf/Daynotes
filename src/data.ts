import type { AppRecord, CheckIn, FamilyDate, Habit, Task } from "./types";

export const STORAGE_KEY = "daybook.records.v1";
export const SAMPLE_KEY = "daybook.sample.v1";
const uid = () => crypto.randomUUID();
const timestamp = Date.now();
const today = new Date();
export const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const asDate = (offset: number) => {
  const day = new Date(today);
  day.setDate(day.getDate() + offset);
  return dateKey(day);
};

const workbookHabits = [
  ["Wake up at 6 AM", 20, 0],
  ["Drink 3 litres of water", 20, 0],
  ["Move your body", 16, 25],
  ["Stretch for a few minutes", 20, 10],
  ["Read 10 pages", 20, 15],
  ["Take a quiet moment", 20, 10],
  ["Study for one hour", 16, 60],
  ["Do your evening routine", 20, 10],
  ["Put your phone away", 20, 0],
  ["Track your spending", 20, 5],
] as const;

export function createSampleRecords(): AppRecord[] {
  const habits: Habit[] = workbookHabits.map(([name, goal, minutes]) => ({
    id: uid(), type: "habit", name, goal, cadence: "month", minutes: minutes || undefined, updatedAt: timestamp, sample: true,
  }));
  const checkins = habits.flatMap((habit, habitIndex) => {
    const sampleDays = habitIndex < 5 ? [ -3, -2, -1 ] : habitIndex < 8 ? [ -2 ] : [];
    return sampleDays.map((offset): AppRecord => ({
      id: `${habit.id}:${asDate(offset)}`, type: "checkin", habitId: habit.id, date: asDate(offset), completed: true, updatedAt: timestamp - Math.abs(offset) * 1000, sample: true,
    }));
  });
  const tasks: Task[] = [
    { id: uid(), type: "task", title: "Pick up groceries", list: "Home", dueDate: asDate(0), assignee: "", completed: false, updatedAt: timestamp, sample: true },
    { id: uid(), type: "task", title: "Water the balcony plants", list: "Home", dueDate: asDate(0), assignee: "", completed: false, updatedAt: timestamp, sample: true },
    { id: uid(), type: "task", title: "Plan Sunday lunch", list: "Family", dueDate: asDate(2), assignee: "", completed: false, updatedAt: timestamp, sample: true },
  ];
  const events: FamilyDate[] = [
    { id: uid(), type: "date", title: "Family lunch", date: asDate(3), time: "13:00", note: "", updatedAt: timestamp, sample: true },
  ];
  return [...habits, ...checkins, ...tasks, ...events];
}

export function loadLocalRecords(): AppRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSampleRecords();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AppRecord[] : createSampleRecords();
  } catch {
    return createSampleRecords();
  }
}

export function saveLocalRecords(records: AppRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.filter((record) => record.type !== "journal")));
}

export function mergeRecords(...sets: AppRecord[][]): AppRecord[] {
  const merged = new Map<string, AppRecord>();
  for (const record of sets.flat()) {
    const previous = merged.get(record.id);
    if (!previous || record.updatedAt > previous.updatedAt) merged.set(record.id, record);
  }
  return [...merged.values()].sort((a, b) => a.updatedAt - b.updatedAt);
}

export function liveRecords<T extends AppRecord["type"]>(records: AppRecord[], type: T) {
  return records.filter((record) => record.type === type && !record.deletedAt) as Extract<AppRecord, { type: T }> [];
}

export function monthCheckinCount(records: AppRecord[], habitId: string, date: Date) {
  const month = dateKey(date).slice(0, 7);
  return records.filter((item) => item.type === "checkin" && item.habitId === habitId && item.completed && item.date.startsWith(month) && !item.deletedAt).length;
}

export function calculateRecentProgress(records: AppRecord[], habits: Habit[], endDate: Date, dayCount = 7) {
  const activeHabits = habits.filter((habit) => !habit.deletedAt);
  const checkins = records.filter((record): record is CheckIn => record.type === "checkin" && record.completed && !record.deletedAt);
  const start = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 12);
  start.setDate(start.getDate() - Math.max(0, dayCount - 1));
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    const completed = checkins.filter((checkin) => checkin.date === key && activeHabits.some((habit) => habit.id === checkin.habitId)).length;
    return { date: key, label: date.toLocaleDateString(undefined, { weekday: "short" }), completed, rate: activeHabits.length ? Math.round((completed / activeHabits.length) * 100) : 0 };
  });
  const cadenceCheckins = (habit: Habit) => {
    let startDate: Date;
    if (habit.cadence === "week") {
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 12);
      startDate.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));
    } else {
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1, 12);
    }
    const from = dateKey(startDate);
    const through = dateKey(endDate);
    return checkins.filter((checkin) => checkin.habitId === habit.id && checkin.date >= from && checkin.date <= through).length;
  };
  const targets = activeHabits.map((habit) => {
    const completed = cadenceCheckins(habit);
    const goal = Math.max(0, habit.goal);
    return { id: habit.id, name: habit.name, completed, goal, cadence: habit.cadence, percent: goal ? Math.min(100, Math.round((completed / goal) * 100)) : 0 };
  });
  return { days, targets, total: days.reduce((sum, day) => sum + day.completed, 0), activeDays: days.filter((day) => day.completed > 0).length };
}

export function calculateConsistencyGrid(records: AppRecord[], habits: Habit[], endDate: Date, weeks = 12) {
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 12);
  const monday = new Date(end);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - (weeks - 1) * 7);
  const checkins = records.filter((record): record is CheckIn => record.type === "checkin" && record.completed && !record.deletedAt);
  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = dateKey(date);
    const completed = checkins.filter((item) => item.date === key && habits.some((habit) => habit.id === item.habitId)).length;
    const eligible = key <= dateKey(end) && habits.length > 0;
    const rate = eligible ? Math.round((completed / habits.length) * 100) : 0;
    return { date: key, completed, total: habits.length, rate, eligible };
  });
  const eligibleDays = cells.filter((cell) => cell.eligible);
  const completedCount = eligibleDays.reduce((sum, cell) => sum + cell.completed, 0);
  const possibleCount = eligibleDays.reduce((sum, cell) => sum + cell.total, 0);
  let currentStreak = 0;
  let streakIndex = eligibleDays.length - 1;
  if (streakIndex >= 0 && eligibleDays[streakIndex].date === dateKey(end) && eligibleDays[streakIndex].completed === 0) streakIndex -= 1;
  for (let index = streakIndex; index >= 0; index -= 1) {
    if (eligibleDays[index].completed > 0) currentStreak += 1;
    else break;
  }
  const habitConsistency = habits.map((habit) => {
    const count = checkins.filter((item) => item.habitId === habit.id && item.date >= cells[0]?.date && item.date <= dateKey(end)).length;
    const start = parseDateKey(cells[0]?.date ?? dateKey(end));
    const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
    const expected = habit.goal * (habit.cadence === "week" ? weeks : months);
    return { id: habit.id, name: habit.name, count, expected, percent: expected ? Math.min(100, Math.round((count / expected) * 100)) : 0 };
  }).sort((a, b) => b.percent - a.percent || b.count - a.count);
  const weekly = Array.from({ length: weeks }, (_, weekIndex) => {
    const week = cells.slice(weekIndex * 7, weekIndex * 7 + 7).filter((cell) => cell.eligible);
    const total = week.reduce((sum, cell) => sum + cell.completed, 0);
    const possible = week.reduce((sum, cell) => sum + cell.total, 0);
    return { label: week.length ? week[0].date.slice(5) : "", rate: possible ? Math.round((total / possible) * 100) : 0, total, possible };
  });
  return { cells, eligibleDays: eligibleDays.length, completedCount, possibleCount, percent: possibleCount ? Math.round((completedCount / possibleCount) * 100) : 0, activeDays: eligibleDays.filter((cell) => cell.completed > 0).length, currentStreak, habitConsistency, weekly };
}

export type PerformanceMetrics = {
  startDate: string;
  endDate: string;
  rangeDays: number;
  elapsedDays: number;
  completedCount: number;
  plannedToDate: number;
  plannedInRange: number;
  completionPercent: number;
  activeDays: number;
  activeDayPercent: number;
  averagePerDay: number;
  currentStreak: number;
  bestStreak: number;
  habits: Array<{ id: string; name: string; goal: number; cadence: Habit["cadence"]; completed: number; planned: number; percent: number }>;
  weeks: Array<{ startDate: string; endDate: string; label: string; completed: number; planned: number; percent: number; isFuture: boolean }>;
};

function inclusiveDays(start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return 0;
  return Math.floor((parseDateKey(end).getTime() - parseDateKey(start).getTime()) / 86_400_000) + 1;
}

function plannedHabitCount(habit: Habit, start: string, end: string) {
  if (!inclusiveDays(start, end)) return 0;
  if (habit.cadence === "week") return Math.max(0, habit.goal) * inclusiveDays(start, end) / 7;
  let planned = 0;
  let cursor = parseDateKey(start);
  const through = parseDateKey(end);
  while (cursor <= through) {
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12);
    const segmentEnd = monthEnd < through ? monthEnd : through;
    const daysInMonth = monthEnd.getDate();
    planned += Math.max(0, habit.goal) * (Math.floor((segmentEnd.getTime() - cursor.getTime()) / 86_400_000) + 1) / daysInMonth;
    cursor = new Date(segmentEnd.getFullYear(), segmentEnd.getMonth(), segmentEnd.getDate() + 1, 12);
  }
  return planned;
}

export function calculatePerformanceMetrics(records: AppRecord[], habits: Habit[], startDate: string, endDate: string, throughDate = dateKey(new Date())): PerformanceMetrics {
  const rangeDays = inclusiveDays(startDate, endDate);
  const validRange = rangeDays > 0;
  const actualEnd = validRange && endDate < throughDate ? endDate : throughDate;
  const elapsedDays = validRange && actualEnd >= startDate ? inclusiveDays(startDate, actualEnd) : 0;
  const habitIds = new Set(habits.map((habit) => habit.id));
  const checkins = records.filter((record): record is CheckIn => record.type === "checkin" && record.completed && !record.deletedAt && habitIds.has(record.habitId) && validRange && record.date >= startDate && record.date <= actualEnd);
  const uniqueCheckins = [...new Map(checkins.map((item) => [`${item.habitId}:${item.date}`, item])).values()];
  const countFor = (habit: Habit, from: string, to: string) => uniqueCheckins.filter((item) => item.habitId === habit.id && item.date >= from && item.date <= to).length;
  const habitMetrics = habits.map((habit) => {
    const completed = countFor(habit, startDate, endDate);
    const planned = validRange && elapsedDays ? plannedHabitCount(habit, startDate, actualEnd) : 0;
    return { id: habit.id, name: habit.name, goal: habit.goal, cadence: habit.cadence, completed, planned, percent: planned ? Math.round(completed / planned * 100) : 0 };
  }).sort((a, b) => b.percent - a.percent || b.completed - a.completed || a.name.localeCompare(b.name));
  const plannedToDate = validRange && elapsedDays ? habits.reduce((sum, habit) => sum + plannedHabitCount(habit, startDate, actualEnd), 0) : 0;
  const completedCount = uniqueCheckins.length;
  const activeDates = new Set(uniqueCheckins.filter((item) => item.date <= actualEnd).map((item) => item.date));
  const hasActivity = (date: string) => activeDates.has(date);
  let currentStreak = 0;
  if (validRange && elapsedDays) {
    let cursor = parseDateKey(actualEnd);
    if (!hasActivity(actualEnd)) cursor.setDate(cursor.getDate() - 1);
    while (dateKey(cursor) >= startDate && hasActivity(dateKey(cursor))) { currentStreak += 1; cursor.setDate(cursor.getDate() - 1); }
  }
  let bestStreak = 0, streak = 0;
  if (validRange && elapsedDays) {
    const cursor = parseDateKey(startDate);
    while (dateKey(cursor) <= actualEnd) {
      streak = hasActivity(dateKey(cursor)) ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const weeks = Array.from({ length: validRange ? Math.ceil(rangeDays / 7) : 0 }, (_, index) => {
    const from = parseDateKey(startDate);
    from.setDate(from.getDate() + index * 7);
    const to = parseDateKey(startDate);
    to.setDate(to.getDate() + Math.min(rangeDays - 1, index * 7 + 6));
    const weekStart = dateKey(from), weekEnd = dateKey(to);
    const elapsedEndForWeek = weekStart > throughDate ? weekStart : weekEnd < throughDate ? weekEnd : throughDate;
    const elapsedStartForWeek = weekStart;
    const plannedDays = elapsedEndForWeek >= elapsedStartForWeek ? habits.reduce((sum, habit) => sum + plannedHabitCount(habit, elapsedStartForWeek, elapsedEndForWeek), 0) : 0;
    const completed = uniqueCheckins.filter((item) => item.date >= weekStart && item.date <= weekEnd).length;
    return { startDate: weekStart, endDate: weekEnd, label: from.toLocaleDateString(undefined, { month: "short", day: "numeric" }), completed, planned: plannedDays, percent: plannedDays ? Math.round(completed / plannedDays * 100) : 0, isFuture: weekStart > throughDate };
  });
  const plannedInRange = validRange ? habits.reduce((sum, habit) => sum + plannedHabitCount(habit, startDate, endDate), 0) : 0;
  return {
    startDate, endDate, rangeDays, elapsedDays, completedCount,
    plannedToDate, plannedInRange, completionPercent: plannedToDate ? Math.min(100, Math.round(completedCount / plannedToDate * 100)) : 0,
    activeDays: activeDates.size, activeDayPercent: elapsedDays ? Math.round(activeDates.size / elapsedDays * 100) : 0,
    averagePerDay: elapsedDays ? completedCount / elapsedDays : 0, currentStreak, bestStreak,
    habits: habitMetrics, weeks,
  };
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function isSampleData() {
  return localStorage.getItem(SAMPLE_KEY) !== "cleared";
}
