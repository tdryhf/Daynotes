export type View = "today" | "habits" | "tasks" | "goals" | "trackers" | "ideas" | "dates" | "journal" | "reminders" | "settings";
export type Cadence = "week" | "month";
export type TaskCategory = "Homework" | "Extracurriculars" | "Physical development";

type BaseRecord = { id: string; updatedAt: number; deletedAt?: number; sample?: boolean };
export type Habit = BaseRecord & {
  type: "habit";
  name: string;
  goal: number;
  cadence: Cadence;
  minutes?: number;
  successCriteria?: string;
  nonNegotiable?: boolean;
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
  category?: TaskCategory;
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
export type JournalNote = BaseRecord & {
  type: "note";
  ownerType: "habit" | "task" | "goal" | "tracker";
  ownerId: string;
  sessionDate: string;
  rawText: string;
  polishedText?: string;
  summary?: string;
  keyIdeas?: string[];
};
export type Goal = BaseRecord & {
  type: "goal";
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  target: number;
  unit: string;
};
export type GoalProgress = BaseRecord & {
  type: "goalProgress";
  goalId: string;
  amount: number;
  date: string;
  note?: string;
};
export type CustomTracker = BaseRecord & {
  type: "tracker";
  name: string;
  description?: string;
  unit: string;
  target?: number;
  startDate?: string;
  endDate?: string;
};
export type TrackerEntry = BaseRecord & {
  type: "trackerEntry";
  trackerId: string;
  value: number;
  date: string;
  note?: string;
};
export type Reminder = BaseRecord & {
  type: "reminder";
  title: string;
  details?: string;
  scheduledAt: string;
  repeat?: "none" | "weekly";
  enabled: boolean;
  notifiedAt?: number;
  lastNotifiedAt?: number;
};
export type AppRecord = Habit | CheckIn | Task | Idea | FamilyDate | JournalEntry | JournalNote | Goal | GoalProgress | CustomTracker | TrackerEntry | Reminder;

export type Draft = Omit<Habit, keyof BaseRecord | "type"> | Omit<CheckIn, keyof BaseRecord | "type"> | Omit<Task, keyof BaseRecord | "type"> | Omit<Idea, keyof BaseRecord | "type"> | Omit<FamilyDate, keyof BaseRecord | "type"> | Omit<JournalEntry, keyof BaseRecord | "type">;
