import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3,
  Cloud, CloudOff, Download, FileUp, Heart, Home, Lightbulb, ListChecks, Menu,
  NotebookPen, Plus, Settings, Share2, Sparkles, Timer, Trash2, X,
  LockKeyhole, UnlockKeyhole, Camera, KeyRound, Copy, BookOpen,
} from "lucide-react";
import { calculateRecentProgress, dateKey, isSampleData, liveRecords, loadLocalRecords, mergeRecords, monthCheckinCount, SAMPLE_KEY, saveLocalRecords, STORAGE_KEY } from "./data";
import { cloudConfigured, readCloudRecords, writeCloudRecords, readPrivateJournal, writePrivateJournal } from "./sync";
import { changePassword, createVault, openVault, resetPassword, sealContent, type JournalContent, type JournalEnvelope } from "./journalVault";
import type { AppRecord, FamilyDate, Habit, Idea, JournalEntry, Task, View } from "./types";

const navigation: { id: View; label: string; icon: typeof Home }[] = [
  { id: "today", label: "Today", icon: Home },
  { id: "habits", label: "Habits", icon: Check },
  { id: "tasks", label: "To-dos", icon: ListChecks },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
  { id: "dates", label: "Dates", icon: CalendarDays },
  { id: "journal", label: "Journal", icon: NotebookPen },
];
const categories = ["All ideas", "Places", "Meals", "Things to try", "Gifts"];
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

type DialogKind = "habit" | "task" | "idea" | "date" | "journal" | null;
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
  const [timerHabit, setTimerHabit] = useState<Habit | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(20);
  const [month, setMonth] = useState(() => new Date());
  const [matrixMode, setMatrixMode] = useState<"week" | "month">("week");
  const [taskFilter, setTaskFilter] = useState("Today");
  const [ideaFilter, setIdeaFilter] = useState("All ideas");
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(() => window.matchMedia("(max-width: 760px)").matches);

  const habits = liveRecords(records, "habit");
  const tasks = liveRecords(records, "task");
  const ideas = liveRecords(records, "idea");
  const dates = liveRecords(records, "date").sort((a, b) => a.date.localeCompare(b.date));
  const journal = liveRecords(records, "journal").sort((a, b) => b.date.localeCompare(a.date));
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

  const addRecord = (type: Exclude<DialogKind, null>, fields: Record<string, unknown>) => {
    const record = { ...fields, id: id(), type, updatedAt: Date.now() } as AppRecord;
    saveRecord(record);
    setDialog(null);
    setToast(type === "habit" ? "Habit added." : type === "task" ? "To-do added." : type === "idea" ? "Idea saved." : type === "date" ? "Date added." : "Memory saved.");
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
    today: "Today", habits: "Habits", tasks: "Family to-dos", ideas: "Idea shelf",
    dates: "Important dates", journal: "Private journal", settings: "Your daybook",
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
            {navigation.slice(2).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} />)}
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
              {view === "ideas" && <button className="primary-button" onClick={() => setDialog("idea")}><Plus size={17} /> Save an idea</button>}
              {view === "dates" && <button className="primary-button" onClick={() => setDialog("date")}><Plus size={17} /> Add a date</button>}
              {view === "today" && <button className="soft-button" onClick={() => chooseView("habits")}><CalendarDays size={16} /> Month view</button>}
            </div>
          </div>

          {view === "today" && <TodayPage habits={habits} records={records} tasks={dueToday} onToggle={toggleCheckin} onTimer={(habit) => { setTimerHabit(habit); setTimerSeconds((habit.minutes || 20) * 60); setTimerMinutes(habit.minutes || 20); setTimerRunning(false); }} onAdd={() => setDialog("habit")} onNavigate={chooseView} completedToday={completedToday} />}
          {view === "habits" && <HabitsPage habits={habits} records={records} month={month} setMonth={setMonth} mode={matrixMode} setMode={setMatrixMode} onToggle={toggleCheckin} onAdd={() => setDialog("habit")} onRemove={(habit) => saveRecord({ ...habit, deletedAt: Date.now(), updatedAt: Date.now() })} />}
          {view === "tasks" && <TasksPage tasks={tasks} filter={taskFilter} setFilter={setTaskFilter} onToggle={toggleTask} onDelete={(task) => saveRecord({ ...task, deletedAt: Date.now(), updatedAt: Date.now() })} onAdd={() => setDialog("task")} />}
          {view === "ideas" && <IdeasPage ideas={ideas} filter={ideaFilter} setFilter={setIdeaFilter} onDelete={(idea) => saveRecord({ ...idea, deletedAt: Date.now(), updatedAt: Date.now() })} onAdd={() => setDialog("idea")} />}
          {view === "dates" && <DatesPage dates={dates} onDelete={(event) => saveRecord({ ...event, deletedAt: Date.now(), updatedAt: Date.now() })} onAdd={() => setDialog("date")} />}
          {view === "journal" && <JournalPage legacyEntries={journal} onLegacyMigrated={() => setRecords((current) => current.filter((record) => record.type !== "journal"))} />}
          {view === "settings" && <SettingsPage syncState={syncState} configured={cloudConfigured} online={online} sampleData={sampleData} onClearSamples={removeSampleData} onExport={exportData} onImport={importData} onCopy={copyLink} onInstall={installApp} />}
        </main>

        <nav className="bottom-nav" aria-label="Main navigation">
          {navigation.slice(0, 5).map((item) => <NavItem key={item.id} item={item} active={view === item.id} onClick={() => chooseView(item.id)} compact />)}
          <button className={`nav-item compact ${view === "journal" ? "is-active" : ""}`} onClick={() => chooseView("journal")}><NotebookPen size={20} /><span>Journal</span></button>
        </nav>
      </div>

      {dialog && <EntryDialog kind={dialog} onClose={() => setDialog(null)} onSave={(fields) => addRecord(dialog, fields)} />}
      {timerHabit && <TimerDialog habit={timerHabit} seconds={timerSeconds} minutes={timerMinutes} running={timerRunning} onMinutes={setTimerMinutes} onStart={() => { if (timerSeconds === 0) setTimerSeconds(timerMinutes * 60); setTimerRunning(true); }} onPause={() => setTimerRunning(false)} onStop={() => { setTimerRunning(false); setTimerSeconds(0); }} onDone={() => { toggleCheckin(timerHabit, new Date()); setTimerRunning(false); setTimerHabit(null); setToast(`${timerHabit.name} checked off.`); }} onClose={() => { setTimerRunning(false); setTimerHabit(null); }} />}
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
    tasks: "The small things your family wants to get done.", ideas: "A shelf for plans you want to come back to.",
    dates: "Birthdays, plans, and days worth keeping free.", journal: "An unhurried place for thoughts, one page at a time.",
    settings: "Keep your shared space the way you need it.",
  };
  return subtitles[view];
}

