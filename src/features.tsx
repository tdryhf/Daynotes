import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bell, ChevronDown, Clock3, MessageSquareText, Plus, Sparkles, Target, TrendingUp, Trash2, X } from "lucide-react";
import { calculateConsistencyGrid } from "./data";
import { askAssistant, type AssistantToolCall, type ChatMessage } from "./ai";
import type { AppRecord, CustomTracker, Goal, GoalProgress, Habit, JournalNote, Reminder, Task, TrackerEntry } from "./types";

const today = () => {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};
const prettyDate = (value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, options);
};

export function ConsistencyVisualization({ records, habits, onAdd }: { records: AppRecord[]; habits: Habit[]; onAdd: () => void }) {
  const [weeks, setWeeks] = useState(12);
  const consistency = calculateConsistencyGrid(records, habits, new Date(), weeks);
  const dates = consistency.cells;
  const weekdayLabels = ["M", "T", "W", "T", "F", "S", "S"];
  return <div className="consistency-visualization">
    <div className="consistency-topline">
      <div><p className="panel-title">Your rhythm, at a glance</p><h3>Consistency map</h3><p className="consistency-caption">Each square is one day. Stronger color means more of your habits happened.</p></div>
      <div className="view-switch" role="group" aria-label="Consistency period">{[4, 8, 12].map((value) => <button type="button" key={value} className={weeks === value ? "selected" : ""} onClick={() => setWeeks(value)}>{value} weeks</button>)}</div>
    </div>
    {!habits.length ? <div className="consistency-empty"><Sparkles size={19} /><div><strong>Your consistency map starts with one habit.</strong><p>Check-ins will build a useful picture over time.</p></div><button className="soft-button" onClick={onAdd}><Plus size={15} /> Add a habit</button></div> : <>
      <div className="consistency-stats">
        <div className="consistency-stat consistency-stat-primary"><span>Follow-through</span><strong>{consistency.percent}<small>%</small></strong><em>of possible check-ins</em></div>
        <div className="consistency-stat"><span>Active days</span><strong>{consistency.activeDays}<small>/{consistency.eligibleDays}</small></strong><em>days with a check-in</em></div>
        <div className="consistency-stat"><span>Check-ins</span><strong>{consistency.completedCount}<small> total</small></strong><em>across all habits</em></div>
        <div className="consistency-stat"><span>Current streak</span><strong>{consistency.currentStreak}<small> days</small></strong><em>in a row with a check-in</em></div>
      </div>
      <div className="consistency-main-grid">
        <section className="heatmap-card" aria-label={`${weeks}-week habit completion calendar`}>
          <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} aria-hidden="true">{Array.from({ length: weeks }, (_, index) => {
            const weekStart = dates[index * 7]?.date ?? "";
            const priorMonth = index > 0 ? dates[(index - 1) * 7]?.date.slice(0, 7) : "";
            const currentMonth = weekStart.slice(0, 7);
            return <span key={index}>{index === 0 || currentMonth !== priorMonth ? prettyDate(weekStart, { month: "short" }) : ""}</span>;
          })}</div>
          <div className="heatmap-body"><div className="heatmap-weekdays" aria-hidden="true">{weekdayLabels.map((label, index) => <span key={index}>{index % 2 === 0 ? label : ""}</span>)}</div><div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>{dates.map((cell) => <span key={cell.date} className={`heatmap-cell ${cell.eligible ? `heatmap-level-${cell.rate === 0 ? 0 : cell.rate < 25 ? 1 : cell.rate < 50 ? 2 : cell.rate < 75 ? 3 : 4}` : "heatmap-future"}`} title={`${prettyDate(cell.date, { weekday: "long", month: "long", day: "numeric" })}: ${cell.completed} of ${cell.total} habits`} aria-label={`${prettyDate(cell.date, { weekday: "long", month: "long", day: "numeric" })}: ${cell.completed} of ${cell.total} habits`} />)}</div></div>
          <div className="heatmap-legend"><span>Less</span>{[0, 1, 2, 3, 4].map((level) => <span aria-hidden="true" key={level} className={`heatmap-cell heatmap-level-${level}`} />)}<span>More</span></div>
        </section>
        <section className="weekly-card" aria-label="Weekly completion trend"><div className="feature-section-heading"><div><h4>Week by week</h4><p>Completion across all active habits</p></div><TrendingUp size={17} /></div><div className="weekly-bars">{consistency.weekly.map((week, index) => <div className="weekly-bar-column" key={`${week.label}-${index}`} title={`${week.label}: ${week.rate}%`}><div className="weekly-bar-track"><span style={{ height: `${week.rate}%` }} /></div><small>{index % (weeks > 8 ? 2 : 1) === 0 ? week.label : ""}</small></div>)}</div><div className="weekly-scale"><span>0%</span><span>100%</span></div></section>
      </div>
      <section className="habit-consistency-section"><div className="feature-section-heading"><div><h4>How each habit is holding up</h4><p>Progress toward each habit’s weekly or monthly target</p></div></div><div className="habit-consistency-list">{consistency.habitConsistency.slice(0, 8).map((habit) => <div className="habit-consistency-row" key={habit.id}><span>{habit.name}</span><div className="goal-track"><span style={{ transform: `scaleX(${habit.percent / 100})` }} /></div><strong>{habit.percent}%</strong><small>{habit.count} of {habit.expected}</small></div>)}</div>{consistency.habitConsistency.length > 8 && <p className="quiet-note">Showing the first 8 habits. Your full calendar has every habit.</p>}</section>
    </>}
  </div>;
}

