import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Bell, Target, TrendingUp,
  Cloud, CloudOff, Download, FileUp, Flame, Heart, Home, Lightbulb, ListChecks, Menu,
  NotebookPen, Plus, Settings, Share2, Sparkles, Timer, Trash2, X,
} from "lucide-react";
import { dateKey, habitStreak, hasSampleRecords, isAppRecord, liveRecords, loadLocalRecords, mergeRecords, monthCheckinCount, saveLocalRecords, STORAGE_KEY } from "./data";
import { cloudConfigured } from "./sync";
import { sameRecords, useCloudSync, type SyncState } from "./useCloudSync";
import { JournalPage } from "./journal";
import type { AppRecord, CustomTracker, FamilyDate, Goal, GoalDraft, Habit, Idea, JournalNote, PerformanceReflection, Task, TaskCategory, View } from "./types";
import { refineNote, type AssistantToolCall } from "./ai";
import { editTime } from "./clock";
import { AssistantDialog, ConsistencyVisualization, GoalCoachDialog, GoalsPage, HabitDetailsDialog, RemindersPage, TaskDetailsDialog, TaskTitleButton, TrackerDetailsDialog, TrackersPage } from "./features";
import { InsightsPage } from "./insights";

const navigation: { id: View; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home },
  { id: "insights", label: "Insights", icon: TrendingUp },
  { id: "habits", label: "Habits", icon: Check },
  { id: "tasks", label: "To-dos", icon: ListChecks },
  { id: "goals", label: "Goals", icon: Target },
  { id: "trackers", label: "Trackers", icon: TrendingUp },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "dates", label: "Dates", icon: CalendarDays },
  { id: "journal", label: "Journal", icon: NotebookPen },
  { id: "reminders", label: "Reminders", icon: Bell },
];
const categories = ["All ideas", "Places", "Meals", "Things to try", "Gifts"];
const taskCategories: TaskCategory[] = ["Homework", "Extracurriculars", "Physical development"];
const id = () => crypto.randomUUID();
const localDate = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
const todayKey = () => dateKey(new Date());
const parseDate = (value: string) => new Date(`${value}T12:00:00`);
const dateLabel = (value: string, options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) => parseDate(value).toLocaleDateString(undefined, options);
const timeLabel = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return value;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};
const uniqueFamilyDates = (events: FamilyDate[]) => {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = JSON.stringify([event.date, event.title.trim().toLowerCase(), event.time ?? "", event.note?.trim().toLowerCase() ?? ""]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const monthLabel = (value: Date) => value.toLocaleDateString(undefined, { month: "long", year: "numeric" });
const weekDates = (date: Date) => {
  const monday = localDate(date);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(monday);
    next.setDate(next.getDate() + index);
    return next;
  });
};
const monthDates = (date: Date) => Array.from({ length: new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() }, (_, index) => new Date(date.getFullYear(), date.getMonth(), index + 1, 12));
const countCadence = (records: AppRecord[], habit: Habit, date: Date) => {
  const keys = habit.cadence === "month" ? monthDates(date).map(dateKey) : weekDates(date).map(dateKey);
  return records.filter((record) => record.type === "checkin" && record.habitId === habit.id && record.completed && keys.includes(record.date) && !record.deletedAt).length;
};

/** A small flame with the habit's current run of days in a row. Hidden until there is a run to show. */
function StreakBadge({ records, habit }: { records: AppRecord[]; habit: Habit }) {
  const days = habitStreak(records, habit.id);
  if (!days) return null;
  const label = `${days}-day streak`;
  return <span className="streak-badge" title={`${days} day${days === 1 ? "" : "s"} in a row`}><Flame size={11} aria-hidden="true" /><span aria-hidden="true">{days}</span><span className="visually-hidden">{label}</span></span>;
}

type DialogKind = "habit" | "task" | "goal" | "tracker" | "reminder" | "idea" | "date" | "journal" | null;

