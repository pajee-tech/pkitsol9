/**
 * Tiny local server that behaves like Vercel for this site:
 * clean URLs (/seo-services -> seo-services.html), 404.html for unknown paths,
 * the redirects from vercel.json, and correct content types.
 *   node scripts/serve.mjs dist 4173     (the built site)
 *   node scripts/serve.mjs . 8080        (the source files)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";

const root = resolve(process.argv[2] || "dist");
const port = Number(process.argv[3] || 4173);
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const GLOBAL_HEADERS = Object.fromEntries((vercel.headers.find((h) => h.source === "/(.*)")?.headers || []).filter((h) => h.key !== "Strict-Transport-Security").map((h) => [h.key, h.key === "Content-Security-Policy" ? h.value.replace("; upgrade-insecure-requests", "") : h.value]));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".avif": "image/avif", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };

async function file(p) { try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; } }

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  const redirect = vercel.redirects.find((r) => r.source === path);
  if (redirect) { res.writeHead(308, { Location: redirect.destination }); return res.end(); }
  if (path.endsWith(".html") && path !== "/404.html") { res.writeHead(308, { Location: path.replace(/(index)?\.html$/, "") || "/" }); return res.end(); }
  const base = join(root, path);
  if (!base.startsWith(root)) { res.writeHead(400); return res.end(); }
  const hit = (await file(base)) || (await file(base + ".html")) || (await file(join(base, "index.html")));
  if (!hit) {
    res.writeHead(404, { ...GLOBAL_HEADERS, "Content-Type": TYPES[".html"] });
    return res.end(await readFile(join(root, "404.html")));
  }
  res.writeHead(200, { ...GLOBAL_HEADERS, "Content-Type": TYPES[extname(hit)] || "application/octet-stream" });
  res.end(await readFile(hit));
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
