import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowUpRight, CalendarDays, Check, ChevronRight, Clock3, Sparkles } from "lucide-react";
import { analyzePerformance, type PerformanceReview, type PerformanceReviewRequest } from "./ai";
import { calculatePerformanceMetrics, dateKey } from "./data";
import type { AppRecord, Habit, JournalNote, PerformanceReflection } from "./types";

const today = () => dateKey(new Date());
const initialEndDate = () => `${new Date().getFullYear() + 1}-01-01`;
const formatDate = (value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) => validKey(value) ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options) : "Choose a date";
const countLabel = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
const validKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());

type InsightState = { signature: string; review: PerformanceReview };

export function InsightsPage({ records, habits, notes, reflections, onSaveReflection, onAddHabit }: {
  records: AppRecord[];
  habits: Habit[];
  notes: JournalNote[];
  reflections: PerformanceReflection[];
  onSaveReflection: (startDate: string, endDate: string, text: string) => void;
  onAddHabit: () => void;
}) {
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [reflectionDraft, setReflectionDraft] = useState("");
  const [reflectionDirty, setReflectionDirty] = useState(false);
  const [reviewState, setReviewState] = useState<InsightState | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const validRange = validKey(startDate) && validKey(endDate) && startDate <= endDate;
  const metrics = useMemo(() => calculatePerformanceMetrics(records, habits, startDate, endDate), [records, habits, startDate, endDate]);
  const matchingReflection = reflections.find((reflection) => reflection.startDate === startDate && reflection.endDate === endDate);
  const rangeNotes = useMemo(() => notes
    .filter((note) => habits.some((habit) => habit.id === note.ownerId) && note.sessionDate >= startDate && note.sessionDate <= endDate)
    .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate) || b.updatedAt - a.updatedAt), [notes, habits, startDate, endDate]);
  const rangeReflections = useMemo(() => reflections
    .filter((reflection) => reflection.startDate <= endDate && reflection.endDate >= startDate)
    .sort((a, b) => b.updatedAt - a.updatedAt), [reflections, startDate, endDate]);
  const sourceSignature = useMemo(() => JSON.stringify({
    startDate, endDate, metrics,
    notes: rangeNotes.map((note) => [note.id, note.updatedAt, note.rawText, note.polishedText, note.summary]),
    reflections: rangeReflections.map((reflection) => [reflection.id, reflection.updatedAt, reflection.text]),
  }), [startDate, endDate, metrics, rangeNotes, rangeReflections]);

  useEffect(() => { setReflectionDraft(matchingReflection?.text ?? ""); setReflectionDirty(false); }, [startDate, endDate]);
  useEffect(() => { if (!reflectionDirty) setReflectionDraft(matchingReflection?.text ?? ""); }, [matchingReflection, reflectionDirty]);

  const applyPreset = (preset: "year-to-date" | "last-30-days" | "today-to-new-year") => {
    const now = new Date();
    const current = today();
    if (preset === "today-to-new-year") { setStartDate(current); setEndDate(initialEndDate()); return; }
    if (preset === "year-to-date") { setStartDate(`${now.getFullYear()}-01-01`); setEndDate(current); return; }
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 12);
    setStartDate(dateKey(start)); setEndDate(current);
  };

  const saveReflection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validRange || !reflectionDraft.trim()) return;
    onSaveReflection(startDate, endDate, reflectionDraft.trim());
    setReflectionDirty(false);
  };

  const askForReview = async () => {
    if (!validRange || !habits.length || analyzing) return;
    setAnalyzing(true); setError("");
    try {
      const checkins = records.flatMap((record) => record.type === "checkin" && record.completed && !record.deletedAt && record.date >= startDate && record.date <= endDate && habits.some((habit) => habit.id === record.habitId) ? [{ habitId: record.habitId, date: record.date }] : []);
      const request: PerformanceReviewRequest = {
        startDate, endDate, localToday: today(),
        metrics: { completionPercent: metrics.completionPercent, completedCount: metrics.completedCount, plannedToDate: metrics.plannedToDate, activeDays: metrics.activeDays, elapsedDays: metrics.elapsedDays, currentStreak: metrics.currentStreak, bestStreak: metrics.bestStreak },
        habits: metrics.habits.map(({ id, name, goal, cadence, completed, percent }) => ({ id, name, goal, cadence, completed, percent })),
        checkins,
        notes: rangeNotes.slice(0, 60).map((note) => ({ date: note.sessionDate, habit: habits.find((habit) => habit.id === note.ownerId)?.name ?? "Habit", text: (note.summary || note.polishedText || note.rawText).slice(0, 1200) })),
        reflections: rangeReflections.slice(0, 20).map(({ startDate: from, endDate: through, text }) => ({ startDate: from, endDate: through, text: text.slice(0, 2400) })),
      };
      const review = await analyzePerformance(request);
      setReviewState({ signature: sourceSignature, review });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The review could not be created. Try again in a moment.");
    } finally { setAnalyzing(false); }
  };

  const history = useMemo(() => {
    if (!validRange) return [];
    const byDate = new Map<string, { habits: string[]; notes: JournalNote[] }>();
    for (const record of records) {
      if (record.type !== "checkin" || record.deletedAt || record.date < startDate || record.date > endDate) continue;
      if (record.completed) {
        const habit = habits.find((item) => item.id === record.habitId);
        if (!habit) continue;
        const day = byDate.get(record.date) ?? { habits: [], notes: [] };
        if (!day.habits.includes(habit.name)) day.habits.push(habit.name);
        byDate.set(record.date, day);
      }
    }
    for (const note of rangeNotes) {
      const day = byDate.get(note.sessionDate) ?? { habits: [], notes: [] };
      day.notes.push(note); byDate.set(note.sessionDate, day);
    }
    return [...byDate.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [records, habits, rangeNotes, startDate, endDate, validRange]);

  return <div className="insights-page">
    <section className="insights-intro paper-sheet">
      <span className="insights-intro-icon"><Sparkles size={20} /></span>
      <div><p className="panel-title">A clearer picture, one period at a time</p><h2>See how your habits are really going</h2><p>Choose any two dates. Your progress, journal, and review will stay inside that window.</p></div>
    </section>

    <section className="insights-range paper-sheet" aria-labelledby="period-heading">
      <div className="insights-section-heading"><div><p className="panel-title">Performance window</p><h2 id="period-heading">Choose the dates to review</h2></div><CalendarDays size={19} /></div>
      <div className="insights-date-fields">
        <label className="field"><span>From</span><input className="input-control" aria-label="Insights start date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
        <span className="range-arrow" aria-hidden="true"><ChevronRight size={17} /></span>
        <label className="field"><span>Through, inclusive</span><input className="input-control" aria-label="Insights end date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
      </div>
      <div className="insights-presets" role="group" aria-label="Date range shortcuts">
        <button type="button" className={startDate === today() && endDate === initialEndDate() ? "is-selected" : ""} onClick={() => applyPreset("today-to-new-year")}>Today → New Year</button>
        <button type="button" onClick={() => applyPreset("last-30-days")}>Last 30 days</button>
        <button type="button" onClick={() => applyPreset("year-to-date")}>Year to date</button>
      </div>
      {!validRange ? <p className="form-error" role="alert">Choose a valid start date and an end date on or after it.</p> : <p className="insights-range-caption">{formatDate(startDate)} – {formatDate(endDate)} · {metrics.rangeDays} calendar days</p>}
    </section>

    <section className="insights-results" aria-labelledby="results-heading">
      <div className="insights-section-heading insights-results-heading"><div><p className="panel-title">Your numbers</p><h2 id="results-heading">Progress in this period</h2><p>Habit targets are paced by their weekly or monthly schedule. Progress is current through {formatDate(metrics.elapsedDays && endDate > today() ? today() : endDate)}.</p></div></div>
      <div className="insights-stat-grid">
        <article className="insights-stat insights-stat-primary"><span>Goal pace</span><strong>{metrics.elapsedDays ? `${metrics.completionPercent}%` : "—"}</strong><small>{metrics.elapsedDays ? `${countLabel(metrics.completedCount)} of ${countLabel(metrics.plannedToDate)} planned check-ins so far` : "Your selected period has not started"}</small><div className="insights-progress-track" aria-hidden="true"><span style={{ width: `${metrics.completionPercent}%` }} /></div></article>
        <article className="insights-stat"><span>Completed check-ins</span><strong>{metrics.completedCount}</strong><small>{countLabel(metrics.plannedInRange)} planned across the full date window</small></article>
        <article className="insights-stat"><span>Active days</span><strong>{metrics.elapsedDays ? `${metrics.activeDays}<small> / ${metrics.elapsedDays}</small>` : "—"}</strong><small>{metrics.elapsedDays ? `${metrics.activeDayPercent}% of elapsed days had a check-in` : "Starts when the period begins"}</small></article>
        <article className="insights-stat"><span>Best streak</span><strong>{metrics.bestStreak}<small> days</small></strong><small>{metrics.currentStreak ? `${metrics.currentStreak} day current streak` : "Longest run in the selected period"}</small></article>
      </div>
    </section>

    <section className="insights-panel paper-sheet" aria-labelledby="trend-heading">
      <div className="insights-section-heading"><div><p className="panel-title">Week by week</p><h2 id="trend-heading">Your progress trend</h2><p>Completion against planned habit pace for elapsed days. Future weeks are left open.</p></div><ArrowUpRight size={19} /></div>
      {metrics.weeks.length ? <div className="insights-week-chart" aria-label="Weekly habit progress">
        {metrics.weeks.map((week) => <div className={`insights-week ${week.isFuture ? "is-future" : ""}`} key={week.startDate} title={`${formatDate(week.startDate)}–${formatDate(week.endDate)}: ${week.isFuture ? "upcoming" : `${week.completed} check-ins, ${week.percent}% of plan`}`}><div className="insights-week-bar"><span style={{ height: `${week.planned ? Math.min(100, Math.max(week.completed ? 5 : 0, week.percent)) : 0}%` }} /></div><strong>{week.isFuture ? "—" : `${week.percent}%`}</strong><small>{week.label}</small></div>)}
      </div> : <p className="insights-empty-copy">Choose a valid period to build your progress trend.</p>}
    </section>

    <section className="insights-panel paper-sheet" aria-labelledby="habit-performance-heading">
      <div className="insights-section-heading"><div><p className="panel-title">A closer look</p><h2 id="habit-performance-heading">How each habit is holding up</h2><p>Percentage of the planned target reached so far in the selected period.</p></div></div>
      {metrics.habits.length ? <div className="insights-habit-list">{metrics.habits.map((habit) => <article className="insights-habit-row" key={habit.id}><div className="insights-habit-label"><strong>{habit.name}</strong><span>{habit.cadence === "week" ? `${habit.goal}× weekly` : `${habit.goal}× monthly`}</span></div><div className="insights-habit-track" aria-label={`${habit.percent}% of planned target`}><span style={{ width: `${Math.min(100, habit.percent)}%` }} /></div><strong className="insights-habit-percent">{metrics.elapsedDays ? `${habit.percent}%` : "—"}</strong><small>{countLabel(habit.completed)} / {countLabel(habit.planned)} expected</small></article>)}</div> : <div className="insights-empty-state"><p>Add a habit to start measuring your progress.</p><button type="button" className="primary-button" onClick={onAddHabit}><Check size={15} /> Add a habit</button></div>}
    </section>

    <section className="insights-panel paper-sheet" aria-labelledby="period-journal-heading">
      <div className="insights-section-heading"><div><p className="panel-title">The story behind the numbers</p><h2 id="period-journal-heading">Your period reflection</h2><p>Capture what helped, what got in the way, and what you want to try next.</p></div><Clock3 size={19} /></div>
      <form className="period-reflection-form" onSubmit={saveReflection}>
        <label className="field"><span>Write a short reflection for {validRange ? `${formatDate(startDate, { month: "short", day: "numeric" })} – ${formatDate(endDate, { month: "short", day: "numeric", year: "numeric" })}` : "this period"}</span><textarea className="input-control textarea-control" rows={4} maxLength={6000} value={reflectionDraft} onChange={(event) => { setReflectionDraft(event.target.value); setReflectionDirty(true); }} placeholder="What went well? What felt harder than expected? What would you like to carry forward?" disabled={!validRange} /></label>
        <div className="reflection-form-footer"><p>This reflection is saved in your shared daybook. Use Private journal for encrypted personal writing.</p><button className="soft-button" type="submit" disabled={!validRange || !reflectionDraft.trim()}>{matchingReflection ? "Update reflection" : "Save reflection"}</button></div>
      </form>
      {rangeReflections.length > 0 && <div className="insights-saved-reflections"><h3>Saved reflections in this window</h3>{rangeReflections.map((reflection) => <article key={reflection.id}><small>{formatDate(reflection.startDate)} – {formatDate(reflection.endDate)}</small><p>{reflection.text}</p></article>)}</div>}
    </section>

    <section className="insights-ai-panel" aria-labelledby="ai-review-heading">
      <div className="insights-ai-copy"><span className="insights-ai-icon"><Sparkles size={19} /></span><div><p className="panel-title">A grounded read of your data</p><h2 id="ai-review-heading">Review this period with Groq</h2><p>Get a clear summary, patterns in your logs, and a few practical next steps. Your private encrypted journal pages are never included.</p></div></div>
      <div className="insights-privacy-note"><strong>What gets sent when you ask for a review</strong><span>Only check-ins, habit targets, habit session notes, and reflections dated within or overlapping this selected period. The request uses the server-side GROQ_API_KEY.</span></div>
      <button type="button" className="primary-button" disabled={!validRange || !habits.length || analyzing} onClick={() => void askForReview()}>{analyzing ? <><Sparkles size={16} className="insights-loading-icon" /> Reviewing your period…</> : <><Sparkles size={16} /> Analyze this period</>}</button>
      {!habits.length && <p className="insights-empty-copy">Add at least one habit before creating an AI review.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {reviewState && <article className={`performance-review ${reviewState.signature !== sourceSignature ? "is-stale" : ""}`} aria-live="polite"><div className="performance-review-heading"><div><span className="journal-kicker">{reviewState.signature === sourceSignature ? "Your review" : "Data updated since this review"}</span><h3>{formatDate(startDate)} – {formatDate(endDate)}</h3></div>{reviewState.signature !== sourceSignature && <button type="button" className="quiet-button" onClick={() => void askForReview()}>Refresh review</button>}</div><p className="performance-review-summary">{reviewState.review.summary}</p><div className="performance-review-columns">{([
        ["Wins", reviewState.review.wins], ["Patterns", reviewState.review.patterns], ["Try next", reviewState.review.nextSteps],
      ] as const).map(([title, items]) => items.length > 0 && <section key={title}><h4>{title}</h4><ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul></section>)}</div></article>}
    </section>

    <section className="insights-panel paper-sheet" aria-labelledby="activity-heading">
      <div className="insights-section-heading"><div><p className="panel-title">Your actual logs</p><h2 id="activity-heading">Activity in this period</h2><p>{history.length} days with check-ins or habit notes in the selected range.</p></div></div>
      {history.length ? <div className="insights-activity-list">{history.map(([date, day]) => <article key={date}><time dateTime={date}>{formatDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</time>{day.habits.length > 0 && <p className="insights-activity-checkins"><Check size={14} /> {day.habits.join(" · ")}</p>}{day.notes.map((note) => <blockquote key={note.id}><strong>{habits.find((habit) => habit.id === note.ownerId)?.name}</strong><span>{note.polishedText || note.rawText}</span>{note.summary && <small>{note.summary}</small>}</blockquote>)}</article>)}</div> : <div className="insights-empty-state"><p>No check-ins or habit session notes fall inside these dates yet.</p><p>When you start logging, each day and session note will appear here.</p></div>}
    </section>
  </div>;
}
