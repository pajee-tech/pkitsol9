// @ts-check
// Every in-page CTA must land its section right under the sticky header,
// and every "#quote" CTA on service pages must open the proposal dialog.
const { test, expect } = require("@playwright/test");

const PAGES = ["/", "/seo-services", "/web-development", "/digital-marketing", "/privacy-policy"];

for (const path of PAGES) {
  test(`CTA anchors land on the right section: ${path}`, async ({ page }, info) => {
    test.skip(info.project.name === "tablet", "desktop + mobile cover it");
    test.setTimeout(120000);
    await page.goto(path);
    const links = await page.$$eval("a[href*='#']", (as) => as
      .filter((a) => a.offsetParent !== null && !a.closest("[role=tablist]") && !a.closest("dialog") && !a.closest(".mega") && !a.closest("#mobile-menu"))
      .map((a, i) => { a.setAttribute("data-t", String(i)); return { i, href: a.getAttribute("href"), text: (a.textContent || "").trim().slice(0, 40) }; })
      .filter((l) => !/#i-/.test(l.href) && l.href !== "#"));
    for (const l of links) {
      if (/Skip to/.test(l.text)) continue;
      const url = new URL(l.href, "http://x" + path);
      const samePage = l.href.startsWith("#") || (url.pathname.replace(/\/$/, "") || "/") === (path.replace(/\/$/, "") || "/");
      if (!samePage || !url.hash) continue;
      await page.evaluate(() => window.scrollTo(0, 0));
      const link = page.locator(`[data-t="${l.i}"]`);
      if (!(await link.isVisible())) continue;
      await link.click();
      if (url.hash === "#quote") {
        await expect(page.locator("dialog#quote"), l.text).toBeVisible();
        await page.locator("[data-quote-close]").click();
        continue;
      }
      await page.waitForTimeout(1900);
      const r = await page.evaluate((id) => {
        const t = document.getElementById(id); const h = document.querySelector(".site-header");
        return { top: Math.round(t.getBoundingClientRect().top), header: Math.round(h.getBoundingClientRect().bottom), max: document.documentElement.scrollHeight - innerHeight, y: Math.round(scrollY) };
      }, url.hash.slice(1));
      const atBottom = Math.abs(r.y - r.max) < 3; // sections near the page end cannot reach the top
      if (!atBottom) expect(Math.abs(r.top - r.header), `${l.text} -> ${url.hash} (top ${r.top}, header ${r.header})`).toBeLessThanOrEqual(16);
      else expect(r.top, `${l.text} -> ${url.hash} visible`).toBeLessThan(800);
    }
  });
}

test("cross-page link /#contact lands on the contact form", async ({ page }) => {
  await page.goto("/seo-services");
  await page.goto("/#contact");
  await page.waitForTimeout(1500);
  const top = await page.evaluate(() => Math.round(document.getElementById("contact").getBoundingClientRect().top));
  const header = await page.evaluate(() => Math.round(document.querySelector(".site-header").getBoundingClientRect().bottom));
  expect(Math.abs(top - header)).toBeLessThanOrEqual(16);
});
