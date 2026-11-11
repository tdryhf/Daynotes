export type View = "today" | "habits" | "tasks" | "ideas" | "dates" | "journal" | "settings";
export type Cadence = "week" | "month";

type BaseRecord = { id: string; updatedAt: number; deletedAt?: number; sample?: boolean };
export type Habit = BaseRecord & {
  type: "habit";
  name: string;
  goal: number;
  cadence: Cadence;
  minutes?: number;
};
export type CheckIn = BaseRecord & {
  type: "checkin";
  habitId: string;
  date: string;
  completed: boolean;
};
export type Task = BaseRecord & {
  type: "task";
  title: string;
  list: string;
  dueDate?: string;
  assignee?: string;
  completed: boolean;
};
export type Idea = BaseRecord & {
  type: "idea";
  title: string;
  category: string;
  note?: string;
};
export type FamilyDate = BaseRecord & {
  type: "date";
  title: string;
  date: string;
  time?: string;
  note?: string;
};
export type JournalEntry = BaseRecord & {
  type: "journal";
  title: string;
  body: string;
  date: string;
  tags: string[];
};
export type AppRecord = Habit | CheckIn | Task | Idea | FamilyDate | JournalEntry;

export type Draft = Omit<Habit, keyof BaseRecord | "type"> | Omit<CheckIn, keyof BaseRecord | "type"> | Omit<Task, keyof BaseRecord | "type"> | Omit<Idea, keyof BaseRecord | "type"> | Omit<FamilyDate, keyof BaseRecord | "type"> | Omit<JournalEntry, keyof BaseRecord | "type">;
