import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function localJournalApi() {
  const vaultDirectory = resolve(process.cwd(), ".daybook", ".system", "cache", "runtime", "session", "vault");
  const file = resolve(vaultDirectory, "daybook.vault.enc");
  const hideOnWindows = (path: string) => {
    if (process.platform === "win32") spawnSync("attrib", ["+h", path], { windowsHide: true, stdio: "ignore" });
  };
  return {
    name: "local-private-journal-api",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/private-journal")) return next();
        response.setHeader("Cache-Control", "no-store");
        if (request.method === "GET" && url.pathname === "/api/private-journal") {
          try {
            const data = await readFile(file, "utf8");
            response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(data);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") response.writeHead(404).end();
            else response.writeHead(500).end("Could not read the local journal.");
          }
          return;
        }
        if (request.method === "PUT" && url.pathname === "/api/private-journal") {
          const chunks: Buffer[] = [];
          let size = 0;
          request.on("data", (chunk: Buffer) => { size += chunk.length; if (size <= 40 * 1024 * 1024) chunks.push(chunk); else request.destroy(); });
          request.on("end", async () => {
            if (size > 40 * 1024 * 1024) { response.writeHead(413).end("Journal is too large."); return; }
            try {
              const payload = Buffer.concat(chunks).toString("utf8");
              const parsed = JSON.parse(payload) as { envelope?: unknown };
              if (!parsed.envelope || typeof parsed.envelope !== "object") throw new Error("Invalid journal envelope.");
              await mkdir(vaultDirectory, { recursive: true });
              await writeFile(file, JSON.stringify(parsed), { encoding: "utf8", mode: 0o600 });
              for (const directory of [resolve(process.cwd(), ".daybook"), resolve(process.cwd(), ".daybook", ".system"), resolve(process.cwd(), ".daybook", ".system", "cache"), resolve(process.cwd(), ".daybook", ".system", "cache", "runtime"), resolve(process.cwd(), ".daybook", ".system", "cache", "runtime", "session"), vaultDirectory, file]) hideOnWindows(directory);
              response.writeHead(204).end();
            } catch {
              response.writeHead(400).end("Could not save the local journal.");
            }
          });
          return;
        }
        response.writeHead(405).end("Method not allowed.");
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localJournalApi()],
  build: { target: "es2022" },
});
