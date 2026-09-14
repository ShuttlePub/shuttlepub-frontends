import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { z } from "zod";
import { captureCases, catalogSchema } from "./cases.ts";

const baseURL = z.url().parse(process.env.CATALOG_URL ?? "http://127.0.0.1:3220");
const output = resolve(process.env.CAPTURE_DIR ?? ".visual/actual");
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
});
try {
  const context = await browser.newContext({
    baseURL, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
    locale: "en-US", timezoneId: "UTC", colorScheme: "dark", reducedMotion: "reduce",
  });
  const response = await context.request.get("/manifest.json");
  expect(response.ok()).toBe(true);
  const cases = captureCases(catalogSchema.parse(await response.json()));
  expect(new Set(cases.map((item) => item.filename)).size).toBe(cases.length);
  await mkdir(output, { recursive: true });
  for (const item of cases) {
    const page = await context.newPage();
    await page.addInitScript(({ color, shape }) => {
      localStorage.setItem("ratcap-color", color);
      localStorage.setItem("ratcap-shape", shape);
    }, item);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (res) => { if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`); });
    await page.goto(item.url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("data-color", item.color);
    await expect(page.locator("html")).toHaveAttribute("data-shape", item.shape);
    const story = page.locator(item.selector);
    await expect(story).toBeVisible();
    await story.screenshot({ path: resolve(output, item.filename), animations: "disabled", caret: "hide" });
    expect(errors).toEqual([]);
    await page.close();
  }
  console.info(`Captured ${cases.length} catalog screenshots in ${output}`);
} finally {
  await browser.close();
}
