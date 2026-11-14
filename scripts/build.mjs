/**
 * Static build (SSG) for the PK IT Solutions site.
 *
 * The site is already pre-rendered HTML, so "rendering" here means: take the
 * source pages, optimise them and refuse to ship anything broken.
 *
 *   1. Copy the public files into dist/ (dev files, tests and tools stay out)
 *   2. Minify CSS and JS with esbuild
 *   3. Add a content hash to every CSS/JS URL (?v=abc123) so browsers can cache
 *      them for a year and still get the new file on the next deploy
 *   4. Strip HTML comments, stamp the service-worker cache version and the
 *      sitemap <lastmod>
 *   5. Deployment checks: every page has one <h1>, a title, a description and a
 *      canonical; every JSON-LD block parses; every internal link and asset exists.
 *      Any failure stops the build, so Vercel keeps the previous deployment live.
 *
 * Run: npm run build      Output: dist/
 */
import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, extname, dirname } from "node:path";
import { transform } from "esbuild";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "dist");
const EXCLUDE = new Set(["dist", "node_modules", "scripts", "tests", "tools", ".git", ".github", "docs",
  "package.json", "package-lock.json", "vercel.json", "playwright.config.js", "lighthouserc.json", "README.md", ".gitignore",
  ".env", ".env.example", "test-results", "playwright-report", ".lighthouseci", ".vercel"]);
const INDEXABLE = ["index.html", "seo-services.html", "web-development.html", "digital-marketing.html", "privacy-policy.html"];

const errors = [];
const fail = (msg) => errors.push(msg);
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const entry of await readdir(ROOT)) {
  if (EXCLUDE.has(entry) || entry.startsWith(".")) continue;
  await cp(join(ROOT, entry), join(OUT, entry), { recursive: true });
}

// 2 + 3. Minify and fingerprint CSS / JS
const versions = {};
for (const file of ["css/style.css", "js/config.js", "js/main.js"]) {
  const src = await readFile(join(OUT, file), "utf8");
  const loader = extname(file) === ".css" ? "css" : "js";
  const { code } = await transform(src, { loader, minify: true, target: loader === "css" ? ["chrome90", "safari14", "firefox90"] : "es2017", legalComments: "none" });
  await writeFile(join(OUT, file), code);
  versions[file] = hash(code);
  console.log(`  minified ${file}: ${(src.length / 1024).toFixed(1)} KB -> ${(code.length / 1024).toFixed(1)} KB`);
}

const buildId = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 10) || hash(Object.values(versions).join("") + Date.now());
const today = new Date().toISOString().slice(0, 10);

// 4. HTML: version asset URLs, drop comments
const htmlFiles = (await readdir(OUT)).filter((f) => f.endsWith(".html"));
for (const f of htmlFiles) {
  let html = await readFile(join(OUT, f), "utf8");
  for (const [file, v] of Object.entries(versions)) {
    const re = new RegExp(`(href|src)="(/?)${file.replace(".", "\\.")}"`, "g");
    html = html.replace(re, `$1="$2${file}?v=${v}"`);
  }
  html = html.replace(/<!--(?!\[if)[\s\S]*?-->/g, "").replace(/\n\s*\n+/g, "\n");
  await writeFile(join(OUT, f), html);
}
const sw = await readFile(join(OUT, "sw.js"), "utf8");
await writeFile(join(OUT, "sw.js"), sw.replace("__BUILD_VERSION__", buildId));
const sitemap = await readFile(join(OUT, "sitemap.xml"), "utf8");
await writeFile(join(OUT, "sitemap.xml"), sitemap.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${today}</lastmod>`));

// 5. Deployment checks
const sitemapUrls = [...sitemap.matchAll(/<loc>https:\/\/pkitsol\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
const pageForPath = (p) => (p === "/" ? "index.html" : p.replace(/^\//, "") + ".html");
for (const p of sitemapUrls) if (!(await exists(join(OUT, pageForPath(p))))) fail(`sitemap lists ${p} but ${pageForPath(p)} is missing`);

for (const f of htmlFiles) {
  const html = await readFile(join(OUT, f), "utf8");
  if (INDEXABLE.includes(f)) {
    const h1 = (html.match(/<h1[\s>]/g) || []).length;
    if (h1 !== 1) fail(`${f}: expected exactly one <h1>, found ${h1}`);
    if (!/<title>[^<]{10,}<\/title>/.test(html)) fail(`${f}: missing <title>`);
    if (!/<meta name="description" content="[^"]{50,}"/.test(html)) fail(`${f}: missing meta description`);
    if (!/<link rel="canonical" href="https:\/\/pkitsol\.com/.test(html)) fail(`${f}: missing canonical`);
    if (/noindex/.test(html.match(/<meta name="robots"[^>]*>/)?.[0] || "")) fail(`${f}: indexable page is set to noindex`);
  }
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { fail(`${f}: invalid JSON-LD (${e.message})`); }
  }
  for (const m of html.matchAll(/<img(?![^>]*\balt=)[^>]*>/g)) fail(`${f}: <img> without alt: ${m[0].slice(0, 80)}`);
  // internal links and assets
  const withFallback = new Set([...html.matchAll(/<img[^>]*\bsrc="([^"]+)"[^>]*\bdata-remote=/g)].map((m) => m[1]));
  for (const m of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    const ref = m[1];
    if (/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(ref) || ref === "") continue;
    const clean = decodeURIComponent(ref.replace(/^\//, ""));
    const candidates = clean === "" ? ["index.html"] : [clean, clean + ".html", join(clean, "index.html")];
    let ok = false;
    for (const c of candidates) if (await exists(join(OUT, c))) { ok = true; break; }
    if (!ok && withFallback.has(ref)) console.warn(`  note: ${f} uses ${ref} which is not in the repo yet (falls back to its data-remote copy; run tools/download-images)`);
    else if (!ok) fail(`${f}: broken internal link or asset "${ref}"`);
  }
}
// assets referenced from config.js must exist (portfolio, menu pictures)
const cfg = await readFile(join(ROOT, "js/config.js"), "utf8");
for (const m of cfg.matchAll(/"(assets\/img\/[^"]+)"/g)) {
  if (!(await exists(join(OUT, m[1])))) console.warn(`  note: config.js points at ${m[1]} which is not in the repo (its remote fallback is used)`);
}

if (errors.length) {
  console.error(`\nBuild checks failed (${errors.length}):\n - ` + errors.join("\n - "));
  process.exit(1);
}
console.log(`\nBuild ${buildId} ready in dist/ (${htmlFiles.length} pages, all checks passed)`);
