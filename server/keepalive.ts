import { DEFAULT_SUPABASE_KEY, DEFAULT_SUPABASE_URL } from "../src/supabaseDefaults.js";

type Request = { method?: string; headers: Record<string, string | string[] | undefined> };
type Response = { setHeader(name: string, value: string): void; status(code: number): Response; json(value: unknown): void };

const env = (name: string) => process.env[name]?.trim() || undefined;

/**
 * Supabase pauses projects on the free plan after about a week without activity. Vercel calls this
 * once a day (see "crons" in vercel.json) so the shared backend stays awake even when nobody opens
 * Daybook for a while. It reads at most one row id with the public key, so it is harmless to leave
 * reachable; if CRON_SECRET is set in Vercel, only Vercel's own cron calls are accepted.
 */
export async function handleKeepAlive(request: Request, response: Response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method && request.method !== "GET") return response.status(405).json({ error: "Method not allowed." });
  const secret = env("CRON_SECRET");
  if (secret && request.headers.authorization !== `Bearer ${secret}`) return response.status(401).json({ error: "Unauthorized." });
  const url = env("VITE_SUPABASE_URL") ?? DEFAULT_SUPABASE_URL;
  const key = env("VITE_SUPABASE_ANON_KEY") ?? DEFAULT_SUPABASE_KEY;
  try {
    const result = await fetch(`${url}/rest/v1/family_records?select=id&limit=1`, { headers: { apikey: key }, signal: AbortSignal.timeout(20_000) });
    if (!result.ok) return response.status(502).json({ ok: false, error: `The database answered with status ${result.status}.` });
    return response.status(200).json({ ok: true, checkedAt: new Date().toISOString() });
  } catch {
    return response.status(502).json({ ok: false, error: "The database could not be reached." });
  }
}
