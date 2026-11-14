// Playwright: functional, SEO and accessibility smoke tests against the built site (dist/).
// Local run:  npm run build && npx playwright install chromium && npm test
const { defineConfig, devices } = require("@playwright/test");
const chrome = process.env.PW_CHROME ? { launchOptions: { executablePath: process.env.PW_CHROME } } : {};

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: process.env.BASE_URL || "http://localhost:4173", trace: "retain-on-failure", ...chrome },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...chrome } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true, ...chrome } },
    { name: "mobile", use: { ...devices["Pixel 7"], ...chrome } }
  ],
  webServer: process.env.BASE_URL ? undefined : { command: "node scripts/serve.mjs dist 4173", port: 4173, reuseExistingServer: true }
});
