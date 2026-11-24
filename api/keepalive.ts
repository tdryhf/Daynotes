import { handleKeepAlive } from "../server/keepalive.js";

type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(value: unknown): void };

export default function handler(request: Request, response: Response) {
  return handleKeepAlive(request, response);
}
