import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Bell, Target, TrendingUp,
  Cloud, CloudOff, Download, FileUp, Heart, Home, Lightbulb, ListChecks, Menu,
  NotebookPen, Plus, Settings, Share2, Sparkles, Timer, Trash2, X,
  LockKeyhole, UnlockKeyhole, Camera, KeyRound, Copy, BookOpen,
} from "lucide-react";
import { dateKey, isSampleData, liveRecords, loadLocalRecords, mergeRecords, monthCheckinCount, SAMPLE_KEY, saveLocalRecords, STORAGE_KEY } from "./data";
import { cloudConfigured, readCloudRecords, writeCloudRecords, readPrivateJournal, writePrivateJournal } from "./sync";
import { changePassword, createVault, openVault, resetPassword, sealContent, type JournalContent, type JournalEnvelope } from "./journalVault";
import type { AppRecord, CustomTracker, FamilyDate, Goal, Habit, Idea, JournalEntry, JournalNote, Task, TaskCategory, View } from "./types";
import { refineNote, type AssistantToolCall } from "./ai";
import { AssistantDialog, ConsistencyVisualization, GoalsPage, HabitDetailsDialog, RemindersPage, TaskDetailsDialog, TaskTitleButton, TrackersPage } from "./features";

const navigation: { id: View; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home },
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
const recordIsSame = (a: AppRecord[], b: AppRecord[]) => JSON.stringify(a) === JSON.stringify(b);

type DialogKind = "habit" | "task" | "goal" | "tracker" | "reminder" | "idea" | "date" | "journal" | null;
type SyncState = "local" | "connecting" | "synced" | "syncing" | "offline" | "error";

