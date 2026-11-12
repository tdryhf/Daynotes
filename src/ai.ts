import type { AppRecord } from "./types";

export type RefinedNote = { polishedText: string; summary: string; keyIdeas: string[] };
export type ChatMessage = { role: "user" | "assistant" | "tool"; content?: string | null; tool_call_id?: string; name?: string; tool_calls?: AssistantToolCall[] };
export type AssistantToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type PerformanceReview = { summary: string; wins: string[]; patterns: string[]; nextSteps: string[] };
export type PerformanceReviewRequest = {
  startDate: string;
  endDate: string;
  localToday: string;
  metrics: { completionPercent: number; completedCount: number; plannedToDate: number; activeDays: number; elapsedDays: number; currentStreak: number; bestStreak: number };
  habits: Array<{ id: string; name: string; goal: number; cadence: "week" | "month"; completed: number; percent: number }>;
  checkins: Array<{ habitId: string; date: string }>;
  notes: Array<{ date: string; habit: string; text: string }>;
  reflections: Array<{ startDate: string; endDate: string; text: string }>;
};

async function postAi(path: string, body: Record<string, unknown>) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The AI service could not complete that request.");
  return data;
}

export async function refineNote(text: string, owner: string): Promise<RefinedNote> {
  const data = await postAi("/api/ai/refine", { text, owner });
  return {
    polishedText: typeof data.polishedText === "string" ? data.polishedText : text,
    summary: typeof data.summary === "string" ? data.summary : "",
    keyIdeas: Array.isArray(data.keyIdeas) ? data.keyIdeas.filter((item): item is string => typeof item === "string") : [],
  };
}

export async function analyzePerformance(request: PerformanceReviewRequest): Promise<PerformanceReview> {
  const data = await postAi("/api/ai/performance", { performance: request });
  const list = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
  return {
    summary: typeof data.summary === "string" ? data.summary : "Your review is ready.",
    wins: list(data.wins), patterns: list(data.patterns), nextSteps: list(data.nextSteps),
  };
}

export async function askAssistant(messages: ChatMessage[], records: AppRecord[]) {
  const current = new Date();
  const localToday = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
  const data = await postAi("/api/ai/assistant", { messages, records: records.filter((record) => !record.deletedAt), localToday });
  const message = data.message as { content?: unknown; tool_calls?: unknown } | undefined;
  if (!message) throw new Error("The assistant returned an empty response.");
  return {
    content: typeof message.content === "string" ? message.content : "",
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls as AssistantToolCall[] : [],
    raw: message,
  };
}

export type GoalCoachMessage = { role: "user" | "assistant"; content: string };
export type GoalCoachReply = { reply: string; goal?: import("./types").GoalDraft };

export async function askGoalCoach(messages: GoalCoachMessage[], records: AppRecord[]): Promise<GoalCoachReply> {
  const current = new Date();
  const localToday = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
  const data = await postAi("/api/ai/goal-coach", { messages, records, localToday });
  const goal = data.goal && typeof data.goal === "object" ? data.goal as Record<string, unknown> : undefined;
  const validGoal = goal && typeof goal.title === "string" && typeof goal.description === "string" &&
    typeof goal.startDate === "string" && typeof goal.endDate === "string" && typeof goal.target === "number" &&
    typeof goal.unit === "string";
  return {
    reply: typeof data.reply === "string" ? data.reply : "Let’s shape this into a clear goal. What outcome would feel meaningful to you?",
    ...(validGoal ? { goal: {
      title: goal.title as string,
      description: goal.description as string,
      startDate: goal.startDate as string,
      endDate: goal.endDate as string,
      target: goal.target as number,
      unit: goal.unit as string,
      achievablePlan: typeof goal.achievablePlan === "string" ? goal.achievablePlan : undefined,
      relevance: typeof goal.relevance === "string" ? goal.relevance : undefined,
    } } : {}),
  };
}