function App() {
  const [records, setRecords] = useState<AppRecord[]>(() => loadLocalRecords(!cloudConfigured));
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.slice(1);
    return navigation.some((item) => item.id === hash) || hash === "settings" ? hash as View : "today";
  });
  const { status: syncState, lastSyncedAt, pendingCount, syncNow } = useCloudSync(records, setRecords);
  const sampleData = hasSampleRecords(records);
  const [journalOpened, setJournalOpened] = useState(view === "journal");
  const [storageFull, setStorageFull] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [detailHabit, setDetailHabit] = useState<Habit | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailTracker, setDetailTracker] = useState<CustomTracker | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [goalCoachOpen, setGoalCoachOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [timerHabit, setTimerHabit] = useState<Habit | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(20);
  const [month, setMonth] = useState(() => new Date());
  const [matrixMode, setMatrixMode] = useState<"week" | "month">("week");
  const [taskFilter, setTaskFilter] = useState("Today");
  const [taskCategoryFilter, setTaskCategoryFilter] = useState("All categories");
  const [ideaFilter, setIdeaFilter] = useState("All ideas");
  const [toast, setToast] = useState("");
  const [celebrateAllHabits, setCelebrateAllHabits] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(() => typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const deliveringReminders = useRef(new Set<string>());

  const habits = liveRecords(records, "habit");
  const tasks = liveRecords(records, "task");
  const ideas = liveRecords(records, "idea");
  const dates = liveRecords(records, "date").sort((a, b) => a.date.localeCompare(b.date));
  const journal = liveRecords(records, "journal").sort((a, b) => b.date.localeCompare(a.date));
  const notes = liveRecords(records, "note");
  const goals = liveRecords(records, "goal");
  const goalProgress = liveRecords(records, "goalProgress");
  const trackers = liveRecords(records, "tracker");
  const trackerEntries = liveRecords(records, "trackerEntry");
  const reminders = liveRecords(records, "reminder");
  const reflections = liveRecords(records, "reflection");
  const completedToday = habits.filter((habit) => records.some((record) => record.type === "checkin" && record.habitId === habit.id && record.date === todayKey() && record.completed && !record.deletedAt)).length;
  const dueToday = tasks.filter((task) => !task.completed && task.dueDate === todayKey());

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMobileMenuOpen(false);
    };
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileMenuOpen(false);
      document.querySelector<HTMLButtonElement>(".menu-toggle")?.focus();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    setStorageFull(!saveLocalRecords(records));
  }, [records]);

  useEffect(() => {
    // Another tab of this app on the same device saved records: fold them in.
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as unknown;
        if (!Array.isArray(parsed)) return;
        const incoming = parsed.filter(isAppRecord);
        setRecords((current) => { const merged = mergeRecords(current, incoming); return sameRecords(current, merged) ? current : merged; });
      } catch { /* keep the current copy if another tab wrote invalid data */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!timerRunning) return;
    const interval = window.setInterval(() => {
      setTimerSeconds((seconds) => {
        if (seconds <= 1) { setTimerRunning(false); setToast("Your focus time is up."); return 0; }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timerRunning]);

  useEffect(() => {
    if (notificationPermission !== "granted") return;
    const deliverDueReminders = () => {
      const now = Date.now();
      for (const reminder of reminders) {
        const scheduled = Date.parse(reminder.scheduledAt);
        if (!reminder.enabled || reminder.notifiedAt || Number.isNaN(scheduled) || scheduled > now || deliveringReminders.current.has(reminder.id)) continue;
        deliveringReminders.current.add(reminder.id);
        void (async () => {
          try {
            const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
            if (registration?.showNotification) await registration.showNotification(reminder.title, { body: reminder.details || "A reminder from Daybook.", icon: "/icon.svg", tag: reminder.id });
            else new Notification(reminder.title, { body: reminder.details || "A reminder from Daybook.", tag: reminder.id });
          } catch { setToast(`Reminder: ${reminder.title}`); }
          const deliveredAt = editTime();
          if (reminder.repeat === "weekly") {
            const next = new Date(reminder.scheduledAt);
            next.setDate(next.getDate() + 7);
            saveRecord({ ...reminder, scheduledAt: next.toISOString(), lastNotifiedAt: deliveredAt, notifiedAt: undefined, updatedAt: deliveredAt });
          } else saveRecord({ ...reminder, notifiedAt: deliveredAt, updatedAt: deliveredAt });
          setToast(`Reminder: ${reminder.title}`);
          deliveringReminders.current.delete(reminder.id);
        })();
      }
    };
    deliverDueReminders();
    const timers = reminders.filter((reminder) => reminder.enabled && !reminder.notifiedAt && !Number.isNaN(Date.parse(reminder.scheduledAt))).map((reminder) => window.setTimeout(deliverDueReminders, Math.max(0, Date.parse(reminder.scheduledAt) - Date.now())));
    const interval = window.setInterval(deliverDueReminders, 15_000);
    window.addEventListener("focus", deliverDueReminders);
    return () => { window.clearInterval(interval); timers.forEach(window.clearTimeout); window.removeEventListener("focus", deliverDueReminders); };
  }, [reminders, notificationPermission]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const chooseView = (nextView: View) => {
    setView(nextView);
    if (nextView === "journal") setJournalOpened(true);
    window.location.hash = nextView;
    setMobileMenuOpen(false);
  };

  const saveRecord = (record: AppRecord) => {
    setRecords((current) => [...current.filter((item) => item.id !== record.id), record]);
  };

  const saveNote = async (ownerType: JournalNote["ownerType"], ownerId: string, ownerName: string, rawText: string, sessionDate: string) => {
    let refined: Awaited<ReturnType<typeof refineNote>> | undefined;
    try { refined = await refineNote(rawText, `${ownerType}: ${ownerName}`); }
    catch { /* Keep the hurried original if AI is not configured or unreachable. */ }
    const note: JournalNote = { id: id(), type: "note", ownerType, ownerId, sessionDate, rawText, polishedText: refined?.polishedText, summary: refined?.summary, keyIdeas: refined?.keyIdeas, updatedAt: editTime() };
    saveRecord(note);
    setToast(refined ? "Note polished and saved." : "Note saved. Add GROQ_API_KEY to enable AI polishing.");
  };

  const addRecord = (type: Exclude<DialogKind, null>, fields: Record<string, unknown>) => {
    const recordId = id();
    const now = editTime();
    const supportingHabitIds = type === "goal" && Array.isArray(fields.supportingHabitIds) ? fields.supportingHabitIds as string[] : [];
    const supportingTaskIds = type === "goal" && Array.isArray(fields.supportingTaskIds) ? fields.supportingTaskIds as string[] : [];
    const storedFields = { ...fields };
    delete storedFields.supportingHabitIds;
    delete storedFields.supportingTaskIds;
    const record = { ...storedFields, id: recordId, type, updatedAt: now } as AppRecord;
    if (type === "habit") setCelebrateAllHabits(false);
    if (type === "goal") {
      setRecords((current) => [...current.map((item) => {
        if (item.type === "habit" && supportingHabitIds.includes(item.id)) return { ...item, goalIds: [...new Set([...(item.goalIds ?? []), recordId])], updatedAt: now };
        if (item.type === "task" && supportingTaskIds.includes(item.id)) return { ...item, goalIds: [...new Set([...(item.goalIds ?? []), recordId])], updatedAt: now };
        return item;
      }), record]);
    } else saveRecord(record);
    setDialog(null);
    setGoalDraft(null);
    setToast(type === "habit" ? "Habit added." : type === "task" ? "To-do added." : type === "goal" ? "Goal set." : type === "tracker" ? "Tracker ready." : type === "reminder" ? "Reminder saved." : type === "idea" ? "Idea saved." : type === "date" ? "Date added." : "Memory saved.");
  };

  const saveHabit = (fields: Record<string, unknown>) => {
    if (editingHabit) {
      saveRecord({ ...editingHabit, ...fields, updatedAt: editTime(), sample: false } as Habit);
      setEditingHabit(null);
      setDialog(null);
      setDetailHabit(null);
      setToast("Habit updated.");
      return;
    }
    addRecord("habit", fields);
  };

  const editHabit = (habit: Habit) => {
    setDetailHabit(null);
    setEditingHabit(habit);
    setDialog("habit");
  };

  const deleteHabit = (habit: Habit) => {
    setCelebrateAllHabits(false);
    const deletedAt = editTime();
    setRecords((current) => current.map((record) => record.id === habit.id || (record.type === "checkin" && record.habitId === habit.id) || (record.type === "note" && record.ownerType === "habit" && record.ownerId === habit.id) ? { ...record, deletedAt, updatedAt: deletedAt, sample: false } as AppRecord : record));
    setDetailHabit(null);
    setToast("Habit deleted.");
  };

  const toggleCheckin = (habit: Habit, date: Date) => {
    const key = dateKey(date);
    const found = records.find((record) => record.type === "checkin" && record.habitId === habit.id && record.date === key && !record.deletedAt);
    const record = found && found.type === "checkin"
      ? { ...found, completed: !found.completed, updatedAt: editTime(), sample: false }
      : { id: `${habit.id}:${key}`, type: "checkin" as const, habitId: habit.id, date: key, completed: true, updatedAt: editTime() };
    if (key === todayKey() && !record.completed && completedToday === habits.length) setCelebrateAllHabits(false);
    if (key === todayKey() && record.completed && completedToday + 1 >= habits.length && habits.length > 0) setCelebrateAllHabits(true);
    saveRecord(record);
  };

  const savePerformanceReflection = (startDate: string, endDate: string, text: string) => {
    const existing = reflections.find((item) => item.startDate === startDate && item.endDate === endDate);
    const now = editTime();
    const record: PerformanceReflection = existing
      ? { ...existing, text, updatedAt: now, sample: false }
      : { id: id(), type: "reflection", startDate, endDate, text, updatedAt: now };
    saveRecord(record);
    setToast(existing ? "Reflection updated." : "Reflection saved to your daybook.");
  };

  const toggleTask = (task: Task) => { const completed = !task.completed; saveRecord({ ...task, completed, completedAt: completed ? todayKey() : undefined, updatedAt: editTime(), sample: false }); };
  const logGoalProgress = (goal: Goal, amount: number, date: string, note?: string) => saveRecord({ id: id(), type: "goalProgress", goalId: goal.id, amount, date, note: note || undefined, updatedAt: editTime() });
  const logTrackerEntry = (tracker: CustomTracker, value: number, date: string, note?: string) => saveRecord({ id: id(), type: "trackerEntry", trackerId: tracker.id, value, date, note: note || undefined, updatedAt: editTime() });
  const deleteTask = (task: Task) => {
    const deletedAt = editTime();
    setRecords((current) => current.map((record) => record.id === task.id || (record.type === "note" && record.ownerType === "task" && record.ownerId === task.id) ? { ...record, deletedAt, updatedAt: deletedAt, sample: false } as AppRecord : record));
    if (detailTask?.id === task.id) setDetailTask(null);
  };
  const deleteGoal = (goal: Goal) => {
    const deletedAt = editTime();
    setRecords((current) => current.map((record) => record.id === goal.id || (record.type === "goalProgress" && record.goalId === goal.id) || (record.type === "note" && record.ownerType === "goal" && record.ownerId === goal.id) ? { ...record, deletedAt, updatedAt: deletedAt } as AppRecord : record));
  };
  const deleteTracker = (tracker: CustomTracker) => {
    const deletedAt = editTime();
    setRecords((current) => current.map((record) => record.id === tracker.id || (record.type === "trackerEntry" && record.trackerId === tracker.id) || (record.type === "note" && record.ownerType === "tracker" && record.ownerId === tracker.id) ? { ...record, deletedAt, updatedAt: deletedAt } as AppRecord : record));
  };
  const requestNotifications = async () => {
    if (typeof Notification === "undefined") { setNotificationPermission("unsupported"); setToast("This browser does not support notifications."); return; }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setToast(permission === "granted" ? "Reminders are enabled on this device." : "Allow notifications in your browser settings to receive reminders.");
  };

  const executeAssistantTool = async (call: AssistantToolCall): Promise<Record<string, unknown>> => {
    let args: Record<string, unknown>;
    try { args = JSON.parse(call.function.arguments) as Record<string, unknown>; }
    catch { return { ok: false, message: "The action arguments were not valid." }; }
    const textArg = (key: string, fallback = "") => typeof args[key] === "string" ? String(args[key]).trim() : fallback;
    const numArg = (key: string, fallback = 0) => typeof args[key] === "number" ? Number(args[key]) : fallback;
    const created = (type: AppRecord["type"], fields: Record<string, unknown>) => {
      const record = { ...fields, id: id(), type, updatedAt: editTime() } as AppRecord;
      saveRecord(record);
      return record;
    };
    switch (call.function.name) {
      case "create_habit": {
        const name = textArg("name"); const goal = numArg("goal"); const cadence = textArg("cadence");
        if (!name || goal < 1 || !["week", "month"].includes(cadence)) return { ok: false, message: "A habit needs a name, target, and weekly or monthly cadence." };
        const goalIds = Array.isArray(args.goalIds) ? args.goalIds.filter((value): value is string => typeof value === "string" && goals.some((item) => item.id === value)) : [];
        const habit = created("habit", { name, goal, cadence, successCriteria: textArg("successCriteria") || undefined, goalIds });
        return { ok: true, action: "habit_created", name, id: habit.id };
      }
      case "create_task": {
        const title = textArg("title"); if (!title) return { ok: false, message: "A task needs a title." };
        const goalIds = Array.isArray(args.goalIds) ? args.goalIds.filter((value): value is string => typeof value === "string" && goals.some((item) => item.id === value)) : [];
        const task = created("task", { title, list: textArg("list", "Personal") || "Personal", dueDate: textArg("dueDate") || undefined, completed: false, goalIds });
        if (textArg("comment")) await saveNote("task", task.id, title, textArg("comment"), todayKey());
        return { ok: true, action: "task_created", title, id: task.id };
      }
      case "set_task_deadline": {
        const taskName = textArg("taskName"), dueDate = textArg("dueDate");
        const task = tasks.find((item) => item.title.toLowerCase() === taskName.toLowerCase());
        if (!task || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, message: "Could not find that task or the deadline was not a valid date." };
        saveRecord({ ...task, dueDate, updatedAt: editTime(), sample: false });
        return { ok: true, action: "task_deadline_set", title: task.title, dueDate };
      }
      case "check_in_habit": {
        const habitName = textArg("habitName"), date = textArg("date", todayKey());
        const habit = habits.find((item) => item.name.toLowerCase() === habitName.toLowerCase());
        if (!habit || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Could not find that habit or the date was not valid." };
        const found = records.find((record) => record.type === "checkin" && record.habitId === habit.id && record.date === date && !record.deletedAt);
        if (!found || (found.type === "checkin" && !found.completed)) saveRecord(found && found.type === "checkin" ? { ...found, completed: true, updatedAt: editTime(), sample: false } : { id: `${habit.id}:${date}`, type: "checkin", habitId: habit.id, date, completed: true, updatedAt: editTime() });
        return { ok: true, action: "habit_checked_in", habitName: habit.name, date };
      }
      case "create_goal": {
        const title = textArg("title"), startDate = textArg("startDate"), endDate = textArg("endDate"), target = numArg("target"), unit = textArg("unit"), achievablePlan = textArg("achievablePlan"), relevance = textArg("relevance");
        if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate || target <= 0 || !unit || !achievablePlan || !relevance) return { ok: false, message: "A SMART goal needs a clear outcome, measurable target and unit, realistic plan, personal reason, and valid start and end dates." };
        const goal = created("goal", { title, description: textArg("description") || undefined, achievablePlan, relevance, startDate, endDate, target, unit });
        return { ok: true, action: "goal_created", title, id: goal.id };
      }
      case "create_tracker": {
        const name = textArg("name"), unit = textArg("unit"), target = numArg("target", 0), startDate = textArg("startDate"), endDate = textArg("endDate");
        if (!name || !unit || target < 0 || (startDate && endDate && endDate < startDate)) return { ok: false, message: "A tracker needs a name and unit, with a valid target and date range if supplied." };
        const tracker = created("tracker", { name, unit, target: target || undefined, description: textArg("description") || undefined, startDate: startDate || undefined, endDate: endDate || undefined });
        return { ok: true, action: "tracker_created", name, id: tracker.id };
      }
      case "add_reminder": {
        const title = textArg("title"), scheduledAt = textArg("scheduledAt");
        if (!title || Number.isNaN(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) return { ok: false, message: "A reminder needs a title and a future date and time." };
        const repeat = textArg("repeat", "none");
        const reminder = created("reminder", { title, details: textArg("details") || undefined, scheduledAt: new Date(scheduledAt).toISOString(), repeat: repeat === "weekly" ? "weekly" : "none", enabled: true });
        return { ok: true, action: "reminder_created", title, scheduledAt: reminder.type === "reminder" ? reminder.scheduledAt : scheduledAt, id: reminder.id };
      }
      case "add_note": {
        const ownerType = textArg("ownerType") as JournalNote["ownerType"], ownerName = textArg("ownerName"), noteText = textArg("text");
        const collection = ownerType === "habit" ? habits : ownerType === "task" ? tasks : ownerType === "goal" ? goals : ownerType === "tracker" ? trackers : [];
        const owner = collection.find((item) => ("name" in item ? item.name : item.title).toLowerCase() === ownerName.toLowerCase());
        if (!owner || !noteText) return { ok: false, message: `Could not find a ${ownerType} named “${ownerName}”, or the note was empty.` };
        const sessionDate = textArg("sessionDate", todayKey());
        await saveNote(ownerType, owner.id, ownerName, noteText, /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? sessionDate : todayKey());
        return { ok: true, action: "note_added", ownerName };
      }
      case "record_progress": {
        const entityType = textArg("entityType"), name = textArg("entityName"), amount = numArg("amount"), date = textArg("date", todayKey());
        if (amount <= 0) return { ok: false, message: "Progress amount must be greater than zero." };
        if (entityType === "goal") {
          const goal = goals.find((item) => item.title.toLowerCase() === name.toLowerCase());
          if (!goal) return { ok: false, message: `Could not find a goal named “${name}”.` };
          logGoalProgress(goal, amount, date, textArg("note")); return { ok: true, action: "goal_progress_logged", goal: name, amount, unit: goal.unit };
        }
        if (entityType === "tracker") {
          const tracker = trackers.find((item) => item.name.toLowerCase() === name.toLowerCase());
          if (!tracker) return { ok: false, message: `Could not find a tracker named “${name}”.` };
          logTrackerEntry(tracker, amount, date, textArg("note")); return { ok: true, action: "tracker_entry_logged", tracker: name, amount, unit: tracker.unit };
        }
        return { ok: false, message: "Choose a goal or tracker to log progress against." };
      }
      default: return { ok: false, message: "That action is not available in Daybook." };
    }
  };
  const removeSampleData = () => {
    setRecords((current) => current.map((record) => record.sample ? { ...record, deletedAt: editTime(), updatedAt: editTime() } as AppRecord : record));
    setToast("Sample entries cleared. Your own records are still here.");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ product: "Daybook", version: 1, exportedAt: new Date().toISOString(), records }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `daybook-${todayKey()}.json`; anchor.click();
    URL.revokeObjectURL(url);
    setToast("A backup copy has been downloaded.");
  };

  const importData = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { records?: AppRecord[] } | AppRecord[];
      const imported = Array.isArray(parsed) ? parsed : parsed.records;
      if (!Array.isArray(imported) || imported.some((record) => !record.id || !record.type || !record.updatedAt)) throw new Error("This file does not contain Daybook records.");
      setRecords((current) => mergeRecords(current, imported));
      setToast(`${imported.length} records merged into this daybook.`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "That file could not be read.");
    }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setToast("Daybook link copied."); }
    catch { setToast("Copy this page address to share the daybook."); }
  };

  const installApp = async () => {
    if (!installPrompt) { setToast("On iPhone or iPad, use Share, then Add to Home Screen."); return; }
    await installPrompt.prompt();
    setInstallPrompt(null);
  };

  const pageTitle: Record<View, string> = {
    today: "Today", insights: "Habit insights", habits: "Habits", tasks: "Family to-dos", goals: "SMART goals", trackers: "Your trackers", ideas: "Idea shelf",
    dates: "Important dates", journal: "Private journal", reminders: "Reminders", settings: "Your daybook",
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to today</a>
      <header className="topbar">
        <button className="menu-toggle icon-button" onClick={() => setMobileMenuOpen((open) => !open)} aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen}>{mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <button className="wordmark" onClick={() => chooseView("today")} aria-label="Daybook home"><span className="wordmark-stamp"><Heart size={17} fill="currentColor" /></span><span>daybook</span></button>
        <div className="topbar-spacer" />
        {sampleData && <span className="sample-chip"><Sparkles size={13} /> Sample</span>}
        <button className="share-button" onClick={copyLink}><Share2 size={16} /><span>Share daybook</span></button>
        <SyncBadge state={syncState} configured={cloudConfigured} online={online} />
      </header>

      <div className="workspace">
        <aside className={`side-rail ${mobileMenuOpen ? "is-open" : ""}`} aria-label="Main navigation" aria-hidden={mobileViewport && !mobileMenuOpen} inert={mobileViewport && !mobileMenuOpen}>
          <div className="rail-family"><span className="family-mark">O</span><span><strong>Our family</strong><small>one shared space</small></span><ChevronDown size={15} /></div>
          <nav className="primary-nav">
            <p className="nav-heading">Day by day</p>
            {navigation.slice(0, 2).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} />)}
            <p className="nav-heading nav-heading-spaced">Family plans</p>
            {navigation.slice(2, 7).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} />)}
            <p className="nav-heading nav-heading-spaced">Personal space</p>
            {navigation.slice(7, 8).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} />)}
            <p className="nav-heading nav-heading-spaced">At the right time</p>
            {navigation.slice(8).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} />)}
          </nav>
          <div className="rail-bottom">
            <button className={`nav-item ${view === "settings" ? "is-active" : ""}`} onClick={() => chooseView("settings")}><Settings size={18} /><span>Settings</span></button>
            <div className="rail-reminder"><span className="reminder-dot" /><span>Open to anyone with the link</span></div>
          </div>
        </aside>
        {mobileViewport && mobileMenuOpen && <div className="rail-scrim" aria-hidden="true" onClick={() => setMobileMenuOpen(false)} />}

        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div className="heading-copy">
              <h1>{view === "today" ? `Today, ${new Date().toLocaleDateString(undefined, { month: "long", day: "numeric" })}` : pageTitle[view]}</h1>
              <p>{view === "today" ? "A little check-in, then on with your day." : pageSubtitle(view)}</p>
            </div>
            <div className="heading-actions">
              {view === "habits" && <button className="primary-button" onClick={() => setDialog("habit")}><Plus size={17} /> Add a habit</button>}
              {view === "tasks" && <button className="primary-button" onClick={() => setDialog("task")}><Plus size={17} /> Add a to-do</button>}
              {view === "goals" && <button className="primary-button" onClick={() => setDialog("goal")}><Plus size={17} /> Set a goal</button>}
              {view === "trackers" && <button className="primary-button" onClick={() => setDialog("tracker")}><Plus size={17} /> Build a tracker</button>}
              {view === "ideas" && <button className="primary-button" onClick={() => setDialog("idea")}><Plus size={17} /> Save an idea</button>}
              {view === "dates" && <button className="primary-button" onClick={() => setDialog("date")}><Plus size={17} /> Add a date</button>}
              {view === "reminders" && <button className="primary-button" onClick={() => document.querySelector<HTMLInputElement>(".reminder-form input")?.focus()}><Plus size={17} /> Add a reminder</button>}
              {view === "today" && <button className="soft-button" onClick={() => chooseView("habits")}><CalendarDays size={16} /> Month view</button>}
            </div>
          </div>

          {view === "today" && <TodayPage habits={habits} records={records} tasks={dueToday} goals={goals} onToggle={toggleCheckin} onTimer={(habit) => { setTimerHabit(habit); setTimerSeconds((habit.minutes || 20) * 60); setTimerMinutes(habit.minutes || 20); setTimerRunning(false); }} onAdd={() => setDialog("habit")} onNavigate={chooseView} onHabitClick={setDetailHabit} celebrateAllHabits={celebrateAllHabits} />}
          {view === "insights" && <InsightsPage records={records} habits={habits} notes={notes} reflections={reflections} onSaveReflection={savePerformanceReflection} onAddHabit={() => setDialog("habit")} />}
          {view === "habits" && <HabitsPage habits={habits} goals={goals} records={records} month={month} setMonth={setMonth} mode={matrixMode} setMode={setMatrixMode} onToggle={toggleCheckin} onAdd={() => setDialog("habit")} onRemove={deleteHabit} onHabitClick={setDetailHabit} />}
          {view === "tasks" && <TasksPage tasks={tasks} goals={goals} notes={notes} filter={taskFilter} setFilter={setTaskFilter} categoryFilter={taskCategoryFilter} setCategoryFilter={setTaskCategoryFilter} onToggle={toggleTask} onDelete={deleteTask} onAdd={() => setDialog("task")} onTaskClick={setDetailTask} />}
          {view === "goals" && <GoalsPage goals={goals} progress={goalProgress} notes={notes} habits={habits} tasks={tasks} records={records} onCoach={() => setGoalCoachOpen(true)} onLog={logGoalProgress} onSaveNote={(goal, text, date) => saveNote("goal", goal.id, goal.title, text, date)} onDelete={deleteGoal} />}
          {view === "trackers" && <TrackersPage trackers={trackers} entries={trackerEntries} notes={notes} onAdd={() => setDialog("tracker")} onLog={logTrackerEntry} onSaveNote={(tracker, text, date) => saveNote("tracker", tracker.id, tracker.name, text, date)} onDelete={deleteTracker} onSelect={setDetailTracker} />}
          {view === "ideas" && <IdeasPage ideas={ideas} filter={ideaFilter} setFilter={setIdeaFilter} onDelete={(idea) => saveRecord({ ...idea, deletedAt: editTime(), updatedAt: editTime() })} onAdd={() => setDialog("idea")} />}
          {view === "dates" && <DatesPage dates={dates} onDelete={(event) => saveRecord({ ...event, deletedAt: editTime(), updatedAt: editTime() })} onAdd={() => setDialog("date")} />}
          {journalOpened && <div hidden={view !== "journal"}><JournalPage active={view === "journal"} legacyEntries={journal} onLegacyMigrated={() => setRecords((current) => current.filter((record) => record.type !== "journal"))} /></div>}
          {view === "reminders" && <RemindersPage reminders={reminders} permission={notificationPermission} onRequestPermission={() => void requestNotifications()} onAdd={(fields) => addRecord("reminder", { ...fields, enabled: true })} onDelete={(reminder) => saveRecord({ ...reminder, deletedAt: editTime(), updatedAt: editTime() })} onToggle={(reminder) => saveRecord({ ...reminder, enabled: !reminder.enabled, updatedAt: editTime() })} />}
          {view === "settings" && <SettingsPage syncState={syncState} configured={cloudConfigured} online={online} lastSyncedAt={lastSyncedAt} pendingCount={pendingCount} storageFull={storageFull} onSyncNow={() => void syncNow()} sampleData={sampleData} onClearSamples={removeSampleData} onExport={exportData} onImport={importData} onCopy={copyLink} onInstall={installApp} onAskAI={() => setAssistantOpen(true)} />}
        </main>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navigation.filter((item) => ["today", "insights", "habits", "journal", "reminders"].includes(item.id)).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} compact />)}
        </nav>
      </div>

      {detailHabit && <HabitDetailsDialog habit={detailHabit} notes={notes} onClose={() => setDetailHabit(null)} onEdit={() => editHabit(detailHabit)} onDelete={() => deleteHabit(detailHabit)} onSaveNote={(text, date) => saveNote("habit", detailHabit.id, detailHabit.name, text, date)} />}
      {detailTask && <TaskDetailsDialog task={detailTask} notes={notes} onClose={() => setDetailTask(null)} onSaveNote={(text, date) => saveNote("task", detailTask.id, detailTask.title, text, date)} />}
      {detailTracker && <TrackerDetailsDialog tracker={detailTracker} entries={trackerEntries.filter((entry) => entry.trackerId === detailTracker.id)} notes={notes} onClose={() => setDetailTracker(null)} onUpdate={(fields) => { const updated = { ...detailTracker, ...fields, updatedAt: editTime(), sample: false }; saveRecord(updated); setDetailTracker(updated); }} onLog={(value, date, note) => logTrackerEntry(detailTracker, value, date, note)} onSaveNote={(text, date) => saveNote("tracker", detailTracker.id, detailTracker.name, text, date)} />}
      {assistantOpen && <AssistantDialog records={records} onClose={() => setAssistantOpen(false)} onToolCall={executeAssistantTool} />}
      {goalCoachOpen && <GoalCoachDialog records={records} onClose={() => setGoalCoachOpen(false)} onUseGoal={(draft) => { setGoalDraft(draft); setGoalCoachOpen(false); setDialog("goal"); }} />}
      {dialog && <EntryDialog key={editingHabit?.id ?? `new-${dialog}`} kind={dialog} habit={editingHabit ?? undefined} goals={goals} habits={habits} tasks={tasks} initialGoal={dialog === "goal" ? goalDraft ?? undefined : undefined} onClose={() => { setDialog(null); setEditingHabit(null); setGoalDraft(null); }} onSave={(fields) => dialog === "habit" ? saveHabit(fields) : addRecord(dialog, fields)} />}
      {timerHabit && <TimerDialog habit={timerHabit} seconds={timerSeconds} minutes={timerMinutes} running={timerRunning} onMinutes={setTimerMinutes} onStart={() => { if (timerSeconds === 0) setTimerSeconds(timerMinutes * 60); setTimerRunning(true); }} onPause={() => setTimerRunning(false)} onStop={() => { setTimerRunning(false); setTimerSeconds(0); }} onDone={() => { toggleCheckin(timerHabit, new Date()); setTimerRunning(false); setTimerHabit(null); setToast(`${timerHabit.name} checked off.`); }} onClose={() => { setTimerRunning(false); setTimerHabit(null); }} />}
      <button className="assistant-fab" onClick={() => setAssistantOpen(true)} aria-label="Open Daybook assistant" title="Daybook assistant"><Sparkles size={17} /></button>
      <div className="live-toast" role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function SyncBadge({ state, configured, online }: { state: SyncState; configured: boolean; online: boolean }) {
  const Icon = !online || state === "offline" ? CloudOff : configured ? Cloud : CloudOff;
  const label = !online ? "Offline" : state === "connecting" ? "Connecting" : state === "syncing" ? "Syncing" : state === "offline" ? "Saved on this device" : configured ? "Synced" : "On this device";
  return <span className={`sync-badge sync-${state}`} title={configured ? "Cloud sync uses the public family database." : "Add Supabase settings to sync between devices."}><Icon size={14} aria-hidden="true" />{label}</span>;
}