function App() {
  const [records, setRecords] = useState<AppRecord[]>(() => loadLocalRecords());
  const recordsRef = useRef(records);
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.slice(1);
    return navigation.some((item) => item.id === hash) || hash === "settings" ? hash as View : "today";
  });
  const [syncState, setSyncState] = useState<SyncState>(cloudConfigured ? "connecting" : "local");
  const [cloudReady, setCloudReady] = useState(!cloudConfigured);
  const [sampleData, setSampleData] = useState(isSampleData());
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [detailHabit, setDetailHabit] = useState<Habit | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
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
  const completedToday = records.filter((record) => record.type === "checkin" && record.date === todayKey() && record.completed && !record.deletedAt).length;
  const dueToday = tasks.filter((task) => !task.completed && task.dueDate === todayKey());

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const updateViewport = () => setMobileViewport(media.matches);
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    recordsRef.current = records;
    saveLocalRecords(records);
    if (cloudConfigured && cloudReady) setSyncState("syncing");
  }, [records, cloudReady]);

  useEffect(() => {
    if (!cloudConfigured) return;
    let active = true;
    const connect = async () => {
      setSyncState("connecting");
      try {
        const remote = await readCloudRecords();
        if (!active) return;
        const local = recordsRef.current;
        if (remote.length === 0 && local.length > 0) {
          await writeCloudRecords(local);
        } else {
          const merged = mergeRecords(local, remote);
          if (!recordIsSame(local, merged)) setRecords(merged);
          await writeCloudRecords(merged);
        }
        if (active) setSyncState("synced");
      } catch {
        if (active) setSyncState("offline");
      } finally {
        if (active) setCloudReady(true);
      }
    };
    void connect();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!cloudConfigured || !cloudReady || !online) return;
    const timeout = window.setTimeout(async () => {
      try {
        await writeCloudRecords(records);
        setSyncState("synced");
      } catch {
        setSyncState("offline");
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [records, cloudReady, online]);

  useEffect(() => {
    if (!cloudConfigured || !cloudReady) return;
    const poll = window.setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const remote = await readCloudRecords();
        const merged = mergeRecords(recordsRef.current, remote);
        if (!recordIsSame(recordsRef.current, merged)) setRecords(merged);
        setSyncState("synced");
      } catch {
        setSyncState("offline");
      }
    }, 12000);
    return () => window.clearInterval(poll);
  }, [cloudReady]);

  useEffect(() => {
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("daybook-records") : null;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue) as AppRecord[];
        setRecords((current) => mergeRecords(current, incoming));
      } catch { /* keep the current copy if another tab wrote invalid data */ }
    };
    const onMessage = (event: MessageEvent<AppRecord[]>) => setRecords((current) => mergeRecords(current, event.data));
    channel?.addEventListener("message", onMessage);
    window.addEventListener("storage", onStorage);
    return () => { channel?.close(); window.removeEventListener("storage", onStorage); };
  }, []);

  useEffect(() => {
    const up = () => { setOnline(true); if (cloudConfigured) setSyncState("syncing"); };
    const down = () => { setOnline(false); setSyncState("offline"); };
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
          const deliveredAt = Date.now();
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
    const note: JournalNote = { id: id(), type: "note", ownerType, ownerId, sessionDate, rawText, polishedText: refined?.polishedText, summary: refined?.summary, keyIdeas: refined?.keyIdeas, updatedAt: Date.now() };
    saveRecord(note);
    setToast(refined ? "Note polished and saved." : "Note saved. Add GROQ_API_KEY to enable AI polishing.");
  };

  const addRecord = (type: Exclude<DialogKind, null>, fields: Record<string, unknown>) => {
    const record = { ...fields, id: id(), type, updatedAt: Date.now() } as AppRecord;
    saveRecord(record);
    setDialog(null);
    setToast(type === "habit" ? "Habit added." : type === "task" ? "To-do added." : type === "goal" ? "Goal set." : type === "tracker" ? "Tracker ready." : type === "reminder" ? "Reminder saved." : type === "idea" ? "Idea saved." : type === "date" ? "Date added." : "Memory saved.");
  };

  const saveHabit = (fields: Record<string, unknown>) => {
    if (editingHabit) {
      saveRecord({ ...editingHabit, ...fields, updatedAt: Date.now(), sample: false } as Habit);
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
    const deletedAt = Date.now();
    setRecords((current) => current.map((record) => record.id === habit.id || (record.type === "checkin" && record.habitId === habit.id) || (record.type === "note" && record.ownerType === "habit" && record.ownerId === habit.id) ? { ...record, deletedAt, updatedAt: deletedAt, sample: false } as AppRecord : record));
    setDetailHabit(null);
    setToast("Habit deleted.");
  };

  const toggleCheckin = (habit: Habit, date: Date) => {
    const key = dateKey(date);
    const found = records.find((record) => record.type === "checkin" && record.habitId === habit.id && record.date === key && !record.deletedAt);
    const record = found && found.type === "checkin"
      ? { ...found, completed: !found.completed, updatedAt: Date.now(), sample: false }
      : { id: `${habit.id}:${key}`, type: "checkin" as const, habitId: habit.id, date: key, completed: true, updatedAt: Date.now() };
    saveRecord(record);
  };

  const toggleTask = (task: Task) => saveRecord({ ...task, completed: !task.completed, updatedAt: Date.now(), sample: false });
  const logGoalProgress = (goal: Goal, amount: number, date: string, note?: string) => saveRecord({ id: id(), type: "goalProgress", goalId: goal.id, amount, date, note: note || undefined, updatedAt: Date.now() });
  const logTrackerEntry = (tracker: CustomTracker, value: number, date: string, note?: string) => saveRecord({ id: id(), type: "trackerEntry", trackerId: tracker.id, value, date, note: note || undefined, updatedAt: Date.now() });
  const deleteTask = (task: Task) => {
    const deletedAt = Date.now();
    setRecords((current) => current.map((record) => record.id === task.id || (record.type === "note" && record.ownerType === "task" && record.ownerId === task.id) ? { ...record, deletedAt, updatedAt: deletedAt, sample: false } as AppRecord : record));
    if (detailTask?.id === task.id) setDetailTask(null);
  };
  const deleteGoal = (goal: Goal) => {
    const deletedAt = Date.now();
    setRecords((current) => current.map((record) => record.id === goal.id || (record.type === "goalProgress" && record.goalId === goal.id) || (record.type === "note" && record.ownerType === "goal" && record.ownerId === goal.id) ? { ...record, deletedAt, updatedAt: deletedAt } as AppRecord : record));
  };
  const deleteTracker = (tracker: CustomTracker) => {
    const deletedAt = Date.now();
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
      const record = { ...fields, id: id(), type, updatedAt: Date.now() } as AppRecord;
      saveRecord(record);
      return record;
    };
    switch (call.function.name) {
      case "create_habit": {
        const name = textArg("name"); const goal = numArg("goal"); const cadence = textArg("cadence");
        if (!name || goal < 1 || !["week", "month"].includes(cadence)) return { ok: false, message: "A habit needs a name, target, and weekly or monthly cadence." };
        const habit = created("habit", { name, goal, cadence, successCriteria: textArg("successCriteria") || undefined });
        return { ok: true, action: "habit_created", name, id: habit.id };
      }
      case "create_task": {
        const title = textArg("title"); if (!title) return { ok: false, message: "A task needs a title." };
        const task = created("task", { title, list: textArg("list", "Personal") || "Personal", dueDate: textArg("dueDate") || undefined, completed: false });
        if (textArg("comment")) await saveNote("task", task.id, title, textArg("comment"), todayKey());
        return { ok: true, action: "task_created", title, id: task.id };
      }
      case "set_task_deadline": {
        const taskName = textArg("taskName"), dueDate = textArg("dueDate");
        const task = tasks.find((item) => item.title.toLowerCase() === taskName.toLowerCase());
        if (!task || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, message: "Could not find that task or the deadline was not a valid date." };
        saveRecord({ ...task, dueDate, updatedAt: Date.now(), sample: false });
        return { ok: true, action: "task_deadline_set", title: task.title, dueDate };
      }
      case "check_in_habit": {
        const habitName = textArg("habitName"), date = textArg("date", todayKey());
        const habit = habits.find((item) => item.name.toLowerCase() === habitName.toLowerCase());
        if (!habit || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Could not find that habit or the date was not valid." };
        const found = records.find((record) => record.type === "checkin" && record.habitId === habit.id && record.date === date && !record.deletedAt);
        if (!found || (found.type === "checkin" && !found.completed)) saveRecord(found && found.type === "checkin" ? { ...found, completed: true, updatedAt: Date.now(), sample: false } : { id: `${habit.id}:${date}`, type: "checkin", habitId: habit.id, date, completed: true, updatedAt: Date.now() });
        return { ok: true, action: "habit_checked_in", habitName: habit.name, date };
      }
      case "create_goal": {
        const title = textArg("title"), startDate = textArg("startDate"), endDate = textArg("endDate"), target = numArg("target"), unit = textArg("unit");
        if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate || target <= 0 || !unit) return { ok: false, message: "A goal needs a title, valid start and end dates, a positive target, and a unit." };
        const goal = created("goal", { title, description: textArg("description") || undefined, startDate, endDate, target, unit });
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
    setRecords((current) => current.map((record) => record.sample ? { ...record, deletedAt: Date.now(), updatedAt: Date.now() } as AppRecord : record));
    localStorage.setItem(SAMPLE_KEY, "cleared");
    setSampleData(false);
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
    today: "Today", habits: "Habits", tasks: "Family to-dos", goals: "Time-bound goals", trackers: "Your trackers", ideas: "Idea shelf",
    dates: "Important dates", journal: "Private journal", reminders: "Reminders", settings: "Your daybook",
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to today</a>
      <header className="topbar">
        <button className="menu-toggle icon-button" onClick={() => setMobileMenuOpen((open) => !open)} aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen}><Menu size={20} /></button>
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

          {view === "today" && <TodayPage habits={habits} records={records} tasks={dueToday} onToggle={toggleCheckin} onTimer={(habit) => { setTimerHabit(habit); setTimerSeconds((habit.minutes || 20) * 60); setTimerMinutes(habit.minutes || 20); setTimerRunning(false); }} onAdd={() => setDialog("habit")} onNavigate={chooseView} onHabitClick={setDetailHabit} completedToday={completedToday} />}
          {view === "habits" && <HabitsPage habits={habits} records={records} month={month} setMonth={setMonth} mode={matrixMode} setMode={setMatrixMode} onToggle={toggleCheckin} onAdd={() => setDialog("habit")} onRemove={deleteHabit} onHabitClick={setDetailHabit} />}
          {view === "tasks" && <TasksPage tasks={tasks} notes={notes} filter={taskFilter} setFilter={setTaskFilter} categoryFilter={taskCategoryFilter} setCategoryFilter={setTaskCategoryFilter} onToggle={toggleTask} onDelete={deleteTask} onAdd={() => setDialog("task")} onTaskClick={setDetailTask} />}
          {view === "goals" && <GoalsPage goals={goals} progress={goalProgress} notes={notes} onAdd={() => setDialog("goal")} onLog={logGoalProgress} onSaveNote={(goal, text, date) => saveNote("goal", goal.id, goal.title, text, date)} onDelete={deleteGoal} />}
          {view === "trackers" && <TrackersPage trackers={trackers} entries={trackerEntries} notes={notes} onAdd={() => setDialog("tracker")} onLog={logTrackerEntry} onSaveNote={(tracker, text, date) => saveNote("tracker", tracker.id, tracker.name, text, date)} onDelete={deleteTracker} />}
          {view === "ideas" && <IdeasPage ideas={ideas} filter={ideaFilter} setFilter={setIdeaFilter} onDelete={(idea) => saveRecord({ ...idea, deletedAt: Date.now(), updatedAt: Date.now() })} onAdd={() => setDialog("idea")} />}
          {view === "dates" && <DatesPage dates={dates} onDelete={(event) => saveRecord({ ...event, deletedAt: Date.now(), updatedAt: Date.now() })} onAdd={() => setDialog("date")} />}
          {view === "journal" && <JournalPage legacyEntries={journal} onLegacyMigrated={() => setRecords((current) => current.filter((record) => record.type !== "journal"))} />}
          {view === "reminders" && <RemindersPage reminders={reminders} permission={notificationPermission} onRequestPermission={() => void requestNotifications()} onAdd={(fields) => addRecord("reminder", { ...fields, enabled: true })} onDelete={(reminder) => saveRecord({ ...reminder, deletedAt: Date.now(), updatedAt: Date.now() })} onToggle={(reminder) => saveRecord({ ...reminder, enabled: !reminder.enabled, updatedAt: Date.now() })} />}
          {view === "settings" && <SettingsPage syncState={syncState} configured={cloudConfigured} online={online} sampleData={sampleData} onClearSamples={removeSampleData} onExport={exportData} onImport={importData} onCopy={copyLink} onInstall={installApp} onAskAI={() => setAssistantOpen(true)} />}
        </main>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navigation.filter((item) => ["today", "habits", "tasks", "journal", "reminders"].includes(item.id)).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} compact />)}
        </nav>
      </div>

      {detailHabit && <HabitDetailsDialog habit={detailHabit} notes={notes} onClose={() => setDetailHabit(null)} onEdit={() => editHabit(detailHabit)} onDelete={() => deleteHabit(detailHabit)} onSaveNote={(text, date) => saveNote("habit", detailHabit.id, detailHabit.name, text, date)} />}
      {detailTask && <TaskDetailsDialog task={detailTask} notes={notes} onClose={() => setDetailTask(null)} onSaveNote={(text, date) => saveNote("task", detailTask.id, detailTask.title, text, date)} />}
      {assistantOpen && <AssistantDialog records={records} onClose={() => setAssistantOpen(false)} onToolCall={executeAssistantTool} />}
      {dialog && <EntryDialog key={editingHabit?.id ?? `new-${dialog}`} kind={dialog} habit={editingHabit ?? undefined} onClose={() => { setDialog(null); setEditingHabit(null); }} onSave={(fields) => dialog === "habit" ? saveHabit(fields) : addRecord(dialog, fields)} />}
      {timerHabit && <TimerDialog habit={timerHabit} seconds={timerSeconds} minutes={timerMinutes} running={timerRunning} onMinutes={setTimerMinutes} onStart={() => { if (timerSeconds === 0) setTimerSeconds(timerMinutes * 60); setTimerRunning(true); }} onPause={() => setTimerRunning(false)} onStop={() => { setTimerRunning(false); setTimerSeconds(0); }} onDone={() => { toggleCheckin(timerHabit, new Date()); setTimerRunning(false); setTimerHabit(null); setToast(`${timerHabit.name} checked off.`); }} onClose={() => { setTimerRunning(false); setTimerHabit(null); }} />}
      <button className="assistant-fab" onClick={() => setAssistantOpen(true)} aria-label="Open Daybook assistant" title="Daybook assistant"><Sparkles size={17} /></button>
      <div className="live-toast" role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

