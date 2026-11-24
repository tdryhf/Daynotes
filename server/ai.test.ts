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
