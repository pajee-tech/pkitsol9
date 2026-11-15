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
  if (EXCLUDE.has(entry) || (entry.startsWith(".") && entry !== ".htaccess")) continue;
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

// 3b. FAQ schema is rebuilt from the visible FAQ text on every build, so editing a
//     question or answer in the page is enough: Google always gets matching data.
const ENT = { amp: "&", nbsp: " ", mdash: "\u2014", ndash: "\u2013", rarr: "\u2192", middot: "\u00b7", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">", hellip: "\u2026", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d" };
const plain = (h) => h.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => ENT[e] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : m))
  .replace(/\s+/g, " ").trim();
function faqFrom(html) {
  const items = [];
  const parts = html.split(/<div class="faq__item"/).slice(1);
  for (const part of parts) {
    const q = part.match(/class="faq__q"[^>]*>([\s\S]*?)<\/button>/);
    const a = part.match(/class="faq__a"[^>]*>([\s\S]*?)(?=<div class="faq__item"|<\/section>|$)/);
    if (q && a) items.push({ "@type": "Question", name: plain(q[1]), acceptedAnswer: { "@type": "Answer", text: plain(a[1]) } });
  }
  return items;
}

// 4. HTML: version asset URLs, drop comments
const htmlFiles = (await readdir(OUT)).filter((f) => f.endsWith(".html"));
for (const f of htmlFiles) {
  let html = await readFile(join(OUT, f), "utf8");
  for (const [file, v] of Object.entries(versions)) {
    const re = new RegExp(`(href|src)="(/?)${file.replace(".", "\\.")}"`, "g");
    html = html.replace(re, `$1="$2${file}?v=${v}"`);
  }
  const faq = faqFrom(html);
  if (faq.length) {
    html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (m, body) => {
      let data; try { data = JSON.parse(body); } catch { return m; }
      const nodes = data["@graph"] || [data];
      let hit = false;
      for (const n of nodes) if (n["@type"] === "FAQPage") { n.mainEntity = faq; hit = true; }
      return hit ? `<script type="application/ld+json">${JSON.stringify(data)}</script>` : m;
    });
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
