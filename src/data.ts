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

export function isSampleData() {
  return localStorage.getItem(SAMPLE_KEY) !== "cleared";
}
