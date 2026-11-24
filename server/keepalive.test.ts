import { afterEach, describe, expect, it, vi } from "vitest";
import { handleKeepAlive } from "./keepalive";

const call = async (headers: Record<string, string> = {}, method = "GET") => {
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const response = {
    setHeader(name: string, value: string) { sent.headers[name] = value; },
    status(code: number) { sent.status = code; return response; },
    json(value: unknown) { sent.body = value; },
  };
  await handleKeepAlive({ method, headers }, response);
  return sent;
};

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("daily keep-alive", () => {
  it("reads one row from the shared database with the public key", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sent = await call();
    expect(sent.status).toBe(200);
    expect(sent.headers["Cache-Control"]).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://prhjlqbhbjjugygyxuja.supabase.co/rest/v1/family_records?select=id&limit=1");
    expect((init.headers as Record<string, string>).apikey).toMatch(/^sb_publishable_/);
  });

  it("reports a failure when the database can't be reached or refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    expect((await call()).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("paused", { status: 540 })));
    expect((await call()).status).toBe(502);
  });

  it("accepts only Vercel's cron call once CRON_SECRET is set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    vi.stubEnv("CRON_SECRET", "s3cret-for-test");
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call({ authorization: "Bearer s3cret-for-test" })).status).toBe(200);
  });

  it("rejects anything but GET", async () => {
    expect((await call({}, "POST")).status).toBe(405);
  });
});
