// Minimal static server for the test harness: node harness/serve.mjs [port]
// Serves the visual project folder so harness/index.html can load ../.tmp/drop/visual.js.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.argv[2]) || 8181;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = normalize(join(root, path === "/" ? "/harness/index.html" : path));
    if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
        res.end(body);
    } catch {
        res.writeHead(404).end("Not found");
    }
}).listen(port, "127.0.0.1", () => console.log(`Harness at http://localhost:${port}/`));