function TodayPage({ habits, records, tasks, onToggle, onTimer, onAdd, onNavigate, completedToday }: {
  habits: Habit[]; records: AppRecord[]; tasks: Task[]; onToggle: (habit: Habit, date: Date) => void; onTimer: (habit: Habit) => void; onAdd: () => void; onNavigate: (view: View) => void; completedToday: number;
}) {
  const today = new Date();
  const progress = calculateRecentProgress(records, habits, today);
  const chartPoints = progress.days.map((day, index) => `${28 + index * (266 / Math.max(1, progress.days.length - 1))},${96 - day.rate * .76}`).join(" ");
  const chartCoordinates = progress.days.map((day, index) => ({ x: 28 + index * (266 / Math.max(1, progress.days.length - 1)), y: 96 - day.rate * .76 }));
  const chartArea = chartCoordinates.length ? `M ${chartCoordinates[0].x} 96 L ${chartPoints} L ${chartCoordinates[chartCoordinates.length - 1].x} 96 Z` : "";
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
            <span className="daily-habit-name">{habit.name}</span>
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
      <div className="progress-heading"><div><p className="panel-title">A little history helps</p><h2 id="progress-heading">Your habit progress</h2></div><span className="progress-period">Past 7 days</span></div>
      <div className="progress-grid">
        <article className="progress-card trend-card" aria-labelledby="trend-heading">
          <div className="progress-card-heading"><div><h3 id="trend-heading">Daily follow-through</h3><p>Share of your habits checked off each day</p></div><span className="progress-total"><strong>{progress.total}</strong><small>check-ins</small></span></div>
          {habits.length ? <>
            <svg className="progress-chart" viewBox="0 0 310 118" role="img" aria-label={`Daily habit completion for the past seven days: ${progress.days.map((day) => `${day.label} ${day.rate}%`).join(", ")}`} preserveAspectRatio="none">
              <line x1="28" y1="20" x2="300" y2="20" className="chart-gridline" /><line x1="28" y1="58" x2="300" y2="58" className="chart-gridline" /><line x1="28" y1="96" x2="300" y2="96" className="chart-gridline" />
              <text x="0" y="23" className="chart-axis-label">100%</text><text x="7" y="61" className="chart-axis-label">50%</text><text x="17" y="99" className="chart-axis-label">0</text>
              <path d={chartArea} className="chart-area" /><polyline points={chartPoints} className="chart-line" />
              {chartCoordinates.map((point, index) => <circle key={progress.days[index].date} cx={point.x} cy={point.y} r="3.5" className="chart-point"><title>{`${progress.days[index].label}: ${progress.days[index].rate}%`}</title></circle>)}
            </svg>
            <div className="chart-day-labels">{progress.days.map((day) => <div key={day.date}><span>{day.label}</span><strong>{day.rate}%</strong></div>)}</div>
            <p className="chart-footnote">You showed up on <strong>{progress.activeDays} of 7 days</strong>.</p>
          </> : <EmptyState text="Your graph starts here." detail="Add a habit and your daily check-ins will build a trend." action="Add a habit" onClick={onAdd} />}
        </article>
        <article className="progress-card goals-card" aria-labelledby="goals-heading">
          <div className="progress-card-heading"><div><h3 id="goals-heading">Current goals</h3><p>Progress toward this week or month</p></div></div>
          {progress.targets.length ? <div className="goal-chart-list">{progress.targets.slice(0, 5).map((target) => <div className="goal-chart-row" key={target.id}>
            <div className="goal-chart-label"><span>{target.name}</span><strong>{target.completed}/{target.goal}</strong></div>
            <div className="goal-track" role="progressbar" aria-label={`${target.name} goal progress`} aria-valuemin={0} aria-valuemax={target.goal} aria-valuenow={Math.min(target.completed, target.goal)}><span style={{ transform: `scaleX(${target.percent / 100})` }} /></div>
            <small>{target.cadence === "week" ? "this week" : "this month"}</small>
          </div>)}</div> : <p className="quiet-note">Add a habit to set your first goal.</p>}
          {habits.length > 5 && <button className="text-link" onClick={() => onNavigate("habits")}>See all {habits.length} goals <ChevronRight size={15} /></button>}
        </article>
      </div>
    </section>
  </div>;
}

