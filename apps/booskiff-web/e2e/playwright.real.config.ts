import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./real/tests",
  timeout: 45_000,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "e2e/playwright-report/real", open: "never" }]],
  outputDir: "test-results/real",
  use: {
    baseURL: "http://127.0.0.1:3211",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
});
