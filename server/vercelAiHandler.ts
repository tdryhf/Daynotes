import { handleAiRequest } from "./ai";

type Request = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(value: unknown): void };

export async function handleVercelAiRequest(request: Request, response: Response, mode: "refine" | "assistant") {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed." });
  const forwarded = request.headers["x-forwarded-for"];
  const clientKey = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim() || "unknown";
  try {
    const body = (typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {}) as Record<string, unknown>;
    if (JSON.stringify(body).length > 1_000_000) return response.status(413).json({ error: "This request is too large." });
    const result = await handleAiRequest({ ...body, mode } as Parameters<typeof handleAiRequest>[0], process.env.GROQ_API_KEY, clientKey);
    return response.status(result.status).json(result.body);
  } catch {
    return response.status(400).json({ error: "Invalid AI request." });
  }
}
