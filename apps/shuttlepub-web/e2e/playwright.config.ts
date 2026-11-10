import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "e2e/playwright-report", open: "never" }]],
  outputDir: "e2e/test-results",
  use: {
    baseURL: "http://127.0.0.1:3231",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
});