function SyncBadge({ state, configured, online }: { state: SyncState; configured: boolean; online: boolean }) {
  const Icon = !online || state === "offline" ? CloudOff : configured ? Cloud : CloudOff;
  const label = !online ? "Offline" : state === "connecting" ? "Connecting" : state === "syncing" ? "Syncing" : state === "error" || state === "offline" ? "Saved on this device" : configured ? "Synced" : "On this device";
  return <span className={`sync-badge sync-${state}`} title={configured ? "Cloud sync uses the public family database." : "Add Supabase settings to sync between devices."}><Icon size={14} aria-hidden="true" />{label}</span>;
}

function NavItem({ item, active, onClick, compact = false }: { item: { id: View; label: string; icon: typeof Home }; active: boolean; onClick: () => void; compact?: boolean }) {
  const Icon = item.icon;
  return <button className={`nav-item ${active ? "is-active" : ""} ${compact ? "compact" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={active ? 2.3 : 1.8} /><span>{item.label}</span></button>;
}

function pageSubtitle(view: View) {
  const subtitles: Record<View, string> = {
    today: "A little check-in, then on with your day.", habits: "Keep your goals in view, one day at a time.",
    tasks: "The small things your family wants to get done.", goals: "Choose your window, then build progress one entry at a time.",
    trackers: "Make room for the things you want to measure your own way.", ideas: "A shelf for plans you want to come back to.",
    dates: "Birthdays, plans, and days worth keeping free.", journal: "An unhurried place for thoughts, one page at a time.",
    reminders: "A simple nudge at the time you choose.",
    settings: "Keep your shared space the way you need it.",
  };
  return subtitles[view];
}

function TodayPage({ habits, records, tasks, onToggle, onTimer, onAdd, onNavigate, onHabitClick, completedToday }: {
  habits: Habit[]; records: AppRecord[]; tasks: Task[]; onToggle: (habit: Habit, date: Date) => void; onTimer: (habit: Habit) => void; onAdd: () => void; onNavigate: (view: View) => void; onHabitClick: (habit: Habit) => void; completedToday: number;
}) {
  const today = new Date();
  const todayCheck = (habitId: string) => records.some((record) => record.type === "checkin" && record.habitId === habitId && record.date === todayKey() && record.completed && !record.deletedAt);
  const upcoming = liveRecords(records, "date").filter((item) => item.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2);
  return <div className="today-layout">
    <section className="today-ledger paper-sheet" aria-labelledby="today-habits-heading">
      <div className="ledger-topline"><div><h2 id="today-habits-heading">Your daily check-in</h2><p>Pick up wherever you are.</p></div><span className="day-stamp">{completedToday}<span>done</span></span></div>
      <div className="daily-list">
        {habits.length === 0 && <EmptyState text="Your habit page is blank." detail="Add one small thing you would like to do more often." action="Add a habit" onClick={onAdd} />}
        {habits.slice(0, 8).map((habit) => {
          const complete = todayCheck(habit.id);
          const progress = countCadence(records, habit, today);
          return <div className={`daily-row ${complete ? "is-complete" : ""}`} key={habit.id}>
            <button className="check-button" onClick={() => onToggle(habit, today)} aria-label={`${complete ? "Uncheck" : "Check off"} ${habit.name}`} aria-pressed={complete}><Check size={15} /></button>
            <span className="daily-habit-copy"><button className="daily-habit-name habit-detail-trigger" onClick={() => onHabitClick(habit)}>{habit.name}</button>{habit.nonNegotiable && <span className="non-negotiable-badge">Non-negotiable</span>}</span>
            {habit.minutes && <button className="timer-link" onClick={() => onTimer(habit)}><Timer size={14} /><span>{habit.minutes} min</span></button>}
            <span className="goal-progress"><strong>{progress}</strong> / {habit.goal}<span className="goal-cadence">{habit.cadence === "month" ? "this month" : "this week"}</span></span>
          </div>;
        })}
        {habits.length > 8 && <button className="text-link more-link" onClick={() => onNavigate("habits")}>See all {habits.length} habits <ChevronRight size={15} /></button>}
      </div>
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
        {upcoming.length ? upcoming.map((event) => <div className="event-line" key={event.id}><time dateTime={event.date}>{dateLabel(event.date, { month: "short", day: "numeric" })}</time><span>{event.title}</span></div>) : <p className="quiet-note">No dates on the family calendar yet.</p>}
      </section>
      <div className="daybook-prompt"><Sparkles size={18} /><p>Good habits grow quietly, in all the ordinary moments.</p></div>
    </aside>
    <section className="progress-panel paper-sheet" aria-labelledby="progress-heading">
      <div className="progress-heading"><div><p className="panel-title">A little history helps</p><h2 id="progress-heading">Your habit progress</h2></div><span className="progress-period">4, 8, or 12 weeks</span></div>
      <ConsistencyVisualization records={records} habits={habits} onAdd={onAdd} />
    </section>
  </div>;
}

function HabitsPage({ habits, records, month, setMonth, mode, setMode, onToggle, onAdd, onRemove, onHabitClick }: {
  habits: Habit[]; records: AppRecord[]; month: Date; setMonth: (date: Date) => void; mode: "week" | "month"; setMode: (value: "week" | "month") => void; onToggle: (habit: Habit, date: Date) => void; onAdd: () => void; onRemove: (habit: Habit) => void; onHabitClick: (habit: Habit) => void;
}) {
  const dates = mode === "week" ? weekDates(new Date()) : monthDates(month);
  const onMonthChange = (offset: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1, 12));
  const hasCheckin = (habit: Habit, date: Date) => records.some((record) => record.type === "checkin" && record.habitId === habit.id && record.date === dateKey(date) && record.completed && !record.deletedAt);
  return <section className="habit-workspace paper-sheet">
    <div className="calendar-toolbar">
      <div className="month-controls"><button className="icon-button" aria-label="Previous month" onClick={() => onMonthChange(-1)}><ChevronLeft size={19} /></button><h2>{monthLabel(month)}</h2><button className="icon-button" aria-label="Next month" onClick={() => onMonthChange(1)}><ChevronRight size={19} /></button></div>
      <div className="view-switch" role="group" aria-label="Calendar range"><button className={mode === "week" ? "selected" : ""} onClick={() => setMode("week")}>Week</button><button className={mode === "month" ? "selected" : ""} onClick={() => setMode("month")}>Month</button></div>
    </div>
    <div className={`calendar-scroll ${mode === "month" ? "is-month" : ""}`} tabIndex={0} aria-label={`${mode} habit calendar, scroll horizontally to see all days`}>
      <table className="habit-table">
        <thead><tr><th className="habit-name-head" scope="col">Habit</th>{dates.map((date) => <th scope="col" key={dateKey(date)} className={dateKey(date) === todayKey() ? "today-column" : ""}><span>{date.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{date.getDate()}</strong></th>)}</tr></thead>
        <tbody>{habits.map((habit) => {
          const count = countCadence(records, habit, month);
          return <tr key={habit.id}>
            <th scope="row" className="habit-name-cell"><div className="habit-row-content"><div><span className="habit-title-line"><button className="habit-name-label habit-detail-trigger" onClick={() => onHabitClick(habit)}>{habit.name}</button>{habit.nonNegotiable && <span className="non-negotiable-badge">Non-negotiable</span>}</span><span className="habit-goal-label">{count} of {habit.goal} {habit.cadence === "month" ? "this month" : "this week"}</span></div><button className="habit-remove" onClick={() => onRemove(habit)} aria-label={`Remove habit ${habit.name}`} title={`Remove ${habit.name}`}><Trash2 size={14} /></button></div></th>
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

function TasksPage({ tasks, notes, filter, setFilter, categoryFilter, setCategoryFilter, onToggle, onDelete, onAdd, onTaskClick }: { tasks: Task[]; notes: JournalNote[]; filter: string; setFilter: (value: string) => void; categoryFilter: string; setCategoryFilter: (value: string) => void; onToggle: (task: Task) => void; onDelete: (task: Task) => void; onAdd: () => void; onTaskClick: (task: Task) => void }) {
  const lists = [...new Set(tasks.map((task) => task.list || "Family"))];
  const filters = ["Today", "All to-dos", ...lists];
  const shown = tasks.filter((task) => (filter === "All to-dos" || (filter === "Today" ? !task.completed && (!task.dueDate || task.dueDate <= todayKey()) : task.list === filter)) && (categoryFilter === "All categories" || task.category === categoryFilter)).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  return <section className="list-sheet paper-sheet">
    <div className="filter-tabs" role="tablist" aria-label="To-do lists">{filters.map((name) => <button key={name} className={filter === name ? "selected" : ""} role="tab" aria-selected={filter === name} onClick={() => setFilter(name)}>{name}</button>)}</div>
    <div className="filter-tabs task-category-filters" role="tablist" aria-label="Filter by task category">{["All categories", ...taskCategories].map((name) => <button key={name} className={categoryFilter === name ? "selected" : ""} role="tab" aria-selected={categoryFilter === name} onClick={() => setCategoryFilter(name)}>{name}</button>)}</div>
    <div className="task-list">
      {shown.map((task) => <div className={`task-row ${task.completed ? "is-complete" : ""}`} key={task.id}>
        <button className="check-button" aria-label={`${task.completed ? "Reopen" : "Complete"}: ${task.title}`} aria-pressed={task.completed} onClick={() => onToggle(task)}><Check size={15} /></button>
        <div className="task-main"><TaskTitleButton task={task} noteCount={notes.filter((note) => note.ownerType === "task" && note.ownerId === task.id).length} onClick={() => onTaskClick(task)} />{task.category && <span className="task-category-badge">{task.category}</span>}</div>
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

function JournalPage({ legacyEntries, onLegacyMigrated }: { legacyEntries: JournalEntry[]; onLegacyMigrated: () => void }) {
  const journalStorage = cloudConfigured ? "your Supabase project" : "this device's local server";
  const [loading, setLoading] = useState(true), [envelope, setEnvelope] = useState<JournalEnvelope | null>(null);
  const [content, setContent] = useState<JournalContent | null>(null), [key, setKey] = useState<CryptoKey | null>(null);
  const [password, setPassword] = useState(""), [passwordAgain, setPasswordAgain] = useState(""), [recovery, setRecovery] = useState(""), [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [resetMode, setResetMode] = useState(false), [changingPassword, setChangingPassword] = useState(false), [saving, setSaving] = useState(false);
  const [pageIndex, setPageIndex] = useState(0), [showRecovery, setShowRecovery] = useState(false), [savedRecovery, setSavedRecovery] = useState("");
  const photoInput = useRef<HTMLInputElement>(null), loaded = useRef(false);
  useEffect(() => { let active = true; readPrivateJournal().then((value) => { if (active) { setEnvelope(value); setLoading(false); } }).catch((reason: unknown) => { if (active) { setError(reason instanceof Error ? reason.message : "Could not reach journal storage."); setLoading(false); } }); return () => { active = false; }; }, []);
  const saveNow = async () => {
    if (!key || !content || !envelope || !loaded.current) return;
    setSaving(true);
    try { const next = await sealContent(content, key, envelope); await writePrivateJournal(next); setEnvelope(next); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The journal could not be saved."); }
    finally { setSaving(false); }
  };
  useEffect(() => {
    if (!key || !content || !envelope || !loaded.current) return;
    const timer = window.setTimeout(() => { void saveNow(); }, 600);
    return () => window.clearTimeout(timer);
  }, [content]);

  const createJournal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Use at least 8 characters for your passphrase."); return; }
    if (password !== passwordAgain) { setError("Those passphrases do not match."); return; }
    try {
      const migrated = legacyEntries.length ? legacyEntries.map((entry) => `${entry.title}\n${entry.body}`).join("\n\n") : "";
      const initial = { pages: [{ id: crypto.randomUUID(), text: migrated, updatedAt: Date.now() }], photos: [], stickyNote: "" };
      const created = await createVault(password, initial); await writePrivateJournal(created.envelope);
      if (legacyEntries.length) onLegacyMigrated();
      setEnvelope(created.envelope); setContent(created.content); setKey(created.key); loaded.current = true;
      setSavedRecovery(created.code); setShowRecovery(true); setPassword(""); setPasswordAgain("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The private journal could not be created."); }
  };
  const unlock = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setError(""); if (!envelope) return; try { const opened = await openVault(envelope, password); setKey(opened.key); setContent(opened.content); loaded.current = true; setPassword(""); setPageIndex(0); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not unlock the journal."); } };
  const reset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); if (!envelope) return;
    if (newPassword.length < 8) { setError("Use at least 8 characters for the new passphrase."); return; }
    try { const result = await resetPassword(envelope, recovery, newPassword); await writePrivateJournal(result.envelope); setEnvelope(result.envelope); setKey(result.key); setContent(result.content); loaded.current = true; setSavedRecovery(result.code); setShowRecovery(true); setRecovery(""); setNewPassword(""); setResetMode(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The passphrase could not be reset."); }
  };
  const change = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); if (!envelope || !key) return;
    if (newPassword.length < 8) { setError("Use at least 8 characters for the new passphrase."); return; }
    try { const next = await changePassword(envelope, key, newPassword); await writePrivateJournal(next); setEnvelope(next); setChangingPassword(false); setNewPassword(""); setNotice("Passphrase changed."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change the passphrase."); }
  };
  const updatePage = (text: string) => { if (content) setContent({ ...content, pages: content.pages.map((page, index) => index === pageIndex ? { ...page, text, updatedAt: Date.now() } : page) }); };
  const addPage = () => { if (!content) return; const pages = [...content.pages, { id: crypto.randomUUID(), text: "", updatedAt: Date.now() }]; setContent({ ...content, pages }); setPageIndex(pages.length - 1); };
  const addPhoto = async (file?: File) => {
    if (!file || !content) return; setError("");
    try { const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale); canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); const image = canvas.toDataURL("image/jpeg", 0.78); setContent({ ...content, photos: [...content.photos, { id: crypto.randomUUID(), label: "A moment", image, addedAt: Date.now() }] }); setNotice("Photo added to your private gallery."); }
    catch { setError("That picture could not be prepared for the private gallery."); } if (photoInput.current) photoInput.current.value = "";
  };
  const lock = async () => { await saveNow(); loaded.current = false; setKey(null); setContent(null); setPassword(""); setRecovery(""); setNewPassword(""); setChangingPassword(false); };
  if (loading) return <section className="journal-lock paper-sheet"><span className="lock-emblem"><BookOpen size={23} /></span><h2>Opening your journal</h2><p>Checking your journal storage…</p></section>;
  if (!window.isSecureContext || !window.crypto?.subtle) return <section className="journal-lock paper-sheet"><span className="lock-emblem"><LockKeyhole size={23} /></span><h2>Secure connection needed</h2><p>Open the locally hosted daybook over HTTPS to use journal encryption on this device. Your journal stays locked until the browser can provide secure encryption.</p></section>;
  if (!envelope) return <section className="journal-lock paper-sheet"><span className="lock-emblem"><LockKeyhole size={23} /></span><p className="journal-kicker">A private place, just for you</p><h2>Begin your journal</h2><p>Your pages and private gallery are encrypted in your browser before they are sent to {journalStorage}. Enter the passphrase you want to use.</p><form className="journal-auth-form" onSubmit={createJournal}><label className="field"><span>Passphrase</span><input className="input-control" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="field"><span>Confirm passphrase</span><input className="input-control" type="password" autoComplete="new-password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} required /></label><p className="journal-footnote">Your passphrase is never sent to the storage service. Save the recovery code shown after setup somewhere safe.</p><p className="form-error" role="alert">{error}</p><button className="primary-button" type="submit"><LockKeyhole size={16} /> Create private journal</button></form></section>;
  if (!key || !content) return <section className="journal-lock paper-sheet"><span className="lock-emblem"><LockKeyhole size={23} /></span><p className="journal-kicker">Your private journal</p><h2>{resetMode ? "Reset your passphrase" : "Unlock your pages"}</h2>{!resetMode ? <form className="journal-auth-form" onSubmit={unlock}><label className="field"><span>Passphrase</span><input className="input-control" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required /></label><p className="form-error" role="alert">{error}</p><button className="primary-button" type="submit"><UnlockKeyhole size={16} /> Unlock journal</button><button className="text-link" type="button" onClick={() => { setResetMode(true); setError(""); }}>Forgot passphrase? Use recovery code</button></form> : <form className="journal-auth-form" onSubmit={reset}><label className="field"><span>Recovery code</span><input className="input-control" value={recovery} onChange={(event) => setRecovery(event.target.value)} autoFocus required /></label><label className="field"><span>New passphrase</span><input className="input-control" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><p className="form-error" role="alert">{error}</p><button className="primary-button" type="submit"><KeyRound size={16} /> Reset passphrase</button><button className="text-link" type="button" onClick={() => { setResetMode(false); setError(""); }}>Back to unlock</button></form>}</section>;
  const page = content.pages[pageIndex];
  return <div className="journal-workspace">
    {showRecovery && <section className="recovery-card paper-sheet"><div><span className="journal-kicker">Save this recovery code</span><h2>Keep a way back in</h2><p>This code can reset the passphrase if you forget it. Save it somewhere separate from this device.</p><code>{savedRecovery}</code></div><button className="soft-button" onClick={() => { void navigator.clipboard.writeText(savedRecovery); setNotice("Recovery code copied."); }}><Copy size={16} /> Copy code</button><button className="icon-button" onClick={() => setShowRecovery(false)} aria-label="Close recovery code"><X size={18} /></button></section>}
    <div className="journal-toolbar"><div className="journal-save-state"><LockKeyhole size={15} /><span>{saving ? "Saving privately…" : "Private journal"}</span></div><div className="journal-tools"><button className="soft-button" onClick={() => photoInput.current?.click()}><Camera size={16} /> Add a photo</button><input ref={photoInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={(event) => void addPhoto(event.target.files?.[0])} /><button className="quiet-button" onClick={() => setChangingPassword(!changingPassword)}><KeyRound size={15} /> Passphrase</button><button className="icon-button" onClick={() => void lock()} aria-label="Lock the journal"><LockKeyhole size={17} /></button></div></div>
    {changingPassword && <form className="password-change paper-sheet" onSubmit={change}><div><strong>Change your passphrase</strong><span>Use at least 8 characters.</span></div><input className="input-control" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="New passphrase" required /><button className="soft-button" type="submit">Save passphrase</button></form>}
    {(error || notice) && <p className={`journal-flash ${error ? "has-error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</p>}
    <section className="sticky-note paper-sheet"><div className="sticky-note-heading"><span className="sticky-pin"/><div><span className="journal-kicker">Post-it</span><strong>Keep one thought in front</strong></div><small>{saving ? "Saving…" : "Private and encrypted"}</small></div><textarea aria-label="Your private post-it note" maxLength={400} value={content.stickyNote ?? ""} onChange={(event) => setContent({ ...content, stickyNote: event.target.value })} placeholder="One thing to remember…" rows={2}/></section>
    <section className="journal-paper paper-sheet" aria-label="Journal page"><div className="paper-page-top"><span>DAYBOOK · PERSONAL NOTES</span><span>{String(pageIndex + 1).padStart(2, "0")}</span></div><textarea aria-label={`Journal page ${pageIndex + 1}`} className="freeflow-page" value={page?.text ?? ""} onBlur={() => void saveNow()} onChange={(event) => updatePage(event.target.value)} placeholder="Let your thoughts find their own shape…" spellCheck /><div className="paper-page-bottom"><span>Write freely. This page has no date or prompt.</span><div className="page-turn"><button className="icon-button" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button><span>Page {pageIndex + 1} of {content.pages.length}</span><button className="icon-button" disabled={pageIndex === content.pages.length - 1} onClick={() => setPageIndex((index) => index + 1)} aria-label="Next page"><ChevronRight size={18} /></button><button className="soft-button page-add" onClick={addPage}><Plus size={15} /> New page</button></div></div></section>
    <section className="photo-gallery paper-sheet"><div className="gallery-heading"><span className="lock-emblem"><Camera size={18} /></span><div><h2>Private photo gallery</h2><p>Pictures are separate from your writing and encrypted before upload.</p></div><button className="soft-button" onClick={() => photoInput.current?.click()}><Camera size={15} /> Take a photo</button></div>{content.photos.length ? <div className="gallery-grid">{content.photos.map((photo) => <figure className="gallery-photo" key={photo.id}><img src={photo.image} alt={photo.label || "Private gallery photo"} /><div><input aria-label="Photo label" value={photo.label} onChange={(event) => setContent({ ...content, photos: content.photos.map((item) => item.id === photo.id ? { ...item, label: event.target.value } : item) })} /><button className="row-delete" onClick={() => setContent({ ...content, photos: content.photos.filter((item) => item.id !== photo.id) })} aria-label="Remove photo"><Trash2 size={15} /></button></div></figure>)}</div> : <div className="gallery-empty"><Camera size={19} /><span>Photos you add will live here, separate from your pages.</span></div>}</section>
  </div>;
}

function SettingsPage({ syncState, configured, online, sampleData, onClearSamples, onExport, onImport, onCopy, onInstall, onAskAI }: {
  syncState: SyncState; configured: boolean; online: boolean; sampleData: boolean; onClearSamples: () => void; onExport: () => void; onImport: (file?: File) => void; onCopy: () => void; onInstall: () => void; onAskAI: () => void;
}) {
  return <div className="settings-page">
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon"><Share2 size={19} /></span><div><h2>Open family link</h2><p>Anyone with this link can view and edit the shared family daybook. No account or password is needed.</p></div></div><div className="public-note"><strong>Your private journal is separate.</strong><span>Journal pages and gallery photos are encrypted before they are sent to {cloudConfigured ? "Supabase" : "the local journal service"}. The storage contains encrypted data, not readable photos or text.</span></div><button className="primary-button" onClick={onCopy}><Share2 size={16} /> Copy the daybook link</button></section>
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon settings-icon-green"><Cloud size={19} /></span><div><h2>Sync between devices</h2><p>{configured ? `Cloud sync is set up. ${syncState === "synced" ? "Your latest changes are saved online." : "Changes will sync when your connection is back."}` : "This copy currently saves to this device. Add a Supabase project to share it across devices."}</p></div></div>{!configured && <div className="setup-steps"><p className="steps-lead">Connect shared sync in three small steps</p><ol><li>Create a free Supabase project and copy its project URL and anon key.</li><li>Run the SQL in <code>supabase/schema.sql</code> in the project’s SQL editor.</li><li>Copy <code>.env.example</code> to <code>.env.local</code>, add the two values, then restart the app.</li></ol><p className="public-note compact-note"><strong>This creates an open database.</strong><span>Anyone with the app URL can read, add, change, or remove records. Do not use confidential information.</span></p></div>}<div className="sync-status-line"><span className={`status-dot ${online && syncState === "synced" ? "is-green" : ""}`} /><span>{configured ? syncState === "synced" ? "Connected" : syncState === "offline" ? "Offline changes stay on this device" : "Connecting to shared storage" : "Local storage is ready"}</span></div></section>
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon settings-icon-blue"><Download size={19} /></span><div><h2>Take a copy with you</h2><p>Save a backup file or bring records back from another device.</p></div></div><div className="settings-actions"><button className="soft-button" onClick={onExport}><Download size={16} /> Download a backup</button><label className="soft-button file-button"><FileUp size={16} /> Import a backup<input type="file" accept="application/json,.json" onChange={(event) => onImport(event.target.files?.[0])} /></label><button className="soft-button" onClick={onInstall}>Add to home screen</button></div></section>
    <section className="settings-sheet assistant-settings"><div className="settings-heading"><span className="settings-icon settings-icon-blue"><Sparkles size={18} /></span><div><h2>Personal assistant</h2><p>Ask privately about your daybook or ask it to add a habit, task, goal, tracker, reminder, or note. Configure <code>GROQ_API_KEY</code> on the server to enable it.</p></div></div><button className="quiet-button" onClick={onAskAI}>Open assistant</button></section>
    <section className="settings-sheet last-settings"><div><h2>Sample workbook entries</h2><p>The starter habits and family to-dos are examples adapted from your Excel sample.</p></div><button className="quiet-button" disabled={!sampleData} onClick={onClearSamples}><Trash2 size={15} /> {sampleData ? "Clear sample entries" : "Samples cleared"}</button></section>
  </div>;
}

function EmptyState({ text, detail, action, onClick }: { text: string; detail: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><span className="empty-mark"><Sparkles size={18} /></span><h2>{text}</h2><p>{detail}</p>{action && <button className="soft-button" onClick={onClick}><Plus size={15} /> {action}</button>}</div>;
}

function EntryDialog({ kind, habit, onClose, onSave }: { kind: Exclude<DialogKind, null>; habit?: Habit; onClose: () => void; onSave: (fields: Record<string, unknown>) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const today = todayKey();
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
      onSave({ name, goal, cadence: value("cadence"), minutes: Number(value("minutes")) || undefined, successCriteria: value("successCriteria") || undefined, nonNegotiable: form.get("nonNegotiable") === "on" } as Partial<Habit> as Record<string, unknown>); return;
    }
    if (kind === "task") {
      const title = value("title"); if (!title) { setError("Add a short name for this to-do."); return; }
      onSave({ title, list: value("list") || "Family", category: (value("category") || undefined) as TaskCategory | undefined, dueDate: value("dueDate") || undefined, assignee: value("assignee") || undefined, completed: false }); return;
    }
    if (kind === "goal") {
      const title = value("title"), startDate = value("startDate"), endDate = value("endDate"), target = Number(value("target")), unit = value("unit");
      if (!title || !startDate || !endDate || endDate < startDate || !Number.isFinite(target) || target <= 0 || !unit) { setError("Add a title, valid start and end dates, a positive target, and its unit."); return; }
      onSave({ title, description: value("description") || undefined, startDate, endDate, target, unit }); return;
    }
    if (kind === "tracker") {
      const name = value("name"), unit = value("unit"), target = Number(value("target")), startDate = value("startDate"), endDate = value("endDate");
      if (!name || !unit || (value("target") && (!Number.isFinite(target) || target <= 0)) || (startDate && endDate && endDate < startDate)) { setError("Add a name and unit. Check the optional target and date range."); return; }
      onSave({ name, unit, description: value("description") || undefined, target: value("target") ? target : undefined, startDate: startDate || undefined, endDate: endDate || undefined }); return;
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

  const title = kind === "habit" && habit ? "Edit habit" : { habit: "Add a habit", task: "Add a family to-do", goal: "Set a time-bound goal", tracker: "Build a tracker", reminder: "Add a reminder", idea: "Save an idea", date: "Add an important date", journal: "Write a small memory" }[kind];
  return <dialog className="entry-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><h2>{title}</h2><p>{kind === "journal" ? "A few words are enough." : "Keep it easy to pick up later."}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={submit} noValidate>
      {kind === "habit" && <>
        <Field label="Habit name" name="name" placeholder="For example, read 10 pages" defaultValue={habit?.name} required />
        <div className="form-grid"><Field label="Goal count" name="goal" type="number" min="1" max="1000" defaultValue={habit?.goal ?? 20} required /><Field label="Time, in minutes" name="minutes" type="number" min="1" max="600" placeholder="Optional" defaultValue={habit?.minutes} /></div>
        <label className="field"><span>Goal period</span><select className="input-control" name="cadence" defaultValue={habit?.cadence ?? "month"}><option value="week">Each week</option><option value="month">Each month</option></select></label>
        <label className="field"><span>Success criteria <em>What counts as done?</em></span><textarea className="input-control textarea-control" name="successCriteria" rows={3} placeholder="For example, read at least 10 pages before bed" defaultValue={habit?.successCriteria ?? ""} /></label>
        <label className="habit-priority-toggle"><input type="checkbox" name="nonNegotiable" defaultChecked={habit?.nonNegotiable ?? false} /><span><strong>Non-negotiable</strong><small>Mark this as a habit you want to prioritize consistently.</small></span></label>
      </>}
      {kind === "task" && <>
        <Field label="What needs doing?" name="title" placeholder="Add a to-do" required />
        <label className="field"><span>Category</span><select className="input-control" name="category" defaultValue=""><option value="">Choose a category (optional)</option>{taskCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <div className="form-grid"><Field label="List" name="list" placeholder="Family" defaultValue="Family" /><Field label="Due date" name="dueDate" type="date" /></div>
        <Field label="For someone (optional)" name="assignee" placeholder="Name" />
      </>}
      {kind === "goal" && <>
        <Field label="What do you want to work toward?" name="title" placeholder="Run 40 km by New Year" required />
        <label className="field"><span>Why this matters <em>Optional</em></span><textarea className="input-control textarea-control" name="description" rows={2} placeholder="A little context for future you" /></label>
        <div className="form-grid"><Field label="Start date" name="startDate" type="date" defaultValue={today} required /><Field label="End date" name="endDate" type="date" required /></div>
        <div className="form-grid"><Field label="Target amount" name="target" type="number" min="0.01" defaultValue={10} required /><Field label="Unit" name="unit" placeholder="km, pages, sessions" required /></div>
      </>}
      {kind === "tracker" && <>
        <Field label="What do you want to track?" name="name" placeholder="Side project sessions" required />
        <Field label="What is it for?" name="description" placeholder="A short description (optional)" />
        <div className="form-grid"><Field label="Unit" name="unit" placeholder="sessions, pages, km" required /><Field label="Target (optional)" name="target" type="number" min="0.01" placeholder="10" /></div>
        <div className="form-grid"><Field label="Start date (optional)" name="startDate" type="date" /><Field label="End date (optional)" name="endDate" type="date" /></div>
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
