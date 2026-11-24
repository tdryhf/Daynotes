import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleAiRequest } from "./server/ai.ts";

function localAiApi(env: Record<string, string>) {
  return {
    name: "local-groq-ai-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/ai/")) return next();
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "POST") { response.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Method not allowed." })); return; }
        const mode = url.pathname.endsWith("/refine") ? "refine" : url.pathname.endsWith("/assistant") ? "assistant" : url.pathname.endsWith("/goal-coach") ? "goal-coach" : url.pathname.endsWith("/performance") ? "performance" : "unknown";
        const chunks: Buffer[] = [];
        let size = 0;
        request.on("data", (chunk: Buffer) => { size += chunk.length; if (size <= 1_000_000) chunks.push(chunk); });
        request.on("end", async () => {
          if (size > 1_000_000) { response.writeHead(413, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "This request is too large." })); return; }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
            const result = await handleAiRequest({ ...parsed, mode } as Parameters<typeof handleAiRequest>[0], env.GROQ_API_KEY, request.socket.remoteAddress ?? "local");
            response.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(result.body));
          } catch {
            response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Invalid AI request." }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), localAiApi(env)],
    build: { target: "es2022" },
  };
});
