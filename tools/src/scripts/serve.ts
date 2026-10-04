/** Minimal static file server for exported web builds (Playwright smoke tests, local previews). */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".wav": "audio/wav", ".mp3": "audio/mpeg",
};

export function serveDir(dir: string, port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
    let file = join(dir, path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dir, "index.html");
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    resolve({ server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}` });
  }));
}

if (process.argv[1]?.endsWith("serve.ts")) {
  const dir = process.argv[2] ?? "build/web/maplebrook";
  const port = Number(process.argv[3] ?? 8081);
  serveDir(dir, port).then(({ url }) => console.log(`serving ${dir} at ${url}`));
}