export function NotesTimeline({ notes, ownerType, ownerId, ownerName, onSave }: { notes: JournalNote[]; ownerType: JournalNote["ownerType"]; ownerId: string; ownerName: string; onSave: (text: string, sessionDate: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [sessionDate, setSessionDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const relevant = notes.filter((note) => note.ownerType === ownerType && note.ownerId === ownerId).sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.updatedAt - a.updatedAt);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true); setError("");
    try { await onSave(text, sessionDate); setDraft(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This note could not be saved."); }
    finally { setSaving(false); }
  };
  return <div className="notes-timeline">
    {relevant.length ? <div className="session-notes-list">{relevant.map((note) => <article className="session-note" key={note.id}><div className="session-note-date"><Clock3 size={13} />{prettyDate(note.sessionDate, { month: "short", day: "numeric", year: "numeric" })}</div><p>{note.polishedText || note.rawText}</p>{note.summary && <div className="note-summary"><Sparkles size={14} /><span>{note.summary}</span></div>}{note.keyIdeas?.length ? <ul className="note-ideas">{note.keyIdeas.map((idea, index) => <li key={`${index}-${idea}`}>{idea}</li>)}</ul> : null}{note.polishedText && note.polishedText !== note.rawText && <details className="original-note"><summary>Original note</summary><p>{note.rawText}</p></details>}</article>)}</div> : <p className="quiet-note notes-empty">No notes yet. Add a quick entry to keep the details for next time.</p>}
    <form className="note-composer" aria-label={`Notes for ${ownerName}`} onSubmit={(event) => void submit(event)}><label className="field"><span>{ownerType === "task" ? "Add a comment" : "Log a session"}<em>AI will clean it up and pull out the main ideas</em></span><textarea className="input-control textarea-control" rows={3} maxLength={6000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={ownerType === "habit" ? "What did you do? Add distance, time, or how it felt…" : "Jot down what happened, in your own words…"} /></label><div className="note-composer-footer"><label className="field note-date-field"><span>Session date</span><input className="input-control" type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} /></label><span className="quiet-note note-privacy">Saved with {ownerName} in this shared daybook.</span><button type="submit" className="primary-button" disabled={!draft.trim() || saving}>{saving ? <><Sparkles size={15} /> Polishing…</> : <><Plus size={15} /> Save note</>}</button></div>{error && <p className="form-error" role="alert">{error}</p>}</form>
  </div>;
}

export function HabitDetailsDialog({ habit, notes, onClose, onEdit, onDelete, onSaveNote }: { habit: Habit; notes: JournalNote[]; onClose: () => void; onEdit: () => void; onDelete: () => void; onSaveNote: (text: string, date: string) => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialogRef.current; if (!element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, []);
  return <dialog className="entry-dialog habit-details-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><p className="journal-kicker">Habit journal</p><h2>{habit.name}</h2><p>{habit.nonNegotiable ? "Non-negotiable habit" : "Habit details"} · {habit.goal} times {habit.cadence === "month" ? "each month" : "each week"}</p></div><button className="icon-button" onClick={onClose} aria-label="Close habit details"><X size={19} /></button></div>
    <section className="habit-criteria"><h3>Success criteria</h3><p>{habit.successCriteria || "No success criteria added yet."}</p></section>
    <section className="detail-notes"><div className="feature-section-heading"><div><h3>Session notes</h3><p>Record distance, time, effort, or anything you want to remember.</p></div><MessageSquareText size={17} /></div><NotesTimeline notes={notes} ownerType="habit" ownerId={habit.id} ownerName={habit.name} onSave={onSaveNote} /></section>
    <div className="dialog-actions"><button className="quiet-button habit-delete-action" onClick={onDelete}>Delete habit</button><button className="soft-button" onClick={onClose}>Close</button><button className="primary-button" onClick={onEdit}>Edit habit</button></div>
  </dialog>;
}

export function TaskDetailsDialog({ task, notes, onClose, onSaveNote }: { task: Task; notes: JournalNote[]; onClose: () => void; onSaveNote: (text: string, date: string) => Promise<void> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialogRef.current; if (!element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, []);
  return <dialog className="entry-dialog task-details-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><p className="journal-kicker">{task.list || "Family"} to-do</p><h2>{task.title}</h2><p>{task.dueDate ? `Due ${prettyDate(task.dueDate)}` : "No deadline set"}{task.completed ? " · Completed" : " · In progress"}</p></div><button className="icon-button" onClick={onClose} aria-label="Close to-do details"><X size={19} /></button></div>
    <section className="detail-notes"><div className="feature-section-heading"><div><h3>Comments and updates</h3><p>Keep small notes on what changed or what comes next.</p></div><MessageSquareText size={17} /></div><NotesTimeline notes={notes} ownerType="task" ownerId={task.id} ownerName={task.title} onSave={onSaveNote} /></section>
    <div className="dialog-actions"><button className="soft-button" onClick={onClose}>Close</button></div>
  </dialog>;
}

export function GoalsPage({ goals, progress, notes, onAdd, onLog, onSaveNote, onDelete }: { goals: Goal[]; progress: GoalProgress[]; notes: JournalNote[]; onAdd: () => void; onLog: (goal: Goal, amount: number, date: string, note: string) => void; onSaveNote: (goal: Goal, text: string, date: string) => Promise<void>; onDelete: (goal: Goal) => void }) {
  const ordered = [...goals].sort((a, b) => a.endDate.localeCompare(b.endDate));
  return <div className="feature-page goals-page">
    <section className="feature-intro paper-sheet"><span className="feature-icon feature-icon-green"><Target size={20} /></span><div><h2>Give your effort a time frame</h2><p>Set a clear target, choose when it starts and ends, and record progress as you go.</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} /> Set a goal</button></section>
    {ordered.length ? <div className="goal-card-grid">{ordered.map((goal) => <GoalCard key={goal.id} goal={goal} progress={progress.filter((item) => item.goalId === goal.id)} notes={notes} onLog={onLog} onSaveNote={onSaveNote} onDelete={onDelete} />)}</div> : <section className="feature-empty paper-sheet"><span className="empty-mark"><Target size={18} /></span><h2>What would you like to work toward?</h2><p>A goal becomes easier to follow when it has a start, an end, and something you can count.</p><button className="primary-button" onClick={onAdd}><Plus size={16} /> Set your first goal</button></section>}
  </div>;
}

function GoalCard({ goal, progress, notes, onLog, onSaveNote, onDelete }: { goal: Goal; progress: GoalProgress[]; notes: JournalNote[]; onLog: (goal: Goal, amount: number, date: string, note: string) => void; onSaveNote: (goal: Goal, text: string, date: string) => Promise<void>; onDelete: (goal: Goal) => void }) {
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const total = progress.reduce((sum, item) => sum + item.amount, 0);
  const percent = Math.min(100, Math.round(total / goal.target * 100));
  const status = today() < goal.startDate ? "Starts soon" : today() > goal.endDate ? total >= goal.target ? "Reached" : "Time window ended" : "In progress";
  const left = Math.max(0, Math.ceil((new Date(`${goal.endDate}T12:00:00`).getTime() - new Date(`${today()}T12:00:00`).getTime()) / 86_400_000));
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = Number(amount); if (value <= 0) return; onLog(goal, value, today(), note.trim()); setAmount("1"); setNote(""); };
  return <article className="goal-feature-card paper-sheet"><div className="goal-feature-heading"><span className="feature-icon feature-icon-gold"><Target size={19} /></span><span className={`goal-status ${status === "In progress" ? "is-active" : ""}`}>{status}</span><button className="row-delete feature-delete" onClick={() => onDelete(goal)} aria-label={`Delete goal ${goal.title}`}><Trash2 size={15}/></button></div><h2>{goal.title}</h2>{goal.description && <p className="goal-description">{goal.description}</p>}<div className="goal-dates"><span>{prettyDate(goal.startDate)}</span><span className="goal-date-rule" /><span>{prettyDate(goal.endDate)}</span></div><div className="goal-progress-copy"><strong>{Number.isInteger(total) ? total : total.toFixed(1)} <small>{goal.unit}</small></strong><span>of {goal.target} {goal.unit}</span></div><div className="goal-feature-track"><span style={{ width: `${percent}%` }} /></div><div className="goal-progress-foot"><span>{percent}% complete</span><span>{status === "In progress" ? `${left} day${left === 1 ? "" : "s"} left` : `${progress.length} progress entr${progress.length === 1 ? "y" : "ies"}`}</span></div>{progress.length > 0 && <details className="feature-notes-disclosure progress-history"><summary>Progress history <span>{progress.length}</span><ChevronDown size={15}/></summary><div className="progress-history-list">{[...progress].sort((a, b) => b.date.localeCompare(a.date)).map((entry) => <div key={entry.id}><time>{prettyDate(entry.date)}</time><strong>+{entry.amount} {goal.unit}</strong>{entry.note && <span>{entry.note}</span>}</div>)}</div></details>}<form className="goal-log-form" onSubmit={submit}><label className="field"><span>Add progress</span><div className="progress-entry-fields"><input className="input-control" type="number" min="0.01" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label={`Amount of ${goal.unit}`} /><input className="input-control" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional note" aria-label="Progress note" /><button className="soft-button" type="submit"><Plus size={14} /> Log</button></div></label></form><details className="feature-notes-disclosure"><summary>Session notes <span>{notes.filter((entry) => entry.ownerType === "goal" && entry.ownerId === goal.id).length}</span><ChevronDown size={15} /></summary><NotesTimeline notes={notes} ownerType="goal" ownerId={goal.id} ownerName={goal.title} onSave={(text, date) => onSaveNote(goal, text, date)} /></details></article>;
}

export function TrackersPage({ trackers, entries, notes, onAdd, onLog, onSaveNote, onDelete }: { trackers: CustomTracker[]; entries: TrackerEntry[]; notes: JournalNote[]; onAdd: () => void; onLog: (tracker: CustomTracker, value: number, date: string, note: string) => void; onSaveNote: (tracker: CustomTracker, text: string, date: string) => Promise<void>; onDelete: (tracker: CustomTracker) => void }) {
  return <div className="feature-page trackers-page"><section className="feature-intro paper-sheet"><span className="feature-icon feature-icon-blue"><TrendingUp size={20} /></span><div><h2>Make a tracker for what matters to you</h2><p>Track a side project, miles run, books read, practice sessions, or anything you can count.</p></div><button className="primary-button" onClick={onAdd}><Plus size={16} /> Build a tracker</button></section>{trackers.length ? <div className="tracker-card-grid">{trackers.map((tracker) => <TrackerCard key={tracker.id} tracker={tracker} entries={entries.filter((entry) => entry.trackerId === tracker.id)} notes={notes} onLog={onLog} onSaveNote={onSaveNote} onDelete={onDelete} />)}</div> : <section className="feature-empty paper-sheet"><span className="empty-mark"><TrendingUp size={18} /></span><h2>Start with something you are curious about</h2><p>Choose a name and unit. You can add dates and a target when those help.</p><button className="primary-button" onClick={onAdd}><Plus size={16} /> Create a tracker</button></section>}</div>;
}

function TrackerCard({ tracker, entries, notes, onLog, onSaveNote, onDelete }: { tracker: CustomTracker; entries: TrackerEntry[]; notes: JournalNote[]; onLog: (tracker: CustomTracker, value: number, date: string, note: string) => void; onSaveNote: (tracker: CustomTracker, text: string, date: string) => Promise<void>; onDelete: (tracker: CustomTracker) => void }) {
  const [value, setValue] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt);
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  const displayed = ordered.slice(-14);
  const max = Math.max(1, ...displayed.map((entry) => entry.value));
  const chartPoints = displayed.map((entry, index) => `${displayed.length > 1 ? 16 + index * (268 / (displayed.length - 1)) : 150},${82 - entry.value / max * 62}`).join(" ");
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const number = Number(value); if (number <= 0) return; onLog(tracker, number, today(), entryNote.trim()); setValue(""); setEntryNote(""); };
  const percent = tracker.target ? Math.min(100, Math.round(total / tracker.target * 100)) : null;
  return <article className="tracker-feature-card paper-sheet"><div className="tracker-feature-heading"><span className="feature-icon feature-icon-blue"><TrendingUp size={18} /></span>{tracker.target && <span className="tracker-target">{percent}% of target</span>}<button className="row-delete feature-delete" onClick={() => onDelete(tracker)} aria-label={`Delete tracker ${tracker.name}`}><Trash2 size={15}/></button></div><h2>{tracker.name}</h2>{tracker.description && <p className="tracker-description">{tracker.description}</p>}{(tracker.startDate || tracker.endDate) && <p className="tracker-range">{tracker.startDate ? prettyDate(tracker.startDate) : "Started anytime"} <span>→</span> {tracker.endDate ? prettyDate(tracker.endDate) : "Open-ended"}</p>}<div className="tracker-metrics"><strong>{total.toLocaleString(undefined, { maximumFractionDigits: 1 })}<small> {tracker.unit}</small></strong><span>{entries.length} log entr{entries.length === 1 ? "y" : "ies"}</span></div>{displayed.length > 1 ? <div className="tracker-chart-wrap"><svg className="tracker-chart" viewBox="0 0 300 100" role="img" aria-label={`Recent ${tracker.name} entries: ${displayed.map((entry) => `${entry.date} ${entry.value} ${tracker.unit}`).join(", ")}`}><line x1="12" y1="84" x2="288" y2="84" className="chart-gridline"/><polyline points={chartPoints} className="tracker-line"/>{displayed.map((entry, index) => <circle key={entry.id} cx={displayed.length > 1 ? 16 + index * (268 / (displayed.length - 1)) : 150} cy={82 - entry.value / max * 62} r="3.2" className="tracker-point"><title>{`${prettyDate(entry.date)}: ${entry.value} ${tracker.unit}`}</title></circle>)}</svg><div className="tracker-chart-labels"><span>{displayed[0].date.slice(5)}</span><span>{displayed[displayed.length - 1].date.slice(5)}</span></div></div> : <div className="tracker-chart-empty">{entries.length ? "One entry logged. A trend will appear after the next one." : "Log a session to start your trend."}</div>}{tracker.target && <div className="goal-track tracker-goal-track"><span style={{ transform: `scaleX(${(percent ?? 0) / 100})` }}/></div>}{entries.length > 0 && <details className="feature-notes-disclosure progress-history"><summary>Log history <span>{entries.length}</span><ChevronDown size={15}/></summary><div className="progress-history-list">{[...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map((entry) => <div key={entry.id}><time>{prettyDate(entry.date)}</time><strong>+{entry.value} {tracker.unit}</strong>{entry.note && <span>{entry.note}</span>}</div>)}</div></details>}<form className="tracker-log-form" onSubmit={submit}><label className="field"><span>Log {tracker.unit}</span><div className="progress-entry-fields"><input className="input-control" type="number" min="0.01" step="any" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Amount" aria-label={`Amount of ${tracker.unit}`} required/><input className="input-control" value={entryNote} onChange={(event) => setEntryNote(event.target.value)} placeholder="Quick note (optional)" aria-label="Entry note"/><button className="soft-button" type="submit"><Plus size={14}/> Log</button></div></label></form><details className="feature-notes-disclosure"><summary>Session journal <span>{notes.filter((note) => note.ownerType === "tracker" && note.ownerId === tracker.id).length}</span><ChevronDown size={15} /></summary><NotesTimeline notes={notes} ownerType="tracker" ownerId={tracker.id} ownerName={tracker.name} onSave={(text, date) => onSaveNote(tracker, text, date)}/></details></article>;
}

export function RemindersPage({ reminders, permission, onRequestPermission, onAdd, onDelete, onToggle }: { reminders: Reminder[]; permission: NotificationPermission | "unsupported"; onRequestPermission: () => void; onAdd: (fields: { title: string; details?: string; scheduledAt: string; repeat: "none" | "weekly" }) => void; onDelete: (reminder: Reminder) => void; onToggle: (reminder: Reminder) => void }) {
  const initialTime = new Date(Date.now() + 3_600_000 - (new Date().getMinutes() % 5) * 60_000);
  initialTime.setSeconds(0, 0);
  const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [repeat, setRepeat] = useState<"none" | "weekly">("none");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(initialTime));
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const stamp = new Date(scheduledAt); if (!title.trim() || Number.isNaN(stamp.getTime())) { setError("Add a reminder name and a valid date and time."); return; } if (stamp.getTime() < Date.now()) { setError("Choose a time in the future."); return; } onAdd({ title: title.trim(), details: details.trim() || undefined, scheduledAt: stamp.toISOString(), repeat }); setTitle(""); setDetails(""); setError(""); };
  const upcoming = reminders.filter((reminder) => reminder.enabled && !reminder.notifiedAt).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const past = reminders.filter((reminder) => !reminder.enabled || reminder.notifiedAt).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const permissionText = permission === "granted" ? "Notifications are enabled on this device." : permission === "denied" ? "Notifications are blocked in browser settings." : permission === "unsupported" ? "This browser does not support web notifications." : "Allow notifications so Daybook can remind you.";
  return <div className="feature-page reminders-page"><section className="reminder-permission paper-sheet"><span className={`feature-icon ${permission === "granted" ? "feature-icon-green" : "feature-icon-gold"}`}><Bell size={20}/></span><div><h2>Keep a gentle nudge nearby</h2><p>{permissionText} For reliable delivery, keep Daybook open around the reminder time.</p></div>{permission !== "granted" && permission !== "unsupported" && <button className="soft-button" onClick={onRequestPermission}>Enable notifications</button>}</section><section className="reminder-create paper-sheet"><div className="feature-section-heading"><div><p className="panel-title">A dance class, a call, a pause</p><h2>Add a reminder</h2></div><Clock3 size={18}/></div><form className="reminder-form" onSubmit={submit}><label className="field"><span>What should we remind you about?</span><input className="input-control" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dance class" required/></label><div className="form-grid"><label className="field"><span>Date and time</span><input className="input-control" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required/></label><label className="field"><span>Repeat</span><select className="input-control" value={repeat} onChange={(event) => setRepeat(event.target.value as "none" | "weekly")}><option value="none">Just once</option><option value="weekly">Every week</option></select></label></div><label className="field"><span>Details <em>Optional</em></span><input className="input-control" value={details} onChange={(event) => setDetails(event.target.value)} placeholder="Bring your shoes"/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" type="submit"><Plus size={16}/> Save reminder</button></form></section><section className="reminder-list paper-sheet"><div className="feature-section-heading"><div><p className="panel-title">Coming up</p><h2>Your reminders</h2></div><span className="reminder-count">{upcoming.length} active</span></div>{upcoming.length ? <div className="reminder-items">{upcoming.map((reminder) => <ReminderRow key={reminder.id} reminder={reminder} onDelete={onDelete} onToggle={onToggle}/>)}</div> : <p className="quiet-note">No active reminders yet. Add one for the next thing you want to remember.</p>}{past.length > 0 && <details className="past-reminders"><summary>Past and paused <span>{past.length}</span><ChevronDown size={15}/></summary><div className="reminder-items">{past.map((reminder) => <ReminderRow key={reminder.id} reminder={reminder} onDelete={onDelete} onToggle={onToggle}/>)}</div></details>}</section></div>;
}