function NavItem({ item, active, onClick, compact = false }: { item: { id: View; label: string; icon: typeof Home }; active: boolean; onClick: () => void; compact?: boolean }) {
  const Icon = item.icon;
  return <button className={`nav-item ${active ? "is-active" : ""} ${compact ? "compact" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={active ? 2.3 : 1.8} /><span>{item.label}</span></button>;
}

function pageSubtitle(view: View) {
  const subtitles: Record<View, string> = {
    today: "A little check-in, then on with your day.", insights: "Your habits, your dates, and the patterns that matter.", habits: "Keep your goals in view, one day at a time.",
    tasks: "The small things your family wants to get done.", goals: "Turn a clear outcome into small actions you can track.",
    trackers: "Make room for the things you want to measure your own way.", ideas: "A shelf for plans you want to come back to.",
    dates: "Birthdays, plans, and days worth keeping free.", journal: "An unhurried place for thoughts, one page at a time.",
    reminders: "A simple nudge at the time you choose.",
    settings: "Keep your shared space the way you need it.",
  };
  return subtitles[view];
}

function TodayPage({ habits, records, tasks, goals, onToggle, onTimer, onAdd, onNavigate, onHabitClick, celebrateAllHabits }: {
  habits: Habit[]; records: AppRecord[]; tasks: Task[]; goals: Goal[]; onToggle: (habit: Habit, date: Date) => void; onTimer: (habit: Habit) => void; onAdd: () => void; onNavigate: (view: View) => void; onHabitClick: (habit: Habit) => void; celebrateAllHabits: boolean;
}) {
  // The check-in list can be stepped back to an earlier day to fill in habits that were missed.
  // A remembered past day stays put; anything that is not in the past shows today.
  const [pastDay, setPastDay] = useState<string | null>(null);
  const currentKey = todayKey();
  const shownKey = pastDay && pastDay < currentKey ? pastDay : currentKey;
  const isToday = shownKey === currentKey;
  const shownDate = parseDate(shownKey);
  const yesterday = parseDate(currentKey);
  yesterday.setDate(yesterday.getDate() - 1);
  const dayName = isToday ? "Today" : shownKey === dateKey(yesterday) ? "Yesterday" : dateLabel(shownKey);
  const stepDay = (offset: number) => {
    const next = parseDate(shownKey);
    next.setDate(next.getDate() + offset);
    const key = dateKey(next);
    setPastDay(key < todayKey() ? key : null);
  };
  const isChecked = (habitId: string) => records.some((record) => record.type === "checkin" && record.habitId === habitId && record.date === shownKey && record.completed && !record.deletedAt);
  const completedOnDay = habits.filter((habit) => isChecked(habit.id)).length;
  const inCurrentPeriod = (habit: Habit) => habit.cadence === "month" ? shownKey.slice(0, 7) === currentKey.slice(0, 7) : weekDates(shownDate).some((date) => dateKey(date) === currentKey);
  const upcoming = uniqueFamilyDates(liveRecords(records, "date").filter((item) => item.date >= todayKey()))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title))
    .slice(0, 2);
  return <div className="today-layout">
    <section className="today-ledger paper-sheet" aria-labelledby="today-habits-heading">
      <div className="ledger-topline"><div><h2 id="today-habits-heading">Your daily check-in</h2><p>{isToday ? "Pick up wherever you are." : `Filling in ${dayName === "Yesterday" ? "yesterday" : dayName}. Changes count for that day.`}</p></div><span className="day-stamp" aria-label={`${completedOnDay} of ${habits.length} habits done ${isToday ? "today" : dayName === "Yesterday" ? "yesterday" : `on ${dayName}`}`}><span className="day-stamp-count"><strong>{completedOnDay}</strong><span>/ {habits.length}</span></span><span className="day-stamp-label">done</span></span></div>
      {habits.length > 0 && <div className={`day-stepper ${isToday ? "" : "is-past"}`} role="group" aria-label="Day to check in">
        <button className="icon-button" onClick={() => stepDay(-1)} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <span className="day-stepper-label" aria-live="polite"><strong>{dayName}</strong>{dayName !== dateLabel(shownKey) && <span>{dateLabel(shownKey)}</span>}</span>
        <button className="icon-button" onClick={() => stepDay(1)} disabled={isToday} aria-label="Next day"><ChevronRight size={18} /></button>
        {!isToday && <button className="text-link day-stepper-reset" onClick={() => setPastDay(null)}>Back to today</button>}
      </div>}
      <div className="daily-list">
        {habits.length === 0 && <EmptyState text="Your habit page is blank." detail="Add one small thing you would like to do more often." action="Add a habit" onClick={onAdd} />}
        {habits.slice(0, 8).map((habit) => {
          const complete = isChecked(habit.id);
          const progress = countCadence(records, habit, shownDate);
          const period = `${inCurrentPeriod(habit) ? "this" : "that"} ${habit.cadence === "month" ? "month" : "week"}`;
          return <div className={`daily-row ${complete ? "is-complete" : ""}`} key={habit.id}>
            <button className="check-button" onClick={() => onToggle(habit, shownDate)} aria-label={`${complete ? "Uncheck" : "Check off"} ${habit.name}${isToday ? "" : ` for ${dayName === "Yesterday" ? "yesterday" : dayName}`}`} aria-pressed={complete}><Check size={15} /></button>
            <span className="daily-habit-copy"><button className="daily-habit-name habit-detail-trigger" onClick={() => onHabitClick(habit)}>{habit.name}</button><StreakBadge records={records} habit={habit} />{habit.nonNegotiable && <span className="non-negotiable-badge">Non-negotiable</span>}{goals.filter((goal) => habit.goalIds?.includes(goal.id)).map((goal) => <span className="connected-goal-tag" key={goal.id} title={goal.title}><Target size={11}/><span>{goal.title}</span></span>)}</span>
            {habit.minutes && isToday && <button className="timer-link" onClick={() => onTimer(habit)}><Timer size={14} /><span>{habit.minutes} min</span></button>}
            <span className="goal-progress"><strong>{progress}</strong> / {habit.goal}<span className="goal-cadence">{period}</span></span>
          </div>;
        })}
        {habits.length > 8 && <button className="text-link more-link" onClick={() => onNavigate("habits")}>See all {habits.length} habits <ChevronRight size={15} /></button>}
      </div>
      {habits.length > 0 && completedOnDay === habits.length && <div className={`all-habits-badge ${isToday && celebrateAllHabits ? "is-celebrating" : ""}`} role="status" aria-live="polite"><span className="all-habits-medal"><Sparkles size={19} /></span><span><strong>All habits complete!</strong><small>{isToday ? "That’s a full day of showing up. Let it count." : `Every habit is marked for ${dayName === "Yesterday" ? "yesterday" : dayName}.`}</small></span><span className="badge-sparkle badge-sparkle-one" aria-hidden="true">✦</span><span className="badge-sparkle badge-sparkle-two" aria-hidden="true">✦</span></div>}
      <div className="sheet-footer"><span>One day at a time is plenty.</span><button className="text-link" onClick={() => onNavigate("habits")}>Open the habit calendar <ChevronRight size={15} /></button></div>
    </section>
    <aside className="today-aside">
      <section className="quick-summary paper-panel">
        <p className="panel-title">The rest of today</p>
        <button className="side-row-link" onClick={() => onNavigate("tasks")}><span className="side-row-icon accent-coral"><ListChecks size={18} /></span><span><strong>{tasks.length ? `${tasks.length} to-do${tasks.length === 1 ? "" : "s"}` : "No to-dos due"}</strong><small>{tasks.length ? "waiting on your list" : "You have a little room"}</small></span><ChevronRight size={16} /></button>
        <button className="side-row-link" onClick={() => onNavigate("journal")}><span className="side-row-icon accent-blue"><NotebookPen size={18} /></span><span><strong>Save a small moment</strong><small>It only takes a few words</small></span><ChevronRight size={16} /></button>
      </section>
      <section className="upcoming-note">
        <div className="upcoming-heading"><h2>Coming up</h2><button className="text-link" onClick={() => onNavigate("dates")}>See dates</button></div>
        {upcoming.length ? upcoming.map((event) => <div className="event-line" key={event.id}><time dateTime={event.date}>{dateLabel(event.date, { month: "short", day: "numeric" })}</time><span className="event-copy"><strong>{event.title}</strong>{event.time && <small>{timeLabel(event.time)}</small>}</span></div>) : <p className="quiet-note">No dates on the family calendar yet.</p>}
      </section>
      <div className="daybook-prompt"><Sparkles size={18} /><p>Good habits grow quietly, in all the ordinary moments.</p></div>
    </aside>
    <section className="progress-panel paper-sheet" aria-labelledby="progress-heading">
      <div className="progress-heading"><div><p className="panel-title">A little history helps</p><h2 id="progress-heading">Your habit progress</h2></div><span className="progress-period">4, 8, or 12 weeks</span></div>
      <ConsistencyVisualization records={records} habits={habits} onAdd={onAdd} />
    </section>
  </div>;
}

function HabitsPage({ habits, goals, records, month, setMonth, mode, setMode, onToggle, onAdd, onRemove, onHabitClick }: {
  habits: Habit[]; goals: Goal[]; records: AppRecord[]; month: Date; setMonth: (date: Date) => void; mode: "week" | "month"; setMode: (value: "week" | "month") => void; onToggle: (habit: Habit, date: Date) => void; onAdd: () => void; onRemove: (habit: Habit) => void; onHabitClick: (habit: Habit) => void;
}) {
  const dates = mode === "week" ? weekDates(new Date()) : monthDates(month);
  const onMonthChange = (offset: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1, 12));
  const hasCheckin = (habit: Habit, date: Date) => records.some((record) => record.type === "checkin" && record.habitId === habit.id && record.date === dateKey(date) && record.completed && !record.deletedAt);
  // On a narrow screen the month runs off to the right. When today's column is out of view, slide it in with a couple of days of context.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const todayHead = scroller.querySelector<HTMLElement>("thead .today-column");
    if (!todayHead) { scroller.scrollLeft = 0; return; }
    const nameWidth = scroller.querySelector<HTMLElement>(".habit-name-head")?.offsetWidth ?? 0;
    const left = todayHead.offsetLeft - scroller.scrollLeft;
    if (left >= nameWidth && left + todayHead.offsetWidth <= scroller.clientWidth) return;
    scroller.scrollLeft = Math.max(0, todayHead.offsetLeft - nameWidth - todayHead.offsetWidth * 2);
  }, [mode, month]);
  return <section className="habit-workspace paper-sheet">
    <div className="calendar-toolbar">
      <div className="month-controls"><button className="icon-button" aria-label="Previous month" onClick={() => onMonthChange(-1)}><ChevronLeft size={19} /></button><h2>{monthLabel(month)}</h2><button className="icon-button" aria-label="Next month" onClick={() => onMonthChange(1)}><ChevronRight size={19} /></button></div>
      <div className="view-switch" role="group" aria-label="Calendar range"><button className={mode === "week" ? "selected" : ""} onClick={() => setMode("week")}>Week</button><button className={mode === "month" ? "selected" : ""} onClick={() => setMode("month")}>Month</button></div>
    </div>
    <div className={`calendar-scroll ${mode === "month" ? "is-month" : ""}`} ref={scrollRef} tabIndex={0} aria-label={`${mode} habit calendar, scroll horizontally to see all days`}>
      <table className="habit-table" style={{ "--days": dates.length } as CSSProperties}>
        <thead><tr><th className="habit-name-head" scope="col">Habit</th>{dates.map((date) => <th scope="col" key={dateKey(date)} className={dateKey(date) === todayKey() ? "today-column" : ""}><span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{date.getDate()}</strong></th>)}</tr></thead>
        <tbody>{habits.map((habit) => {
          const count = countCadence(records, habit, month);
          return <tr key={habit.id}>
            <th scope="row" className="habit-name-cell"><div className="habit-row-content"><div><span className="habit-title-line"><button className="habit-name-label habit-detail-trigger" onClick={() => onHabitClick(habit)}>{habit.name}</button><StreakBadge records={records} habit={habit} />{habit.nonNegotiable && <span className="non-negotiable-badge">Non-negotiable</span>}</span><span className="habit-goal-label">{count} of {habit.goal} {habit.cadence === "month" ? "this month" : "this week"}</span>{goals.filter((goal) => habit.goalIds?.includes(goal.id)).map((goal) => <span className="connected-goal-tag" key={goal.id} title={goal.title}><Target size={11}/><span>{goal.title}</span></span>)}</div><button className="habit-remove" onClick={() => onRemove(habit)} aria-label={`Remove habit ${habit.name}`} title={`Remove ${habit.name}`}><Trash2 size={14} /></button></div></th>
            {dates.map((date) => {
              const complete = hasCheckin(habit, date);
              const isFuture = dateKey(date) > todayKey();
              return <td key={dateKey(date)} className={dateKey(date) === todayKey() ? "today-column" : ""}><button className={`calendar-check ${complete ? "is-checked" : ""}`} disabled={isFuture} onClick={() => onToggle(habit, date)} aria-label={`${complete ? "Uncheck" : "Check off"} ${habit.name} on ${dateLabel(dateKey(date), { month: "long", day: "numeric" })}`} aria-pressed={complete}><Check size={13} /></button></td>;
            })}
          </tr>;
        })}</tbody>
      </table>
      {!habits.length && <EmptyState text="A fresh page." detail="Add one habit to start your family's tracker." action="Add a habit" onClick={onAdd} />}
    </div>
    <div className="calendar-footer"><p>Tap a day to update it. Your goals can be weekly or monthly.</p><div className="habit-footer-actions"><button className="primary-button" onClick={onAdd}><Plus size={16} /> Add a habit</button></div></div>
    <div className="month-summary"><span><strong>{habits.length}</strong> habits to tend</span><span><strong>{habits.reduce((sum, habit) => sum + monthCheckinCount(records, habit.id, month), 0)}</strong> check-ins this month</span></div>
  </section>;
}

function TasksPage({ tasks, goals, notes, filter, setFilter, categoryFilter, setCategoryFilter, onToggle, onDelete, onAdd, onTaskClick }: { tasks: Task[]; goals: Goal[]; notes: JournalNote[]; filter: string; setFilter: (value: string) => void; categoryFilter: string; setCategoryFilter: (value: string) => void; onToggle: (task: Task) => void; onDelete: (task: Task) => void; onAdd: () => void; onTaskClick: (task: Task) => void }) {
  const lists = [...new Set(tasks.map((task) => task.list || "Family"))];
  const filters = ["Today", "All to-dos", ...lists];
  const shown = tasks.filter((task) => (filter === "All to-dos" || (filter === "Today" ? !task.completed && (!task.dueDate || task.dueDate <= todayKey()) : task.list === filter)) && (categoryFilter === "All categories" || task.category === categoryFilter)).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  return <section className="list-sheet paper-sheet">
    <div className="filter-tabs" role="tablist" aria-label="To-do lists">{filters.map((name) => <button key={name} className={filter === name ? "selected" : ""} role="tab" aria-selected={filter === name} onClick={() => setFilter(name)}>{name}</button>)}</div>
    <div className="filter-tabs task-category-filters" role="tablist" aria-label="Filter by task category">{["All categories", ...taskCategories].map((name) => <button key={name} className={categoryFilter === name ? "selected" : ""} role="tab" aria-selected={categoryFilter === name} onClick={() => setCategoryFilter(name)}>{name}</button>)}</div>
    <div className="task-list">
      {shown.map((task) => <div className={`task-row ${task.completed ? "is-complete" : ""}`} key={task.id}>
        <button className="check-button" aria-label={`${task.completed ? "Reopen" : "Complete"}: ${task.title}`} aria-pressed={task.completed} onClick={() => onToggle(task)}><Check size={15} /></button>
        <div className="task-main"><TaskTitleButton task={task} noteCount={notes.filter((note) => note.ownerType === "task" && note.ownerId === task.id).length} onClick={() => onTaskClick(task)} />{task.category && <span className="task-category-badge">{task.category}</span>}{goals.filter((goal) => task.goalIds?.includes(goal.id)).map((goal) => <span className="connected-goal-tag" key={goal.id} title={goal.title}><Target size={11}/><span>{goal.title}</span></span>)}</div>
        {task.assignee && <span className="assignee-tag">{task.assignee}</span>}
        {task.dueDate && <time className={`task-date ${task.dueDate < todayKey() && !task.completed ? "is-late" : ""}`} dateTime={task.dueDate}>{dateLabel(task.dueDate, { month: "short", day: "numeric" })}</time>}
        <button className="row-delete" onClick={() => onDelete(task)} aria-label={`Remove to-do ${task.title}`} title={`Remove ${task.title}`}><Trash2 size={15} /></button>
      </div>)}
      {!shown.length && <EmptyState text={filter === "Today" ? "Nothing waiting on you today." : "This list is ready for its first to-do."} detail="Add the little things your family wants to remember." action="Add a to-do" onClick={onAdd} />}
    </div>
    <button className="add-line-button" onClick={onAdd}><Plus size={16} /> Add something to the list</button>
    <div className="list-note"><span>{tasks.filter((task) => task.completed).length} done</span><span>{tasks.filter((task) => !task.completed).length} still to do</span></div>
  </section>;
}

function IdeasPage({ ideas, filter, setFilter, onDelete, onAdd }: { ideas: Idea[]; filter: string; setFilter: (value: string) => void; onDelete: (idea: Idea) => void; onAdd: () => void }) {
  const categoriesAvailable = ["All ideas", ...new Set([...categories.slice(1), ...ideas.map((idea) => idea.category).filter(Boolean)])];
  const shown = ideas.filter((idea) => filter === "All ideas" || idea.category === filter);
  return <section className="list-sheet paper-sheet">
    <div className="filter-tabs idea-filters" role="tablist" aria-label="Idea categories">{categoriesAvailable.map((name) => <button key={name} className={filter === name ? "selected" : ""} role="tab" aria-selected={filter === name} onClick={() => setFilter(name)}>{name}</button>)}</div>
    {shown.length ? <div className="idea-list">{shown.map((idea) => <article className="idea-row" key={idea.id}><span className="idea-bullet"><Lightbulb size={17} /></span><div><h2>{idea.title}</h2>{idea.note && <p>{idea.note}</p>}</div><span className="idea-category">{idea.category}</span><button className="row-delete" onClick={() => onDelete(idea)} aria-label={`Remove idea ${idea.title}`} title={`Remove ${idea.title}`}><Trash2 size={15} /></button></article>)}</div> : <EmptyState text="Keep a good idea here." detail="Places to visit, meals to make, or anything the family wants to try." action="Save an idea" onClick={onAdd} />}
    <button className="add-line-button" onClick={onAdd}><Plus size={16} /> Add to the idea shelf</button>
  </section>;
}

function DatesPage({ dates, onAdd, onDelete }: { dates: FamilyDate[]; onAdd: () => void; onDelete: (event: FamilyDate) => void }) {
  const upcoming = dates.filter((event) => event.date >= todayKey());
  const past = dates.filter((event) => event.date < todayKey()).slice().reverse();
  return <div className="dates-layout">
    <section className="paper-sheet date-sheet"><h2 className="section-title">Coming up</h2>{upcoming.length ? upcoming.map((event) => <DateRow key={event.id} event={event} onDelete={onDelete} />) : <EmptyState text="A clear calendar." detail="Add a birthday, a plan, or a day you want to keep open." action="Add a date" onClick={onAdd} />}</section>
    {past.length > 0 && <section className="paper-sheet date-sheet past-dates"><h2 className="section-title">Already passed</h2>{past.slice(0, 6).map((event) => <DateRow key={event.id} event={event} onDelete={onDelete} />)}</section>}
  </div>;
}

function DateRow({ event, onDelete }: { event: FamilyDate; onDelete: (event: FamilyDate) => void }) {
  const date = parseDate(event.date);
  return <article className="date-row"><div className="date-block"><span>{date.toLocaleDateString(undefined, { month: "short" })}</span><strong>{date.getDate()}</strong><small>{date.toLocaleDateString(undefined, { weekday: "short" })}</small></div><div className="date-detail"><h3>{event.title}</h3>{event.note && <p>{event.note}</p>}</div>{event.time && <time className="event-time" dateTime={`${event.date}T${event.time}`}><Clock3 size={14} />{event.time}</time>}<button className="row-delete" onClick={() => onDelete(event)} aria-label={`Remove date ${event.title}`} title={`Remove ${event.title}`}><Trash2 size={15} /></button></article>;
}

function SettingsPage({ syncState, configured, online, lastSyncedAt, pendingCount, storageFull, onSyncNow, sampleData, onClearSamples, onExport, onImport, onCopy, onInstall, onAskAI }: {
  syncState: SyncState; configured: boolean; online: boolean; lastSyncedAt: number | null; pendingCount: number; storageFull: boolean; onSyncNow: () => void; sampleData: boolean; onClearSamples: () => void; onExport: () => void; onImport: (file?: File) => void; onCopy: () => void; onInstall: () => void; onAskAI: () => void;
}) {
  return <div className="settings-page">
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon"><Share2 size={19} /></span><div><h2>Open family link</h2><p>Anyone with this link can view and edit the shared family daybook. No account or password is needed.</p></div></div><div className="public-note"><strong>Your private journal is separate.</strong><span>Journal pages and gallery photos are encrypted on your device with your journal passphrase before they are stored. The family link alone can’t open them.</span></div><button className="primary-button" onClick={onCopy}><Share2 size={16} /> Copy the daybook link</button></section>
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon settings-icon-green"><Cloud size={19} /></span><div><h2>Sync between devices</h2><p>{configured ? syncState === "synced" ? "Cloud sync is on. Every device that opens this link shares the same habits, to-dos, goals, dates, and ideas." : syncState === "offline" || !online ? "You’re offline right now. Changes are kept on this device and sync automatically when the connection is back." : "Cloud sync is on. Connecting to the shared family store…" : "This copy saves to this device only."}</p></div></div><div className="sync-status-line"><span className={`status-dot ${online && syncState === "synced" ? "is-green" : ""}`} /><span>{configured ? syncState === "synced" ? `Connected${lastSyncedAt ? ` · last synced ${new Date(lastSyncedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}` : pendingCount ? `${pendingCount} change${pendingCount === 1 ? "" : "s"} waiting to sync` : syncState === "offline" || !online ? "Offline — changes stay on this device until you reconnect" : "Connecting to shared storage" : "Local storage is ready"}</span>{configured && <button className="quiet-button" onClick={onSyncNow} disabled={!online}>Sync now</button>}</div>{storageFull && <p className="public-note compact-note"><strong>This browser’s storage is full.</strong><span>Recent changes are still being sent to the cloud, but this device can’t keep an offline copy. Free up browser storage to restore offline use.</span></p>}</section>
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon settings-icon-blue"><Download size={19} /></span><div><h2>Take a copy with you</h2><p>Save a backup file or bring records back from another device.</p></div></div><div className="settings-actions"><button className="soft-button" onClick={onExport}><Download size={16} /> Download a backup</button><label className="soft-button file-button"><FileUp size={16} /> Import a backup<input type="file" accept="application/json,.json" onChange={(event) => onImport(event.target.files?.[0])} /></label><button className="soft-button" onClick={onInstall}>Add to home screen</button></div></section>
    <section className="settings-sheet assistant-settings"><div className="settings-heading"><span className="settings-icon settings-icon-blue"><Sparkles size={18} /></span><div><h2>Personal assistant</h2><p>Ask privately about your daybook or ask it to add a habit, task, goal, tracker, reminder, or note. Configure <code>GROQ_API_KEY</code> on the server to enable it.</p></div></div><button className="quiet-button" onClick={onAskAI}>Open assistant</button></section>
    <section className="settings-sheet last-settings"><div><h2>Sample workbook entries</h2><p>The starter habits and family to-dos are examples adapted from your Excel sample.</p></div><button className="quiet-button" disabled={!sampleData} onClick={onClearSamples}><Trash2 size={15} /> {sampleData ? "Clear sample entries" : "Samples cleared"}</button></section>
  </div>;
}

function EmptyState({ text, detail, action, onClick }: { text: string; detail: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><span className="empty-mark"><Sparkles size={18} /></span><h2>{text}</h2><p>{detail}</p>{action && <button className="soft-button" onClick={onClick}><Plus size={15} /> {action}</button>}</div>;
}

function EntryDialog({ kind, habit, goals, habits, tasks, initialGoal, onClose, onSave }: { kind: Exclude<DialogKind, null>; habit?: Habit; goals: Goal[]; habits: Habit[]; tasks: Task[]; initialGoal?: GoalDraft; onClose: () => void; onSave: (fields: Record<string, unknown>) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const today = todayKey();
  const defaultTrackerEnd = (() => { const end = new Date(); end.setDate(end.getDate() + 30); return dateKey(end); })();
  useEffect(() => {
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;
    dialogElement.showModal();
    dialogElement.querySelector<HTMLInputElement>("input:not([type=hidden]),textarea")?.focus();
    return () => { if (dialogElement.open) dialogElement.close(); };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || "").trim();
    if (kind === "habit") {
      const name = value("name"); const goal = Number(value("goal"));
      if (!name || !Number.isFinite(goal) || goal < 1 || goal > 1000) { setError("Add a name and a goal between 1 and 1,000."); return; }
      onSave({ name, goal, cadence: value("cadence"), minutes: Number(value("minutes")) || undefined, successCriteria: value("successCriteria") || undefined, nonNegotiable: form.get("nonNegotiable") === "on", goalIds: form.getAll("goalIds").map(String) } as Partial<Habit> as Record<string, unknown>); return;
    }
    if (kind === "task") {
      const title = value("title"); if (!title) { setError("Add a short name for this to-do."); return; }
      onSave({ title, list: value("list") || "Family", category: (value("category") || undefined) as TaskCategory | undefined, dueDate: value("dueDate") || undefined, assignee: value("assignee") || undefined, completed: false, goalIds: form.getAll("goalIds").map(String) }); return;
    }
    if (kind === "goal") {
      const title = value("title"), startDate = value("startDate"), endDate = value("endDate"), target = Number(value("target")), unit = value("unit");
      if (!title || !value("relevance") || !value("achievablePlan") || !startDate || !endDate || endDate < startDate || !Number.isFinite(target) || target <= 0 || !unit) { setError("Complete the outcome, measurable target and unit, realistic plan, reason it matters, and valid start and end dates."); return; }
      onSave({ title, description: value("description") || undefined, achievablePlan: value("achievablePlan") || undefined, relevance: value("relevance") || undefined, startDate, endDate, target, unit, supportingHabitIds: form.getAll("supportingHabitIds").map(String), supportingTaskIds: form.getAll("supportingTaskIds").map(String) }); return;
    }
    if (kind === "tracker") {
      const name = value("name"), unit = value("unit"), target = Number(value("target")), startDate = value("startDate"), endDate = value("endDate");
      if (!name || !unit || !Number.isFinite(target) || target <= 0 || !startDate || !endDate || endDate < startDate) { setError("Add a name, unit, positive measurable target, and valid start and end dates."); return; }
      onSave({ name, unit, description: value("description") || undefined, target, startDate, endDate }); return;
    }
    if (kind === "reminder") {
      const title = value("title"), dateTime = value("dateTime");
      const scheduledAt = new Date(dateTime);
      if (!title || Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) { setError("Add a name and choose a time in the future."); return; }
      onSave({ title, details: value("details") || undefined, scheduledAt: scheduledAt.toISOString(), enabled: true }); return;
    }
    if (kind === "idea") {
      const title = value("title"); if (!title) { setError("Give this idea a name so you can find it later."); return; }
      onSave({ title, category: value("category"), note: value("note") || undefined }); return;
    }
    if (kind === "date") {
      const title = value("title"); const date = value("date");
      if (!title || !date) { setError("Add a name and a date for the calendar."); return; }
      onSave({ title, date, time: value("time") || undefined, note: value("note") || undefined }); return;
    }
    const title = value("title"); const body = value("body");
    if (!title || !body) { setError("Add a title and a few words to save this memory."); return; }
    onSave({ title, body, date: value("date") || today, tags: value("tags").split(",").map((tag) => tag.trim()).filter(Boolean) });
  };

  const title = kind === "habit" && habit ? "Edit habit" : { habit: "Add a habit", task: "Add a family to-do", goal: "Set a SMART goal", tracker: "Build a tracker", reminder: "Add a reminder", idea: "Save an idea", date: "Add an important date", journal: "Write a small memory" }[kind];
  return <dialog className="entry-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><h2>{title}</h2><p>{kind === "goal" ? "Name the outcome, choose a target, and connect the actions that will count." : kind === "journal" ? "A few words are enough." : "Keep it easy to pick up later."}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={submit} noValidate>
      {kind === "habit" && <>
        <Field label="Habit name" name="name" placeholder="For example, read 10 pages" defaultValue={habit?.name} required />
        <div className="form-grid"><Field label="Goal count" name="goal" type="number" min="1" max="1000" defaultValue={habit?.goal ?? 20} required /><Field label="Time, in minutes" name="minutes" type="number" min="1" max="600" placeholder="Optional" defaultValue={habit?.minutes} /></div>
        <label className="field"><span>Goal period</span><select className="input-control" name="cadence" defaultValue={habit?.cadence ?? "month"}><option value="week">Each week</option><option value="month">Each month</option></select></label>
        <label className="field"><span>Success criteria <em>What counts as done?</em></span><textarea className="input-control textarea-control" name="successCriteria" rows={3} placeholder="For example, read at least 10 pages before bed" defaultValue={habit?.successCriteria ?? ""} /></label>
        {goals.length > 0 && <fieldset className="goal-link-list"><legend>Goals this habit supports</legend>{goals.map((goal) => <label key={goal.id}><input type="checkbox" name="goalIds" value={goal.id} defaultChecked={habit?.goalIds?.includes(goal.id)} /><span>{goal.title}</span></label>)}</fieldset>}
        <label className="habit-priority-toggle"><input type="checkbox" name="nonNegotiable" defaultChecked={habit?.nonNegotiable ?? false} /><span><strong>Non-negotiable</strong><small>Mark this as a habit you want to prioritize consistently.</small></span></label>
      </>}
      {kind === "task" && <>
        <Field label="What needs doing?" name="title" placeholder="Add a to-do" required />
        <label className="field"><span>Category</span><select className="input-control" name="category" defaultValue=""><option value="">Choose a category (optional)</option>{taskCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <div className="form-grid"><Field label="List" name="list" placeholder="Family" defaultValue="Family" /><Field label="Due date" name="dueDate" type="date" /></div>
        <Field label="For someone (optional)" name="assignee" placeholder="Name" />
        {goals.length > 0 && <fieldset className="goal-link-list"><legend>Goals this to-do supports</legend>{goals.map((goal) => <label key={goal.id}><input type="checkbox" name="goalIds" value={goal.id} /><span>{goal.title}</span></label>)}</fieldset>}
      </>}
      {kind === "goal" && <>
        <Field label="Specific outcome" name="title" placeholder="For example, complete 20 daily planning check-ins" defaultValue={initialGoal?.title} required />
        <label className="field"><span>Why it matters <em>Relevant · Required</em></span><textarea className="input-control textarea-control" name="relevance" rows={2} placeholder="What would this change for you?" defaultValue={initialGoal?.relevance ?? ""} required /></label>
        <label className="field"><span>Achievable plan <em>Realistic · Required</em></span><textarea className="input-control textarea-control" name="achievablePlan" rows={2} placeholder="For example, use a short daily planning habit and finish one priority to-do" defaultValue={initialGoal?.achievablePlan ?? ""} required /></label>
        <div className="form-grid"><Field label="Start date · Time-bound" name="startDate" type="date" defaultValue={initialGoal?.startDate ?? today} required /><Field label="End date" name="endDate" type="date" defaultValue={initialGoal?.endDate} required /></div>
        <div className="form-grid"><Field label="Measurable target" name="target" type="number" min="0.01" defaultValue={initialGoal?.target ?? 10} required /><Field label="Unit" name="unit" placeholder="to-dos, check-ins, km" defaultValue={initialGoal?.unit} required /></div>
        <label className="field"><span>Specific context <em>Optional</em></span><textarea className="input-control textarea-control" name="description" rows={2} placeholder="Add a little context for future you" defaultValue={initialGoal?.description ?? ""} /></label>
        {(habits.length > 0 || tasks.length > 0) && <fieldset className="goal-link-list"><legend>Choose actions that count toward this goal</legend>{habits.map((item) => <label key={item.id}><input type="checkbox" name="supportingHabitIds" value={item.id} /><span>Habit · {item.name}</span></label>)}{tasks.map((item) => <label key={item.id}><input type="checkbox" name="supportingTaskIds" value={item.id} /><span>To-do · {item.title}</span></label>)}<p className="goal-link-help">Each habit check-in and completed to-do adds 1 unit. For pages, kilometres, or other amounts, log the measured value directly.</p></fieldset>}
      </>}
      {kind === "tracker" && <>
        <Field label="What do you want to track?" name="name" placeholder="Side project sessions" required />
        <Field label="What is it for?" name="description" placeholder="A short description (optional)" />
        <div className="form-grid"><Field label="Unit" name="unit" placeholder="sessions, pages, km" required /><Field label="Measurable target" name="target" type="number" min="0.01" defaultValue={10} required /></div>
        <div className="form-grid"><Field label="Start date" name="startDate" type="date" defaultValue={today} required /><Field label="End date" name="endDate" type="date" defaultValue={defaultTrackerEnd} required /></div>
      </>}
      {kind === "reminder" && <>
        <Field label="What should we remind you about?" name="title" placeholder="Dance class" required />
        <Field label="Date and exact time" name="dateTime" type="datetime-local" required />
        <Field label="Details (optional)" name="details" placeholder="Bring your shoes" />
      </>}
      {kind === "idea" && <>
        <Field label="The idea" name="title" placeholder="A place, meal, or thing to try" required />
        <label className="field"><span>Category</span><select className="input-control" name="category" defaultValue="Things to try">{categories.slice(1).map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="field"><span>A note (optional)</span><textarea className="input-control textarea-control" name="note" placeholder="Add a detail to help you remember" rows={3} /></label>
      </>}
      {kind === "date" && <>
        <Field label="What is happening?" name="title" placeholder="A birthday, a plan, a reminder" required />
        <div className="form-grid"><Field label="Date" name="date" type="date" defaultValue={today} required /><Field label="Time (optional)" name="time" type="time" /></div>
        <label className="field"><span>A note (optional)</span><textarea className="input-control textarea-control" name="note" rows={2} placeholder="Where, or what to bring" /></label>
      </>}
      {kind === "journal" && <>
        <Field label="Give this memory a title" name="title" placeholder="A good afternoon" required />
        <label className="field"><span>What do you want to remember?</span><textarea className="input-control journal-textarea" name="body" rows={5} placeholder="A few words are enough." required /></label>
        <div className="form-grid"><Field label="Date" name="date" type="date" defaultValue={today} /><Field label="Tags (comma separated)" name="tags" placeholder="family, summer" /></div>
      </>}
      <p className="form-error" role="alert">{error}</p>
      <div className="dialog-actions"><button type="button" className="soft-button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit"><Check size={16} /> Save</button></div>
    </form>
  </dialog>;
}

function Field({ label, name, placeholder, type = "text", required = false, defaultValue, min, max }: { label: string; name: string; placeholder?: string; type?: string; required?: boolean; defaultValue?: string | number; min?: string; max?: string }) {
  return <label className="field"><span>{label}{required && <em>Required</em>}</span><input className="input-control" name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} min={min} max={max} /></label>;
}

function TimerDialog({ habit, seconds, minutes, running, onMinutes, onStart, onPause, onStop, onDone, onClose }: {
  habit: Habit; seconds: number; minutes: number; running: boolean; onMinutes: (value: number) => void; onStart: () => void; onPause: () => void; onStop: () => void; onDone: () => void; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, []);
  const value = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return <dialog className="timer-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><h2>A little time for it</h2><p>{habit.name}</p></div><button className="icon-button" onClick={onClose} aria-label="Close timer"><X size={19} /></button></div>
    <div className="timer-face"><span role="timer" aria-live="off">{value}</span><small>{running ? "Your time is running" : "Settle in at your own pace"}</small></div>
    <div className="timer-presets" role="group" aria-label="Timer length">{[10, 20, 25, 45].map((value) => <button className={minutes === value ? "selected" : ""} key={value} onClick={() => { onMinutes(value); onStop(); }}>{value} min</button>)}</div>
    <div className="dialog-actions"><button className="soft-button" onClick={running ? onPause : onStart}>{running ? "Pause" : seconds === 0 ? "Start timer" : "Continue"}</button><button className="primary-button" onClick={onDone}><Check size={16} /> Done for today</button></div>
  </dialog>;
}

export default App;
