import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAiRequest } from "./ai";

// Groq's JSON mode sometimes fails to produce valid JSON and answers 400 "json_validate_failed".
// The same request usually succeeds when sent again, so the server retries it before giving up.
const jsonFailure = () => new Response(JSON.stringify({ error: {
  message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
  type: "invalid_request_error", code: "json_validate_failed", failed_generation: "{\"reply\": \"Sure",
} }), { status: 400 });
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });

let client = 0;
const askCoach = () => handleAiRequest(
  { mode: "goal-coach", messages: [{ role: "user", content: "help me get consistent with to do's" }], records: [], localToday: "2026-11-24" },
  "test-key", `ai-test-${client += 1}`,
);

afterEach(() => { vi.unstubAllGlobals(); });

describe("AI JSON replies", () => {
  it("retry when Groq fails to generate JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonFailure()).mockResolvedValueOnce(reply(JSON.stringify({ reply: "Which to-dos matter most?" })));
    vi.stubGlobal("fetch", fetchMock);
    const result = await askCoach();
    expect(result).toEqual({ status: 200, body: { reply: "Which to-dos matter most?" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recognise the failure by its wording when the code is missing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Failed to validate JSON. Please adjust your prompt." } }), { status: 400 }))
      .mockResolvedValueOnce(reply(JSON.stringify({ reply: "Which to-dos matter most?" })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await askCoach()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("give up after three attempts with a message the user can act on", async () => {
    const fetchMock = vi.fn(async () => jsonFailure());
    vi.stubGlobal("fetch", fetchMock);
    const result = await askCoach();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(502);
    expect(result.body.error).toBe("The AI couldn't put a reply together. Please try again.");
  });

  it("don't retry other errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid API Key", code: "invalid_api_key" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await askCoach();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 502, body: { error: "Invalid API Key" } });
  });
});

// Groq answers 429 when the per-minute limit is used up; it frees up within seconds, so the server waits and retries.
const rateLimited = (wait: string, headers: Record<string, string> = {}) => new Response(JSON.stringify({ error: {
  message: `Rate limit reached for model \`openai/gpt-oss-120b\` in organization \`org_x\` service tier \`on_demand\` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 900. Please try again in ${wait}. Need more tokens? Upgrade to Dev Tier today.`,
  type: "tokens", code: "rate_limit_exceeded",
} }), { status: 429, headers });

describe("AI rate limits", () => {
  afterEach(() => { vi.useRealTimers(); });

  const settle = async <T,>(promise: Promise<T>) => { await vi.runAllTimersAsync(); return promise; };

  it("wait as long as Groq says, then retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(rateLimited("1.5s")).mockResolvedValueOnce(reply(JSON.stringify({ reply: "Which to-dos matter most?" })));
    vi.stubGlobal("fetch", fetchMock);
    const startedAt = Date.now();
    const result = await settle(askCoach());
    expect(result).toEqual({ status: 200, body: { reply: "Which to-dos matter most?" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - startedAt).toBe(1_750);
  });

  it("keep retrying until the limit resets", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rateLimited("3s")).mockResolvedValueOnce(rateLimited("2s")).mockResolvedValueOnce(rateLimited("450ms"))
      .mockResolvedValueOnce(reply(JSON.stringify({ reply: "Ready." })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await settle(askCoach())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("also retry the assistant's tool-calling requests", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(rateLimited("1s")).mockResolvedValueOnce(reply("Done."));
    vi.stubGlobal("fetch", fetchMock);
    const result = await settle(handleAiRequest({ mode: "assistant", messages: [{ role: "user", content: "hi" }], records: [] }, "test-key", `ai-test-${client += 1}`));
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("use the retry-after header when the message gives no time", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Too many requests", code: "rate_limit_exceeded" } }), { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(reply(JSON.stringify({ reply: "Ready." })));
    vi.stubGlobal("fetch", fetchMock);
    const startedAt = Date.now();
    expect((await settle(askCoach())).status).toBe(200);
    expect(Date.now() - startedAt).toBe(3_250);
  });

  it("give up straight away when Groq asks for a long wait (daily limit)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => rateLimited("14m22.5s"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await settle(askCoach());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 429, body: { error: "The AI has hit its usage limit for now. Please try again in about 15 minutes." } });
  });

  it("stop retrying once the waiting budget is used up", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => rateLimited("9s"));
    vi.stubGlobal("fetch", fetchMock);
    const startedAt = Date.now();
    const result = await settle(askCoach());
    expect(result).toEqual({ status: 429, body: { error: "The AI is still busy after several tries. Please try again in a moment." } });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(Date.now() - startedAt).toBeLessThanOrEqual(40_000);
  });
});
