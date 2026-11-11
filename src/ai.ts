import type { AppRecord } from "./types";

export type RefinedNote = { polishedText: string; summary: string; keyIdeas: string[] };
export type ChatMessage = { role: "user" | "assistant" | "tool"; content?: string | null; tool_call_id?: string; name?: string; tool_calls?: AssistantToolCall[] };
export type AssistantToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

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
