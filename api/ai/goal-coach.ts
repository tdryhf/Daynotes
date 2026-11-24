import { handleVercelAiRequest } from "../../server/vercelAiHandler.js";

type Request = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(value: unknown): void };

export default function handler(request: Request, response: Response) {
  return handleVercelAiRequest(request, response, "goal-coach");
}
