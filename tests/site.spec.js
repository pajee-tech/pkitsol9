// @ts-check
const { test, expect } = require("@playwright/test");

const PAGES = ["/", "/seo-services", "/web-development", "/digital-marketing", "/privacy-policy"];
const EXTERNAL_NOISE = /ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR|Failed to load resource|mshots|techwiz|unsplash|google\.com\/maps/i;

for (const path of PAGES) {
  test(`@smoke ${path} loads without script errors and has core SEO tags`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && (/Content Security Policy/i.test(m.text()) || !EXTERNAL_NOISE.test(m.text()))) errors.push(m.text()); });
    const res = await page.goto(path);
    expect(res && res.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/pkitsol\.com/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https:\/\//);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    for (const block of ld) expect(() => JSON.parse(block)).not.toThrow();
    const missingAlt = await page.locator("img:not([alt])").count();
    expect(missingAlt).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("@smoke home hero: lead bar carries the website to the contact form", async ({ page }) => {
  await page.goto("/");
  await page.fill("#hero-url", "example.com");
  await page.click(".hero__bar button[type=submit]");
  const message = page.locator('form[data-form="Contact"] [name="message"]');
  await expect(message).toHaveValue(/example\.com/);
  await expect(page.locator('form[data-form="Contact"] [name="subject"]')).toHaveValue(/review/i);
});

test("contact form validates required fields and blocks instant bot submits", async ({ page }) => {
  await page.goto("/#contact");
  const form = page.locator('form[data-form="Contact"]');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator("[data-form-status]")).toContainText(/Fill in|moment/i);
});

test("service page proposal button opens the quote dialog", async ({ page, isMobile }) => {
  await page.goto("/seo-services");
  await page.fill("#wb-hero", "example.com");
  await page.click(".svc-hero .website-bar button[type=submit]");
  await expect(page.locator("dialog#quote")).toBeVisible();
});

test("every service page has a reviews section and hero dashboard", async ({ page }) => {
  for (const path of ["/seo-services", "/web-development", "/digital-marketing"]) {
    await page.goto(path);
    await expect(page.locator("#reviews .rv")).toHaveCount(3);
    await expect(page.locator(".svc-hero .hx")).toHaveCount(1);
  }
});

test("desktop mega menu opens and links to service pages", async ({ page, isMobile }, info) => {
  test.skip(info.project.name !== "desktop", "desktop only");
  await page.goto("/");
  await page.click(".nav-mega__toggle");
  const links = page.locator(".mega a[href*='seo-services']");
  await expect(links.first()).toBeVisible();
});

test("mobile menu and contact bar work", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "mobile only");
  await page.goto("/");
  await expect(page.locator(".mobile-bar")).toBeVisible();
  await page.click("[data-nav-toggle]");
  await expect(page.locator("#mobile-menu")).toBeVisible();
});

test("@smoke unknown address shows the custom 404 page", async ({ page }) => {
  const res = await page.goto("/this-page-does-not-exist");
  expect(res && res.status()).toBe(404);
  await expect(page.locator("h1")).toContainText(/not exist|not found/i);
});

test("@smoke robots, sitemap and manifest are served", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap:");
  expect(robots).not.toMatch(/Disallow: \/\s*$/m);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const p of ["/seo-services", "/web-development", "/digital-marketing"]) expect(sitemap).toContain(`https://pkitsol.com${p}`);
  expect((await request.get("/manifest.webmanifest")).ok()).toBeTruthy();
});

test("no horizontal scroll on any page", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});

test("internal links on the home page resolve", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop", "once is enough");
  await page.goto("/");
  const hrefs = await page.$$eval("a[href^='/']", (as) => [...new Set(as.map((a) => a.getAttribute("href").split("#")[0]))]);
  for (const href of hrefs.filter(Boolean)) {
    const res = await request.get(href);
    expect(res.status(), href).toBeLessThan(400);
  }
});