function HabitsPage({ habits, records, month, setMonth, mode, setMode, onToggle, onAdd, onRemove }: {
  habits: Habit[]; records: AppRecord[]; month: Date; setMonth: (date: Date) => void; mode: "week" | "month"; setMode: (value: "week" | "month") => void; onToggle: (habit: Habit, date: Date) => void; onAdd: () => void; onRemove: (habit: Habit) => void;
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
            <th scope="row" className="habit-name-cell"><div className="habit-row-content"><div><span className="habit-name-label">{habit.name}</span><span className="habit-goal-label">{count} of {habit.goal} {habit.cadence === "month" ? "this month" : "this week"}</span></div><button className="habit-remove" onClick={() => onRemove(habit)} aria-label={`Remove habit ${habit.name}`} title={`Remove ${habit.name}`}><Trash2 size={14} /></button></div></th>
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

function TasksPage({ tasks, filter, setFilter, onToggle, onDelete, onAdd }: { tasks: Task[]; filter: string; setFilter: (value: string) => void; onToggle: (task: Task) => void; onDelete: (task: Task) => void; onAdd: () => void }) {
  const lists = [...new Set(tasks.map((task) => task.list || "Family"))];
  const filters = ["Today", "All to-dos", ...lists];
  const shown = tasks.filter((task) => filter === "All to-dos" || (filter === "Today" ? !task.completed && (!task.dueDate || task.dueDate <= todayKey()) : task.list === filter)).sort((a, b) => Number(a.completed) - Number(b.completed) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
  return <section className="list-sheet paper-sheet">
    <div className="filter-tabs" role="tablist" aria-label="To-do lists">{filters.map((name) => <button key={name} className={filter === name ? "selected" : ""} role="tab" aria-selected={filter === name} onClick={() => setFilter(name)}>{name}</button>)}</div>
    <div className="task-list">
      {shown.map((task) => <div className={`task-row ${task.completed ? "is-complete" : ""}`} key={task.id}>
        <button className="check-button" aria-label={`${task.completed ? "Reopen" : "Complete"}: ${task.title}`} aria-pressed={task.completed} onClick={() => onToggle(task)}><Check size={15} /></button>
        <span className="task-title">{task.title}</span>
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
      const initial = { pages: [{ id: crypto.randomUUID(), text: migrated, updatedAt: Date.now() }], photos: [] };
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
    <section className="journal-paper paper-sheet" aria-label="Journal page"><div className="paper-page-top"><span>DAYBOOK · PERSONAL NOTES</span><span>{String(pageIndex + 1).padStart(2, "0")}</span></div><textarea aria-label={`Journal page ${pageIndex + 1}`} className="freeflow-page" value={page?.text ?? ""} onBlur={() => void saveNow()} onChange={(event) => updatePage(event.target.value)} placeholder="Let your thoughts find their own shape…" spellCheck /><div className="paper-page-bottom"><span>Write freely. This page has no date or prompt.</span><div className="page-turn"><button className="icon-button" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)} aria-label="Previous page"><ChevronLeft size={18} /></button><span>Page {pageIndex + 1} of {content.pages.length}</span><button className="icon-button" disabled={pageIndex === content.pages.length - 1} onClick={() => setPageIndex((index) => index + 1)} aria-label="Next page"><ChevronRight size={18} /></button><button className="soft-button page-add" onClick={addPage}><Plus size={15} /> New page</button></div></div></section>
    <section className="photo-gallery paper-sheet"><div className="gallery-heading"><span className="lock-emblem"><Camera size={18} /></span><div><h2>Private photo gallery</h2><p>Pictures are separate from your writing and encrypted before upload.</p></div><button className="soft-button" onClick={() => photoInput.current?.click()}><Camera size={15} /> Take a photo</button></div>{content.photos.length ? <div className="gallery-grid">{content.photos.map((photo) => <figure className="gallery-photo" key={photo.id}><img src={photo.image} alt={photo.label || "Private gallery photo"} /><div><input aria-label="Photo label" value={photo.label} onChange={(event) => setContent({ ...content, photos: content.photos.map((item) => item.id === photo.id ? { ...item, label: event.target.value } : item) })} /><button className="row-delete" onClick={() => setContent({ ...content, photos: content.photos.filter((item) => item.id !== photo.id) })} aria-label="Remove photo"><Trash2 size={15} /></button></div></figure>)}</div> : <div className="gallery-empty"><Camera size={19} /><span>Photos you add will live here, separate from your pages.</span></div>}</section>
  </div>;
}

function SettingsPage({ syncState, configured, online, sampleData, onClearSamples, onExport, onImport, onCopy, onInstall }: {
  syncState: SyncState; configured: boolean; online: boolean; sampleData: boolean; onClearSamples: () => void; onExport: () => void; onImport: (file?: File) => void; onCopy: () => void; onInstall: () => void;
}) {
  return <div className="settings-page">
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon"><Share2 size={19} /></span><div><h2>Open family link</h2><p>Anyone with this link can view and edit the shared family daybook. No account or password is needed.</p></div></div><div className="public-note"><strong>Your private journal is separate.</strong><span>Journal pages and gallery photos are encrypted before they are sent to {cloudConfigured ? "Supabase" : "the local journal service"}. The storage contains encrypted data, not readable photos or text.</span></div><button className="primary-button" onClick={onCopy}><Share2 size={16} /> Copy the daybook link</button></section>
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon settings-icon-green"><Cloud size={19} /></span><div><h2>Sync between devices</h2><p>{configured ? `Cloud sync is set up. ${syncState === "synced" ? "Your latest changes are saved online." : "Changes will sync when your connection is back."}` : "This copy currently saves to this device. Add a Supabase project to share it across devices."}</p></div></div>{!configured && <div className="setup-steps"><p className="steps-lead">Connect shared sync in three small steps</p><ol><li>Create a free Supabase project and copy its project URL and anon key.</li><li>Run the SQL in <code>supabase/schema.sql</code> in the project’s SQL editor.</li><li>Copy <code>.env.example</code> to <code>.env.local</code>, add the two values, then restart the app.</li></ol><p className="public-note compact-note"><strong>This creates an open database.</strong><span>Anyone with the app URL can read, add, change, or remove records. Do not use confidential information.</span></p></div>}<div className="sync-status-line"><span className={`status-dot ${online && syncState === "synced" ? "is-green" : ""}`} /><span>{configured ? syncState === "synced" ? "Connected" : syncState === "offline" ? "Offline changes stay on this device" : "Connecting to shared storage" : "Local storage is ready"}</span></div></section>
    <section className="settings-sheet paper-sheet"><div className="settings-heading"><span className="settings-icon settings-icon-blue"><Download size={19} /></span><div><h2>Take a copy with you</h2><p>Save a backup file or bring records back from another device.</p></div></div><div className="settings-actions"><button className="soft-button" onClick={onExport}><Download size={16} /> Download a backup</button><label className="soft-button file-button"><FileUp size={16} /> Import a backup<input type="file" accept="application/json,.json" onChange={(event) => onImport(event.target.files?.[0])} /></label><button className="soft-button" onClick={onInstall}>Add to home screen</button></div></section>
    <section className="settings-sheet last-settings"><div><h2>Sample workbook entries</h2><p>The starter habits and family to-dos are examples adapted from your Excel sample.</p></div><button className="quiet-button" disabled={!sampleData} onClick={onClearSamples}><Trash2 size={15} /> {sampleData ? "Clear sample entries" : "Samples cleared"}</button></section>
  </div>;
}

function EmptyState({ text, detail, action, onClick }: { text: string; detail: string; action?: string; onClick?: () => void }) {
  return <div className="empty-state"><span className="empty-mark"><Sparkles size={18} /></span><h2>{text}</h2><p>{detail}</p>{action && <button className="soft-button" onClick={onClick}><Plus size={15} /> {action}</button>}</div>;
}

function EntryDialog({ kind, onClose, onSave }: { kind: Exclude<DialogKind, null>; onClose: () => void; onSave: (fields: Record<string, unknown>) => void }) {
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
      onSave({ name, goal, cadence: value("cadence"), minutes: Number(value("minutes")) || undefined } as Partial<Habit> as Record<string, unknown>); return;
    }
    if (kind === "task") {
      const title = value("title"); if (!title) { setError("Add a short name for this to-do."); return; }
      onSave({ title, list: value("list") || "Family", dueDate: value("dueDate") || undefined, assignee: value("assignee") || undefined, completed: false }); return;
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

  const title = { habit: "Add a habit", task: "Add a family to-do", idea: "Save an idea", date: "Add an important date", journal: "Write a small memory" }[kind];
  return <dialog className="entry-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><h2>{title}</h2><p>{kind === "journal" ? "A few words are enough." : "Keep it easy to pick up later."}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={submit} noValidate>
      {kind === "habit" && <>
        <Field label="Habit name" name="name" placeholder="For example, read 10 pages" required />
        <div className="form-grid"><Field label="Goal count" name="goal" type="number" min="1" max="1000" defaultValue="20" required /><Field label="Time, in minutes" name="minutes" type="number" min="1" max="600" placeholder="Optional" /></div>
        <label className="field"><span>Goal period</span><select className="input-control" name="cadence" defaultValue="month"><option value="week">Each week</option><option value="month">Each month</option></select></label>
      </>}
      {kind === "task" && <>
        <Field label="What needs doing?" name="title" placeholder="Add a to-do" required />
        <div className="form-grid"><Field label="List" name="list" placeholder="Family" defaultValue="Family" /><Field label="Due date" name="dueDate" type="date" /></div>
        <Field label="For someone (optional)" name="assignee" placeholder="Name" />
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