function ReminderRow({ reminder, onDelete, onToggle }: { reminder: Reminder; onDelete: (reminder: Reminder) => void; onToggle: (reminder: Reminder) => void }) {
  const date = new Date(reminder.scheduledAt);
  return <article className={`reminder-row ${reminder.notifiedAt ? "is-delivered" : ""}`}><span className="reminder-time-block"><strong>{date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</strong><small>{date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</small></span><div className="reminder-copy"><h3>{reminder.title}</h3>{reminder.details && <p>{reminder.details}</p>}<small>{reminder.notifiedAt ? "Reminder sent" : reminder.repeat === "weekly" ? "Repeats every week" : "One-time reminder"}</small></div><button className={`reminder-toggle ${reminder.enabled ? "is-enabled" : ""}`} onClick={() => onToggle(reminder)} aria-pressed={reminder.enabled} aria-label={`${reminder.enabled ? "Pause" : "Enable"} reminder ${reminder.title}`}><Bell size={16}/></button><button className="row-delete" onClick={() => onDelete(reminder)} aria-label={`Delete reminder ${reminder.title}`}><Trash2 size={15}/></button></article>;
}

export function AssistantDialog({ records, onClose, onToolCall }: { records: AppRecord[]; onClose: () => void; onToolCall: (call: AssistantToolCall) => Promise<Record<string, unknown>> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { const element = dialogRef.current; if (!element) return; element.showModal(); return () => { if (element.open) element.close(); }; }, []);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [transcript, status]);
  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft(""); setError(""); setBusy(true); setStatus("Thinking…");
    const visible = [...transcript, { role: "user" as const, content: text }];
    setTranscript(visible);
    const messages: ChatMessage[] = [...history, { role: "user", content: text }];
    try {
      for (let turn = 0; turn < 5; turn += 1) {
        const response = await askAssistant(messages, records);
        if (response.toolCalls.length) {
          messages.push(response.raw as ChatMessage);
          setStatus("Updating your daybook…");
          for (const call of response.toolCalls) {
            let result: Record<string, unknown>;
            try { result = await onToolCall(call); }
            catch (reason) { result = { ok: false, message: reason instanceof Error ? reason.message : "That action could not be completed." }; }
            messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
          }
          continue;
        }
        const answer = response.content || "I could not form a useful answer from those records yet.";
        messages.push({ role: "assistant", content: answer });
        setHistory(messages);
        setTranscript([...visible, { role: "assistant", content: answer }]);
        setStatus("");
        return;
      }
      setHistory(messages);
      const answer = "I made the requested updates. What would you like to check next?";
      setTranscript([...visible, { role: "assistant", content: answer }]); setStatus("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The assistant could not reach Groq.");
      setStatus("");
      setTranscript(visible);
      setHistory(messages);
    } finally { setBusy(false); }
  };
  return <dialog className="entry-dialog assistant-dialog" ref={dialogRef} onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="dialog-heading"><div><p className="journal-kicker">A quiet helper</p><h2>Ask your daybook</h2><p>Ask about your routines, notes, goals, or make a change.</p></div><button className="icon-button" onClick={onClose} aria-label="Close assistant"><X size={19}/></button></div><div className="assistant-privacy"><Sparkles size={14}/><span>Your daybook records are sent to Groq while you chat.</span></div><div className="assistant-transcript" aria-live="polite">{transcript.length ? transcript.map((message, index) => <article className={`assistant-message is-${message.role}`} key={`${index}-${message.role}`}><span>{message.role === "user" ? "You" : "Daybook"}</span><p>{message.content}</p></article>) : <div className="assistant-welcome"><span className="lock-emblem"><Sparkles size={19}/></span><h3>What would you like to know?</h3><p>Try asking, “How steady was my running this month?” or “Create a goal to run 40 km by New Year.”</p></div>}{status && <p className="assistant-status">{status}</p>}{error && <p className="form-error" role="alert">{error}</p>}<div ref={bottomRef}/></div><form className="assistant-composer" onSubmit={(event) => void send(event)}><textarea className="input-control textarea-control" rows={2} maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask a question or tell Daybook what to do…" disabled={busy}/><button className="primary-button" disabled={!draft.trim() || busy}><Sparkles size={15}/> Ask</button></form><p className="assistant-capability-note">Can add habits, tasks, dated goals, trackers, reminders, progress, and session notes.</p></dialog>;
}

export function TaskTitleButton({ task, noteCount, onClick }: { task: Task; noteCount: number; onClick: () => void }) {
  return <button className="task-title task-title-button" onClick={onClick}>{task.title}{noteCount > 0 && <span className="task-comment-count"><MessageSquareText size={12}/>{noteCount}</span>}</button>;
}
